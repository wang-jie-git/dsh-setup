/**
 * prompt-manager — 提示词管理器
 *
 * 参考 dsh-memory-evolve 的提示词管理器设计，支持创建、分类、搜索、注入提示词模板。
 * 代码风格与 procedure-memory.ts / user-profile.ts 一致。
 */
import { MemoryDatabase } from "./database";
export interface PromptTemplate {
    id: string;
    name: string;
    category: string;
    content: string;
    description: string;
    tags: string[];
    version: string;
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
}
export interface PromptCreateInput {
    name: string;
    category: string;
    content: string;
    description?: string;
    tags?: string[];
    version?: string;
}
export interface PromptUpdateInput {
    name?: string;
    category?: string;
    content?: string;
    description?: string;
    tags?: string[];
    version?: string;
    enabled?: boolean;
}
export interface PromptFilter {
    category?: string;
    enabled?: boolean;
    limit?: number;
}
export declare class PromptManager {
    private db;
    constructor(db: MemoryDatabase);
    /**
     * 创建提示词模板
     */
    createTemplate(data: PromptCreateInput): Promise<PromptTemplate>;
    /**
     * 获取单条模板
     */
    getTemplate(id: string): Promise<PromptTemplate | null>;
    /**
     * 按名称获取模板
     */
    getTemplateByName(name: string): Promise<PromptTemplate | null>;
    /**
     * 更新模板（自动版本递增）
     */
    updateTemplate(id: string, data: PromptUpdateInput): Promise<boolean>;
    /**
     * 删除模板
     */
    deleteTemplate(id: string): Promise<boolean>;
    /**
     * 列出模板（支持分类/启用状态过滤）
     */
    listTemplates(filter?: PromptFilter): Promise<PromptTemplate[]>;
    /**
     * 搜索模板
     */
    findTemplates(query: string, limit?: number): Promise<PromptTemplate[]>;
    /**
     * 获取所有启用的模板
     */
    getEnabledTemplates(): Promise<PromptTemplate[]>;
    /**
     * 注入模板内容到目标上下文
     * 返回注入后的完整提示词文本（不做实际注入，只拼接）
     */
    injectTemplate(id: string, context?: string): Promise<string>;
    private rowToTemplate;
}
//# sourceMappingURL=prompt-manager.d.ts.map