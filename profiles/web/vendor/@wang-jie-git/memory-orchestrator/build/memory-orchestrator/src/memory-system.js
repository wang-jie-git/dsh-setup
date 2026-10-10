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
import { MemoryDatabase } from "../../memory-graph/src/database";
import { ObsidianWriter } from "../../memory-graph/src/obsidian-writer";
import { SqliteVectorStore } from "../../memory-vector/src/vector-store";
import { LocalEmbedder, ApiEmbedder, SimpleEmbedder, NoopQueryOptimizer, NoopReranker, LLMQueryOptimizer, EmbeddingReranker } from "../../memory-vector/src";
import { HybridQueryEngine } from "./index";
import { SessionCompressor } from "./session-compressor";
import { NudgeEngine } from "../../memory-graph/src/nudge-engine";
import { UserProfileEngine } from "../../memory-graph/src/user-profile";
import { ProcedureMemoryEngine } from "../../memory-graph/src/procedure-memory";
import { HookSystem, createHealthCheckHook, createSystemStartupHook } from "../../memory-graph/src/hook-system";
import { MemoryLogger } from "./memory-logger";
import { MemoryWatchdog } from "./memory-watchdog";
import { AutoWritebackRuntime } from "./auto-writeback";
import { TodoManager } from "../../memory-graph/src/todo-manager";
import { PromptManager } from "../../memory-graph/src/prompt-manager";
import { SessionBookmarkManager } from "../../memory-graph/src/session-bookmark";
import { MemorySync } from "../../memory-graph/src/memory-sync";
import { NotificationBus } from "../../memory-graph/src/notification-bus";
import * as path from "node:path";
import * as fs from "node:fs";
const DEFAULT_CONFIG = {
    vectorDbFilename: "memory-vectors.db",
    embedder: "local",
    writeBufferSize: 10,
    writeBufferIntervalMs: 2000,
};
// ===== MemorySystem =====
export class MemorySystem {
    config;
    memoryDb;
    vectorStore;
    embedder;
    obsidianWriter;
    queryEngine;
    /** 会话压缩器（跨会话上下文连续） */
    sessionCompressor;
    /** 主动 Nudge 引擎（模式检测与建议） */
    nudgeEngine;
    /** 用户画像引擎（辩证建模） */
    userProfileEngine;
    /** Procedure Memory 引擎（工作流程记忆） */
    procedureEngine;
    /** Hook 系统 */
    hookSystem;
    /** 自动写回运行时 */
    autoWriteback;
    /** 四轨待办管理器（v12） */
    todoManager;
    /** 提示词管理器（v12） */
    promptManager;
    /** 会话书签管理器（v12） */
    bookmarkManager;
    /** 记忆同步（v12） */
    memorySync;
    /** 通知总线（v12） */
    notificationBus;
    writeBuffer = [];
    bufferTimer = null;
    _initialized = false;
    /** 日志系统 */
    logger;
    /** 健康看门狗 */
    watchdog;
    constructor(config) {
        this.config = config;
        this.logger = new MemoryLogger(config.logger);
        this.watchdog = null; // Will be set after init
        this.sessionCompressor = undefined; // Will be set after init
        this.nudgeEngine = undefined; // Will be set after init
        this.userProfileEngine = undefined; // Will be set after init
        this.autoWriteback = undefined; // Will be set after init
    }
    // ===== Initialize =====
    static async init(config) {
        const fullConfig = { ...DEFAULT_CONFIG, ...config };
        const startedAt = Date.now();
        const cgDbPath = path.join(fullConfig.codegraphDir, "codegraph.db");
        if (!fs.existsSync(cgDbPath)) {
            throw new Error(`CodeGraph database not found: ${cgDbPath}\nRun 'codegraph index' first.`);
        }
        const sys = new MemorySystem(fullConfig);
        // 1. Open graph DB
        try {
            sys.memoryDb = MemoryDatabase.open(cgDbPath);
            sys.logger.info("init", "openGraph", "图数据库已连接", { path: cgDbPath });
        }
        catch (err) {
            sys.logger.error("init", "openGraph", "图数据库连接失败", err, { path: cgDbPath });
            throw err;
        }
        // 2. Open vector store
        try {
            const vecDbPath = path.join(fullConfig.codegraphDir, fullConfig.vectorDbFilename);
            sys.vectorStore = SqliteVectorStore.open(vecDbPath);
            sys.logger.info("init", "openVector", "向量库已连接", { path: vecDbPath, entries: sys.vectorStore.stats().totalEntries });
        }
        catch (err) {
            sys.logger.error("init", "openVector", "向量库连接失败", err);
            throw err;
        }
        // 3. Initialize embedder
        try {
            if (fullConfig.embedder === "api") {
                sys.embedder = new ApiEmbedder({
                    model: fullConfig.embedderModel ?? "text-embedding-3-small",
                    apiKey: fullConfig.embedderApiKey,
                    baseUrl: fullConfig.embedderBaseUrl,
                });
                sys.logger.info("init", "initEmbedder", "API embedder 已创建", { model: sys.embedder.modelName });
            }
            else if (fullConfig.embedder === "simple") {
                sys.embedder = new SimpleEmbedder();
                sys.logger.info("init", "initEmbedder", "轻量内置 embedder 已创建", { dim: sys.embedder.dimension });
            }
            else {
                const local = new LocalEmbedder();
                await local.init();
                sys.embedder = local;
                sys.logger.info("init", "initEmbedder", "本地 embedder 已加载", { model: local.modelName, dim: local.dimension });
            }
        }
        catch (err) {
            sys.logger.error("init", "initEmbedder", "Embedder 初始化失败", err);
            throw err;
        }
        // 4. Initialize Obsidian writer (optional)
        if (fullConfig.obsidianVaultPath) {
            try {
                sys.obsidianWriter = new ObsidianWriter({
                    vaultPath: fullConfig.obsidianVaultPath,
                    subDir: fullConfig.obsidianSubDir,
                });
                sys.logger.info("init", "initObsidian", "Obsidian 同步已启用", { vault: fullConfig.obsidianVaultPath });
            }
            catch (err) {
                sys.logger.warn("init", "initObsidian", "Obsidian 初始化失败（不影响核心功能）", { error: err.message });
            }
        }
        // 5. Initialize query engine
        try {
            // Build query optimizer
            let queryOptimizer = new NoopQueryOptimizer();
            if (fullConfig.queryOptimizer?.type === "llm" && fullConfig.queryOptimizer.apiKey) {
                queryOptimizer = new LLMQueryOptimizer({
                    baseUrl: fullConfig.queryOptimizer.baseUrl,
                    apiKey: fullConfig.queryOptimizer.apiKey,
                    model: fullConfig.queryOptimizer.model,
                });
                sys.logger.info("init", "initQueryOptimizer", "LLM 查询优化器已启用", {
                    model: fullConfig.queryOptimizer.model ?? "gpt-4o-mini",
                });
            }
            // Build reranker
            let reranker = new NoopReranker();
            if (fullConfig.reranker?.type === "embedding") {
                reranker = new EmbeddingReranker(sys.embedder, {
                    candidateK: fullConfig.reranker.candidateK,
                    topK: fullConfig.reranker.topK,
                });
                sys.logger.info("init", "initReranker", "Embedding 重排序器已启用", {
                    model: sys.embedder.modelName,
                });
            }
            sys.queryEngine = new HybridQueryEngine(sys.memoryDb, sys.vectorStore, sys.embedder, fullConfig.hybridQuery, queryOptimizer, reranker);
        }
        catch (err) {
            sys.logger.error("init", "initQueryEngine", "查询引擎初始化失败", err);
            throw err;
        }
        // 5b. Initialize session compressor (跨会话上下文压缩)
        try {
            const scConfig = fullConfig.sessionCompressor ?? {};
            sys.sessionCompressor = new SessionCompressor(sys.memoryDb, sys.vectorStore, sys.embedder, scConfig);
            if (scConfig.enabled !== false) {
                sys.logger.info("init", "initSessionCompressor", "会话压缩器已初始化");
            }
        }
        catch (err) {
            sys.logger.warn("init", "initSessionCompressor", "会话压缩器初始化失败（不影响核心功能）", { error: err.message });
        }
        // 5c. Initialize nudge engine (模式检测)
        try {
            sys.nudgeEngine = new NudgeEngine(sys.memoryDb);
            sys.logger.info("init", "initNudgeEngine", "Nudge 引擎已初始化");
        }
        catch (err) {
            sys.logger.warn("init", "initNudgeEngine", "Nudge 引擎初始化失败（不影响核心功能）", { error: err.message });
        }
        // 5d. Initialize user profile engine (用户画像辩证建模)
        try {
            const userProfileConfig = fullConfig.userProfile ?? {};
            sys.userProfileEngine = new UserProfileEngine(sys.memoryDb, userProfileConfig);
            sys.logger.info("init", "initUserProfile", "用户画像引擎已初始化", userProfileConfig);
        }
        catch (err) {
            sys.logger.warn("init", "initUserProfile", "用户画像引擎初始化失败（不影响核心功能）", { error: err.message });
        }
        // 5e. Initialize procedure memory engine (工作流程记忆)
        try {
            const procedureConfig = fullConfig.procedureMemory ?? {};
            sys.procedureEngine = new ProcedureMemoryEngine(sys.memoryDb, procedureConfig);
            sys.logger.info("init", "initProcedureMemory", "Procedure Memory 引擎已初始化", procedureConfig);
        }
        catch (err) {
            sys.logger.warn("init", "initProcedureMemory", "Procedure Memory 引擎初始化失败（不影响核心功能）", { error: err.message });
        }
        // 5f. Initialize hook system (事件驱动)
        try {
            const hookConfig = fullConfig.hooks ?? {};
            sys.hookSystem = new HookSystem(hookConfig);
            sys.logger.info("init", "initHookSystem", "Hook 系统已初始化", hookConfig);
            // 注册内置 Hook
            sys.hookSystem.register(createSystemStartupHook());
            sys.hookSystem.register(createHealthCheckHook());
        }
        catch (err) {
            sys.logger.warn("init", "initHookSystem", "Hook 系统初始化失败（不影响核心功能）", { error: err.message });
        }
        // 5g. Initialize auto-writeback runtime (自动写回)
        try {
            sys.autoWriteback = new AutoWritebackRuntime(fullConfig.autoWriteback);
            sys.logger.info("init", "initAutoWriteback", "自动写回运行时已初始化");
        }
        catch (err) {
            sys.logger.warn("init", "initAutoWriteback", "自动写回初始化失败（不影响核心功能）", { error: err.message });
        }
        // 5h. Initialize todo manager (四轨待办)
        try {
            sys.todoManager = new TodoManager(sys.memoryDb);
            sys.logger.info("init", "initTodoManager", "待办管理器已初始化");
        }
        catch (err) {
            sys.logger.warn("init", "initTodoManager", "待办管理器初始化失败（不影响核心功能）", { error: err.message });
        }
        // 5i. Initialize prompt manager (提示词管理器)
        try {
            sys.promptManager = new PromptManager(sys.memoryDb);
            sys.logger.info("init", "initPromptManager", "提示词管理器已初始化");
        }
        catch (err) {
            sys.logger.warn("init", "initPromptManager", "提示词管理器初始化失败（不影响核心功能）", { error: err.message });
        }
        // 5j. Initialize session bookmark (会话书签)
        try {
            sys.bookmarkManager = new SessionBookmarkManager(sys.memoryDb);
            sys.logger.info("init", "initBookmark", "会话书签已初始化");
        }
        catch (err) {
            sys.logger.warn("init", "initBookmark", "会话书签初始化失败（不影响核心功能）", { error: err.message });
        }
        // 5k. Initialize notification bus (通知通道)
        try {
            sys.notificationBus = new NotificationBus(sys.memoryDb);
            sys.logger.info("init", "initNotificationBus", "通知总线已初始化");
        }
        catch (err) {
            sys.logger.warn("init", "initNotificationBus", "通知总线初始化失败（不影响核心功能）", { error: err.message });
        }
        // 5l. Initialize memory sync (记忆同步)
        try {
            sys.memorySync = new MemorySync(sys.memoryDb, fullConfig.codegraphDir);
            sys.logger.info("init", "initMemorySync", "记忆同步已初始化");
        }
        catch (err) {
            sys.logger.warn("init", "initMemorySync", "记忆同步初始化失败（不影响核心功能）", { error: err.message });
        }
        // 6. Initialize watchdog (with logger persistence)
        try {
            // 绑定日志持久化到 graph DB
            sys.logger.setPersistDb({
                run: (sql, ...params) => {
                    sys.memoryDb.getRawDb().prepare(sql).run(...params);
                },
            });
        }
        catch (err) {
            // 日志持久化失败不影响核心功能
            sys.logger.warn("init", "initLogger", "日志持久化设置失败", { error: err.message });
        }
        // 7. Initialize watchdog
        const watchdog = new MemoryWatchdog(sys.memoryDb, sys.vectorStore, sys.embedder, sys.logger, sys.obsidianWriter, fullConfig.watchdog);
        sys.watchdog = watchdog;
        // 8. Register error callback from config
        if (fullConfig.onError) {
            sys.logger.onError(fullConfig.onError);
        }
        // 9. Register unhealthy callback from config
        if (fullConfig.onUnhealthy) {
            watchdog.onUnhealthy(fullConfig.onUnhealthy);
        }
        sys._initialized = true;
        // 记录 init 完成
        const initDuration = Date.now() - startedAt;
        sys.logger.info("init", "complete", `MemorySystem 初始化完成`, {
            duration: initDuration,
            codegraphDir: fullConfig.codegraphDir,
            embedderType: fullConfig.embedder,
        });
        // 首次健康检查（不阻塞 init）
        watchdog.checkHealth().catch(() => { });
        // 自动启动定时健康检查
        watchdog.start();
        return sys;
    }
    get initialized() {
        return this._initialized;
    }
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
    static checkSystemTier(requiredTier = "global") {
        if (requiredTier === "public")
            return true;
        const tier = process.env.AI_MEMORY_TIER ?? "employee";
        if (tier !== "prime" && tier !== "orchestrator") {
            throw new Error(`[checkSystemTier] 权限不足：需要 AI_MEMORY_TIER=prime 才能执行全局操作，当前=${tier}`);
        }
        return true;
    }
    // ===== Logger Accessors =====
    /** 获取最近 N 条日志 */
    getLogs(limit = 50, minLevel) {
        return this.logger.getRecent(limit, minLevel);
    }
    /** 获取最近错误 */
    getRecentErrors(hours = 1) {
        const cutoff = Date.now() - hours * 3600000;
        return this.logger.getErrorsSince(cutoff);
    }
    /** 获取指定模块日志 */
    getLogsByModule(module, limit = 20) {
        return this.logger.getByModule(module, limit);
    }
    /** 注册日志回调 */
    onLog(cb) {
        this.logger.onLog(cb);
    }
    /** 注册错误通知回调 */
    onError(cb) {
        this.logger.onError(cb);
    }
    // ===== Health Accessors =====
    /** 执行一次健康检查 */
    async checkHealth() {
        return this.watchdog.checkHealth();
    }
    /** 获取最近一次健康状态 */
    getHealth() {
        const status = this.watchdog.lastStatus;
        // 触发 health_check Hook
        if (status) {
            this.hookSystem?.trigger("health_check", status, {}).catch((err) => {
                this.logger.warn("hook", "health_check", `Hook 执行失败`, err);
            });
        }
        return status;
    }
    /** 注册不健康回调 */
    onUnhealthy(cb) {
        this.watchdog.onUnhealthy(cb);
    }
    // ===== Evaluation Report =====
    /** 生成评估报告（手动触发） */
    generateReport() {
        return this.watchdog.generateReport(undefined, "on_demand");
    }
    /** 注册评估报告回调（系统不健康时自动触发） */
    onReport(cb) {
        this.watchdog.onReport(cb);
    }
    /** 获取格式化文本报告 */
    formatReport(report) {
        return this.watchdog.formatReport(report);
    }
    // ===== Write (buffered) =====
    async write(data) {
        // Create node in graph (immediate — graph is authoritative)
        const node = this.memoryDb.createNode({
            id: crypto.randomUUID(),
            title: data.title,
            summary: data.summary ?? "",
            body: data.body ?? "",
            importance: data.importance ?? 5,
            status: "active",
            source: data.source ?? "agent",
            sourceSession: data.sourceSession ?? null,
            tags: data.tags ?? [],
            nodeType: data.nodeType ?? "memory_entry",
            ttlDays: data.ttlDays ?? null,
            scope: data.scope ?? "public",
            tierMin: data.tierMin ?? 1,
            negativeExamples: data.negativeExamples ?? [],
            isDeprecated: data.isDeprecated ?? false,
            deprecatedAt: data.deprecatedAt ?? null,
            userId: data.userId ?? "default",
            agentId: data.agentId ?? "unknown",
            confidence: data.confidence ?? 0.6,
            verified: data.verified ?? false,
            privacyFlag: data.privacyFlag ?? 0,
            gitBranch: data.gitBranch ?? null,
            projectDir: data.projectDir ?? null,
        });
        this.logger.info("write", "createNode", `已创建记忆节点: ${node.title}`, {
            nodeId: node.id,
            importance: node.importance,
            tags: node.tags,
        });
        // Buffer the vector + obsidian write
        // 注意：graph 节点已创建（authoritative），但向量/Obsidian 写入是异步的。
        // 如果 flush 时向量写入失败，会在 reject 回调中回滚 graph 节点（见 flush 方法）。
        return new Promise((resolve, reject) => {
            this.writeBuffer.push({
                node,
                resolve: () => {
                    this.watchdog.recordWrite(true);
                    // 触发 memory_written Hook
                    this.hookSystem?.trigger("memory_written", node, {
                        userId: data.userId,
                        sessionId: data.sourceSession ?? undefined,
                    }).catch((err) => {
                        this.logger.warn("hook", "memory_written", `Hook 执行失败`, err);
                    });
                    resolve(node);
                },
                reject: (err) => {
                    this.watchdog.recordWrite(false);
                    this.logger.error("write", "flush", `写入失败: ${node.title}`, err, { nodeId: node.id });
                    // 回滚：向量/Obsidian 写入失败时，删除已创建的 graph 节点，
                    // 避免出现"图中有节点但向量库中缺失"的不一致状态
                    try {
                        this.memoryDb.deleteNode(node.id);
                        this.logger.warn("write", "rollback", `已回滚 graph 节点: ${node.title}`, { nodeId: node.id });
                    }
                    catch (rollbackErr) {
                        this.logger.error("write", "rollback", `回滚失败: ${node.title}`, rollbackErr, { nodeId: node.id });
                    }
                    reject(err);
                },
            });
            this.scheduleFlush();
        });
    }
    async writeBatch(entries) {
        this.logger.info("write", "writeBatch", `批量写入 ${entries.length} 条记忆`);
        const nodes = [];
        const vectorEntries = [];
        for (const data of entries) {
            const node = this.memoryDb.createNode({
                id: crypto.randomUUID(),
                title: data.title,
                summary: data.summary ?? "",
                body: data.body ?? "",
                importance: data.importance ?? 5,
                status: "active",
                source: data.source ?? "agent",
                sourceSession: null,
                tags: data.tags ?? [],
                nodeType: data.nodeType ?? "memory_entry",
                ttlDays: null,
                scope: "public",
                tierMin: 1,
                negativeExamples: [],
                isDeprecated: false,
                deprecatedAt: null,
                userId: data.userId ?? "default",
                agentId: data.agentId ?? "unknown",
                confidence: data.confidence ?? 0.6,
                verified: data.verified ?? false,
            });
            nodes.push(node);
            let vector;
            try {
                const summary = data.summary ?? data.title;
                vector = await this.embedder.embed(summary);
            }
            catch (err) {
                this.logger.error("write", "embedBatch", `Embedding 失败: ${data.title}`, err);
                throw err;
            }
            vectorEntries.push({
                id: node.id,
                vector,
                metadata: {
                    nodeId: node.id,
                    type: node.nodeType,
                    title: node.title,
                    summary: node.summary,
                    importance: node.importance,
                    createdAt: node.createdAt,
                    source: node.source,
                    tenantId: node.userId === "default" ? undefined : node.userId,
                },
            });
            // Sync to Obsidian
            if (this.obsidianWriter) {
                try {
                    this.obsidianWriter.write(node);
                }
                catch (err) {
                    this.logger.warn("write", "obsidianSync", `Obsidian 同步失败: ${node.title}`, { error: err.message });
                }
            }
        }
        try {
            this.vectorStore.upsertBatch(vectorEntries);
            this.logger.info("write", "embedBatch", `向量批量索引完成: ${vectorEntries.length} 条`);
        }
        catch (err) {
            this.logger.error("write", "embedBatch", "向量批量索引失败", err);
            throw err;
        }
        this.watchdog.recordWrite(true);
        return nodes;
    }
    /**
     * 异步写入（无缓冲，立即执行）
     *
     * 供自动写回等场景使用，不需要缓冲直接写入
     */
    async writeAsync(data) {
        try {
            return await this.write(data);
        }
        catch (err) {
            this.logger.error("write", "writeAsync", `异步写入失败`, err, { title: data.title });
            throw err;
        }
    }
    scheduleFlush() {
        if (this.bufferTimer)
            return;
        if (this.writeBuffer.length >= this.config.writeBufferSize) {
            this.flush();
            return;
        }
        this.bufferTimer = setTimeout(() => {
            this.bufferTimer = null;
            if (this.writeBuffer.length > 0)
                this.flush();
        }, this.config.writeBufferIntervalMs);
    }
    flush() {
        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
            this.bufferTimer = null;
        }
        const batch = this.writeBuffer.splice(0);
        if (batch.length === 0)
            return;
        this.logger.info("write", "flush", `Flush ${batch.length} 条缓冲记忆`);
        (async () => {
            let successCount = 0;
            for (const entry of batch) {
                try {
                    const vector = await this.embedder.embed(entry.node.summary || entry.node.title);
                    this.vectorStore.upsert(entry.node.id, vector, {
                        nodeId: entry.node.id,
                        type: entry.node.nodeType,
                        title: entry.node.title,
                        summary: entry.node.summary,
                        importance: entry.node.importance,
                        createdAt: entry.node.createdAt,
                        source: entry.node.source,
                        tenantId: entry.node.userId === "default" ? undefined : entry.node.userId,
                    });
                    if (this.obsidianWriter) {
                        this.obsidianWriter.write(entry.node);
                    }
                    entry.resolve();
                    successCount++;
                }
                catch (err) {
                    this.logger.error("write", "flushItem", `单条 flush 失败: ${entry.node.title}`, err);
                    entry.reject(err instanceof Error ? err : new Error(String(err)));
                }
            }
            this.watchdog.recordWrite(successCount === batch.length);
        })();
    }
    // ===== Query =====
    async query(text, filter) {
        this.logger.info("query", "hybridSearch", `查询: "${text.slice(0, 60)}"`, filter);
        const startTime = performance.now();
        try {
            // 将 userId 映射为向量库的 tenantId 过滤
            const vectorFilter = {};
            if (filter?.importanceMin !== undefined)
                vectorFilter.importanceMin = filter.importanceMin;
            if (filter?.userId !== undefined && filter.userId !== "default")
                vectorFilter.tenantId = filter.userId;
            const result = await this.queryEngine.query(text, vectorFilter);
            const duration = Math.round(performance.now() - startTime);
            this.logger.info("query", "hybridSearch", `查询完成: ${result.results.length} 条结果`, {
                duration,
                top1Score: result.telemetry.top1Score,
                degraded: result.telemetry.degraded,
            });
            this.watchdog.recordQuery(true);
            // 触发 memory_queried Hook
            this.hookSystem?.trigger("memory_queried", { query: text, resultCount: result.results.length, duration }, {
                userId: filter?.userId,
            }).catch((err) => {
                this.logger.warn("hook", "memory_queried", `Hook 执行失败`, err);
            });
            return result;
        }
        catch (err) {
            this.watchdog.recordQuery(false);
            this.logger.error("query", "hybridSearch", `查询失败: "${text.slice(0, 60)}"`, err);
            throw err;
        }
    }
    // ===== Link =====
    linkMemoryToCode(memoryId, codeSymbolId, description) {
        this.logger.info("link", "memoryToCode", `关联记忆 → 代码符号`, { memoryId, codeSymbolId });
        this.memoryDb.linkMemoryToCode(memoryId, codeSymbolId, description);
    }
    linkMemoryToMemory(sourceId, targetId, relation, description) {
        this.logger.info("link", "memoryToMemory", `关联记忆 → 记忆`, { sourceId, targetId, relation });
        this.memoryDb.linkMemoryToMemory(sourceId, targetId, relation, 1.0, description);
    }
    // ===== Dream (熵减) =====
    async dream(dryRun = false) {
        this.logger.info("dream", "consolidate", `启动梦境整理${dryRun ? " (预览模式)" : ""}`);
        this.flush();
        const { DreamEngine } = await import("./dream");
        const engine = new DreamEngine(this.memoryDb, this.vectorStore, this.embedder, { dryRun });
        try {
            const report = await engine.consolidate();
            this.logger.info("dream", "consolidate", `梦境完成: 合并${report.actions.merged.length} 聚类${report.actions.insights.length} 归档${report.actions.archived.length} 删除${report.actions.deleted.length}`, {
                healthScore: report.healthScore,
                beforeNodes: report.summary.before.nodes,
                afterNodes: report.summary.after.nodes,
                duration: report.duration,
            });
            this.watchdog.recordDream(true);
            // 触发 dream_completed Hook
            this.hookSystem?.trigger("dream_completed", report, { dryRun }).catch((err) => {
                this.logger.warn("hook", "dream_completed", `Hook 执行失败`, err);
            });
            return report;
        }
        catch (err) {
            this.watchdog.recordDream(false);
            this.logger.error("dream", "consolidate", "梦境整理失败", err);
            throw err;
        }
    }
    /** 按内容哈希查重（v11 gatekeeper 支持） */
    async findDuplicateByHash(summary, body) {
        const { createHash } = await import("node:crypto");
        const hash = createHash("sha256").update(summary + body).digest("hex");
        return this.memoryDb.findByHash(hash);
    }
    // ===== Session Compressor (跨会话上下文) =====
    /**
     * 压缩会话，生成摘要记忆节点。
     * 纯算法实现，无 LLM 调用，零外部依赖。
     *
     * @param sessionId 会话 ID
     * @param messages 会话消息列表
     * @param options 可选参数（token 数、引用记忆/代码符号 ID、用户 ID）
     * @returns CompressedSession | null（会话太短则返回 null）
     */
    async compressSession(sessionId, messages, options) {
        if (!this.sessionCompressor) {
            this.logger.warn("session", "compress", "会话压缩器未初始化，跳过压缩");
            return null;
        }
        const result = await this.sessionCompressor.compress(sessionId, messages, options?.sessionStart ?? Date.now(), options);
        // 触发 session_compressed Hook
        if (result) {
            this.hookSystem?.trigger("session_compressed", result, {
                userId: options?.userId,
                sessionId,
            }).catch((err) => {
                this.logger.warn("hook", "session_compressed", `Hook 执行失败`, err);
            });
        }
        return result;
    }
    /**
     * 获取最近 N 条会话摘要，用于跨会话上下文注入。
     *
     * @param count 返回数量
     * @param userId 用户 ID 过滤（可选）
     * @returns 摘要列表
     */
    getSessionContext(count, userId) {
        if (!this.sessionCompressor)
            return [];
        return this.sessionCompressor.getRecentSummaries(count, userId);
    }
    /**
     * 格式化会话摘要为上下文注入文本。
     */
    formatSessionContext(summaries) {
        if (!this.sessionCompressor)
            return "";
        return this.sessionCompressor.formatForContext(summaries);
    }
    // ===== Nudge =====
    /**
     * 分析近期记忆，发现跨会话模式（适合定时触发）。
     * 返回 Nudge 建议列表，空数组表示无建议。
     */
    analyzeNudges(hours = 1) {
        if (!this.nudgeEngine)
            return [];
        return this.nudgeEngine.analyzeRecent(hours);
    }
    /**
     * 新记忆写入后调用，返回 nudge 建议（不阻塞写路径）。
     */
    onMemoryWritten(nodeIds) {
        if (!this.nudgeEngine)
            return [];
        const nodes = nodeIds
            .map((id) => this.memoryDb.getNode(id))
            .filter((n) => !!n);
        return this.nudgeEngine.onMemoryWritten(nodes);
    }
    // ===== User Profile =====
    /**
     * 记录一条用户观察（创建/更新 observation 节点，检测矛盾）。
     */
    observeUser(type, domain, content, options) {
        if (!this.userProfileEngine) {
            throw new Error("用户画像引擎未初始化");
        }
        const result = this.userProfileEngine.observe(type, domain, content, options);
        // 触发 user_observed Hook
        this.hookSystem?.trigger("user_observed", result, {
            userId: options?.userId,
            sessionId: options?.sourceSession ?? undefined,
        }).catch((err) => {
            this.logger.warn("hook", "user_observed", `Hook 执行失败`, err);
        });
        return result;
    }
    /**
     * 获取用户画像（累积的 trait 与 domain 统计）。
     */
    getUserProfile(userId = "default") {
        if (!this.userProfileEngine) {
            throw new Error("用户画像引擎未初始化");
        }
        return this.userProfileEngine.getProfile(userId);
    }
    /**
     * 获取用户画像摘要文本（适合注入上下文）。
     */
    getUserProfileSummary(userId = "default", maxTraits = 10) {
        if (!this.userProfileEngine)
            return "";
        return this.userProfileEngine.getProfileSummary(userId, maxTraits);
    }
    /**
     * 获取用户画像系统 Prompt 片段（自动注入用）
     */
    getUserProfilePromptSnippet(userId = "default", maxTraits = 5) {
        if (!this.userProfileEngine)
            return "";
        return this.userProfileEngine.getSystemPromptSnippet(userId, maxTraits);
    }
    /**
     * 删除用户观察
     */
    deleteUserObservation(observationId) {
        if (!this.userProfileEngine) {
            throw new Error("用户画像引擎未初始化");
        }
        return this.userProfileEngine.deleteObservation(observationId);
    }
    /**
     * 获取观察详情
     */
    getUserObservation(observationId) {
        if (!this.userProfileEngine) {
            throw new Error("用户画像引擎未初始化");
        }
        return this.userProfileEngine.getObservation(observationId);
    }
    // ===== Procedure Memory（工作流程记忆）=====
    /**
     * 记录工作流程
     */
    recordProcedure(record) {
        if (!this.procedureEngine) {
            throw new Error("Procedure Memory 引擎未初始化");
        }
        return this.procedureEngine.record(record);
    }
    /**
     * 查找工作流程
     */
    findProcedures(query) {
        if (!this.procedureEngine) {
            throw new Error("Procedure Memory 引擎未初始化");
        }
        return this.procedureEngine.find(query);
    }
    /**
     * 执行工作流程
     */
    executeProcedure(procedureId, inputs) {
        if (!this.procedureEngine) {
            throw new Error("Procedure Memory 引擎未初始化");
        }
        const result = this.procedureEngine.execute(procedureId, inputs);
        // 触发 procedure_executed Hook
        this.hookSystem?.trigger("procedure_executed", result, {}).catch((err) => {
            this.logger.warn("hook", "procedure_executed", `Hook 执行失败`, err);
        });
        return result;
    }
    /**
     * 获取工作流程详情
     */
    getProcedure(procedureId) {
        if (!this.procedureEngine) {
            throw new Error("Procedure Memory 引擎未初始化");
        }
        return this.procedureEngine.get(procedureId);
    }
    /**
     * 列出所有工作流程
     */
    listProcedures(filters) {
        if (!this.procedureEngine) {
            throw new Error("Procedure Memory 引擎未初始化");
        }
        return this.procedureEngine.list(filters);
    }
    /**
     * 获取推荐工作流程
     */
    getRecommendedProcedures(filters) {
        if (!this.procedureEngine) {
            throw new Error("Procedure Memory 引擎未初始化");
        }
        return this.procedureEngine.getRecommendations(filters);
    }
    /**
     * 删除工作流程（软删除）
     */
    deleteProcedure(procedureId) {
        if (!this.procedureEngine) {
            throw new Error("Procedure Memory 引擎未初始化");
        }
        return this.procedureEngine.delete(procedureId);
    }
    /**
     * 更新工作流程（创建新版本）
     */
    updateProcedure(procedureId, updates) {
        if (!this.procedureEngine) {
            throw new Error("Procedure Memory 引擎未初始化");
        }
        return this.procedureEngine.update(procedureId, updates);
    }
    /**
     * 更新 Procedure Memory 配置
     */
    updateProcedureConfig(config) {
        if (!this.procedureEngine) {
            throw new Error("Procedure Memory 引擎未初始化");
        }
        this.procedureEngine.updateConfig(config);
    }
    /**
     * 获取用户画像健康统计
     */
    getUserProfileHealth(userId = "default") {
        if (!this.userProfileEngine) {
            throw new Error("用户画像引擎未初始化");
        }
        return this.userProfileEngine.getHealthStats(userId);
    }
    /**
     * 更新用户画像配置
     */
    updateUserProfileConfig(config) {
        if (!this.userProfileEngine) {
            throw new Error("用户画像引擎未初始化");
        }
        this.userProfileEngine.updateConfig(config);
    }
    // ===== Maintenance =====
    prune(options) {
        this.flush();
        this.logger.info("maintenance", "prune", `执行剪枝${options?.dryRun ? " (预览)" : ""}`);
        const result = this.memoryDb.prune(options?.dryRun ?? false);
        this.logger.info("maintenance", "prune", `剪枝完成: 删除${result.deleted} 归档${result.archived}`);
        return result;
    }
    checkConsistency() {
        this.flush();
        this.logger.info("maintenance", "consistency", "检查一致性");
        const stats = this.memoryDb.getStats();
        const vecStats = this.vectorStore.stats();
        const ok = Math.abs(stats.totalNodes - vecStats.totalEntries) < 10;
        if (!ok) {
            this.logger.warn("maintenance", "consistency", `图库与向量库不一致`, {
                graphNodes: stats.totalNodes,
                vectorEntries: vecStats.totalEntries,
            });
        }
        return {
            inGraph: stats.totalNodes,
            inVector: vecStats.totalEntries,
            graphOnly: [],
            vectorOnly: [],
            ok,
        };
    }
    async rebuildVectorIndex() {
        this.flush();
        this.logger.info("maintenance", "rebuildVector", "重建向量索引开始");
        this.vectorStore.clear();
        const allNodes = this.memoryDb.searchByText("", 99999);
        const batch = [];
        let errors = 0;
        for (const node of allNodes) {
            try {
                const summary = node.summary || node.title;
                const vector = await this.embedder.embed(summary);
                batch.push({
                    id: node.id,
                    vector,
                    metadata: {
                        nodeId: node.id,
                        type: node.nodeType,
                        title: node.title,
                        summary: node.summary,
                        importance: node.importance,
                        createdAt: node.createdAt,
                        source: node.source,
                        tenantId: node.userId === "default" ? undefined : node.userId,
                    },
                });
            }
            catch (err) {
                errors++;
                this.logger.error("maintenance", "rebuildVector", `重建向量失败: ${node.title}`, err);
            }
        }
        if (batch.length > 0) {
            this.vectorStore.upsertBatch(batch);
        }
        this.logger.info("maintenance", "rebuildVector", `重建完成: ${batch.length} 条, ${errors} 条失败`);
        return batch.length;
    }
    // ===== Stats =====
    stats() {
        this.flush();
        const graphStats = this.memoryDb.getStats();
        const vecStats = this.vectorStore.stats();
        const obsidianCount = this.obsidianWriter?.count() ?? 0;
        const health = this.watchdog.lastStatus;
        const recentErrors = this.logger.getRecentErrorCount(3600000);
        return {
            graph: graphStats,
            vector: { total: vecStats.totalEntries, dimension: vecStats.dimension },
            obsidian: obsidianCount,
            bufferPending: this.writeBuffer.length,
            health: health ? {
                score: health.score,
                healthy: health.healthy,
                uptime: this.watchdog.getUptime(),
            } : null,
            recentErrors,
            logger: { buffered: this.logger.getRecent(1).length > 0 ? "active" : "empty" },
        };
    }
    // ===== Shutdown =====
    async shutdown() {
        this.logger.info("shutdown", "begin", "MemorySystem 关闭中...");
        // Stop watchdog
        this.watchdog.stop();
        // Flush remaining buffer
        if (this.writeBuffer.length > 0) {
            await new Promise((resolve) => {
                const check = () => {
                    if (this.writeBuffer.length === 0)
                        resolve();
                    else
                        setTimeout(check, 100);
                };
                this.flush();
                check();
            });
        }
        this.memoryDb.close();
        this.vectorStore.close();
        this.autoWriteback?.stop();
        // 触发 system_shutdown Hook
        await this.hookSystem?.trigger("system_shutdown", { uptime: this.watchdog.getUptime() });
        this._initialized = false;
        this.logger.info("shutdown", "complete", "MemorySystem 已关闭");
    }
}
//# sourceMappingURL=memory-system.js.map