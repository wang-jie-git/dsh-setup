/**
 * User Profile Engine — 辩证用户建模
 *
 * 受 Hermes Honcho 辩证建模启发（RFC-06 Phase C）。
 * 不只是"存-取"用户偏好，而是：
 * 1. 矛盾检测 — 新观察与历史记录对比，发现不一致
 * 2. 置信度衰减 — 旧观察随时间降低置信度
 * 3. 观点演化 — 跟踪偏好随时间的变化轨迹
 *
 * 使用方式：
 *   const engine = new UserProfileEngine(db);
 *   engine.observe("preference", "风格", "偏好简洁", { confidence: 0.8 });
 *   engine.observe("preference", "风格", "需要详细说明", { confidence: 0.7 });
 *   // → 返回矛盾检测结果
 *
 *   const profile = engine.getProfile("default");
 *   // → 返回当前用户画像（含矛盾列表）
 *
 * 设计原则：
 * - 轻量级：无 LLM 依赖，纯规则匹配
 * - 兼容现有 MemoryNode：复用 decision + insight 节点类型
 * - 可进化：观点按时间线存储，支持回溯
 */
export const DEFAULT_MEMORY_CONFIG = {
    ttlDays: 90,
    decayRate: 0.02,
    contradictionThreshold: 0.3,
    minConfidenceForContradiction: 0.5,
};
// ===== User Profile Engine =====
export class UserProfileEngine {
    db;
    config;
    // 矛盾检测阈值：同一 domain 下，两条观察的内容相似度低于此值视为矛盾
    static DEFAULT_CONTRADICTION_THRESHOLD = 0.3;
    // 置信度衰减：每天衰减比例
    static DEFAULT_CONFIDENCE_DECAY_PER_DAY = 0.02;
    // 观察过期时间（天）：超过此时间未更新的观察被标记为低置信度
    static DEFAULT_OBSERVATION_TTL_DAYS = 90;
    constructor(db, config = {}) {
        this.db = db;
        this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    }
    /**
     * 更新配置
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /**
     * 获取当前配置
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * 记录一条用户观察
     *
     * 流程：
     * 1. 创建/更新 observation 记忆节点
     * 2. 与同 domain 的已有观察对比，检测矛盾
     * 3. 如果检测到矛盾，创建 contradicts 边
     * 4. 返回观察结果和矛盾列表
     */
    observe(type, domain, content, options = {}) {
        const userId = options.userId ?? "default";
        const confidence = options.confidence ?? 0.7;
        const sourceSession = options.sourceSession ?? null;
        const tags = options.tags ?? ["user_profile", domain, type];
        const now = Date.now();
        // 查找同 domain 同类型的最新观察
        const existing = this._findLatestObservation(type, domain, userId);
        // 创建观察节点
        const observationId = `obs-${userId}-${type}-${domain}-${now}`;
        const node = this.db.createNode({
            title: `[${type}] ${domain}: ${content}`,
            summary: content,
            body: JSON.stringify({
                type,
                domain,
                confidence,
                userId,
                sourceSession,
                contradicted: false,
                contradictedBy: null,
            }),
            importance: Math.round(confidence * 10),
            status: "active",
            source: "system",
            sourceSession: sourceSession ?? null,
            tags: [...new Set(["user_profile", type, domain, ...tags])],
            nodeType: "insight",
            ttlDays: this.config.ttlDays,
            scope: "public",
            tierMin: 1,
            negativeExamples: [],
            isDeprecated: false,
            deprecatedAt: null,
            userId,
        });
        const observation = {
            id: node.id,
            type,
            domain,
            content,
            confidence,
            sourceSession,
            createdAt: now,
            updatedAt: now,
            tags,
            contradicted: false,
            contradictedBy: null,
        };
        // 矛盾检测
        const contradictions = [];
        if (existing) {
            const similarity = this._computeSimilarity(content, existing.content);
            // 如果语义相似度低且置信度都高，可能矛盾
            if (similarity < this.config.contradictionThreshold &&
                confidence >= this.config.minConfidenceForContradiction &&
                existing.confidence >= this.config.minConfidenceForContradiction) {
                // 用时效性判断谁更新：新观察覆盖旧观察
                const message = this._buildContradictionMessage(type, domain, existing.content, content, existing.createdAt, now);
                // 标记旧观察为矛盾（更新 body 和状态）
                const existingUserId = existing.userId ?? "default";
                this.db.updateNode(existing.id, {
                    status: "pending_review",
                    tags: [...existing.tags, "contradicted"],
                    body: JSON.stringify({
                        type: existing.type,
                        domain: existing.domain,
                        confidence: existing.confidence,
                        userId: existingUserId,
                        sourceSession: existing.sourceSession,
                        contradicted: true,
                        contradictedBy: node.id,
                    }),
                });
                // 创建 contradicts 边（新 → 旧）
                this.db.linkMemoryToMemory(node.id, existing.id, "contradicts", 0.8, `${type}:${domain} — "${existing.content}" → "${content}"`);
                // 更新新观察节点的 body，持久化 contradicted 标记
                this.db.updateNode(node.id, {
                    body: JSON.stringify({
                        type,
                        domain,
                        confidence,
                        userId,
                        sourceSession,
                        contradicted: true,
                        contradictedBy: existing.id,
                    }),
                });
                contradictions.push({
                    existing: existing,
                    message,
                });
                observation.contradicted = true;
                observation.contradictedBy = existing.id;
            }
        }
        return {
            observation,
            contradictions,
            isNew: !existing,
        };
    }
    /**
     * 获取用户画像
     *
     * 聚合所有观察，按 domain 分组，
     * 返回每个 domain 的核心观点和矛盾历史。
     */
    getProfile(userId = "default") {
        const rawDb = this.db.getRawDb();
        // 获取所有用户画像观察节点
        const rows = rawDb
            .prepare(`SELECT * FROM memory_nodes
         WHERE user_id = ?
           AND node_type = 'insight'
           AND tags LIKE '%"user_profile"%'
           AND status != 'archived'
         ORDER BY created_at DESC`)
            .all(userId);
        const observations = rows.map((r) => this._rowToObservation(r));
        // 按 domain 分组
        const domainGroups = new Map();
        for (const obs of observations) {
            if (!domainGroups.has(obs.domain)) {
                domainGroups.set(obs.domain, []);
            }
            domainGroups.get(obs.domain).push(obs);
        }
        // 构建 traits
        const traits = [];
        const contradictionPairs = new Set();
        for (const [domain, obsList] of domainGroups) {
            // 按类型分组
            const typeGroups = new Map();
            for (const obs of obsList) {
                if (!typeGroups.has(obs.type))
                    typeGroups.set(obs.type, []);
                typeGroups.get(obs.type).push(obs);
            }
            for (const [type, typedObs] of typeGroups) {
                // 按时间排序
                typedObs.sort((a, b) => b.createdAt - a.createdAt);
                // 找到当前置信度最高的（非矛盾的优先）
                const active = typedObs.filter((o) => !o.contradicted);
                const current = active.length > 0
                    ? active.reduce((a, b) => (a.confidence >= b.confidence ? a : b))
                    : typedObs[0];
                // 找矛盾
                const contradictions = [];
                for (const obs of typedObs) {
                    if (obs.contradicted && obs.contradictedBy) {
                        // 创建 pair key，确保只计数一次（按字母序）
                        const pairKey = [obs.id, obs.contradictedBy].sort().join("→");
                        if (!contradictionPairs.has(pairKey)) {
                            contradictionPairs.add(pairKey);
                            const contradictor = typedObs.find((o) => o.id === obs.contradictedBy);
                            if (contradictor) {
                                contradictions.push({
                                    old: obs.content,
                                    new: contradictor.content,
                                    detectedAt: contradictor.createdAt,
                                });
                            }
                        }
                    }
                }
                // 历史版本
                const history = typedObs.map((o) => ({
                    content: o.content,
                    confidence: o.confidence,
                    timestamp: o.createdAt,
                }));
                traits.push({
                    domain: `${type}:${domain}`,
                    current: current.content,
                    confidence: this._applyDecay(current.confidence, current.updatedAt),
                    history,
                    hasContradiction: contradictions.length > 0,
                    contradictions,
                });
            }
        }
        // 按置信度排序
        traits.sort((a, b) => b.confidence - a.confidence);
        const strongTraitCount = traits.filter((t) => t.confidence >= 0.7).length;
        const totalObservationCount = observations.length;
        return {
            userId,
            traits,
            observations,
            contradictionCount: contradictionPairs.size,
            lastUpdated: Date.now(),
            strongTraitCount,
            totalObservationCount,
        };
    }
    /**
     * 获取用户画像摘要（用于上下文注入）
     *
     * 返回格式化的文本摘要，可直接注入系统 prompt。
     */
    getProfileSummary(userId = "default", maxTraits = 10) {
        const profile = this.getProfile(userId);
        if (profile.traits.length === 0)
            return "";
        const lines = [`[用户画像: ${userId}]`];
        const topTraits = profile.traits.slice(0, maxTraits);
        for (const trait of topTraits) {
            const badge = trait.hasContradiction ? " ⚠️" : "";
            lines.push(`- ${trait.domain}: ${trait.current} (置信度 ${Math.round(trait.confidence * 100)}%)${badge}`);
        }
        if (profile.contradictionCount > 0) {
            lines.push(`\n⚠️ 检测到 ${profile.contradictionCount} 处矛盾，建议关注。`);
        }
        return lines.join("\n");
    }
    /**
     * 获取系统 Prompt 片段（自动注入用）
     *
     * 返回格式化的用户画像摘要，可直接注入到系统 prompt 中。
     * 包含关键特征、矛盾警告和沟通偏好。
     */
    getSystemPromptSnippet(userId = "default", maxTraits = 5) {
        const summary = this.getProfileSummary(userId, maxTraits);
        if (!summary) {
            return "";
        }
        const lines = [
            "## 用户画像",
            "",
            "以下是根据历史对话观察到的用户特征：",
            "",
            summary,
            "",
            "> 💡 **使用建议**",
            "> - 根据用户偏好调整沟通风格",
            "> - 如检测到 ⚠️ 矛盾，主动确认用户最新偏好",
            "> - 随着时间推移，置信度会衰减，优先参考近期观察",
        ];
        return lines.join("\n");
    }
    /**
     * 删除观察（软删除）
     *
     * 将观察标记为 archived，不物理删除。
     */
    deleteObservation(observationId) {
        try {
            this.db.updateNode(observationId, {
                status: "archived",
                importance: 1,
            });
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * 获取观察详情
     */
    getObservation(observationId) {
        try {
            const rawDb = this.db.getRawDb();
            const rows = rawDb
                .prepare(`SELECT * FROM memory_nodes WHERE id = ? AND status = 'active'`)
                .all(observationId);
            if (rows.length === 0)
                return null;
            return this._rowToObservation(rows[0]);
        }
        catch {
            return null;
        }
    }
    /**
     * 统计用户画像健康度
     */
    getHealthStats(userId = "default") {
        const profile = this.getProfile(userId);
        const now = Date.now();
        const activeObservations = profile.observations.filter((o) => o.contradicted === false);
        const avgConfidence = activeObservations.length > 0
            ? activeObservations.reduce((sum, o) => sum + o.confidence, 0) / activeObservations.length
            : 0;
        const ages = profile.observations.map((o) => now - o.createdAt);
        const oldestAge = ages.length > 0 ? Math.max(...ages) : 0;
        const newestAge = ages.length > 0 ? Math.min(...ages) : 0;
        return {
            totalTraits: profile.traits.length,
            strongTraits: profile.strongTraitCount,
            contradictions: profile.contradictionCount,
            avgConfidence,
            oldestObservationAge: oldestAge,
            newestObservationAge: newestAge,
            needsRefresh: profile.traits.length > 0 && (profile.contradictionCount > 0 || avgConfidence < 0.5),
        };
    }
    /**
     * 清理过期观察
     */
    refreshExpired(dryRun = true) {
        const rawDb = this.db.getRawDb();
        const cutoff = Date.now() - this.config.ttlDays * 86400000;
        const expired = rawDb
            .prepare(`SELECT id FROM memory_nodes
         WHERE node_type = 'insight'
           AND tags LIKE '%"user_profile"%'
           AND updated_at < ?
           AND status = 'active'`)
            .all(cutoff);
        if (dryRun) {
            return { archived: expired.length };
        }
        for (const row of expired) {
            this.db.updateNode(row.id, {
                status: "archived",
                importance: 1,
            });
        }
        return { archived: expired.length };
    }
    // ===== Private: Helpers =====
    /**
     * 查找同 domain 同类型的最新观察
     *
     * 优先按 body JSON 精确匹配，降级到 tag 宽松匹配。
     */
    _findLatestObservation(type, domain, userId) {
        const rawDb = this.db.getRawDb();
        // 精确匹配：body JSON 中包含 type + domain
        const bodyLike = `%"type":"${type}","domain":"${domain}"%`;
        const rows = rawDb
            .prepare(`SELECT * FROM memory_nodes
         WHERE user_id = ?
           AND node_type = 'insight'
           AND tags LIKE '%"user_profile"%'
           AND body LIKE ?
           AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`)
            .all(userId, bodyLike);
        if (rows.length > 0) {
            return this._rowToObservation(rows[0]);
        }
        // 宽松匹配：通过 tag 匹配 domain（降级路径）
        const fallback = rawDb
            .prepare(`SELECT * FROM memory_nodes
         WHERE user_id = ?
           AND node_type = 'insight'
           AND tags LIKE '%"user_profile"%'
           AND tags LIKE ?
           AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`)
            .all(userId, `%"${domain}"%`);
        if (fallback.length === 0)
            return null;
        return this._rowToObservation(fallback[0]);
    }
    /**
     * 计算文本相似度（Jaccard 相似度）
     *
     * 轻量级，无 LLM 依赖。
     */
    _computeSimilarity(a, b) {
        const termsA = this._extractTerms(a);
        const termsB = this._extractTerms(b);
        if (termsA.length === 0 && termsB.length === 0)
            return 1;
        if (termsA.length === 0 || termsB.length === 0)
            return 0;
        const setA = new Set(termsA);
        const setB = new Set(termsB);
        let intersection = 0;
        for (const term of setA) {
            if (setB.has(term))
                intersection++;
        }
        const union = new Set([...setA, ...setB]).size;
        return intersection / union;
    }
    /**
     * 构建矛盾信息
     */
    _buildContradictionMessage(type, domain, oldContent, newContent, oldTime, newTime) {
        const oldDate = new Date(oldTime).toISOString().slice(0, 10);
        const newDate = new Date(newTime).toISOString().slice(0, 10);
        const timeDiff = Math.round((newTime - oldTime) / (86400000));
        return `[${type}:${domain}] "${oldContent}" (${oldDate}) → "${newContent}" (${newDate})，间隔 ${timeDiff} 天。`;
    }
    /**
     * 置信度衰减
     */
    _applyDecay(confidence, lastUpdated) {
        const daysSinceUpdate = (Date.now() - lastUpdated) / 86400000;
        const decay = daysSinceUpdate * this.config.decayRate;
        return Math.max(0.1, confidence - decay);
    }
    /**
     * 提取关键词（去停用词）
     */
    _extractTerms(text) {
        const stopWords = new Set([
            "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
            "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着",
            "没有", "看", "好", "自己", "这", "他", "她", "它", "们",
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "being", "have", "has", "had", "do", "does", "did", "will",
            "would", "could", "should", "may", "might", "can", "shall",
            "to", "of", "in", "for", "on", "with", "at", "by", "from",
            "as", "into", "through", "during", "before", "after",
            "and", "but", "or", "nor", "not", "so", "yet", "if", "then",
            "this", "that", "these", "those", "it", "its", "my", "your",
            "我们", "你们", "他们", "这个", "那个", "什么", "怎么", "为什么",
            "偏好", "喜欢", "需要", "想要", "可以", "应该", "会", "能",
        ]);
        return text
            .toLowerCase()
            .split(/[\s,，。！？、；：""''（）()\[\]【】{}]+/)
            .filter((t) => t.length >= 2 && !stopWords.has(t));
    }
    /**
     * 将数据库行转为 Observation
     */
    _rowToObservation(row) {
        let parsedBody = {};
        try {
            parsedBody = JSON.parse(row.body ?? "{}");
        }
        catch {
            // 忽略解析失败
        }
        return {
            id: row.id,
            type: parsedBody.type ?? "preference",
            domain: parsedBody.domain ?? "general",
            content: row.summary ?? "",
            confidence: parsedBody.confidence ?? 0.5,
            sourceSession: parsedBody.sourceSession ?? null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            tags: (() => {
                try {
                    return JSON.parse(row.tags ?? "[]");
                }
                catch {
                    return [];
                }
            })(),
            contradicted: parsedBody.contradicted ?? false,
            contradictedBy: parsedBody.contradictedBy ?? null,
        };
    }
}
//# sourceMappingURL=user-profile.js.map