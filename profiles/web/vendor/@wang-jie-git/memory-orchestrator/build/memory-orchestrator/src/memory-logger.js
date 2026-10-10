/**
 * Memory Logger — 结构化日志系统
 *
 * 以时间戳 + 级别 + 模块 + 操作为单位的结构化日志。
 * 环形缓冲区 + 错误回调通知 + 可选 SQLite 持久化。
 */
const LEVEL_NUM = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
};
const DEFAULT_CONFIG = {
    bufferSize: 1000,
    minLevel: "debug",
    persistErrors: true,
};
export class MemoryLogger {
    config;
    buffer = [];
    nextId = 0;
    onLogCallbacks = [];
    onErrorCallbacks = [];
    persistDb = null;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /** 绑定 SQLite 持久化（会在 MemorySystem.init 时自动设置） */
    setPersistDb(db) {
        this.persistDb = db;
        // 确保日志表存在
        db.run(`
      CREATE TABLE IF NOT EXISTS memory_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        module TEXT NOT NULL,
        operation TEXT NOT NULL,
        message TEXT NOT NULL,
        duration INTEGER,
        error TEXT,
        stack TEXT,
        context_json TEXT
      )
    `);
        db.run(`CREATE INDEX IF NOT EXISTS idx_memory_logs_level ON memory_logs(level)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_memory_logs_timestamp ON memory_logs(timestamp)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_memory_logs_module ON memory_logs(module)`);
    }
    /** 注册日志回调（每次写入日志时触发） */
    onLog(cb) {
        this.onLogCallbacks.push(cb);
    }
    /** 注册错误通知回调（error/fatal 级别触发） */
    onError(cb) {
        this.onErrorCallbacks.push(cb);
    }
    // ===== Core Log Methods =====
    debug(module, operation, message, ctx) {
        this.log("debug", module, operation, message, { context: ctx });
    }
    info(module, operation, message, ctx) {
        this.log("info", module, operation, message, { context: ctx });
    }
    warn(module, operation, message, ctx) {
        this.log("warn", module, operation, message, { context: ctx });
    }
    error(module, operation, message, err, ctx) {
        this.log("error", module, operation, message, {
            error: err?.message ?? String(err),
            stack: err?.stack,
            context: ctx,
        });
    }
    fatal(module, operation, message, err, ctx) {
        this.log("fatal", module, operation, message, {
            error: err?.message ?? String(err),
            stack: err?.stack,
            context: ctx,
        });
    }
    /** 带耗时的操作日志 */
    timed(module, operation, fn, ctx) {
        const start = performance.now();
        return fn()
            .then((result) => {
            const duration = Math.round(performance.now() - start);
            this.log("info", module, operation, "OK", { duration, context: ctx });
            return result;
        })
            .catch((err) => {
            const duration = Math.round(performance.now() - start);
            this.log("error", module, operation, err.message, {
                duration, error: err.message, stack: err.stack, context: ctx,
            });
            throw err;
        });
    }
    // ===== Query =====
    /** 获取最近 N 条日志 */
    getRecent(limit = 50, minLevel) {
        const minNum = minLevel ? LEVEL_NUM[minLevel] : 0;
        const filtered = this.buffer.filter((e) => LEVEL_NUM[e.level] >= minNum);
        return filtered.slice(-limit);
    }
    /** 获取指定级别以上的日志 */
    getErrorsSince(timestamp) {
        return this.buffer.filter((e) => e.timestamp >= timestamp && LEVEL_NUM[e.level] >= LEVEL_NUM.error);
    }
    /** 获取最近错误数量 */
    getRecentErrorCount(sinceMs = 3600000) {
        const cutoff = Date.now() - sinceMs;
        return this.buffer.filter((e) => e.timestamp >= cutoff && LEVEL_NUM[e.level] >= LEVEL_NUM.error).length;
    }
    /** 获取指定模块的日志 */
    getByModule(module, limit = 20) {
        return this.buffer.filter((e) => e.module === module).slice(-limit);
    }
    /** 清除缓冲区 */
    clear() {
        this.buffer = [];
    }
    // ===== Internal =====
    log(level, module, operation, message, extra = {}) {
        if (LEVEL_NUM[level] < LEVEL_NUM[this.config.minLevel])
            return;
        const entry = {
            id: this.nextId++,
            timestamp: Date.now(),
            level,
            module,
            operation,
            message,
            ...extra,
        };
        // 环形缓冲区
        this.buffer.push(entry);
        if (this.buffer.length > this.config.bufferSize) {
            this.buffer.shift();
        }
        // 回调通知
        for (const cb of this.onLogCallbacks) {
            try {
                cb(entry);
            }
            catch { /* 通知失败不阻塞 */ }
        }
        // 错误级别 → 触发 onError 回调
        if (LEVEL_NUM[level] >= LEVEL_NUM.error) {
            for (const cb of this.onErrorCallbacks) {
                try {
                    cb(entry);
                }
                catch { /* 通知失败不阻塞 */ }
            }
        }
        // 持久化（仅 error/fatal + 配置开启）
        if (this.persistDb && this.config.persistErrors && LEVEL_NUM[level] >= LEVEL_NUM.error) {
            try {
                this.persistDb.run(`INSERT INTO memory_logs (timestamp, level, module, operation, message, duration, error, stack, context_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, entry.timestamp, entry.level, entry.module, entry.operation, entry.message, entry.duration ?? null, entry.error ?? null, entry.stack ?? null, entry.context ? JSON.stringify(entry.context) : null);
            }
            catch {
                // 持久化失败不阻塞
            }
        }
    }
}
//# sourceMappingURL=memory-logger.js.map