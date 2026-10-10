/**
 * memory-vector: IVF 索引 (Inverted File Index)
 *
 * 纯 JS 实现，零外部依赖。通过聚类加速向量搜索：
 *   O(n) → O(n / k * c)
 *   其中 k=簇数量, c=搜索的簇数
 *
 * 使用方法:
 *   const ivf = new IVFIndex(384, 100);  // 384维, 100个簇
 *   ivf.train(vectors);                   // 训练
 *   ivf.add("id-1", vector);             // 添加向量
 *   ivf.search(query, 5);                // 搜索
 */
type Vec = Float32Array;
export declare class IVFIndex {
    private dimension;
    private numClusters;
    private clusters;
    private trained;
    constructor(dimension: number, numClusters: number);
    get isTrained(): boolean;
    get clusterCount(): number;
    get totalEntries(): number;
    /**
     * 使用 k-means 训练聚类中心
     */
    train(vectors: Array<{
        id: string;
        vector: Vec;
    }>): void;
    /**
     * 添加一个向量到最近的簇
     */
    add(id: string, vector: Vec): void;
    /**
     * 删除一个向量
     */
    delete(id: string): boolean;
    /**
     * 搜索最近的 C 个簇，只在这些簇内暴力搜索
     */
    search(query: Vec, topK: number, searchClusters?: number): Array<{
        id: string;
        score: number;
    }>;
    stats(): {
        clusters: number;
        entries: number;
        distribution: number[];
    };
}
export {};
//# sourceMappingURL=ivf-index.d.ts.map