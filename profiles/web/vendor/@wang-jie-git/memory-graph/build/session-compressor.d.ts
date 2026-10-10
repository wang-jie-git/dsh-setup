/**
 * Session Compressor — 会话记忆压缩与上下文注入
 *
 * 受 Hermes 跨会话总结启发（Phase A of RFC-06）：
 * 会话结束时自动生成摘要 → 新会话自动注入上下文，
 * 保持跨会话的上下文连续性，而不需要每次都全量检索。
 *
 * 核心设计：
 * 1. compress() — 将一段会话中的记忆压缩为 session_summary 节点
 * 2. getSessionSummaries() — 查询某会话的所有摘要
 * 3. getRecentSummaries() — 获取最近摘要用于新会话上下文注入
 * 4. injectContext() — 为新会话准备注入上下文
 * 5. refreshExpired() — 清理过期摘要
 *
 * 复用 One Memory 的 schema：session_summary 节点类型 + summarizes 边关系
 * 与梦境引擎的关系：session-compressor 负责实时轻量压缩，
 * 梦境引擎负责深度归纳和冗余合并，两者互补。
 */
import { MemoryDatabase, MemoryNode } from "./database";
export interface SessionSummary {
    /** 摘要节点 ID */
    id: string;
    /** 标题 */
    title: string;
    /** 摘要正文 */
    summary: string;
    /** 来源会话 ID */
    sessionId: string;
    /** 被总结的记忆节点数 */
    memoryCount: number;
    /** 时间范围 */
    timeRange: {
        start: number;
        end: number;
    };
    /** 重要性 (0-10) */
    importance: number;
    /** 标签 */
    tags: string[];
    /** 创建时间 */
    createdAt: number;
}
export interface CompressOptions {
    /** 生成摘要标题（LLM 生成传入） */
    title?: string;
    /** 摘要正文（LLM 生成传入） */
    summary?: string;
    /** 重要性覆盖 */
    importance?: number;
    /** 标签覆盖 */
    tags?: string[];
    /** 作用域 */
    scope?: "public" | "global";
    /** 用户 ID（多租户） */
    userId?: string;
    /** 是否覆盖已有摘要（默认 true） */
    overwrite?: boolean;
}
export interface InjectContext {
    /** 上下文文本段落 */
    contexts: Array<{
        title: string;
        summary: string;
        importance: number;
        sessionId: string;
        createdAt: number;
    }>;
    /** 总记忆数 */
    totalMemories: number;
    /** 时间跨度（小时） */
    timeSpanHours: number;
}
export interface InjectOptions {
    /** 最大注入数量 */
    maxContexts?: number;
    /** 最小重要性阈值 */
    minImportance?: number;
    /** 最大时间范围（小时） */
    maxHours?: number;
    /** 按 sessionId 过滤（排除当前会话） */
    excludeSessionId?: string;
    /** 用户 ID */
    userId?: string;
}
export declare class SessionCompressor {
    private db;
    constructor(db: MemoryDatabase);
    /**
     * 压缩一组会话记忆为摘要节点
     *
     * 流程：
     * 1. 检查该会话是否已有摘要（overwrite 或合并）
     * 2. 创建/更新 session_summary 节点
     * 3. 为每条源记忆创建 summarizes 边
     * 4. 返回新摘要
     *
     * 调用方负责生成 title/summary（可调用 LLM），
     * 本模块只做持久化和关联。
     */
    compress(sessionId: string, memories: MemoryNode[], options?: CompressOptions): SessionSummary;
    /**
     * 获取某会话的所有摘要
     *
     * 通过 sourceSession 字段匹配，按创建时间倒序。
     */
    getSessionSummaries(sessionId: string, options?: {
        userId?: string;
    }): SessionSummary[];
    /**
     * 获取最近摘要（用于新会话上下文注入）
     *
     * 按重要性 × 时效性加权排序，取 top N。
     */
    getRecentSummaries(limit?: number, options?: {
        userId?: string;
        minImportance?: number;
    }): SessionSummary[];
    /**
     * 为新会话准备注入上下文
     *
     * 返回结构化的上下文数据，可直接用于：
     * - 系统 prompt 注入
     * - 记忆检索的初始过滤
     * - 用户可见的"上次会话回顾"
     *
     * 排除当前会话的摘要，避免自引用。
     */
    injectContext(options?: InjectOptions): InjectContext;
    /**
     * 清理过期摘要
     *
     * 删除超过 TTL 的 session_summary 节点。
     * 由外部定时器调用（如 cron 或梦境引擎调度）。
     */
    refreshExpired(dryRun?: boolean): {
        deleted: number;
    };
    /**
     * 查找某会话已有的摘要
     */
    private _findExistingSummary;
    /**
     * 将数据库行转为 SessionSummary
     */
    private _rowToSummary;
}
//# sourceMappingURL=session-compressor.d.ts.map