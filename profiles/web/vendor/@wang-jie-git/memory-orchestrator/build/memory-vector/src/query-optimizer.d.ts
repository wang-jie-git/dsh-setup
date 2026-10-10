/**
 * query-optimizer: 查询优化器
 *
 * 用 LLM 将用户自然语言查询重写为更适合向量搜索的查询。
 * 参考架构: Agentic RAG 的 Query Optimization 模式
 *   - 原文: 用户问"盈利能力" → 优化为"净利润 毛利率 ROE 财务指标"
 *
 * 默认实现: LLMQueryOptimizer — 调用 OpenAI-compatible 文本生成 API
 * 兜底: NoopQueryOptimizer — 直接返回原查询
 */
export interface QueryOptimizer {
    /** 优化查询，返回更适合搜索的改写版本 */
    optimize(query: string): Promise<string>;
    readonly modelName: string;
}
export declare class NoopQueryOptimizer implements QueryOptimizer {
    readonly modelName = "noop";
    optimize(query: string): Promise<string>;
}
export interface LLMQueryOptimizerConfig {
    /** API base URL (OpenAI-compatible) */
    baseUrl?: string;
    /** API key */
    apiKey: string;
    /** Model name, default "gpt-4o-mini" */
    model?: string;
    /** Temperature, default 0 */
    temperature?: number;
    /** Max tokens for response, default 256 */
    maxTokens?: number;
    /** Optional: domain-specific optimization prompt */
    systemPrompt?: string;
}
export declare class LLMQueryOptimizer implements QueryOptimizer {
    readonly modelName: string;
    private config;
    constructor(config: LLMQueryOptimizerConfig);
    optimize(query: string): Promise<string>;
}
//# sourceMappingURL=query-optimizer.d.ts.map