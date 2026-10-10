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
export const DEFAULT_HOOK_CONFIG = {
    enabled: true,
    globalMaxRetries: 3,
    globalRetryDelayMs: 1000,
    globalAllowDegraded: true,
    executionTimeoutMs: 30000,
    enableLogging: true,
};
// ===== Hook System =====
export class HookSystem {
    config;
    hooks = new Map();
    executionLogs = [];
    maxLogSize = 1000;
    constructor(config = {}) {
        this.config = { ...DEFAULT_HOOK_CONFIG, ...config };
    }
    /**
     * 更新配置
     */
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
    /**
     * 获取当前配置
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * 注册 Hook
     */
    register(hook) {
        if (!this.config.enabled && hook.enabled) {
            console.warn(`[HookSystem] Hook ${hook.name} 注册但系统已禁用`);
        }
        const fullHook = {
            ...hook,
            registeredAt: Date.now(),
            executionCount: 0,
            failureCount: 0,
        };
        this.hooks.set(hook.id, fullHook);
        if (this.config.enableLogging) {
            console.log(`[HookSystem] Hook 已注册: ${hook.name} (事件: ${hook.event}, 优先级: ${hook.priority})`);
        }
    }
    /**
     * 注销 Hook
     */
    unregister(hookId) {
        const deleted = this.hooks.delete(hookId);
        if (deleted && this.config.enableLogging) {
            console.log(`[HookSystem] Hook 已注销: ${hookId}`);
        }
        return deleted;
    }
    /**
     * 启用 Hook
     */
    enable(hookId) {
        const hook = this.hooks.get(hookId);
        if (!hook)
            return false;
        hook.enabled = true;
        return true;
    }
    /**
     * 禁用 Hook
     */
    disable(hookId) {
        const hook = this.hooks.get(hookId);
        if (!hook)
            return false;
        hook.enabled = false;
        return true;
    }
    /**
     * 触发事件
     *
     * 按优先级排序，同步执行所有启用的 Hook
     */
    async trigger(event, payload, context = {}) {
        if (!this.config.enabled) {
            return [];
        }
        const fullContext = {
            version: "1.0.0",
            timestamp: Date.now(),
            ...context,
        };
        // 获取匹配的 Hook 并按优先级排序
        const matchingHooks = Array.from(this.hooks.values())
            .filter((hook) => hook.event === event && hook.enabled)
            .filter((hook) => this.checkPermissions(hook, context))
            .filter((hook) => this.checkVersion(hook))
            .sort((a, b) => a.priority - b.priority);
        if (this.config.enableLogging) {
            console.log(`[HookSystem] 触发事件: ${event} (${matchingHooks.length} 个 Hook)`);
        }
        // 并发执行所有 Hook（不等待）
        const results = await Promise.allSettled(matchingHooks.map((hook) => this.executeHook(hook, fullContext, payload)));
        // 收集结果
        const hookResults = results.map((result, index) => {
            if (result.status === "fulfilled") {
                return result.value;
            }
            else {
                return {
                    success: false,
                    executionTimeMs: 0,
                    error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                };
            }
        });
        // 记录执行日志
        this.logExecution(event, fullContext, payload, hookResults);
        return hookResults;
    }
    /**
     * 获取 Hook 详情
     */
    getHook(hookId) {
        return this.hooks.get(hookId) ?? null;
    }
    /**
     * 列出所有 Hook
     */
    listHooks(filters) {
        let hooks = Array.from(this.hooks.values());
        if (filters?.event !== undefined) {
            hooks = hooks.filter((h) => h.event === filters.event);
        }
        if (filters?.enabled !== undefined) {
            hooks = hooks.filter((h) => h.enabled === filters.enabled);
        }
        if (filters?.clientId !== undefined) {
            hooks = hooks.filter((h) => !h.allowedClients || h.allowedClients.includes(filters.clientId));
        }
        return hooks.sort((a, b) => a.priority - b.priority);
    }
    /**
     * 获取 Hook 统计
     */
    getStats() {
        const hooks = Array.from(this.hooks.values());
        const totalExecutions = hooks.reduce((sum, h) => sum + h.executionCount, 0);
        const totalFailures = hooks.reduce((sum, h) => sum + h.failureCount, 0);
        const byEvent = {
            memory_written: 0,
            memory_queried: 0,
            dream_completed: 0,
            session_compressed: 0,
            user_observed: 0,
            procedure_executed: 0,
            health_check: 0,
            system_startup: 0,
            system_shutdown: 0,
        };
        hooks.forEach((hook) => {
            byEvent[hook.event] += hook.executionCount;
        });
        const avgExecutionTimeMs = this.executionLogs.length > 0
            ? this.executionLogs.reduce((sum, log) => sum + log.result.executionTimeMs, 0) / this.executionLogs.length
            : 0;
        return {
            totalHooks: hooks.length,
            enabledHooks: hooks.filter((h) => h.enabled).length,
            totalExecutions,
            totalFailures,
            byEvent,
            avgExecutionTimeMs,
        };
    }
    /**
     * 获取最近的 Hook 执行日志
     */
    getExecutionLogs(limit = 50) {
        return this.executionLogs.slice(-limit);
    }
    /**
     * 清空执行日志
     */
    clearLogs() {
        this.executionLogs = [];
    }
    // ===== Private: Helpers =====
    /**
     * 执行单个 Hook（带重试和降级）
     */
    async executeHook(hook, context, payload) {
        const maxRetries = hook.maxRetries ?? this.config.globalMaxRetries;
        const retryDelayMs = hook.retryDelayMs ?? this.config.globalRetryDelayMs;
        const allowDegraded = hook.allowDegraded ?? this.config.globalAllowDegraded;
        let lastError = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const startTime = Date.now();
            try {
                // 设置超时
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`Hook 执行超时 (${this.config.executionTimeoutMs}ms)`)), this.config.executionTimeoutMs);
                });
                const result = await Promise.race([hook.handler(context, payload), timeoutPromise]);
                const executionTimeMs = Date.now() - startTime;
                // 更新统计
                hook.executionCount++;
                hook.lastExecutedAt = Date.now();
                if (this.config.enableLogging) {
                    console.log(`[HookSystem] ✅ ${hook.name} 执行成功 (${executionTimeMs}ms)`);
                }
                return {
                    success: true,
                    executionTimeMs,
                    data: result.data,
                };
            }
            catch (err) {
                const executionTimeMs = Date.now() - startTime;
                lastError = err instanceof Error ? err : new Error(String(err));
                if (attempt < maxRetries) {
                    if (this.config.enableLogging) {
                        console.warn(`[HookSystem] ⚠️ ${hook.name} 执行失败，重试 (${attempt + 1}/${maxRetries})...`);
                    }
                    await this.sleep(retryDelayMs * (attempt + 1)); // 指数退避
                    continue;
                }
                // 所有重试失败
                hook.failureCount++;
                if (this.config.enableLogging) {
                    console.error(`[HookSystem] ❌ ${hook.name} 执行失败 (${maxRetries + 1} 次尝试):`, lastError.message);
                }
                // 降级执行（如果允许）
                if (allowDegraded) {
                    return {
                        success: false,
                        executionTimeMs,
                        error: lastError.message,
                        degraded: true,
                    };
                }
                return {
                    success: false,
                    executionTimeMs,
                    error: lastError.message,
                };
            }
        }
        // 理论上不会到达这里
        return {
            success: false,
            executionTimeMs: 0,
            error: lastError?.message ?? "未知错误",
        };
    }
    /**
     * 检查客户端权限
     */
    checkPermissions(hook, context) {
        if (!hook.allowedClients || hook.allowedClients.length === 0) {
            return true; // 无限制
        }
        if (!context.clientId) {
            return false; // 需要客户端 ID
        }
        return hook.allowedClients.includes(context.clientId);
    }
    /**
     * 检查版本约束
     */
    checkVersion(hook) {
        if (!hook.versionConstraint) {
            return true; // 无约束
        }
        const currentVersion = this.config.enabled ? "1.0.0" : "0.0.0";
        const constraint = hook.versionConstraint;
        // 简单的版本检查（支持 >=, <=, >, <, ==）
        const match = constraint.match(/^(>=|<=|>|<|==)?\s*(.+)$/);
        if (!match)
            return true;
        const [, operator, requiredVersion] = match;
        switch (operator) {
            case ">=":
                return this.compareVersions(currentVersion, requiredVersion) >= 0;
            case "<=":
                return this.compareVersions(currentVersion, requiredVersion) <= 0;
            case ">":
                return this.compareVersions(currentVersion, requiredVersion) > 0;
            case "<":
                return this.compareVersions(currentVersion, requiredVersion) < 0;
            case "==":
                return this.compareVersions(currentVersion, requiredVersion) === 0;
            default:
                return true;
        }
    }
    /**
     * 比较版本号
     */
    compareVersions(a, b) {
        const partsA = a.split(".").map(Number);
        const partsB = b.split(".").map(Number);
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const partA = partsA[i] ?? 0;
            const partB = partsB[i] ?? 0;
            if (partA < partB)
                return -1;
            if (partA > partB)
                return 1;
        }
        return 0;
    }
    /**
     * 记录执行日志
     */
    logExecution(event, context, payload, results) {
        const log = {
            hookId: results.map((_, i) => `hook-${i}`).join(","),
            event,
            result: {
                success: results.every((r) => r.success),
                executionTimeMs: Math.max(...results.map((r) => r.executionTimeMs)),
            },
            startedAt: context.timestamp,
            completedAt: Date.now(),
            context,
            payload,
        };
        this.executionLogs.push(log);
        // 限制日志大小
        if (this.executionLogs.length > this.maxLogSize) {
            this.executionLogs = this.executionLogs.slice(-this.maxLogSize);
        }
    }
    /**
     * 延迟函数
     */
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
// ===== Built-in Hooks =====
/**
 * 健康检查 Hook — 在健康检查时自动记录日志
 */
