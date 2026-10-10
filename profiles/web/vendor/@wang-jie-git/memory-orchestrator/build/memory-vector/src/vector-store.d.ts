/**
 * memory-vector: SQLite 向量存储
 *
 * 在 CodeGraph DB 同目录下维护独立的 memory-vectors.db，
 * 存储 id → Float32Array BLOB + metadata JSON。
 *
 * 查询策略：余弦相似度暴力搜索（O(n)），适合 MVP 阶段 <10,000 条记录。
 * 后期可换装 LanceDB / ChromaDB 等专用向量引擎。
 */
export interface VectorMetadata {
    nodeId: string;
    type: string;
    title: string;
    summary: string;
    importance: number;
    createdAt: number;
    source: string;
    tags?: string[];
    tenantId?: string;
    tier?: "hot" | "cold";
}
export interface VectorEntry {
    id: string;
    vector: Float32Array;
    metadata: VectorMetadata;
}
export interface VectorQueryOptions {
    topK: number;
    filter?: {
        types?: string[];
        importanceMin?: number;
        sources?: string[];
        timeRange?: [number, number];
        tenantId?: string;
        tiers?: ("hot" | "cold")[];
    };
    scoreThreshold?: number;
}
export interface VectorResult {
    id: string;
    score: number;
    metadata: VectorMetadata;
}
export interface VectorStoreStats {
    totalEntries: number;
    dimension: number;
    memoryUsageBytes: number;
}
export declare class SqliteVectorStore {
    private db;
    private dbPath;
    private _dimension;
    private constructor();
    /** Open existing or create new vector store at dbPath */
    static open(dbPath: string): SqliteVectorStore;
    /** Total number of stored vectors */
    get totalEntries(): number;
    /** Vector dimension (detected from first entry) */
    get dimension(): number;
    upsert(id: string, vector: Float32Array, metadata: VectorMetadata): void;
    upsertBatch(entries: VectorEntry[]): void;
    delete(id: string): boolean;
    query(queryVector: Float32Array, options: VectorQueryOptions): VectorResult[];
    stats(): VectorStoreStats;
    /** Delete all vectors and rebuild from scratch */
    clear(): void;
    /** Move entries to cold tier (update metadata) */
    moveToCold(nodeIds: string[]): number;
    /** Move entries back to hot tier */
    moveToHot(nodeIds: string[]): number;
    /** Auto-archive: entries older than N days with low importance become cold */
    autoTier(daysOld: number, importanceThreshold: number): {
        movedToCold: number;
    };
    /** Delete all cold entries */
    purgeCold(): number;
    close(): void;
    /** Get database file path */
    getPath(): string;
}
//# sourceMappingURL=vector-store.d.ts.map