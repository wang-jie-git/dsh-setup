/**
 * Nudge Engine — 主动记忆提示系统
 *
 * 受 Hermes 周期性 nudge 机制启发（RFC-06 Phase B）。
 * 当 agent 完成复杂任务、发现重复模式、或复现已知问题时，
 * 主动建议写入记忆，而不是等待显式调用 memory_write。
 *
 * 三种触发场景：
 * 1. COMPLEX_TASK — 检测到高重要性/多步骤操作完成
 * 2. REPEATED_PATTERN — 同一话题/任务出现多次
 * 3. ERROR_REVISIT — 已知错误模式再次出现
 *
 * 使用方式：
 *   const engine = new NudgeEngine(db);
 *   engine.onMemoryWritten(newMemories, options);
 *   // → 返回 nudge 建议列表
 *
 * 设计原则：
 * - 零阻塞：所有分析在写路径外异步完成
 * - 轻量级：不使用 LLM，只做规则匹配和相似度分析
 * - 可配置：阈值可调，可禁用特定场景
 */
import { MemoryDatabase, MemoryNode } from "./database";
export type NudgeReason = "complex_task" | "repeated_pattern" | "error_revisit" | "knowledge_gap";
export interface NudgeSuggestion {
    /** 提示原因 */
    reason: NudgeReason;
    /** 提示文本 */
    message: string;
    /** 建议的操作 */
    action: "write_memory" | "update_memory" | "create_decision" | "review";
    /** 建议写入的记忆内容 */
    suggestedMemory: {
        title: string;
        summary: string;
        tags: string[];
        importance: number;
    };
    /** 触发的源记忆 ID 列表 */
    triggeredBy: string[];
    /** 置信度 (0-1) */
    confidence: number;
    /** 关联的已有记忆 ID（如果有） */
    relatedMemoryId?: string;
}
export interface NudgeOptions {
    /** 启用场景（默认全开） */
    enabledScenes?: NudgeReason[];
    /** 重复模式检测：同一话题最小出现次数 */
    repeatThreshold?: number;
    /** 重复模式检测：时间窗口（毫秒） */
    repeatWindowMs?: number;
    /** 复杂任务检测：最小重要性阈值 */
    complexTaskMinImportance?: number;
    /** 复杂任务检测：最小记忆数 */
    complexTaskMinMemories?: number;
    /** 用户 ID（多租户） */
    userId?: string;
}
export declare class NudgeEngine {
    private db;
    private options;
    private static readonly DEFAULTS;
    constructor(db: MemoryDatabase, options?: NudgeOptions);
    /**
     * 当新记忆写入时调用，返回 nudge 建议列表
     *
     * 在写路径外异步调用，不阻塞主流程。
     * 每条新记忆独立分析，去重后返回。
     */
    onMemoryWritten(memories: MemoryNode[], options?: {
        sessionId?: string;
    }): NudgeSuggestion[];
    /**
     * 批量分析：扫描近期所有记忆，发现跨会话模式
     *
     * 适合定时触发（如每 5 分钟），
     * 发现新 nudge 时返回建议列表。
     */
    analyzeRecent(hours?: number): NudgeSuggestion[];
    /**
     * 更新配置（运行时动态调整）
     */
    updateOptions(options: Partial<NudgeOptions>): void;
    /**
     * 对单条新记忆检测所有可能的 nudge 场景
     */
    private _detectScene;
    /**
     * 检测重复模式：同一话题短时间多次出现
     */
    private _detectRepeatedPatterns;
    /**
     * 检测错误复现：新记忆与已知的 decision/错误记录匹配
     */
    private _detectErrorRevisits;
    /**
     * 检测知识缺口：高重要性记忆但未被关联到代码符号
     */
    private _detectKnowledgeGaps;
    /**
     * 检查是否已有相关的 decision 节点
     */
    private _hasRelatedDecision;
    /**
     * 提取文本中的关键词（去停用词）
     */
    private _extractTerms;
    /**
     * 去重：相同 reason + 相同 triggeredBy
     */
    private _deduplicate;
}
//# sourceMappingURL=nudge-engine.d.ts.map