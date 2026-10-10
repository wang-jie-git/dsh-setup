/**
 * prompt-manager — 提示词管理器
 *
 * 参考 dsh-memory-evolve 的提示词管理器设计，支持创建、分类、搜索、注入提示词模板。
 * 代码风格与 procedure-memory.ts / user-profile.ts 一致。
 */
// ===== PromptManager =====
export class PromptManager {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * 创建提示词模板
     */
    createTemplate(data) {
        const result = this.db.createPromptTemplate({
            name: data.name,
            category: data.category,
            content: data.content,
            description: data.description,
            tags: data.tags,
            version: data.version ?? "1.0.0",
        });
        return Promise.resolve({
            id: result.id,
            name: result.name,
            category: result.category,
            content: data.content,
            description: data.description ?? "",
            tags: data.tags ?? [],
            version: result.version,
            enabled: true,
            createdAt: result.createdAt,
            updatedAt: result.createdAt,
        });
    }
    /**
     * 获取单条模板
     */
    getTemplate(id) {
        const row = this.db.getPromptTemplate(id);
        if (!row)
            return Promise.resolve(null);
        return Promise.resolve(this.rowToTemplate(row));
    }
    /**
     * 按名称获取模板
     */
    getTemplateByName(name) {
        const row = this.db.getPromptTemplateByName(name);
        if (!row)
            return Promise.resolve(null);
        return Promise.resolve(this.rowToTemplate(row));
    }
    /**
     * 更新模板（自动版本递增）
     */
    updateTemplate(id, data) {
        // 内容变更时自动递增次要版本
        if (data.content !== undefined) {
            const existing = this.db.getPromptTemplate(id);
            if (existing) {
                const currentVersion = existing.version ?? "1.0.0";
                const parts = currentVersion.split(".").map(Number);
                const newVersion = `${parts[0]}.${(parts[1] ?? 0) + 1}.0`;
                data.version = newVersion;
            }
        }
        return Promise.resolve(this.db.updatePromptTemplate(id, data));
    }
    /**
     * 删除模板
     */
    deleteTemplate(id) {
        return Promise.resolve(this.db.deletePromptTemplate(id));
    }
    /**
     * 列出模板（支持分类/启用状态过滤）
     */
    listTemplates(filter) {
        const rows = this.db.listPromptTemplates({
            category: filter?.category,
            enabled: filter?.enabled,
            limit: filter?.limit,
        });
        return Promise.resolve(rows.map((r) => this.rowToTemplate(r)));
    }
    /**
     * 搜索模板
     */
    findTemplates(query, limit) {
        const rows = this.db.searchPromptTemplates(query, limit);
        return Promise.resolve(rows.map((r) => this.rowToTemplate(r)));
    }
    /**
     * 获取所有启用的模板
     */
    getEnabledTemplates() {
        return this.listTemplates({ enabled: true });
    }
    /**
     * 注入模板内容到目标上下文
     * 返回注入后的完整提示词文本（不做实际注入，只拼接）
     */
    injectTemplate(id, context) {
        const row = this.db.getPromptTemplate(id);
        if (!row)
            return Promise.reject(new Error(`Template not found: ${id}`));
        const template = this.rowToTemplate(row);
        const result = context
            ? `${context}\n\n---\n${template.content}`
            : template.content;
        return Promise.resolve(result);
    }
    // ===== Helpers =====
    rowToTemplate(row) {
        return {
            id: row.id,
            name: row.name,
            category: row.category,
            content: row.content,
            description: row.description ?? "",
            tags: (() => {
                try {
                    return JSON.parse(row.tags ?? "[]");
                }
                catch {
                    return [];
                }
            })(),
            version: row.version ?? "1.0.0",
            enabled: row.enabled === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
//# sourceMappingURL=prompt-manager.js.map