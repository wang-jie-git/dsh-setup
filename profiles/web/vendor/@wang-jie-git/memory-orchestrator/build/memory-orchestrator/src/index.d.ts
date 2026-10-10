/**
 * memory-orchestrator: 混合查询编排器
 *
 * 查询优化 → 向量粗召回 → 重排序 → 图遍历精排序 → 融合打分 → 返回 TOP K
 *
 * 参考: Agentic RAG 的 Multi-Step RAG 模式
 *   - 查询优化: 用 LLM 重写用户查询，提升语义匹配准确率
 *   - 重排序: 粗召回 → 精排，准确率提升 30%+
 *
 * 架构:
 *   query("支付超时")
 *     ├── (可选) queryOptimizer.optimize("支付超时") → "支付模块 超时 故障 排查"
 *     ├── embedder.embed(optimizedQuery) → queryVector
 *     ├── vectorStore.query(queryVector, topK=20) → candidates
 *     ├── (可选) reranker.rerank(optimizedQuery, candidates) → reranked
 *     ├── for each candidate:
 *     │     memoryDb.getRelatedMemories(id) → graphRelevance
 *     │     computeRecency(createdAt) → recencyScore
 *     └── finalScore = α * vectorScore + β * graphScore + γ * recencyScore
 */
import { MemoryDatabase } from "../../memory-graph/src/database";
import { SqliteVectorStore, type VectorQueryOptions } from "../../memory-vector/src/vector-store";
import type { Embedder } from "../../memory-vector/src/embedder";
import { type QueryOptimizer } from "../../memory-vector/src/query-optimizer";
import { type Reranker } from "../../memory-vector/src/reranker";
export interface HybridQueryConfig {
    alpha: number;
    beta: number;
    gamma: number;
    delta: number;
    topK: number;
    candidateK: number;
    maxGraphDepth: number;
    timeoutMs: number;
    /** 启用查询优化（默认 true） */
    enableQueryOptimization: boolean;
    /** 启用重排序（默认 true） */
    enableReranking: boolean;
}
export declare const DEFAULT_CONFIG: HybridQueryConfig;
export interface MemoryQueryResult {
    nodeId: string;
    title: string;
    summary: string;
    score: number;
    vectorScore: number;
    graphScore: number;
    recencyScore: number;
    trustScore: number;
    relations: Array<{
        type: string;
        direction: "incoming" | "outgoing";
        strength: number;
    }>;
    metadata: {
        type: string;
        tags: string[];
        importance: number;
        createdAt: number;
        source: string;
    };
}
export interface QueryTelemetry {
    totalTimeMs: number;
    vectorTimeMs: number;
    graphTimeMs: number;
    candidatesCount: number;
    returnedCount: number;
    degraded: false | "graph_timeout" | "vector_timeout" | "both_timeout";
    top1Score: number;
    /** 查询是否被优化器改写 */
    queryOptimized: boolean;
    /** 原始查询 */
    originalQuery: string;
    /** 优化后的查询（如果被改写） */
    optimizedQuery?: string;
}
export interface HybridQueryResponse {
    results: MemoryQueryResult[];
    telemetry: QueryTelemetry;
}
export declare class HybridQueryEngine {
    private config;
    private memoryDb;
    private vectorStore;
    private embedder;
    private queryOptimizer;
    private reranker;
    constructor(memoryDb: MemoryDatabase, vectorStore: SqliteVectorStore, embedder: Embedder, config?: Partial<HybridQueryConfig>, queryOptimizer?: QueryOptimizer, reranker?: Reranker);
    /**
     * Hybrid query: (optional) query optimization → vector semantic recall →
     * (optional) reranking → graph traversal refine → fusion scoring
     */
    query(queryText: string, filter?: VectorQueryOptions["filter"]): Promise<HybridQueryResponse>;
    /** Fallback: text search when vector store is unavailable */
    private _buildFallbackResponse;
    private _computeRecency;
    /** Update config at runtime */
    setConfig(config: Partial<HybridQueryConfig>): void;
    /** Replace optimizer at runtime */
    setQueryOptimizer(optimizer: QueryOptimizer): void;
    /** Replace reranker at runtime */
    setReranker(reranker: Reranker): void;
    /** Close all underlying connections */
    close(): void;
}
export { SessionCompressor, type SessionSummary, type CompressedSession, type SessionCompressorConfig, DEFAULT_COMPRESSOR_CONFIG, } from "./session-compressor";
export { AutoWritebackRuntime, type AutoWritebackConfig, type WritebackCandidate, type AutoWritebackResult, } from "./auto-writeback";
//# sourceMappingURL=index.d.ts.map