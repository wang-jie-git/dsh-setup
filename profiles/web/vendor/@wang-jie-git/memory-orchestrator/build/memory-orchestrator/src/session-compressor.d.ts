/**
 * Session Compressor — 跨会话上下文压缩与注入
 *
 * 复用梦境引擎的蒸馏思路，但更轻量、实时：
 *   会话结束时 → 提取关键信息 → 生成摘要节点 → 关联到项目
 *   新会话启动 → 自动查询最近 N 条摘要 → 注入上下文
 *
 * 纯算法实现（无 LLM 调用），零外部依赖。
 */
import { MemoryDatabase } from "../../memory-graph/src/database";
import { SqliteVectorStore } from "../../memory-vector/src/vector-store";
import type { Embedder } from "../../memory-vector/src/embedder";
export interface SessionSummary {
    /** 自动生成的会话标题 */
    title: string;
    /** 一句话摘要 */
    summary: string;
    /** 关键决策列表 */
    keyDecisions: Array<{
        decision: string;
        reason: string;
        confidence: number;
    }>;
    /** 未完成事项 */
    unresolvedItems: string[];
    /** 关联标签 */
    tags: string[];
    /** 自动评估的重要性 1-10 */
    importance: number;
    /** 被引用的记忆 ID 列表 */
    referencedMemoryIds: string[];
    /** 被引用的代码符号 ID 列表 */
    referencedCodeSymbolIds: string[];
}
export interface CompressedSession {
    /** 会话 ID（外部传入） */
    sessionId: string;
    /** 会话开始时间戳 */
    sessionStart: number;
    /** 会话结束时间戳 */
    sessionEnd: number;
    /** 消耗的 token 数 */
    tokenCount: number;
    /** 生成的摘要 */
    summary: SessionSummary;
    /** 生成的记忆节点 ID */
    memoryNodeId: string;
}
export interface SessionCompressorConfig {
    /** 摘要触发阈值（token 超过此值才压缩，默认 5000） */
    minTokensForSummary: number;
    /** 最大摘要长度（字符数，默认 500） */
    maxSummaryLength: number;
    /** 跨会话注入时加载最近 N 条摘要（默认 3） */
    recentSummariesCount: number;
    /** 摘要 TTL 天数（默认 30 天，过期后梦境引擎自动处理） */
    summaryTtlDays: number;
    /** 是否自动启用 */
    enabled: boolean;
}
export declare const DEFAULT_COMPRESSOR_CONFIG: SessionCompressorConfig;
export declare class SessionCompressor {
    private config;
    private memoryDb;
    private vectorStore;
    private embedder;
    constructor(memoryDb: MemoryDatabase, vectorStore: SqliteVectorStore, embedder: Embedder, config?: Partial<SessionCompressorConfig>);
    /**
     * 压缩一次会话，生成摘要记忆节点。
     *
     * @param sessionId 会话 ID
     * @param messages 会话消息列表（原始文本）
     * @param sessionStart 会话开始时间戳
     * @param options 可选参数
     * @returns CompressedSession | null（如果 token 数不足则返回 null）
     */
    compress(sessionId: string, messages: string[], sessionStart: number, options?: {
        tokenCount?: number;
        referencedMemoryIds?: string[];
        referencedCodeSymbolIds?: string[];
        userId?: string;
    }): Promise<CompressedSession | null>;
    /**
     * 获取最近 N 条会话摘要，用于跨会话上下文注入。
     *
     * @param count 返回数量（默认 config.recentSummariesCount）
     * @param userId 用户 ID 过滤（可选）
     * @returns 摘要列表（按时间降序）
     */
    getRecentSummaries(count?: number, userId?: string): SessionSummary[];
    /**
     * 格式化会话摘要为上下文注入文本。
     */
    formatForContext(summaries: SessionSummary[]): string;
    private _extractSummary;
    private _generateTitle;
    private _extractDecisions;
    private _extractUnresolved;
    private _generateSummary;
    private _extractTags;
    private _extractTopKeywords;
    private _evaluateImportance;
    private _estimateTokens;
    private _renderBody;
    private _parseBody;
}
//# sourceMappingURL=session-compressor.d.ts.map