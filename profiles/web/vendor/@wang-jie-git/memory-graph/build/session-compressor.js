/**
 * Session Compressor — 会话记忆压缩与上下文注入
 *
 * 受 Hermes 跨会话总结启发（Phase A of RFC-06）：
 * 会话结束时自动生成摘要 → 新会话自动注入上下文，
 * 保持跨会话的上下文连续性，而不需要每次都全量检索。
 *
 * 核心设计：
 * 1. compress() — 将一段会话中的记忆压缩为 session_summary 节点
 * 2. getSessionSummaries() — 查询某会话的所有摘要
 * 3. getRecentSummaries() — 获取最近摘要用于新会话上下文注入
 * 4. injectContext() — 为新会话准备注入上下文
 * 5. refreshExpired() — 清理过期摘要
 *
 * 复用 One Memory 的 schema：session_summary 节点类型 + summarizes 边关系
 * 与梦境引擎的关系：session-compressor 负责实时轻量压缩，
 * 梦境引擎负责深度归纳和冗余合并，两者互补。
 */
// ===== Session Compressor =====
export class SessionCompressor {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * 压缩一组会话记忆为摘要节点
     *
     * 流程：
     * 1. 检查该会话是否已有摘要（overwrite 或合并）
     * 2. 创建/更新 session_summary 节点
     * 3. 为每条源记忆创建 summarizes 边
     * 4. 返回新摘要
     *
     * 调用方负责生成 title/summary（可调用 LLM），
     * 本模块只做持久化和关联。
     */
    compress(sessionId, memories, options = {}) {
        if (memories.length === 0) {
            throw new Error(`Cannot compress empty session: ${sessionId}`);
        }
        const now = Date.now();
        const overwrite = options.overwrite ?? true;
        const userId = options.userId ?? "default";
        // 计算时间范围
        const timestamps = memories.map((m) => m.createdAt);
        const timeRange = {
            start: Math.min(...timestamps),
            end: Math.max(...timestamps),
        };
        // 计算平均重要性
        const avgImportance = Math.round((memories.reduce((sum, m) => sum + (m.importance ?? 5), 0) /
            memories.length) *
            10) / 10;
        const importance = options.importance ?? avgImportance;
        const tags = options.tags ?? [
            "session_summary",
            ...new Set(memories.flatMap((m) => m.tags ?? [])),
        ];
        // 标题和摘要
        const title = options.title ?? `Session ${sessionId.slice(0, 8)} Summary`;
        const summary = options.summary ?? memories.map((m) => m.summary).join("\n");
        // 查找该会话已有摘要
        const existing = this._findExistingSummary(sessionId, userId);
        let summaryNode;
        if (existing && overwrite) {
            // 更新已有摘要
            this.db.updateNode(existing.id, {
                title,
                summary,
                importance,
                tags,
                updatedAt: now,
            });
            summaryNode = { ...existing, title, summary, importance, tags, updatedAt: now };
        }
        else if (existing && !overwrite) {
            // 追加到已有摘要（合并模式）
            const mergedSummary = existing.summary
                ? `${existing.summary}\n\n---\n\n${summary}`
                : summary;
            this.db.updateNode(existing.id, {
                summary: mergedSummary,
                importance: Math.max(existing.importance, importance),
                tags: [...new Set([...existing.tags, ...tags])],
                updatedAt: now,
            });
            summaryNode = {
                ...existing,
                summary: mergedSummary,
                importance: Math.max(existing.importance, importance),
                tags: [...new Set([...existing.tags, ...tags])],
                updatedAt: now,
            };
        }
        else {
            // 创建新摘要节点
            summaryNode = this.db.createNode({
                title,
                summary,
                body: JSON.stringify({
                    sessionId,
                    memoryCount: memories.length,
                    timeRange,
                    userId,
                }),
                importance,
                status: "active",
                source: "system",
                sourceSession: sessionId,
                tags,
                nodeType: "session_summary",
                ttlDays: 90, // 默认 90 天过期
                scope: options.scope ?? "public",
                tierMin: 1,
                negativeExamples: [],
                isDeprecated: false,
                deprecatedAt: null,
                userId,
            });
        }
        // 为每条源记忆创建 summarizes 边（去重）
        for (const mem of memories) {
            const existingEdges = this.db.getNodeEdges(summaryNode.id);
            const alreadyLinked = existingEdges.some((e) => e.relation === "summarizes" &&
                ((e.sourceId === summaryNode.id && e.targetId === mem.id) ||
                    (e.sourceId === mem.id && e.targetId === summaryNode.id)));
            if (!alreadyLinked) {
                this.db.linkMemoryToMemory(summaryNode.id, mem.id, "summarizes", 1.0, `Summarized from session ${sessionId.slice(0, 8)}`);
            }
        }
        return {
            id: summaryNode.id,
            title,
            summary,
            sessionId,
            memoryCount: memories.length,
            timeRange,
            importance,
            tags,
            createdAt: summaryNode.createdAt,
        };
    }
    /**
     * 获取某会话的所有摘要
     *
     * 通过 sourceSession 字段匹配，按创建时间倒序。
     */
    getSessionSummaries(sessionId, options) {
        const rawDb = this.db.getRawDb();
        const userId = options?.userId;
        const rows = rawDb
            .prepare(`SELECT * FROM memory_nodes
         WHERE node_type = 'session_summary'
           AND source_session = ?
           AND status = 'active'
         ${userId ? "AND user_id = ?" : ""}
         ORDER BY created_at DESC`)
            .all(sessionId, ...(userId ? [userId] : []));
        return rows.map((r) => this._rowToSummary(r));
    }
    /**
     * 获取最近摘要（用于新会话上下文注入）
     *
     * 按重要性 × 时效性加权排序，取 top N。
     */
    getRecentSummaries(limit = 10, options) {
        const rawDb = this.db.getRawDb();
        const userId = options?.userId;
        const minImportance = options?.minImportance ?? 0;
        const now = Date.now();
        // 时效性权重：7 天内满权，之后线性衰减
        const rows = rawDb
            .prepare(`SELECT * FROM memory_nodes
         WHERE node_type = 'session_summary'
           AND status = 'active'
           AND importance >= ?
         ${userId ? "AND user_id = ?" : ""}
         ORDER BY
           (importance * 0.6 +
             CASE
               WHEN (? - created_at) < 604800000 THEN 4.0  -- 7天内：满时效权
               ELSE 4.0 * (1.0 - (? - created_at - 604800000) / 2592000000.0)  -- 30天线性衰减
             END * 0.4
           ) DESC
         LIMIT ?`)
            .all(minImportance, ...(userId ? [userId] : []), now, now, limit);
        return rows.map((r) => this._rowToSummary(r));
    }
    /**
     * 为新会话准备注入上下文
     *
     * 返回结构化的上下文数据，可直接用于：
     * - 系统 prompt 注入
     * - 记忆检索的初始过滤
     * - 用户可见的"上次会话回顾"
     *
     * 排除当前会话的摘要，避免自引用。
     */
    injectContext(options = {}) {
        const maxContexts = options.maxContexts ?? 5;
        const minImportance = options.minImportance ?? 3;
        const maxHours = options.maxHours ?? 72;
        const excludeSessionId = options.excludeSessionId;
        const userId = options.userId;
        const summaries = this.getRecentSummaries(maxContexts * 2, {
            userId,
            minImportance,
        });
        // 过滤
        const filtered = summaries.filter((s) => {
            if (excludeSessionId && s.sessionId === excludeSessionId)
                return false;
            const ageHours = (Date.now() - s.createdAt) / (1000 * 60 * 60);
            return ageHours <= maxHours;
        });
        const contexts = filtered.slice(0, maxContexts).map((s) => ({
            title: s.title,
            summary: s.summary,
            importance: s.importance,
            sessionId: s.sessionId,
            createdAt: s.createdAt,
        }));
        // 计算时间跨度
        const timestamps = contexts.map((c) => c.createdAt);
        const timeSpanHours = timestamps.length > 1
            ? Math.round((Math.max(...timestamps) - Math.min(...timestamps)) /
                (1000 * 60 * 60))
            : 0;
        return {
            contexts,
            totalMemories: contexts.length,
            timeSpanHours,
        };
    }
    /**
     * 清理过期摘要
     *
     * 删除超过 TTL 的 session_summary 节点。
     * 由外部定时器调用（如 cron 或梦境引擎调度）。
     */
    refreshExpired(dryRun = true) {
        const rawDb = this.db.getRawDb();
        const now = Date.now();
        const expired = rawDb
            .prepare(`SELECT id FROM memory_nodes
         WHERE node_type = 'session_summary'
           AND ttl_days IS NOT NULL
           AND (created_at + ttl_days * 86400000) < ?
           AND status = 'active'`)
            .all(now);
        if (dryRun) {
            return { deleted: expired.length };
        }
        for (const row of expired) {
            this.db.deleteNode(row.id);
        }
        return { deleted: expired.length };
    }
    // ===== Private Helpers =====
    /**
     * 查找某会话已有的摘要
     */
    _findExistingSummary(sessionId, userId) {
        const rawDb = this.db.getRawDb();
        const row = rawDb
            .prepare(`SELECT * FROM memory_nodes
         WHERE node_type = 'session_summary'
           AND source_session = ?
           AND user_id = ?
           AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`)
            .get(sessionId, userId);
        if (!row)
            return null;
        // 直接构造 MemoryNode（用 rawDb 查的，绕开 MemoryDatabase 的缓存）
        return {
            id: row.id,
            title: row.title,
            summary: row.summary ?? "",
            body: row.body ?? "",
            contentHash: row.content_hash,
            importance: row.importance ?? 5,
            status: row.status ?? "active",
            source: row.source ?? "system",
            sourceSession: row.source_session ?? null,
            tags: (() => {
                try {
                    return JSON.parse(row.tags ?? "[]");
                }
                catch {
                    return [];
                }
            })(),
            nodeType: row.node_type ?? "session_summary",
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            ttlDays: row.ttl_days ?? null,
            scope: row.scope ?? "public",
            tierMin: row.tier_min ?? 1,
            negativeExamples: [],
            isDeprecated: row.is_deprecated === 1,
            deprecatedAt: row.deprecated_at ?? null,
            userId: row.user_id ?? "default",
            agentId: row.agent_id ?? "unknown",
            confidence: row.confidence ?? 0.6,
            verified: row.verified === 1,
            privacyFlag: row.privacy_flag ?? 0,
            gitBranch: row.git_branch ?? null,
            projectDir: row.project_dir ?? null,
        };
    }
    /**
     * 将数据库行转为 SessionSummary
     */
    _rowToSummary(row) {
        let parsedBody = {};
        try {
            parsedBody = JSON.parse(row.body ?? "{}");
        }
        catch {
            // 忽略解析失败
        }
        return {
            id: row.id,
            title: row.title,
            summary: row.summary ?? "",
            sessionId: parsedBody.sessionId ?? row.source_session ?? "",
            memoryCount: parsedBody.memoryCount ?? 0,
            timeRange: parsedBody.timeRange ?? { start: 0, end: 0 },
            importance: row.importance ?? 5,
            tags: (() => {
                try {
                    return JSON.parse(row.tags ?? "[]");
                }
                catch {
                    return [];
                }
            })(),
            createdAt: row.created_at,
        };
    }
}
//# sourceMappingURL=session-compressor.js.map