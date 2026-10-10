/**
 * Hook System — 事件驱动自动化
 *
 * 功能：
 * - 在特定事件发生时自动执行 Hook
 * - 版本化 Hook ABI (Application Binary Interface)
 * - 重试 + 降级机制
 * - Hook 权限控制
 * - 客户端隔离
 *
 * 参考: MemoraX Code 的 Hook 系统
 *
 * Hook 事件类型：
 * - memory_written: 记忆写入后触发
 * - memory_queried: 记忆查询后触发
 * - dream_completed: 梦境整理完成后触发
 * - session_compressed: 会话压缩完成后触发
 * - user_observed: 用户观察记录后触发
 * - procedure_executed: 工作流程执行后触发
 * - health_check: 健康检查时触发
 */
export interface HookContext {
    /** Hook 版本 (用于 ABI 兼容性) */
    version: string;
    /** 触发时间戳 */
    timestamp: number;
    /** 客户端 ID (用于隔离) */
    clientId?: string;
    /** 用户 ID */
    userId?: string;
    /** 会话 ID */
    sessionId?: string;
    /** 预览模式（仅 dream 事件） */
    dryRun?: boolean;
}
export interface HookResult {
    /** 是否成功 */
    success: boolean;
    /** 执行时间（毫秒） */
    executionTimeMs: number;
    /** 输出数据 */
    data?: unknown;
    /** 错误信息（失败时） */
    error?: string;
    /** 是否降级执行 */
    degraded?: boolean;
}
export type HookHandler = (context: HookContext, payload: unknown) => Promise<HookResult>;
export interface HookDefinition {
    /** Hook ID */
    id: string;
    /** Hook 名称 */
    name: string;
    /** Hook 描述 */
    description: string;
    /** 监听的事件类型 */
    event: HookEvent;
    /** 优先级（0-100，数字越小优先级越高） */
    priority: number;
    /** 是否启用 */
    enabled: boolean;
    /** 最大重试次数（默认 3） */
    maxRetries: number;
    /** 重试延迟（毫秒，默认 1000） */
    retryDelayMs: number;
    /** 是否允许降级执行（默认 true） */
    allowDegraded: boolean;
    /** 权限控制（可选，为空则允许所有客户端） */
    allowedClients?: string[];
    /** 版本约束（格式: ">=1.0.0"） */
    versionConstraint?: string;
    /** 处理器 */
    handler: HookHandler;
    /** 注册时间戳 */
    registeredAt: number;
    /** 最后执行时间戳 */
    lastExecutedAt?: number;
    /** 执行次数 */
    executionCount: number;
    /** 失败次数 */
    failureCount: number;
}
export type HookEvent = "memory_written" | "memory_queried" | "dream_completed" | "session_compressed" | "user_observed" | "procedure_executed" | "health_check" | "system_startup" | "system_shutdown";
export interface HookSystemConfig {
    /** 是否启用 Hook 系统 */
    enabled: boolean;
    /** 全局最大重试次数 */
    globalMaxRetries: number;
    /** 全局重试延迟（毫秒） */
    globalRetryDelayMs: number;
    /** 是否允许降级执行 */
    globalAllowDegraded: boolean;
    /** Hook 执行超时（毫秒，默认 30000） */
    executionTimeoutMs: number;
    /** 是否记录 Hook 执行日志 */
    enableLogging: boolean;
}
export declare const DEFAULT_HOOK_CONFIG: HookSystemConfig;
export interface HookExecutionLog {
    /** Hook ID */
    hookId: string;
    /** 事件类型 */
    event: HookEvent;
    /** 执行结果 */
    result: HookResult;
    /** 开始时间 */
    startedAt: number;
    /** 完成时间 */
    completedAt: number;
    /** 上下文 */
    context: HookContext;
    /** 载荷 */
    payload: unknown;
}
export interface HookStats {
    /** 注册的 Hook 总数 */
    totalHooks: number;
    /** 启用的 Hook 数 */
    enabledHooks: number;
    /** 总执行次数 */
    totalExecutions: number;
    /** 总失败次数 */
    totalFailures: number;
    /** 按事件类型的分布 */
    byEvent: Record<HookEvent, number>;
    /** 平均执行时间（毫秒） */
    avgExecutionTimeMs: number;
}
export declare class HookSystem {
    private config;
    private hooks;
    private executionLogs;
    private maxLogSize;
    constructor(config?: Partial<HookSystemConfig>);
    /**
     * 更新配置
     */
    updateConfig(config: Partial<HookSystemConfig>): void;
    /**
     * 获取当前配置
     */
    getConfig(): HookSystemConfig;
    /**
     * 注册 Hook
     */
    register(hook: Omit<HookDefinition, "registeredAt" | "executionCount" | "failureCount" | "lastExecutedAt">): void;
    /**
     * 注销 Hook
     */
    unregister(hookId: string): boolean;
    /**
     * 启用 Hook
     */
    enable(hookId: string): boolean;
    /**
     * 禁用 Hook
     */
    disable(hookId: string): boolean;
    /**
     * 触发事件
     *
     * 按优先级排序，同步执行所有启用的 Hook
     */
    trigger(event: HookEvent, payload: unknown, context?: Partial<HookContext>): Promise<HookResult[]>;
    /**
     * 获取 Hook 详情
     */
    getHook(hookId: string): HookDefinition | null;
    /**
     * 列出所有 Hook
     */
    listHooks(filters?: {
        event?: HookEvent;
        enabled?: boolean;
        clientId?: string;
    }): HookDefinition[];
    /**
     * 获取 Hook 统计
     */
    getStats(): HookStats;
    /**
     * 获取最近的 Hook 执行日志
     */
    getExecutionLogs(limit?: number): HookExecutionLog[];
    /**
     * 清空执行日志
     */
    clearLogs(): void;
    /**
     * 执行单个 Hook（带重试和降级）
     */
    private executeHook;
    /**
     * 检查客户端权限
     */
    private checkPermissions;
    /**
     * 检查版本约束
     */
    private checkVersion;
    /**
     * 比较版本号
     */
    private compareVersions;
    /**
     * 记录执行日志
     */
    private logExecution;
    /**
     * 延迟函数
     */
    private sleep;
}
/**
 * 健康检查 Hook — 在健康检查时自动记录日志
 */
export declare function createHealthCheckHook(): Omit<HookDefinition, "registeredAt" | "executionCount" | "failureCount" | "lastExecutedAt">;
/**
 * 记忆写入通知 Hook — 记忆写入后通知用户
 */
export declare function createMemoryWrittenNotificationHook(): Omit<HookDefinition, "registeredAt" | "executionCount" | "failureCount" | "lastExecutedAt">;
/**
 * 系统启动 Hook — 系统启动时执行初始化
 */
export declare function createSystemStartupHook(): Omit<HookDefinition, "registeredAt" | "executionCount" | "failureCount" | "lastExecutedAt">;
//# sourceMappingURL=hook-system.d.ts.map