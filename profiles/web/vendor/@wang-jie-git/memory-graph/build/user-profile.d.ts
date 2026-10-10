/**
 * User Profile Engine — 辩证用户建模
 *
 * 受 Hermes Honcho 辩证建模启发（RFC-06 Phase C）。
 * 不只是"存-取"用户偏好，而是：
 * 1. 矛盾检测 — 新观察与历史记录对比，发现不一致
 * 2. 置信度衰减 — 旧观察随时间降低置信度
 * 3. 观点演化 — 跟踪偏好随时间的变化轨迹
 *
 * 使用方式：
 *   const engine = new UserProfileEngine(db);
 *   engine.observe("preference", "风格", "偏好简洁", { confidence: 0.8 });
 *   engine.observe("preference", "风格", "需要详细说明", { confidence: 0.7 });
 *   // → 返回矛盾检测结果
 *
 *   const profile = engine.getProfile("default");
 *   // → 返回当前用户画像（含矛盾列表）
 *
 * 设计原则：
 * - 轻量级：无 LLM 依赖，纯规则匹配
 * - 兼容现有 MemoryNode：复用 decision + insight 节点类型
 * - 可进化：观点按时间线存储，支持回溯
 */
import { MemoryDatabase } from "./database";
export type ObservationType = "preference" | "behavior" | "skill" | "knowledge" | "trait";
export interface Observation {
    id: string;
    type: ObservationType;
    /** 领域/分类（如 "风格", "通信", "代码"） */
    domain: string;
    /** 观察内容 */
    content: string;
    /** 置信度 (0-1) */
    confidence: number;
    /** 来源会话 ID */
    sourceSession: string | null;
    /** 创建时间 */
    createdAt: number;
    /** 更新时间（最近一次相同观察的修正） */
    updatedAt: number;
    /** 标签 */
    tags: string[];
    /** 是否被标记为矛盾 */
    contradicted: boolean;
    /** 矛盾的观察 ID（如果有） */
    contradictedBy: string | null;
}
export interface ProfileTrait {
    /** 领域 */
    domain: string;
    /** 核心观察（当前置信度最高的） */
    current: string;
    /** 置信度 */
    confidence: number;
    /** 历史版本 */
    history: Array<{
        content: string;
        confidence: number;
        timestamp: number;
    }>;
    /** 是否检测到矛盾 */
    hasContradiction: boolean;
    /** 矛盾列表 */
    contradictions: Array<{
        old: string;
        new: string;
        detectedAt: number;
    }>;
}
export interface UserProfile {
    userId: string;
    traits: ProfileTrait[];
    /** 所有活跃观察 */
    observations: Observation[];
    /** 矛盾总数 */
    contradictionCount: number;
    /** 最后更新时间 */
    lastUpdated: number;
    /** 置信度 > 0.7 的强特征数 */
    strongTraitCount: number;
    /** 观察总数（含已归档） */
    totalObservationCount: number;
}
export interface UserProfileMemoryConfig {
    /** 记忆自动归档时间（天，默认 90 天） */
    ttlDays: number;
    /** 置信度衰减率（每天，默认 0.02） */
    decayRate: number;
    /** 矛盾检测阈值（默认 0.3） */
    contradictionThreshold: number;
    /** 最小置信度触发矛盾检测（默认 0.5） */
    minConfidenceForContradiction: number;
}
export declare const DEFAULT_MEMORY_CONFIG: UserProfileMemoryConfig;
export interface ObserveResult {
    observation: Observation;
    contradictions: Array<{
        existing: Observation;
        message: string;
    }>;
    isNew: boolean;
}
export interface ObserveOptions {
    /** 置信度 */
    confidence?: number;
    /** 来源会话 */
    sourceSession?: string | null;
    /** 用户 ID */
    userId?: string;
    /** 标签 */
    tags?: string[];
}
export declare class UserProfileEngine {
    private db;
    private config;
    private static readonly DEFAULT_CONTRADICTION_THRESHOLD;
    private static readonly DEFAULT_CONFIDENCE_DECAY_PER_DAY;
    private static readonly DEFAULT_OBSERVATION_TTL_DAYS;
    constructor(db: MemoryDatabase, config?: Partial<UserProfileMemoryConfig>);
    /**
     * 更新配置
     */
    updateConfig(config: Partial<UserProfileMemoryConfig>): void;
    /**
     * 获取当前配置
     */
    getConfig(): UserProfileMemoryConfig;
    /**
     * 记录一条用户观察
     *
     * 流程：
     * 1. 创建/更新 observation 记忆节点
     * 2. 与同 domain 的已有观察对比，检测矛盾
     * 3. 如果检测到矛盾，创建 contradicts 边
     * 4. 返回观察结果和矛盾列表
     */
    observe(type: ObservationType, domain: string, content: string, options?: ObserveOptions): ObserveResult;
    /**
     * 获取用户画像
     *
     * 聚合所有观察，按 domain 分组，
     * 返回每个 domain 的核心观点和矛盾历史。
     */
    getProfile(userId?: string): UserProfile;
    /**
     * 获取用户画像摘要（用于上下文注入）
     *
     * 返回格式化的文本摘要，可直接注入系统 prompt。
     */
    getProfileSummary(userId?: string, maxTraits?: number): string;
    /**
     * 获取系统 Prompt 片段（自动注入用）
     *
     * 返回格式化的用户画像摘要，可直接注入到系统 prompt 中。
     * 包含关键特征、矛盾警告和沟通偏好。
     */
    getSystemPromptSnippet(userId?: string, maxTraits?: number): string;
    /**
     * 删除观察（软删除）
     *
     * 将观察标记为 archived，不物理删除。
     */
    deleteObservation(observationId: string): boolean;
    /**
     * 获取观察详情
     */
    getObservation(observationId: string): Observation | null;
    /**
     * 统计用户画像健康度
     */
    getHealthStats(userId?: string): {
        totalTraits: number;
        strongTraits: number;
        contradictions: number;
        avgConfidence: number;
        oldestObservationAge: number;
        newestObservationAge: number;
        needsRefresh: boolean;
    };
    /**
     * 清理过期观察
     */
    refreshExpired(dryRun?: boolean): {
        archived: number;
    };
    /**
     * 查找同 domain 同类型的最新观察
     *
     * 优先按 body JSON 精确匹配，降级到 tag 宽松匹配。
     */
    private _findLatestObservation;
    /**
     * 计算文本相似度（Jaccard 相似度）
     *
     * 轻量级，无 LLM 依赖。
     */
    private _computeSimilarity;
    /**
     * 构建矛盾信息
     */
    private _buildContradictionMessage;
    /**
     * 置信度衰减
     */
    private _applyDecay;
    /**
     * 提取关键词（去停用词）
     */
    private _extractTerms;
    /**
     * 将数据库行转为 Observation
     */
    private _rowToObservation;
}
//# sourceMappingURL=user-profile.d.ts.map