export function createHealthCheckHook() {
    return {
        id: "health-check-logger",
        name: "健康检查日志",
        description: "在健康检查时自动记录日志",
        event: "health_check",
        priority: 100,
        enabled: true,
        maxRetries: 0,
        retryDelayMs: 0,
        allowDegraded: true,
        handler: async (context, payload) => {
            console.log(`[Hook:health-check] 用户 ${context.userId ?? "unknown"} 触发健康检查`);
            return { success: true, executionTimeMs: 0 };
        },
    };
}
/**
 * 记忆写入通知 Hook — 记忆写入后通知用户
 */
export function createMemoryWrittenNotificationHook() {
    return {
        id: "memory-written-notification",
        name: "记忆写入通知",
        description: "记忆写入后发送通知",
        event: "memory_written",
        priority: 50,
        enabled: false, // 默认禁用
        maxRetries: 2,
        retryDelayMs: 500,
        allowDegraded: true,
        handler: async (context, payload) => {
            // TODO: 实现通知逻辑
            console.log(`[Hook:memory-written] 记忆已写入:`, payload);
            return { success: true, executionTimeMs: 0 };
        },
    };
}
/**
 * 系统启动 Hook — 系统启动时执行初始化
 */
export function createSystemStartupHook() {
    return {
        id: "system-startup-init",
        name: "系统启动初始化",
        description: "系统启动时执行初始化检查",
        event: "system_startup",
        priority: 10,
        enabled: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        allowDegraded: true,
        handler: async (context, payload) => {
            console.log(`[Hook:system-startup] 系统启动完成，Hook 系统就绪`);
            return { success: true, executionTimeMs: 0 };
        },
    };
}
//# sourceMappingURL=hook-system.js.map