/**
 * Memory Logger — 结构化日志系统
 *
 * 以时间戳 + 级别 + 模块 + 操作为单位的结构化日志。
 * 环形缓冲区 + 错误回调通知 + 可选 SQLite 持久化。
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export interface LogEntry {
    id: number;
    timestamp: number;
    level: LogLevel;
    module: string;
    operation: string;
    message: string;
    duration?: number;
    error?: string;
    stack?: string;
    context?: Record<string, unknown>;
}
export interface LoggerConfig {
    /** 环形缓冲区大小 (默认 1000) */
    bufferSize: number;
    /** 最低记录级别 (默认 'debug') */
    minLevel: LogLevel;
    /** 是否持久化错误到 SQLite (默认 true) */
    persistErrors: boolean;
}
export type LogCallback = (entry: LogEntry) => void;
export type ErrorCallback = (entry: LogEntry) => void;
export declare class MemoryLogger {
    private config;
    private buffer;
    private nextId;
    private onLogCallbacks;
    private onErrorCallbacks;
    private persistDb;
    constructor(config?: Partial<LoggerConfig>);
    /** 绑定 SQLite 持久化（会在 MemorySystem.init 时自动设置） */
    setPersistDb(db: {
        run: (sql: string, ...params: unknown[]) => void;
    }): void;
    /** 注册日志回调（每次写入日志时触发） */
    onLog(cb: LogCallback): void;
    /** 注册错误通知回调（error/fatal 级别触发） */
    onError(cb: ErrorCallback): void;
    debug(module: string, operation: string, message: string, ctx?: Record<string, unknown>): void;
    info(module: string, operation: string, message: string, ctx?: Record<string, unknown>): void;
    warn(module: string, operation: string, message: string, ctx?: Record<string, unknown>): void;
    error(module: string, operation: string, message: string, err?: Error, ctx?: Record<string, unknown>): void;
    fatal(module: string, operation: string, message: string, err?: Error, ctx?: Record<string, unknown>): void;
    /** 带耗时的操作日志 */
    timed<T>(module: string, operation: string, fn: () => Promise<T>, ctx?: Record<string, unknown>): Promise<T>;
    /** 获取最近 N 条日志 */
    getRecent(limit?: number, minLevel?: LogLevel): LogEntry[];
    /** 获取指定级别以上的日志 */
    getErrorsSince(timestamp: number): LogEntry[];
    /** 获取最近错误数量 */
    getRecentErrorCount(sinceMs?: number): number;
    /** 获取指定模块的日志 */
    getByModule(module: string, limit?: number): LogEntry[];
    /** 清除缓冲区 */
    clear(): void;
    private log;
}
//# sourceMappingURL=memory-logger.d.ts.map