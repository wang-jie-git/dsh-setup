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
import { NoopQueryOptimizer } from "../../memory-vector/src/query-optimizer";
import { NoopReranker } from "../../memory-vector/src/reranker";
export const DEFAULT_CONFIG = {
    alpha: 0.35,
    beta: 0.35,
    gamma: 0.2,
    delta: 0.1,
    topK: 5,
    candidateK: 20,
    maxGraphDepth: 3,
    timeoutMs: 1000,
    enableQueryOptimization: true,
    enableReranking: true,
};
// ===== Hybrid Query Engine =====
export class HybridQueryEngine {
    config;
    memoryDb;
    vectorStore;
    embedder;
    queryOptimizer;
    reranker;
    constructor(memoryDb, vectorStore, embedder, config = {}, queryOptimizer, reranker) {
        this.memoryDb = memoryDb;
        this.vectorStore = vectorStore;
        this.embedder = embedder;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.queryOptimizer = queryOptimizer ?? new NoopQueryOptimizer();
        this.reranker = reranker ?? new NoopReranker();
    }
    /**
     * Hybrid query: (optional) query optimization → vector semantic recall →
     * (optional) reranking → graph traversal refine → fusion scoring
     */
    async query(queryText, filter) {
        const startTime = performance.now();
        let vectorTimeMs = 0;
        let graphTimeMs = 0;
        let degraded = false;
        let queryOptimized = false;
        let optimizedQuery;
        // ── Step 0: Query optimization ──
        let effectiveQuery = queryText;
        if (this.config.enableQueryOptimization) {
            try {
                const t0 = performance.now();
                const optimized = await this.queryOptimizer.optimize(queryText);
                vectorTimeMs += performance.now() - t0;
                if (optimized && optimized !== queryText) {
                    effectiveQuery = optimized;
                    queryOptimized = true;
                    optimizedQuery = optimized;
                }
            }
            catch {
                // Optimizer failure is non-fatal — use original query
            }
        }
        // ── Step 1: Embed the query text ──
        let queryVector;
        try {
            const t0 = performance.now();
            queryVector = await this.embedder.embed(effectiveQuery);
            vectorTimeMs += performance.now() - t0;
        }
        catch (err) {
            degraded = "vector_timeout";
            return this._buildFallbackResponse(queryText, filter, startTime, queryOptimized, optimizedQuery);
        }
        // ── Step 2: Vector coarse recall ──
        let candidates;
        try {
            const t0 = performance.now();
            const results = this.vectorStore.query(queryVector, {
                topK: this.config.candidateK,
                filter,
            });
            vectorTimeMs += performance.now() - t0;
            candidates = results.map((r) => ({
                id: r.id,
                score: r.score,
                metadata: r.metadata,
            }));
        }
        catch {
            degraded = "vector_timeout";
            return this._buildFallbackResponse(queryText, filter, startTime, queryOptimized, optimizedQuery);
        }
        if (candidates.length === 0) {
            degraded = "vector_timeout";
            return this._buildFallbackResponse(queryText, filter, startTime, queryOptimized, optimizedQuery);
        }
        // ── Step 2.5: Reranking (optional) ──
        let rerankedCandidates = candidates;
        if (this.config.enableReranking && candidates.length > 1) {
            try {
                const t0 = performance.now();
                const rerankerInput = candidates.map((c) => ({
                    id: c.id,
                    content: `${c.metadata.title} ${c.metadata.summary}`,
                    originalScore: c.score,
                    metadata: { nodeId: c.metadata.nodeId },
                }));
                const reranked = await this.reranker.rerank(effectiveQuery, rerankerInput);
                vectorTimeMs += performance.now() - t0;
                // Map reranked results back to candidates, preserving metadata
                const rerankedMap = new Map(reranked.map((r) => [r.id, r]));
                rerankedCandidates = candidates
                    .filter((c) => rerankedMap.has(c.id))
                    .map((c) => ({
                    ...c,
                    score: rerankedMap.get(c.id).score,
                }));
            }
            catch {
                // Reranker failure is non-fatal — use original ranking
            }
        }
        // ── Step 3: Graph traversal refine ──
        const graphStart = performance.now();
        const withGraphScores = rerankedCandidates.map((candidate) => {
            let graphScore = 0;
            let trustScore = 0.5;
            try {
                const node = this.memoryDb.getNode(candidate.metadata.nodeId);
                if (!node) {
                    graphScore = 0;
                    trustScore = 0.5;
                }
                else {
                    // 3a. Code linkage score
                    const codeLinks = this.memoryDb.getMemoryWithCodeSymbols(node.id);
                    const codeLinkageScore = Math.min(codeLinks.length / 3, 1.0);
                    // 3b. Relation density
                    const related = this.memoryDb.getRelatedMemories(node.id, {
                        depth: 1,
                        minWeight: 0.1,
                    });
                    const incomingCount = related.filter((r) => r.direction === "incoming").length;
                    const outgoingCount = related.filter((r) => r.direction === "outgoing").length;
                    const relationDensity = Math.min((incomingCount + outgoingCount) / 10, 1.0);
                    // 3c. Importance score
                    const importanceScore = node.importance / 10;
                    // 3d. Trust score (v11: verified/confidence 信任度)
                    trustScore = node.verified ? 1.0 : node.confidence;
                    graphScore = 0.4 * codeLinkageScore + 0.3 * relationDensity + 0.3 * importanceScore;
                }
            }
            catch {
                graphScore = 0;
                trustScore = 0.5;
            }
            return { ...candidate, graphScore, trustScore, nodeId: candidate.metadata.nodeId };
        });
        graphTimeMs = performance.now() - graphStart;
        // ── Step 4: Fusion scoring ──
        const scored = withGraphScores.map((item) => {
            const vectorScore = Math.max((item.score + 1) / 2, 0); // Normalize [-1,1] → [0,1]
            const graphScore = item.graphScore;
            const recencyScore = this._computeRecency(item.metadata.createdAt);
            const trustScore = item.trustScore ?? 0.5;
            const finalScore = this.config.alpha * vectorScore +
                this.config.beta * graphScore +
                this.config.gamma * recencyScore +
                this.config.delta * trustScore;
            return { item, finalScore, vectorScore, graphScore, recencyScore, trustScore };
        });
        scored.sort((a, b) => b.finalScore - a.finalScore);
        const topResults = scored.slice(0, this.config.topK);
        // ── Step 5: Build result objects ──
        const results = [];
        for (const sr of topResults) {
            let relations = [];
            try {
                const related = this.memoryDb.getRelatedMemories(sr.item.metadata.nodeId, { depth: 1 });
                relations = related.map((r) => ({
                    type: r.relation,
                    direction: r.direction,
                    strength: r.weight,
                }));
            }
            catch {
                // Relations are non-critical
            }
            results.push({
                nodeId: sr.item.metadata.nodeId,
                title: sr.item.metadata.title,
                summary: sr.item.metadata.summary,
                score: sr.finalScore,
                vectorScore: sr.vectorScore,
                graphScore: sr.graphScore,
                recencyScore: sr.recencyScore,
                trustScore: sr.trustScore ?? 0.5,
                relations,
                metadata: {
                    type: sr.item.metadata.type,
                    tags: [],
                    importance: sr.item.metadata.importance,
                    createdAt: sr.item.metadata.createdAt,
                    source: sr.item.metadata.source,
                },
            });
        }
        const totalTimeMs = performance.now() - startTime;
        return {
            results,
            telemetry: {
                totalTimeMs: Math.round(totalTimeMs),
                vectorTimeMs: Math.round(vectorTimeMs),
                graphTimeMs: Math.round(graphTimeMs),
                candidatesCount: candidates.length,
                returnedCount: results.length,
                degraded,
                top1Score: results.length > 0 ? results[0].score : 0,
                queryOptimized,
                originalQuery: queryText,
                ...(optimizedQuery ? { optimizedQuery } : {}),
            },
        };
    }
    /** Fallback: text search when vector store is unavailable */
    _buildFallbackResponse(queryText, filter, startTime, queryOptimized, optimizedQuery) {
        const nodes = this.memoryDb.searchByText(queryText, this.config.topK);
        let filtered = nodes;
        if (filter?.importanceMin !== undefined) {
            filtered = filtered.filter((n) => n.importance >= filter.importanceMin);
        }
        if (filter?.types !== undefined) {
            filtered = filtered.filter((n) => filter.types.includes(n.nodeType));
        }
        const results = filtered.map((node) => ({
            nodeId: node.id,
            title: node.title,
            summary: node.summary,
            score: node.importance / 10,
            vectorScore: 0,
            graphScore: node.importance / 10,
            recencyScore: this._computeRecency(node.createdAt),
            trustScore: node.verified ? 1.0 : node.confidence,
            relations: [],
            metadata: {
                type: node.nodeType,
                tags: node.tags,
                importance: node.importance,
                createdAt: node.createdAt,
                source: node.source,
            },
        }));
        const totalTimeMs = performance.now() - startTime;
        return {
            results,
            telemetry: {
                totalTimeMs: Math.round(totalTimeMs),
                vectorTimeMs: 0,
                graphTimeMs: 0,
                candidatesCount: results.length,
                returnedCount: results.length,
                degraded: "vector_timeout",
                top1Score: results.length > 0 ? results[0].score : 0,
                queryOptimized,
                originalQuery: queryText,
                ...(optimizedQuery ? { optimizedQuery } : {}),
            },
        };
    }
    // ===== Scoring Helpers =====
    _computeRecency(timestamp) {
        const now = Date.now();
        const ageMs = now - timestamp;
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        if (ageDays < 1)
            return 1.0;
        if (ageDays < 7)
            return 0.8;
        if (ageDays < 30)
            return 0.5;
        if (ageDays < 90)
            return 0.2;
        if (ageDays < 365)
            return 0.05;
        return 0.01;
    }
    /** Update config at runtime */
    setConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /** Replace optimizer at runtime */
    setQueryOptimizer(optimizer) {
        this.queryOptimizer = optimizer;
    }
    /** Replace reranker at runtime */
    setReranker(reranker) {
        this.reranker = reranker;
    }
    /** Close all underlying connections */
    close() {
        try {
            this.memoryDb.close();
        }
        catch { /* ignore */ }
        try {
            this.vectorStore.close();
        }
        catch { /* ignore */ }
    }
}
// ===== Session Compressor =====
export { SessionCompressor, DEFAULT_COMPRESSOR_CONFIG, } from "./session-compressor";
// ===== Auto Writeback =====
export { AutoWritebackRuntime, } from "./auto-writeback";
//# sourceMappingURL=index.js.map