/**
 * Memory Watchdog — 健康监控 + 评估报告 + 系统通知
 *
 * 职责链：
 *   定期检查 → 发现问题 → 生成评估报告 → 触发通知回调
 *
 * 评估报告 (EvaluationReport) 是结构化的诊断文档，
 * 包含组件状态、错误汇总、趋势分析和修复建议。
 */
// ===== Defaults =====
const DEFAULT_CONFIG = {
    checkIntervalMs: 60000,
    operationTimeoutMs: 5000,
    errorThreshold: 5,
    autoStart: true,
    historySize: 60,
};
// ===== Watchdog =====
export class MemoryWatchdog {
    config;
    memoryDb;
    vectorStore;
    embedder;
    obsidianWriter;
    logger;
    timer = null;
    _status = null;
    _previousStatus = null;
    _startTime = Date.now();
    _healthHistory = [];
    _totalChecks = 0;
    // 操作状态追踪
    _lastWriteOk = true;
    _lastWriteTime = Date.now();
    _lastQueryOk = true;
    _lastQueryTime = Date.now();
    _lastDreamOk = true;
    _lastDreamTime = Date.now();
    onHealthChangeCallbacks = [];
    onUnhealthyCallbacks = [];
    onReportCallbacks = [];
    constructor(memoryDb, vectorStore, embedder, logger, obsidianWriter, config = {}) {
        this.memoryDb = memoryDb;
        this.vectorStore = vectorStore;
        this.embedder = embedder;
        this.logger = logger;
        this.obsidianWriter = obsidianWriter;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    // ===== Operation Status =====
    recordWrite(success) {
        this._lastWriteOk = success;
        this._lastWriteTime = Date.now();
    }
    recordQuery(success) {
        this._lastQueryOk = success;
        this._lastQueryTime = Date.now();
    }
    recordDream(success) {
        this._lastDreamOk = success;
        this._lastDreamTime = Date.now();
    }
    // ===== Callbacks =====
    /** 健康状态变化时触发 */
    onHealthChange(cb) {
        this.onHealthChangeCallbacks.push(cb);
    }
    /** 系统不健康时触发 */
    onUnhealthy(cb) {
        this.onUnhealthyCallbacks.push(cb);
    }
    /** 评估报告生成时触发 */
    onReport(cb) {
        this.onReportCallbacks.push(cb);
    }
    // ===== Health Check =====
    async checkHealth(type = "periodic") {
        const startTime = performance.now();
        const now = Date.now();
        // Graph DB
        const graphDb = await this.checkComponent(async () => {
            const stats = this.memoryDb.getStats();
            if (stats.totalNodes < 0)
                throw new Error("Invalid node count");
        });
        // Vector Store
        const vectorStore = await this.checkComponent(async () => {
            const vecStats = this.vectorStore.stats();
            return { totalEntries: vecStats.totalEntries };
        });
        // Embedder
        const embedder = await this.checkComponent(async () => {
            const vec = await this.embedder.embed("health check");
            if (!vec || vec.length === 0)
                throw new Error("Embedder returned empty vector");
        });
        // Obsidian Writer (if configured)
        let obsidianWriter = { ok: true };
        if (this.obsidianWriter) {
            obsidianWriter = await this.checkComponent(async () => {
                const count = this.obsidianWriter.count?.() ?? 0;
                return { count };
            });
        }
        // Recent errors
        const recentErrors = this.logger.getRecentErrorCount(3600000);
        // Operations health
        const operations = {
            lastWriteOk: this._lastWriteOk,
            lastWriteAgoMs: now - this._lastWriteTime,
            lastQueryOk: this._lastQueryOk,
            lastQueryAgoMs: now - this._lastQueryTime,
            lastDreamOk: this._lastDreamOk,
            lastDreamAgoMs: now - this._lastDreamTime,
        };
        // Overall health
        const healthy = graphDb.ok && vectorStore.ok && embedder.ok && obsidianWriter.ok
            && recentErrors < this.config.errorThreshold;
        // Score (0-10)
        let score = 10;
        if (!graphDb.ok)
            score -= 3;
        if (!vectorStore.ok)
            score -= 2;
        if (!embedder.ok)
            score -= 2;
        if (!obsidianWriter.ok)
            score -= 1;
        if (recentErrors >= this.config.errorThreshold)
            score -= 2;
        score = Math.max(0, Math.min(10, score));
        const status = {
            healthy,
            timestamp: Date.now(),
            uptimeMs: now - this._startTime,
            graphDb,
            vectorStore: { ...vectorStore, ...vectorStore.extra },
            embedder,
            obsidianWriter: { ...obsidianWriter, ...obsidianWriter.extra },
            operations,
            recentErrors,
            score,
        };
        // Clean up extra fields
        delete status.vectorStore.extra;
        delete status.obsidianWriter.extra;
        // Store history
        this._healthHistory.push(status);
        if (this._healthHistory.length > this.config.historySize) {
            this._healthHistory.shift();
        }
        this._totalChecks++;
        this._previousStatus = this._status;
        this._status = status;
        // Trigger callbacks
        const previous = this._previousStatus;
        const healthChanged = previous && previous.healthy !== healthy;
        if (healthChanged) {
            for (const cb of this.onHealthChangeCallbacks) {
                try {
                    cb(status, previous);
                }
                catch { /* 不阻塞 */ }
            }
        }
        if (!healthy) {
            this.logger.warn("watchdog", "checkHealth", `系统不健康 评分:${score}/10 graphDb:${graphDb.ok} vectorStore:${vectorStore.ok} embedder:${embedder.ok} 错误数:${recentErrors}`);
            // 生成评估报告并通知
            const report = this.generateReport(status, type);
            for (const cb of this.onReportCallbacks) {
                try {
                    cb(report);
                }
                catch { /* 不阻塞 */ }
            }
            for (const cb of this.onUnhealthyCallbacks) {
                try {
                    cb(status);
                }
                catch { /* 不阻塞 */ }
            }
        }
        const elapsed = Math.round(performance.now() - startTime);
        if (elapsed > 1000) {
            this.logger.warn("watchdog", "checkHealth", `健康检查耗时 ${elapsed}ms，超过预期`);
        }
        return status;
    }
    // ===== Evaluation Report =====
    /**
     * 生成系统评估报告。
     * 报告包含：组件状态、错误汇总、趋势分析、修复建议。
     * 可在不健康时自动生成，也可手动调用。
     */
    generateReport(status, type = "on_demand") {
        const s = status ?? this._status;
        const now = Date.now();
        // ── 默认状态（无数据时） ──
        if (!s) {
            return {
                id: crypto.randomUUID(),
                timestamp: now,
                type,
                uptime: this.getUptime(),
                overallScore: 10,
                healthy: true,
                summary: "系统初始化中，尚无数据",
                summaryZh: "系统初始化中，尚无数据",
                components: [],
                errorSummary: [],
                totalErrorsLastHour: 0,
                operations: {
                    lastWriteOk: true, lastWriteAgo: "N/A",
                    lastQueryOk: true, lastQueryAgo: "N/A",
                    lastDreamOk: true, lastDreamAgo: "N/A",
                },
                trend: "stable",
                scoreHistory: [],
                recommendations: ["系统初始化中，请等待首次健康检查"],
                raw: {},
            };
        }
        // ── 组件评分 ──
        const components = this.scoreComponents(s);
        // ── 错误汇总 ──
        const recentErrors = this.logger.getErrorsSince(now - 3600000);
        const errorSummary = this.summarizeErrors(recentErrors);
        // ── 趋势 ──
        const trend = this.computeTrend();
        const scoreHistory = this._healthHistory.map((h) => h.score);
        // ── 操作格式化 ──
        const fmt = (agoMs) => {
            if (agoMs < 60000)
                return `${Math.round(agoMs / 1000)}s 前`;
            if (agoMs < 3600000)
                return `${Math.round(agoMs / 60000)}m 前`;
            return `${Math.round(agoMs / 3600000)}h 前`;
        };
        const ops = {
            lastWriteOk: s.operations.lastWriteOk,
            lastWriteAgo: fmt(s.operations.lastWriteAgoMs),
            lastQueryOk: s.operations.lastQueryOk,
            lastQueryAgo: fmt(s.operations.lastQueryAgoMs),
            lastDreamOk: s.operations.lastDreamOk,
            lastDreamAgo: fmt(s.operations.lastDreamAgoMs),
        };
        // ── 推荐建议 ──
        const recommendations = this.generateRecommendations(s);
        // ── 总结 ──
        const { summary, summaryZh } = this.summarize(s);
        return {
            id: crypto.randomUUID(),
            timestamp: now,
            type,
            uptime: this.getUptime(),
            overallScore: s.score,
            healthy: s.healthy,
            summary,
            summaryZh,
            components,
            errorSummary,
            totalErrorsLastHour: s.recentErrors,
            operations: ops,
            trend,
            scoreHistory,
            recommendations,
            raw: s,
        };
    }
    /** 生成格式化文本报告（可直接输出到控制台/通知） */
    formatReport(report) {
        const r = report ?? this.generateReport();
        const lines = [];
        // ── 总览 ──
        lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        lines.push(`  记忆系统评估报告`);
        lines.push(`  ${r.summaryZh}`);
        lines.push(`  评分: ${r.overallScore}/10  |  状态: ${r.healthy ? "✅ 健康" : "⚠ 异常"}  |  趋势: ${this.trendEmoji(r.trend)}`);
        lines.push(`  运行时长: ${r.uptime}  |  报告类型: ${r.type}`);
        lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        // ── 组件 ──
        lines.push("");
        lines.push("📊 组件状态:");
        for (const c of r.components) {
            const icon = c.status === "healthy" ? "✅" : c.status === "degraded" ? "⚠" : "❌";
            const lat = c.latencyMs != null ? ` ${c.latencyMs}ms` : "";
            const err = c.error ? `  → ${c.error}` : "";
            lines.push(`  ${icon} ${c.name.padEnd(16)} ${c.score}/10${lat}${err}`);
        }
        // ── 操作 ──
        lines.push("");
        lines.push("⚡ 操作状态:");
        for (const [name, ok, ago] of [
            ["写入", r.operations.lastWriteOk, r.operations.lastWriteAgo],
            ["查询", r.operations.lastQueryOk, r.operations.lastQueryAgo],
            ["梦境", r.operations.lastDreamOk, r.operations.lastDreamAgo],
        ]) {
            lines.push(`  ${ok ? "✅" : "❌"} ${name.padEnd(8)} ${ago}`);
        }
        // ── 错误 ──
        if (r.errorSummary.length > 0) {
            lines.push("");
            lines.push(`🚨 近期错误 (${r.totalErrorsLastHour} 条/小时):`);
            for (const e of r.errorSummary.slice(0, 5)) {
                lines.push(`  [${e.module}] ${e.message} (×${e.count})`);
            }
            if (r.errorSummary.length > 5) {
                lines.push(`  ... 还有 ${r.errorSummary.length - 5} 类错误未显示`);
            }
        }
        // ── 评分趋势 ──
        if (r.scoreHistory.length >= 2) {
            const window = r.scoreHistory.slice(-10);
            const bar = window.map((s) => {
                const full = Math.round(s / 2);
                return "█".repeat(full) + "░".repeat(5 - full);
            }).join(" ");
            lines.push("");
            lines.push(`📈 评分趋势 (最近 ${window.length} 次):`);
            lines.push(`  ${bar}`);
        }
        // ── 建议 ──
        if (r.recommendations.length > 0) {
            lines.push("");
            lines.push("💡 修复建议:");
            for (const rec of r.recommendations) {
                lines.push(`  • ${rec}`);
            }
        }
        lines.push("");
        lines.push(`报告 ID: ${r.id}  |  生成时间: ${new Date(r.timestamp).toLocaleString()}`);
        return lines.join("\n");
    }
    // ===== Getters =====
    get lastStatus() {
        return this._status;
    }
    get score() {
        return this._status?.score ?? 10;
    }
    get totalChecks() {
        return this._totalChecks;
    }
    get healthHistory() {
        return [...this._healthHistory];
    }
    // ===== Auto Check =====
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => {
            this.checkHealth("periodic").catch((err) => {
                this.logger.error("watchdog", "autoCheck", `定时检查失败: ${err.message}`, err);
            });
        }, this.config.checkIntervalMs);
        this.logger.info("watchdog", "start", `健康检查已启动，间隔 ${this.config.checkIntervalMs}ms`);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.logger.info("watchdog", "stop", "健康检查已停止");
    }
    getUptime() {
        const ms = Date.now() - this._startTime;
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${hours}h ${minutes}m ${seconds}s`;
    }
    // ===== Private: Component Scoring =====
    scoreComponents(s) {
        return [
            {
                name: "图数据库",
                status: s.graphDb.ok ? "healthy" : "down",
                score: s.graphDb.ok ? 10 : 0,
                error: s.graphDb.error,
                latencyMs: s.graphDb.latencyMs,
                detail: s.graphDb.ok ? undefined : "图数据库无响应，记忆关联查询将失败",
            },
            {
                name: "向量库",
                status: s.vectorStore.ok ? "healthy" : "down",
                score: s.vectorStore.ok ? 10 : 0,
                error: s.vectorStore.error,
                latencyMs: s.vectorStore.latencyMs,
                detail: s.vectorStore.ok
                    ? `共 ${s.vectorStore.totalEntries} 条向量索引`
                    : "向量库不可用，语义搜索将降级",
            },
            {
                name: "Embedder",
                status: s.embedder.ok ? "healthy" : "down",
                score: s.embedder.ok ? 10 : 0,
                error: s.embedder.error,
                latencyMs: s.embedder.latencyMs,
                detail: s.embedder.ok ? undefined : "模型无法响应，任何写入/查询都会失败",
            },
            {
                name: "Obsidian 同步",
                status: s.obsidianWriter.ok ? "healthy" : "degraded",
                score: s.obsidianWriter.ok ? 10 : 3,
                error: s.obsidianWriter.error,
                latencyMs: s.obsidianWriter.latencyMs,
                detail: s.obsidianWriter.ok
                    ? s.obsidianWriter.count != null ? `已同步 ${s.obsidianWriter.count} 篇` : ""
                    : "Obsidian 同步已关闭或初始化失败",
            },
        ];
    }
    // ===== Private: Error Summarization =====
    summarizeErrors(errors) {
        const groups = new Map();
        for (const e of errors) {
            const key = `${e.module}:${e.operation}:${e.message}`;
            const existing = groups.get(key);
            if (existing) {
                existing.count++;
                existing.lastSeen = Math.max(existing.lastSeen, e.timestamp);
                existing.firstSeen = Math.min(existing.firstSeen, e.timestamp);
            }
            else {
                groups.set(key, { count: 1, firstSeen: e.timestamp, lastSeen: e.timestamp });
            }
        }
        return [...groups.entries()]
            .map(([_, v]) => {
            const parts = _.split(":");
            return {
                module: parts[0] ?? "unknown",
                operation: parts[1] ?? "unknown",
                message: parts.slice(2).join(":") ?? "unknown",
                count: v.count,
                firstSeen: v.firstSeen,
                lastSeen: v.lastSeen,
            };
        })
            .sort((a, b) => b.count - a.count);
    }
    // ===== Private: Trend =====
    computeTrend() {
        if (this._healthHistory.length < 3)
            return "stable";
        const recent = this._healthHistory.slice(-5);
        const scores = recent.map((h) => h.score);
        const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
        const secondHalf = scores.slice(Math.floor(scores.length / 2));
        const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        if (avg2 - avg1 > 0.5)
            return "improving";
        if (avg1 - avg2 > 0.5)
            return "degrading";
        return "stable";
    }
    // ===== Private: Recommendations =====
    generateRecommendations(s) {
        const recs = [];
        if (!s.graphDb.ok) {
            recs.push("图数据库连接失败 — 检查 codegraph.db 文件权限或磁盘空间");
            recs.push("运行 ai-memory check 重置索引");
        }
        if (!s.vectorStore.ok) {
            recs.push("向量库异常 — 尝试运行 ai-memory rebuild 重建向量索引");
        }
        if (!s.embedder.ok) {
            recs.push(`Embedding 模型不可用 — ${s.embedder.error}`);
            recs.push("检查模型文件是否完整，或切换到 API embedder");
        }
        if (!s.obsidianWriter.ok) {
            recs.push("Obsidian 同步异常 — 检查 vault 路径配置和写入权限");
        }
        if (!s.operations.lastWriteOk) {
            recs.push("最近写入失败 — 检查存储空间和 Embedder 状态");
        }
        if (!s.operations.lastDreamOk) {
            recs.push("最近梦境整理失败 — 运行 ai-memory dream 手动触发");
        }
        if (s.recentErrors >= this.config.errorThreshold) {
            recs.push(`1 小时内错误数 (${s.recentErrors}) 超过阈值 (${this.config.errorThreshold}) — 建议检查日志定位根因`);
        }
        if (s.score < 4) {
            recs.push("系统健康严重不足 — 建议立即排查并重启记忆系统");
        }
        return recs;
    }
    // ===== Private: Summary =====
    summarize(s) {
        const failed = [
            !s.graphDb.ok && "GraphDB",
            !s.vectorStore.ok && "VectorStore",
            !s.embedder.ok && "Embedder",
            !s.obsidianWriter.ok && "Obsidian",
        ].filter(Boolean);
        if (failed.length === 0) {
            return {
                summary: `All systems operational, score ${s.score}/10`,
                summaryZh: `所有组件正常运行，评分 ${s.score}/10`,
            };
        }
        return {
            summary: `${failed.join(", ")} malfunctioning, score ${s.score}/10`,
            summaryZh: `${failed.join("、")} 异常，评分 ${s.score}/10`,
        };
    }
    trendEmoji(t) {
        switch (t) {
            case "improving": return "📈";
            case "degrading": return "📉";
            default: return "➡";
        }
    }
    // ===== Private: Component Check =====
    async checkComponent(fn) {
        const start = performance.now();
        try {
            const result = await fn();
            return {
                ok: true,
                latencyMs: Math.round(performance.now() - start),
                extra: result,
            };
        }
        catch (err) {
            return {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
                latencyMs: Math.round(performance.now() - start),
            };
        }
    }
}
//# sourceMappingURL=memory-watchdog.js.map