/**
 * memory-graph: ImportanceLearner — 重要性评分自动学习
 *
 * 基于访问频率和引用热度动态调整记忆重要性。
 * 热度数据持久化在 SQLite memory_heat 表中（与 CodeGraph DB 共享），
 * 替代原有的 JSON 文件方案，消除数据一致性问题。
 *
 * 策略:
 *   - 每次被查询命中时，增加临时热度
 *   - 定期聚合: importance = base_importance × 0.7 + heat × 0.3
 *   - 热度随时间衰减（半衰期 7 天）
 *   - 低热度 + 低重要度 → 自动归档候选
 */
import { MemoryDatabase } from "./database";
export interface ImportanceConfig {
    /** 热度半衰期（ms）默认 7 天 */
    heatDecayHalfLifeMs: number;
    /** 学习率（热度对 importance 的影响权重） */
    learningRate: number;
    /** 基础重要性权重 */
    baseWeight: number;
    /** 归档阈值（重要性低于此值且热度为 0） */
    archiveThreshold: number;
}
export declare class ImportanceLearner {
    private config;
    private memoryDb;
    /** 内存缓存，避免每次读 DB */
    private heatCache;
    /** 脏标记，用于批量写入 */
    private dirtyNodes;
    constructor(memoryDb: MemoryDatabase, _dbDir: string, // 保留参数兼容，不再使用
    config?: Partial<ImportanceConfig>);
    /** 记录一次命中（查询返回了这条记忆） */
    recordHit(nodeId: string): void;
    /** 计算衰减后的热度 */
    private decay;
    /** 获取当前有效热度 */
    getEffectiveHeat(nodeId: string): number;
    /** 为单条记忆重新计算重要性 */
    updateImportance(nodeId: string): boolean;
    /** 全量更新（定期运行） */
    updateAll(options?: {
        dryRun?: boolean;
        onProgress?: (done: number) => void;
    }): {
        scanned: number;
        updated: number;
        archiveCandidates: string[];
    };
    private loadAllHeat;
    private loadHeatRow;
    /** 批量写入脏数据到 SQLite */
    flushDirty(): void;
    /** Prune stale heat entries (nodes that no longer exist) */
    pruneHeatData(): number;
    /** Export heat data for analysis */
    exportHeatReport(): Array<{
        nodeId: string;
        heat: number;
        importance: number;
        title: string;
    }>;
}
//# sourceMappingURL=importance-learner.d.ts.map