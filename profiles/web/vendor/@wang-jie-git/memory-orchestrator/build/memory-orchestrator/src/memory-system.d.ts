/**
 * memory-orchestrator: MemorySystem — 统一入口
 *
 * One App 通过 MemorySystem 完成所有记忆操作：
 *   init(dbPath) → 连接图 + 向量 + embedder
 *   write(entry) → 图写入 + 向量索引 + Obsidian 同步
 *   query(text)  → 混合查询
 *   dream()      → 梦境整理（熵减）
 *   getHealth()  → 健康检查
 *   getLogs()    → 日志查询
 *   shutdown()   → flush 缓冲 + 关闭所有连接
 */
import { type MemoryNode, type MemoryNodeType, type MemorySource, type MemoryScope } from "../../memory-graph/src/database";
import { type HybridQueryConfig } from "./index";
import { SessionCompressor, type SessionCompressorConfig } from "./session-compressor";
import { NudgeEngine } from "../../memory-graph/src/nudge-engine";
import { UserProfileEngine } from "../../memory-graph/src/user-profile";
import { ProcedureMemoryEngine } from "../../memory-graph/src/procedure-memory";
import { HookSystem, type HookSystemConfig } from "../../memory-graph/src/hook-system";
import { MemoryLogger, type LogEntry, type LogLevel } from "./memory-logger";
import { MemoryWatchdog, type HealthStatus, type WatchdogConfig, type EvaluationReport, type ReportCallback } from "./memory-watchdog";
import { AutoWritebackRuntime, type AutoWritebackConfig } from "./auto-writeback";
import { TodoManager } from "../../memory-graph/src/todo-manager";
import { PromptManager } from "../../memory-graph/src/prompt-manager";
import { SessionBookmarkManager } from "../../memory-graph/src/session-bookmark";
import { MemorySync } from "../../memory-graph/src/memory-sync";
import { NotificationBus } from "../../memory-graph/src/notification-bus";
export interface MemorySystemConfig {
    /** CodeGraph DB 目录（包含 codegraph.db） */
    codegraphDir: string;
    /** 向量存储文件名（相对 codegraphDir） */
    vectorDbFilename?: string;
    /** Obsidian Vault 根路径（可选，不填则不初始化 ObsidianWriter） */
    obsidianVaultPath?: string;
    /** Obsidian 子目录 */
    obsidianSubDir?: string;
    /** Embedder 类型: 'local' | 'api' | 'simple' */
    embedder?: "local" | "api" | "simple";
    /** API embedder 配置（仅 embedder='api' 时需要） */
    embedderApiKey?: string;
    embedderBaseUrl?: string;
    embedderModel?: string;
    /** 混合查询配置 */
    hybridQuery?: Partial<HybridQueryConfig>;
    /** 查询优化器配置（可选，不配置则不启用优化） */
    queryOptimizer?: {
        /** 优化器类型: 'llm' | 'none' */
        type: "llm" | "none";
        /** LLM API base URL（OpenAI-compatible） */
        baseUrl?: string;
        /** API key */
        apiKey?: string;
        /** 模型名，默认 gpt-4o-mini */
        model?: string;
    };
    /** 重排序器配置（可选，不配置则不启用重排序） */
    reranker?: {
        /** 重排序器类型: 'embedding' | 'none' */
        type: "embedding" | "none";
        /** 粗召回数量，默认 20 */
        candidateK?: number;
        /** 最终返回数量，默认 5 */
        topK?: number;
    };
    /** 用户画像配置（可选） */
    userProfile?: {
        /** 记忆 TTL（天，默认 90） */
        ttlDays?: number;
        /** 置信度衰减率（每天，默认 0.02） */
        decayRate?: number;
        /** 矛盾检测阈值（默认 0.3） */
        contradictionThreshold?: number;
    };
    /** Procedure Memory 配置（可选） */
    procedureMemory?: {
        /** 是否启用（默认 true） */
        enabled?: boolean;
        /** 默认最大搜索结果数（默认 10） */
        defaultLimit?: number;
        /** 匹配分数阈值（0-1，默认 0.5） */
        matchThreshold?: number;
        /** 自动归档过期时间（天，默认 180） */
        ttlDays?: number;
        /** 最小执行次数才推荐（默认 3） */
        minExecutionCountForRecommendation?: number;
    };
    /** 写入缓冲大小（条数，默认 10） */
    writeBufferSize?: number;
    /** 写入缓冲间隔（ms，默认 2000） */
    writeBufferIntervalMs?: number;
    /** 日志配置 */
    logger?: {
        bufferSize?: number;
        minLevel?: LogLevel;
        persistErrors?: boolean;
    };
    /** 会话压缩配置（默认启用） */
    sessionCompressor?: Partial<SessionCompressorConfig>;
    /** 健康检查配置 */
    watchdog?: Partial<WatchdogConfig>;
    /** 错误通知回调（error/fatal 级别触发） */
    onError?: (entry: LogEntry) => void;
    /** 系统不健康回调 */
    onUnhealthy?: (status: HealthStatus) => void;
    /** 自动写回配置（可选，默认禁用） */
    autoWriteback?: Partial<AutoWritebackConfig>;
    /** Hook 系统配置（可选，默认启用） */
    hooks?: Partial<HookSystemConfig>;
}
export declare class MemorySystem {
    private config;
    private memoryDb;
    private vectorStore;
    private embedder;
    private obsidianWriter?;
    private queryEngine;
    /** 会话压缩器（跨会话上下文连续） */
    readonly sessionCompressor?: SessionCompressor;
    /** 主动 Nudge 引擎（模式检测与建议） */
    readonly nudgeEngine?: NudgeEngine;
    /** 用户画像引擎（辩证建模） */
    readonly userProfileEngine?: UserProfileEngine;
    /** Procedure Memory 引擎（工作流程记忆） */
    readonly procedureEngine?: ProcedureMemoryEngine;
    /** Hook 系统 */
    readonly hookSystem?: HookSystem;
    /** 自动写回运行时 */
    readonly autoWriteback?: AutoWritebackRuntime;
    /** 四轨待办管理器（v12） */
    readonly todoManager?: TodoManager;
    /** 提示词管理器（v12） */
    readonly promptManager?: PromptManager;
    /** 会话书签管理器（v12） */
    readonly bookmarkManager?: SessionBookmarkManager;
    /** 记忆同步（v12） */
    readonly memorySync?: MemorySync;
    /** 通知总线（v12） */
    readonly notificationBus?: NotificationBus;
    private writeBuffer;
    private bufferTimer;
    private _initialized;
    /** 日志系统 */
    readonly logger: MemoryLogger;
    /** 健康看门狗 */
    readonly watchdog: MemoryWatchdog;
    private constructor();
    static init(config: MemorySystemConfig): Promise<MemorySystem>;
    get initialized(): boolean;
    /**
     * checkSystemTier — 系统层级权限校验
     *
     * 4 层防御链的第 2 层（软校验）：
     * - 第 1 层：工具注册表不向 Employee Agent 分发 global_* 工具名
     * - 第 2 层：运行时校验环境变量 AI_MEMORY_TIER
     * - 第 3 层：查询时强制过滤 scope="public"（memory_query handler）
     * - 第 4 层：SQLite CHECK 约束限制 scope/tier_min
     *
     * @param requiredTier "global" 操作需要 AI_MEMORY_TIER=prime
     * @returns true 如果通过校验
     * @throws Error 如果权限不足
     */
    static checkSystemTier(requiredTier?: "global" | "public"): boolean;
    /** 获取最近 N 条日志 */
    getLogs(limit?: number, minLevel?: LogLevel): LogEntry[];
    /** 获取最近错误 */
    getRecentErrors(hours?: number): LogEntry[];
    /** 获取指定模块日志 */
    getLogsByModule(module: string, limit?: number): LogEntry[];
    /** 注册日志回调 */
    onLog(cb: (entry: LogEntry) => void): void;
    /** 注册错误通知回调 */
    onError(cb: (entry: LogEntry) => void): void;
    /** 执行一次健康检查 */
    checkHealth(): Promise<HealthStatus>;
    /** 获取最近一次健康状态 */
    getHealth(): HealthStatus | null;
    /** 注册不健康回调 */
    onUnhealthy(cb: (status: HealthStatus) => void): void;
    /** 生成评估报告（手动触发） */
    generateReport(): EvaluationReport;
    /** 注册评估报告回调（系统不健康时自动触发） */
    onReport(cb: ReportCallback): void;
    /** 获取格式化文本报告 */
    formatReport(report?: EvaluationReport): string;
    write(data: {
        title: string;
        summary?: string;
        body?: string;
        importance?: number;
        tags?: string[];
        nodeType?: MemoryNodeType;
        source?: MemorySource;
        sourceSession?: string;
        ttlDays?: number | null;
        scope?: MemoryScope;
        tierMin?: number;
        negativeExamples?: Array<{
            scenario: string;
            whyFails: string;
            betterApproach: string;
        }>;
        isDeprecated?: boolean;
        deprecatedAt?: number | null;
        userId?: string;
        agentId?: string;
        confidence?: number;
        verified?: boolean;
        privacyFlag?: number;
        gitBranch?: string | null;
        projectDir?: string | null;
    }): Promise<MemoryNode>;
    writeBatch(entries: Array<{
        title: string;
        summary?: string;
        body?: string;
        importance?: number;
        tags?: string[];
        nodeType?: MemoryNodeType;
        source?: MemorySource;
        userId?: string;
        agentId?: string;
        confidence?: number;
        verified?: boolean;
    }>): Promise<MemoryNode[]>;
    /**
     * 异步写入（无缓冲，立即执行）
     *
     * 供自动写回等场景使用，不需要缓冲直接写入
     */
    writeAsync(data: Parameters<MemorySystem["write"]>[0]): Promise<MemoryNode>;
    private scheduleFlush;
    private flush;
    query(text: string, filter?: {
        importanceMin?: number;
        userId?: string;
    }): Promise<import("./index").HybridQueryResponse>;
    linkMemoryToCode(memoryId: string, codeSymbolId: string, description?: string): void;
    linkMemoryToMemory(sourceId: string, targetId: string, relation: "causes" | "fixes" | "precedes" | "references" | "contradicts" | "supersedes" | "relates_to" | "implements", description?: string): void;
    dream(dryRun?: boolean): Promise<import("./dream").DreamReport>;
    /** 按内容哈希查重（v11 gatekeeper 支持） */
    findDuplicateByHash(summary: string, body: string): Promise<MemoryNode | null>;
    /**
     * 压缩会话，生成摘要记忆节点。
     * 纯算法实现，无 LLM 调用，零外部依赖。
     *
     * @param sessionId 会话 ID
     * @param messages 会话消息列表
     * @param options 可选参数（token 数、引用记忆/代码符号 ID、用户 ID）
     * @returns CompressedSession | null（会话太短则返回 null）
     */
    compressSession(sessionId: string, messages: string[], options?: {
        sessionStart?: number;
        tokenCount?: number;
        referencedMemoryIds?: string[];
        referencedCodeSymbolIds?: string[];
        userId?: string;
    }): Promise<import("./session-compressor").CompressedSession | null>;
    /**
     * 获取最近 N 条会话摘要，用于跨会话上下文注入。
     *
     * @param count 返回数量
     * @param userId 用户 ID 过滤（可选）
     * @returns 摘要列表
     */
    getSessionContext(count?: number, userId?: string): import("./session-compressor").SessionSummary[];
    /**
     * 格式化会话摘要为上下文注入文本。
     */
    formatSessionContext(summaries: import("./session-compressor").SessionSummary[]): string;
    /**
     * 分析近期记忆，发现跨会话模式（适合定时触发）。
     * 返回 Nudge 建议列表，空数组表示无建议。
     */
    analyzeNudges(hours?: number): import("../../memory-graph/src/nudge-engine").NudgeSuggestion[];
    /**
     * 新记忆写入后调用，返回 nudge 建议（不阻塞写路径）。
     */
    onMemoryWritten(nodeIds: string[]): import("../../memory-graph/src/nudge-engine").NudgeSuggestion[];
    /**
     * 记录一条用户观察（创建/更新 observation 节点，检测矛盾）。
     */
    observeUser(type: "preference" | "behavior" | "skill" | "knowledge" | "trait", domain: string, content: string, options?: {
        userId?: string;
        confidence?: number;
        sourceSession?: string | null;
    }): import("../../memory-graph/src/user-profile").ObserveResult;
    /**
     * 获取用户画像（累积的 trait 与 domain 统计）。
     */
    getUserProfile(userId?: string): import("../../memory-graph/src/user-profile").UserProfile;
    /**
     * 获取用户画像摘要文本（适合注入上下文）。
     */
    getUserProfileSummary(userId?: string, maxTraits?: number): string;
    /**
     * 获取用户画像系统 Prompt 片段（自动注入用）
     */
    getUserProfilePromptSnippet(userId?: string, maxTraits?: number): string;
    /**
     * 删除用户观察
     */
    deleteUserObservation(observationId: string): boolean;
    /**
     * 获取观察详情
     */
    getUserObservation(observationId: string): import("../../memory-graph/src/user-profile").Observation | null;
    /**
     * 记录工作流程
     */
    recordProcedure(record: Omit<import("../../memory-graph/src/procedure-memory").ProcedureRecord, "id" | "createdAt" | "updatedAt" | "nodeType">): import("../../memory-graph/src/procedure-memory").ProcedureRecord;
    /**
     * 查找工作流程
     */
    findProcedures(query: {
        text?: string;
        tags?: string[];
        category?: string;
        author?: string;
        minExecutionCount?: number;
        minSuccessRate?: number;
        maxDifficulty?: number;
        limit?: number;
    }): import("../../memory-graph/src/procedure-memory").ProcedureMatch[];
    /**
     * 执行工作流程
     */
    executeProcedure(procedureId: string, inputs: Record<string, unknown>): import("../../memory-graph/src/procedure-memory").ProcedureExecution;
    /**
     * 获取工作流程详情
     */
    getProcedure(procedureId: string): import("../../memory-graph/src/procedure-memory").ProcedureRecord | null;
    /**
     * 列出所有工作流程
     */
    listProcedures(filters?: {
        category?: string;
        author?: string;
        tags?: string[];
        limit?: number;
    }): import("../../memory-graph/src/procedure-memory").ProcedureRecord[];
    /**
     * 获取推荐工作流程
     */
    getRecommendedProcedures(filters?: {
        category?: string;
        limit?: number;
    }): import("../../memory-graph/src/procedure-memory").ProcedureMatch[];
    /**
     * 删除工作流程（软删除）
     */
    deleteProcedure(procedureId: string): boolean;
    /**
     * 更新工作流程（创建新版本）
     */
    updateProcedure(procedureId: string, updates: Partial<Omit<import("../../memory-graph/src/procedure-memory").ProcedureRecord, "id" | "createdAt" | "nodeType">>): import("../../memory-graph/src/procedure-memory").ProcedureRecord | null;
    /**
     * 更新 Procedure Memory 配置
     */
    updateProcedureConfig(config: Partial<import("../../memory-graph/src/procedure-memory").ProcedureMemoryConfig>): void;
    /**
     * 获取用户画像健康统计
     */
    getUserProfileHealth(userId?: string): ReturnType<import("../../memory-graph/src/user-profile").UserProfileEngine["getHealthStats"]>;
    /**
     * 更新用户画像配置
     */
    updateUserProfileConfig(config: Partial<import("../../memory-graph/src/user-profile").UserProfileMemoryConfig>): void;
    prune(options?: {
        dryRun?: boolean;
    }): {
        deleted: number;
        archived: number;
    };
    checkConsistency(): {
        inGraph: number;
        inVector: number;
        graphOnly: string[];
        vectorOnly: string[];
        ok: boolean;
    };
    rebuildVectorIndex(): Promise<number>;
    stats(): {
        graph: import("../../memory-graph/src/database").MemoryGraphStats;
        vector: {
            total: number;
            dimension: number;
        };
        obsidian: number;
        bufferPending: number;
        health: {
            score: number;
            healthy: boolean;
            uptime: string;
        } | null;
        recentErrors: number;
        logger: {
            buffered: string;
        };
    };
    shutdown(): Promise<void>;
}
//# sourceMappingURL=memory-system.d.ts.map