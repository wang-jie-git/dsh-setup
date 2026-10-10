/**
 * Dream Engine — 记忆熵减引擎
 *
 * 模拟人脑睡眠时的记忆整理过程：
 *   冗余合并 → 主题聚类 → insight 提取 → 低价值修剪
 *
 * 核心哲学：
 *   写入是熵增（清醒），梦境是熵减（睡眠）。
 *   无梦境则系统趋于混乱，有梦境则记忆精炼。
 */
import { MemoryDatabase } from "../../memory-graph/src/database";
import { SqliteVectorStore } from "../../memory-vector/src/vector-store";
import type { Embedder } from "../../memory-vector/src/embedder";
export interface DreamConfig {
    /** 余弦相似度阈值，高于此值视为冗余 (0-1, 默认 0.92) */
    redundancyThreshold: number;
    /** 聚类相似度阈值 (0-1, 默认 0.75) */
    clusterSimilarity: number;
    /** 最小聚类规模，低于此不生成 insight (默认 3) */
    minClusterSize: number;
    /** 低重要性阈值，低于此可能被归档 (1-10, 默认 3) */
    lowImportanceThreshold: number;
    /** 最大 TTL 天数，超过此值且低重要性的被删除 (默认 365) */
    maxAgeDays: number;
    /** 预览模式：不实际修改数据 */
    dryRun: boolean;
    /** 是否启用 LLM 摘要生成（默认 false，纯算法模式） */
    llmEnabled: boolean;
}
export declare const DEFAULT_DREAM_CONFIG: DreamConfig;
export interface DreamSnapshot {
    nodes: number;
    edges: number;
    activeByType: Record<string, number>;
    coldVectors: number;
}
export interface MergeAction {
    targetId: string;
    targetTitle: string;
    sourceIds: string[];
    sourceTitles: string[];
    mergedImportance: number;
    mergedTags: string[];
}
export interface InsightAction {
    title: string;
    confidence: number;
    relatedNodeIds: string[];
    relatedTitles: string[];
    commonTags: string[];
    insightId: string;
}
export interface DreamReport {
    dreamId: string;
    timestamp: number;
    duration: number;
    dryRun: boolean;
    summary: {
        before: DreamSnapshot;
        after: DreamSnapshot;
    };
    actions: {
        merged: MergeAction[];
        archived: string[];
        deleted: string[];
        insights: InsightAction[];
    };
    healthScore: number;
}
export declare class DreamEngine {
    private config;
    private memoryDb;
    private vectorStore;
    private embedder;
    constructor(memoryDb: MemoryDatabase, vectorStore: SqliteVectorStore, embedder: Embedder, config?: Partial<DreamConfig>);
    /** 更新运行时配置 */
    setConfig(config: Partial<DreamConfig>): void;
    /**
     * 执行一次完整的梦境整理周期
     *
     * Phase 1: 快照 — 记录整理前的状态
     * Phase 2: 冗余合并 — 检测并合并高度相似的记忆
     * Phase 3: 主题聚类 — 聚类相关记忆并生成 insight
     * Phase 4: 价值修剪 — 归档/删除低价值记忆
     * Phase 5: 报告 — 输出梦境报告
     */
    consolidate(): Promise<DreamReport>;
    /**
     * 检测并合并冗余记忆。
     * 条件：向量相似度 > threshold AND 标签重叠 > 80%
     */
    private mergeRedundant;
    /**
     * 聚类相关记忆并生成 insight 节点。
     * 策略：按公共标签聚类（标签 → 节点倒排），合并重叠簇。
     * 避免 O(n²) 向量比较，用标签作为高效代理信号。
     */
    private clusterAndGenerateInsights;
    /**
     * 修剪低价值记忆：
     * 1. TTL 过期 → 直接删除
     * 2. 低重要性 + 无引用 + 旧数据 → 归档
     * 3. 归档 + 超期 → 删除
     */
    private pruneLowValue;
    /** 获取所有 active 节点（排除已废弃的） */
    private getActiveNodes;
    /** 判断节点是否为认知模板（st_ 或 ct_ 前缀） */
    private isTemplateNode;
    /** 获取节点的向量表示 */
    private getNodeVector;
    /** 标签重叠率 (Jaccard 相似度) */
    private tagOverlap;
    /** 余弦相似度 */
    private cosineSimilarity;
    /** 删除节点及其向量 */
    private deleteNodeAndVector;
    /** 从标签中合成 insight 标题 */
    private synthesizeInsightTitle;
    /** 快照当前状态 */
    private takeSnapshot;
    /** 计算健康评分 (0-10) */
    private computeHealthScore;
    /** 记录梦境日志到 dream_logs 表 */
    private logDream;
}
//# sourceMappingURL=dream.d.ts.map