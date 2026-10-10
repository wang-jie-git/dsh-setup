/**
 * AutoWritebackRuntime — 自动写回机制
 *
 * 功能：
 * - 从对话中提取可复用知识
 * - 隐私替换 (API Key, Token, Email 等)
 * - 哈希去重（避免重复写入）
 * - 缓冲 + 异步批量写入
 * - MCP 工具: memory_suggest
 *
 * 参考: MemoraX Code 的 Automatic Writeback 机制
 */
export interface WritebackCandidate {
    id: string;
    title: string;
    summary: string;
    body?: string;
    importance: number;
    tags: string[];
    source: "auto-writeback";
    contentHash: string;
    confidence: number;
}
export interface AutoWritebackConfig {
    /** 最小可信度阈值 (0-1, 默认 0.6) */
    minConfidence: number;
    /** 缓冲大小 (条数, 默认 10) */
    bufferSize: number;
    /** 写入间隔 (ms, 默认 5000) */
    flushIntervalMs: number;
    /** 是否启用自动写回 */
    enabled: boolean;
}
export interface AutoWritebackResult {
    extracted: number;
    written: number;
    skipped: number;
    duplicates: number;
    lowConfidence: number;
}
/**
 * 隐私替换器
 *
 * 替换敏感信息为占位符:
 * - API Keys
 * - Tokens
 * - Email addresses
 * - Long numbers (credit cards, phone numbers)
 * - UUIDs
 * - Opaque IDs
 */
export declare class PrivacyRedactor {
    private patterns;
    /**
     * 替换敏感信息
     */
    redact(text: string): string;
    /**
     * 检查文本是否包含敏感信息
     */
    containsSensitive(text: string): boolean;
}
/**
 * 内容哈希计算
 *
 * 用于去重：相同内容的记忆只写入一次
 */
export declare function computeContentHash(title: string, summary: string): string;
/**
 * 从对话中提取可复用知识
 *
 * 当前版本：基于规则的简单提取
 * 未来版本：LLM 驱动的智能提取
 */
export declare class WritebackExtractor {
    private redactor;
    constructor();
    /**
     * 从对话中提取记忆候选
     *
     * @param userMessage 用户消息
     * @param assistantResponse AI 回复
     * @returns 提取的记忆候选列表
     */
    extract(userMessage: string, assistantResponse: string): WritebackCandidate[];
    /**
     * 提取标题（从用户消息）
     */
    private extractTitle;
    /**
     * 提取最佳实践标题
     */
    private extractBestPracticeTitle;
    /**
     * 提取最佳实践摘要
     */
    private extractBestPracticeSummary;
    /**
     * 提取 Bug 修复标题
     */
    private extractBugFixTitle;
    /**
     * 提取 Bug 修复摘要
     */
    private extractBugFixSummary;
}
export declare class AutoWritebackRuntime {
    private config;
    private redactor;
    private extractor;
    private buffer;
    private seenHashes;
    private flushTimer?;
    private writeCallback?;
    private startedAt;
    constructor(config?: Partial<AutoWritebackConfig>);
    /**
     * 注册写入回调（连接到 MemorySystem）
     */
    setWriteCallback(cb: (candidates: WritebackCandidate[]) => Promise<void>): void;
    /**
     * 启动自动写回
     */
    start(): void;
    /**
     * 停止自动写回
     */
    stop(): void;
    /**
     * 处理对话（提取 + 缓冲）
     */
    processTurn(userMessage: string, assistantResponse: string): Promise<AutoWritebackResult>;
    /**
     * 刷新缓冲（批量写入）
     */
    flush(): Promise<number>;
    /**
     * 获取统计信息
     */
    getStats(): {
        bufferSize: number;
        seenHashes: number;
        uptime: number;
        enabled: boolean;
    };
    /**
     * 手动添加记忆候选（用于测试）
     */
    addCandidate(candidate: WritebackCandidate): void;
}
//# sourceMappingURL=auto-writeback.d.ts.map