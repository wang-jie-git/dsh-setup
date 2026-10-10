/**
 * Procedure Memory — 可执行工作流程记忆
 *
 * 功能：
 * - 记录可复用工作流程（Procedure）
 * - 版本管理（创建、更新、迭代）
 * - 工作流程发现（基于标签、描述、输入输出匹配）
 * - 执行记录（追踪使用情况和成功率）
 * - MCP 工具: procedure_record / procedure_find / procedure_execute
 *
 * 参考: MemoraX Code 的 Procedure Memory 机制
 */
export const DEFAULT_PROCEDURE_CONFIG = {
    enabled: true,
    defaultLimit: 10,
    matchThreshold: 0.5,
    ttlDays: 180,
    minExecutionCountForRecommendation: 3,
};
// ===== Procedure Memory Engine =====
export class ProcedureMemoryEngine {
    db;
    config;
    constructor(db, config = {}) {
        this.db = db;
        this.config = { ...DEFAULT_PROCEDURE_CONFIG, ...config };
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
     * 记录工作流程
     *
     * 将工作流程保存为 procedure 节点。
     */
    record(record) {
        const now = Date.now();
        const id = `proc-${now}-${crypto.randomUUID().slice(0, 8)}`;
        const node = this.db.createNode({
            id,
            title: record.title,
            summary: record.description,
            body: JSON.stringify({
                version: record.version,
                parentId: record.parentId,
                inputs: record.inputs,
                outputs: record.outputs,
                steps: record.steps,
                metadata: record.metadata,
            }),
            importance: 7,
            status: "active",
            source: "system",
            sourceSession: null,
            tags: ["procedure", ...record.metadata.tags, record.metadata.category],
            nodeType: "procedure",
            ttlDays: this.config.ttlDays,
            scope: "public",
            tierMin: 1,
            negativeExamples: [],
            isDeprecated: false,
            deprecatedAt: null,
            userId: record.author,
        });
        const procedure = {
            ...record,
            id: node.id,
            createdAt: now,
            updatedAt: now,
            nodeType: "procedure",
        };
        return procedure;
    }
    /**
     * 查找工作流程
     *
     * 基于标签、描述、输入输出的文本匹配。
     */
    find(query) {
        const limit = query.limit || this.config.defaultLimit;
        // 构建 SQL 查询
        const conditions = ["node_type = 'procedure' AND status = 'active'"];
        const params = [];
        // 标签过滤
        if (query.tags && query.tags.length > 0) {
            const tagConditions = query.tags.map((tag) => `tags LIKE ?`).join(" OR ");
            conditions.push(`(${tagConditions})`);
            query.tags.forEach((tag) => params.push(`%"${tag}"%`));
        }
        // 分类过滤
        if (query.category) {
            conditions.push("tags LIKE ?");
            params.push(`%"${query.category}"%`);
        }
        // 作者过滤
        if (query.author) {
            conditions.push("user_id = ?");
            params.push(query.author);
        }
        // 执行次数过滤
        if (query.minExecutionCount !== undefined) {
            // 需要在 body JSON 中检查 metadata.executionCount
            conditions.push(`CAST(JSON_EXTRACT(body, '$.metadata.executionCount') AS INTEGER) >= ?`);
            params.push(query.minExecutionCount);
        }
        const whereClause = conditions.join(" AND ");
        const sql = `SELECT * FROM memory_nodes WHERE ${whereClause} ORDER BY created_at DESC LIMIT ?`;
        params.push(limit * 2); // 获取更多候选以便评分
        const rawDb = this.db.getRawDb();
        const rows = rawDb.prepare(sql).all(...params);
        // 解析并评分
        const candidates = rows.map((row) => ({
            procedure: this._rowToProcedure(row),
            text: `${row.title} ${row.summary}`.toLowerCase(),
        }));
        // 文本匹配
        const matches = candidates.map(({ procedure, text }) => {
            const reasons = [];
            let score = 0;
            // 1. 文本匹配（描述、标签）
            if (query.text) {
                const queryLower = query.text.toLowerCase();
                const queryTerms = queryLower.split(/\s+/).filter((t) => t.length >= 2);
                let textMatchCount = 0;
                for (const term of queryTerms) {
                    if (text.includes(term)) {
                        textMatchCount++;
                        reasons.push(`文本匹配: ${term}`);
                    }
                }
                const textScore = queryTerms.length > 0 ? textMatchCount / queryTerms.length : 0;
                score += textScore * 0.4;
            }
            // 2. 标签匹配
            if (query.tags && query.tags.length > 0) {
                const matchedTags = query.tags.filter((tag) => procedure.metadata.tags.includes(tag));
                const tagScore = matchedTags.length / query.tags.length;
                score += tagScore * 0.3;
                if (matchedTags.length > 0) {
                    reasons.push(`标签匹配: ${matchedTags.join(", ")}`);
                }
            }
            // 3. 成功率加权
            const successRate = procedure.metadata.executionCount > 0
                ? procedure.metadata.successCount / procedure.metadata.executionCount
                : 0;
            score += successRate * 0.2;
            // 4. 使用频率加权
            const frequencyScore = Math.min(procedure.metadata.executionCount / 10, 1);
            score += frequencyScore * 0.1;
            // 过滤低分结果
            if (score < this.config.matchThreshold) {
                return null;
            }
            return { procedure, score: Math.min(score, 1), reasons };
        }).filter(Boolean);
        // 按分数排序
        matches.sort((a, b) => b.score - a.score);
        return matches.slice(0, limit);
    }
    /**
     * 执行工作流程
     *
     * 记录执行过程，追踪成功率。
     */
    execute(procedureId, inputs) {
        const startTime = Date.now();
        const executionId = `exec-${startTime}-${crypto.randomUUID().slice(0, 8)}`;
        // 查找 procedure
        const node = this.db.getNode(procedureId);
        if (!node) {
            throw new Error(`Procedure not found: ${procedureId}`);
        }
        const procedure = this._nodeToProcedure(node);
        // 验证输入
        this._validateInputs(procedure.inputs, inputs);
        // 模拟执行（实际应该调用外部工作流引擎）
        const stepLogs = procedure.steps.map((step) => ({
            stepOrder: step.order,
            status: "success",
            startedAt: startTime,
            completedAt: startTime + 100,
            output: `模拟执行: ${step.name}`,
        }));
        const executionTimeMs = Date.now() - startTime;
        const result = "success";
        // 更新 procedure 元数据
        this._updateProcedureMetadata(procedureId, result, executionTimeMs);
        // 保存执行记录
        const execution = {
            id: executionId,
            procedureId,
            procedureVersion: procedure.version,
            inputs,
            result,
            outputs: {},
            executionTimeMs,
            stepLogs,
            executedAt: startTime,
        };
        // TODO: 保存执行记录到数据库
        // （需要扩展 memory_nodes 或创建单独表）
        return execution;
    }
    /**
     * 获取工作流程详情
     */
    get(procedureId) {
        const node = this.db.getNode(procedureId);
        if (!node || node.nodeType !== "procedure" || node.status !== "active") {
            return null;
        }
        return this._nodeToProcedure(node);
    }
    /**
     * 列出所有工作流程
     */
    list(filters) {
        const conditions = ["node_type = 'procedure' AND status = 'active'"];
        const params = [];
        if (filters?.category) {
            conditions.push("tags LIKE ?");
            params.push(`%"${filters.category}"%`);
        }
        if (filters?.author) {
            conditions.push("user_id = ?");
            params.push(filters.author);
        }
        if (filters?.tags && filters.tags.length > 0) {
            const tagConditions = filters.tags.map((tag) => `tags LIKE ?`).join(" OR ");
            conditions.push(`(${tagConditions})`);
            filters.tags.forEach((tag) => params.push(`%"${tag}"%`));
        }
        const whereClause = conditions.join(" AND ");
        const limit = filters?.limit || 50;
        const sql = `SELECT * FROM memory_nodes WHERE ${whereClause} ORDER BY created_at DESC LIMIT ?`;
        params.push(limit);
        const rawDb = this.db.getRawDb();
        const rows = rawDb.prepare(sql).all(...params);
        return rows.map((row) => this._rowToProcedure(row));
    }
    /**
     * 获取推荐工作流程
     *
     * 基于历史执行数据，推荐高成功率、高频次的工作流程。
     */
    getRecommendations(filters) {
        const limit = filters?.limit || 5;
        const matches = this.find({
            category: filters?.category,
            minExecutionCount: this.config.minExecutionCountForRecommendation,
            minSuccessRate: 0.8,
            limit: limit * 2,
        });
        // 按成功率 + 执行次数排序
        matches.sort((a, b) => {
            const scoreA = a.score + (a.procedure.metadata.successCount / Math.max(a.procedure.metadata.executionCount, 1)) * 0.3;
            const scoreB = b.score + (b.procedure.metadata.successCount / Math.max(b.procedure.metadata.executionCount, 1)) * 0.3;
            return scoreB - scoreA;
        });
        return matches.slice(0, limit);
    }
    /**
     * 删除工作流程（软删除）
     */
    delete(procedureId) {
        try {
            this.db.updateNode(procedureId, {
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
     * 更新工作流程（创建新版本）
     */
    update(procedureId, updates) {
        const existing = this.get(procedureId);
        if (!existing) {
            return null;
        }
        // 创建新版本
        const newRecord = this.record({
            ...existing,
            ...updates,
            version: this._incrementVersion(existing.version),
            parentId: existing.id,
        });
        // 归档旧版本
        this.db.updateNode(procedureId, {
            status: "archived",
            importance: 1,
        });
        return newRecord;
    }
    // ===== Private: Helpers =====
    /**
     * 验证输入参数
     */
    _validateInputs(schema, inputs) {
        const missing = [];
        const invalid = [];
        for (const input of schema) {
            const value = inputs[input.name];
            // 检查必填参数
            if (input.required && value === undefined) {
                missing.push(input.name);
                continue;
            }
            // 检查类型
            if (value !== undefined) {
                const typeMatch = (input.type === "string" && typeof value === "string") ||
                    (input.type === "number" && typeof value === "number") ||
                    (input.type === "boolean" && typeof value === "boolean") ||
                    (input.type === "array" && Array.isArray(value)) ||
                    (input.type === "object" && typeof value === "object" && !Array.isArray(value));
                if (!typeMatch) {
                    invalid.push(`${input.name} (expected ${input.type})`);
                }
                // 检查验证规则
                if (input.validation) {
                    if (input.validation.pattern && typeof value === "string") {
                        const regex = new RegExp(input.validation.pattern);
                        if (!regex.test(value)) {
                            invalid.push(`${input.name} (pattern mismatch)`);
                        }
                    }
                    if (input.validation.min !== undefined && typeof value === "number" && value < input.validation.min) {
                        invalid.push(`${input.name} (min: ${input.validation.min})`);
                    }
                    if (input.validation.max !== undefined && typeof value === "number" && value > input.validation.max) {
                        invalid.push(`${input.name} (max: ${input.validation.max})`);
                    }
                    if (input.validation.enum && !input.validation.enum.includes(value)) {
                        invalid.push(`${input.name} (not in enum)`);
                    }
                }
            }
        }
        if (missing.length > 0) {
            throw new Error(`Missing required inputs: ${missing.join(", ")}`);
        }
        if (invalid.length > 0) {
            throw new Error(`Invalid inputs: ${invalid.join(", ")}`);
        }
    }
    /**
     * 更新 Procedure 元数据
     */
    _updateProcedureMetadata(procedureId, result, executionTimeMs) {
        const node = this.db.getNode(procedureId);
        if (!node)
            return;
        const procedure = this._nodeToProcedure(node);
        const metadata = procedure.metadata;
        // 更新元数据
        const newMetadata = {
            ...metadata,
            executionCount: metadata.executionCount + 1,
            successCount: result === "success" ? metadata.successCount + 1 : metadata.successCount,
            failureCount: result === "failure" ? metadata.failureCount + 1 : metadata.failureCount,
            lastExecutedAt: Date.now(),
            lastExecutionResult: result,
            averageExecutionTimeMs: (metadata.averageExecutionTimeMs * metadata.executionCount + executionTimeMs) /
                (metadata.executionCount + 1),
        };
        // 保存到数据库
        this.db.updateNode(procedureId, {
            body: JSON.stringify({
                ...JSON.parse(node.body),
                metadata: newMetadata,
            }),
        });
    }
    /**
     * 版本号递增（语义化版本）
     * 1.0.0 → 1.1.0（次要版本递增）
     * 1.1.0 → 1.2.0
     * 1.1.3 → 1.2.0（修订版归零）
     */
    _incrementVersion(version) {
        const match = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
        if (!match) {
            return `1.0.0`;
        }
        const [_, major, minor, patch, suffix = ""] = match;
        return `${major}.${Number(minor) + 1}.0${suffix}`;
    }
    /**
     * 节点转 ProcedureRecord
     */
    _nodeToProcedure(node) {
        let body = {};
        try {
            body = JSON.parse(node.body || "{}");
        }
        catch {
            // 忽略解析失败
        }
        return {
            id: node.id,
            title: node.title,
            description: node.summary,
            version: body.version || "1.0.0",
            parentId: body.parentId,
            inputs: body.inputs || [],
            outputs: body.outputs || [],
            steps: body.steps || [],
            metadata: body.metadata || {
                executionCount: 0,
                successCount: 0,
                failureCount: 0,
                averageExecutionTimeMs: 0,
                tags: [],
                category: "general",
                difficulty: 3,
                estimatedDurationMinutes: 10,
            },
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
            author: node.userId,
            nodeType: "procedure",
        };
    }
    /**
     * 数据库行转 ProcedureRecord
     */
    _rowToProcedure(row) {
        const node = row;
        return this._nodeToProcedure(node);
    }
}
//# sourceMappingURL=procedure-memory.js.map