/**
 * memory-graph: AutoLinker — 自动代码符号关联
 *
 * 扫描 CodeGraph 符号库，根据记忆条目的标题/摘要/标签，
 * 自动匹配相关的代码符号并建立 links_to_code 边。
 *
 * 匹配策略（按优先级）:
 *   1. 精确匹配: 记忆标签 → 代码符号 qualified_name
 *   2. 子串匹配: 记忆关键词 → 代码符号 name
 *   3. 文件路径匹配: 记忆标签 → 文件路径
 *
 * ⚠️ 跨模块边界：AutoLinker 不直接访问 CodeGraph 内部表，
 * 通过 CodeSymbolResolver 接口解耦。如需更换符号源，
 * 只需提供新的 resolver 实现。
 */
import { MemoryDatabase } from "./database";
export interface AutoLinkConfig {
    /** 最大关联数 per memory entry */
    maxLinksPerMemory: number;
    /** 自动关联置信度阈值 0-1 */
    minConfidence: number;
    /** 允许匹配的代码符号类型 */
    allowedKinds: string[];
}
export interface CodeSymbol {
    id: string;
    name: string;
    qualifiedName: string;
    kind: string;
    filePath: string;
    docstring: string | null;
}
/** 符号查询契约 — 外部调用方需实现此接口 */
export interface CodeSymbolResolver {
    /** 根据关键词列表搜索代码符号 */
    searchByKeywords(keywords: string[], allowedKinds: string[], maxResults: number): CodeSymbol[];
}
export declare class DefaultCodeSymbolResolver implements CodeSymbolResolver {
    private memoryDb;
    constructor(memoryDb: MemoryDatabase);
    searchByKeywords(keywords: string[], allowedKinds: string[], maxResults: number): CodeSymbol[];
}
interface MatchResult {
    symbolId: string;
    confidence: number;
    matchType: "exact_tag" | "keyword" | "file_path";
    description: string;
}
export declare class AutoLinker {
    private config;
    private memoryDb;
    private symbolResolver;
    constructor(memoryDb: MemoryDatabase, config?: Partial<AutoLinkConfig>, symbolResolver?: CodeSymbolResolver);
    /**
     * 为单条记忆自动关联代码符号
     */
    autoLink(memoryId: string): MatchResult[];
    /**
     * 批量关联（全部记忆）
     */
    autoLinkAll(options?: {
        batchSize?: number;
        onProgress?: (done: number, total: number, links: number) => void;
    }): {
        scanned: number;
        linked: number;
    };
    /**
     * 在 CodeGraph 符号库中搜索与关键词匹配的符号
     * 通过 CodeSymbolResolver 接口解耦，不直接访问内部表
     */
    private scanCodeSymbols;
    /**
     * 评分匹配结果
     */
    private scoreMatches;
}
export {};
//# sourceMappingURL=auto-linker.d.ts.map