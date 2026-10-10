/**
 * reranker: 重排序器
 *
 * 对向量粗召回的候选结果重新打分排序。
 * 参考架构: Agentic RAG 的 Multi-Step RAG 模式
 *   - 原文: 先粗筛20个候选 → CrossEncoder 精排 → Top5
 *   - 准确率提升 30%+
 *
 * 默认实现: EmbeddingReranker — 用 embedding 相似度重排序
 * 兜底: NoopReranker — 透传原始顺序
 */
export interface RerankerCandidate {
    id: string;
    content: string;
    originalScore: number;
    metadata?: Record<string, unknown>;
}
export interface ScoredCandidate {
    id: string;
    score: number;
    originalScore: number;
    metadata?: Record<string, unknown>;
}
export interface Reranker {
    /** 对候选结果重排序，返回重新打分排序后的结果 */
    rerank(query: string, candidates: RerankerCandidate[]): Promise<ScoredCandidate[]>;
    readonly modelName: string;
}
export declare class NoopReranker implements Reranker {
    readonly modelName = "noop";
    rerank(_query: string, candidates: RerankerCandidate[]): Promise<ScoredCandidate[]>;
}
import type { Embedder } from "./embedder";
export interface EmbeddingRerankerConfig {
    /** 粗召回数量，默认 20 */
    candidateK?: number;
    /** 最终返回数量，默认 5 */
    topK?: number;
    /** 重排序权重（0-1），新分数 = w * sim + (1-w) * originalScore，默认 0.7 */
    rerankWeight?: number;
}
export declare class EmbeddingReranker implements Reranker {
    readonly modelName: string;
    private embedder;
    private config;
    constructor(embedder: Embedder, config?: EmbeddingRerankerConfig);
    rerank(query: string, candidates: RerankerCandidate[]): Promise<ScoredCandidate[]>;
    private cosineSimilarity;
}
//# sourceMappingURL=reranker.d.ts.map