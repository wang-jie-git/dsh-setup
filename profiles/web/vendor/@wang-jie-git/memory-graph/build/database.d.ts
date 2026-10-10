/**
 * memory-graph: Database Connection
 *
 * Opens the same SQLite database as CodeGraph (node:sqlite, Node 22.5+)
 * and manages memory-specific schema migrations.
 *
 * Schema v10: scope/tier_min 隔离 | structure_template | negative_examples | is_deprecated | FTS5 | user_id 多租户
 */
interface SqliteStatement {
    run(...params: unknown[]): {
        changes: number;
        lastInsertRowid: number | bigint;
    };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
}
interface SqliteDB {
    prepare(sql: string): SqliteStatement;
    exec(sql: string): void;
    close(): void;
    readonly open: boolean;
}
export type MemoryNodeType = "memory_entry" | "decision" | "project_milestone" | "insight" | "structure_template" | "session_summary" | "procedure";
export type MemoryStatus = "active" | "archived" | "pending_review";
export type MemorySource = "agent" | "user" | "system" | "imported";
export type MemoryScope = "public" | "global";
export type EdgeRelation = "links_to_code" | "causes" | "fixes" | "precedes" | "follows" | "references" | "contradicts" | "supersedes" | "relates_to" | "implements" | "questions" | "summarizes" | "dream_log";
export interface MemoryNode {
    id: string;
    title: string;
    summary: string;
    body: string;
    contentHash: string;
    importance: number;
    status: MemoryStatus;
    source: MemorySource;
    sourceSession: string | null;
    tags: string[];
    nodeType: MemoryNodeType;
    createdAt: number;
    updatedAt: number;
    ttlDays: number | null;
    scope: MemoryScope;
    tierMin: number;
    negativeExamples: Array<{
        scenario: string;
        whyFails: string;
        betterApproach: string;
    }>;
    isDeprecated: boolean;
    deprecatedAt: number | null;
    userId: string;
    agentId: string;
    confidence: number;
    verified: boolean;
    privacyFlag: number;
    gitBranch: string | null;
    projectDir: string | null;
}
export interface MemoryEdge {
    id: number;
    sourceType: "memory" | "code";
    sourceId: string;
    targetType: "memory" | "code";
    targetId: string;
    relation: EdgeRelation;
    weight: number;
    description: string;
    createdAt: number;
}
export interface MemoryGraphStats {
    totalNodes: number;
    totalEdges: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    byScope: Record<string, number>;
    codeLinked: number;
}
export declare class MemoryDatabase {
    private db;
    private dbPath;
    private _hasNewColumns;
    private _hasNewScope;
    private _hasNewTierMin;
    private _hasNewNegExamples;
    private _hasNewDeprecated;
    private _hasNewUserId;
    private _hasNewTrust;
    private constructor();
    /** 检测表结构中是否有新列 */
    private detectSchema;
    /** Open or create memory tables in an existing CodeGraph database */
    static open(dbPath: string): MemoryDatabase;
    /** Expose raw DB for advanced queries (AutoLinker, etc.) */
    getRawDb(): SqliteDB;
    /** Create a fresh database (for testing) */
    static create(dbPath: string): MemoryDatabase;
    private migrate;
    /** 获取表的列名列表 */
    private _getTableColumns;
    /** 执行单步迁移并记录版本 */
    private _runMigration;
    createNode(data: Omit<MemoryNode, "id" | "contentHash" | "createdAt" | "updatedAt" | "agentId" | "confidence" | "verified" | "privacyFlag" | "gitBranch" | "projectDir"> & {
        id?: string;
        agentId?: string;
        confidence?: number;
        verified?: boolean;
        privacyFlag?: number;
        gitBranch?: string | null;
        projectDir?: string | null;
    }): MemoryNode;
    getNode(id: string): MemoryNode | null;
    updateNode(id: string, data: Partial<Omit<MemoryNode, "id" | "createdAt">>): boolean;
    deleteNode(id: string): boolean;
    /** 按 content_hash 查找活跃节点（重复检测用） */
    findByHash(hash: string): MemoryNode | null;
    createEdge(data: Omit<MemoryEdge, "id" | "createdAt">): MemoryEdge;
    getNodeEdges(nodeId: string): MemoryEdge[];
    deleteEdge(id: number): boolean;
    /** Link a memory node to a code symbol */
    linkMemoryToCode(memoryId: string, codeSymbolId: string, description?: string): MemoryEdge;
    /** Link two memory nodes */
    linkMemoryToMemory(sourceId: string, targetId: string, relation: "causes" | "fixes" | "precedes" | "references" | "contradicts" | "supersedes" | "relates_to" | "implements" | "summarizes" | "dream_log", weight?: number, description?: string): MemoryEdge;
    /** Get memory entry with its code symbol associations */
    getMemoryWithCodeSymbols(memoryId: string): {
        relation: string;
        weight: number;
        description: string;
        symbol: {
            id: string;
            name: string;
            kind: string;
            filePath: string;
            qualifiedName: string;
        };
    }[];
    /** Get related memory entries (graph traversal, depth=1) */
    getRelatedMemories(memoryId: string, options?: {
        depth?: number;
        relationTypes?: EdgeRelation[];
        minWeight?: number;
    }): Array<{
        node: MemoryNode;
        relation: EdgeRelation;
        weight: number;
        direction: "incoming" | "outgoing";
    }>;
    /** Full-text search via FTS5 (v7+) */
    searchByFTS(query: string, limit?: number): MemoryNode[];
    /** Full-text search across memory titles and summaries (LIKE fallback) */
    searchByText(query: string, limit?: number): MemoryNode[];
    /** Search by tags */
    searchByTag(tag: string, limit?: number): MemoryNode[];
    /** Get nodes by scope */
    getNodesByScope(scope: MemoryScope, limit?: number): MemoryNode[];
    /** Get nodes by user_id（多租户查询） */
    getNodesByUserId(userId: string, limit?: number): MemoryNode[];
    /** Get recent memories by time range */
    getRecentMemories(hours?: number, limit?: number): MemoryNode[];
    /** Get statistics */
    getStats(): MemoryGraphStats;
    createTodoItem(data: {
        id?: string;
        title: string;
        description?: string;
        track: "life" | "work" | "project" | "daily";
        priority?: "low" | "medium" | "high" | "urgent";
        dueDate?: number | null;
        projectDir?: string | null;
        tags?: string[];
        userId?: string;
    }): {
        id: string;
        title: string;
        track: string;
        priority: string;
        status: string;
        createdAt: number;
    };
    getTodoItem(id: string): Record<string, unknown> | undefined;
    updateTodoItem(id: string, data: Partial<{
        title: string;
        description: string;
        track: "life" | "work" | "project" | "daily";
        priority: "low" | "medium" | "high" | "urgent";
        status: string;
        dueDate: number | null;
        projectDir: string | null;
        tags: string[];
    }>): boolean;
    deleteTodoItem(id: string): boolean;
    completeTodoItem(id: string): boolean;
    listTodoItems(filter?: {
        track?: string;
        status?: string;
        priority?: string;
        dueBefore?: number;
        dueAfter?: number;
        userId?: string;
        limit?: number;
    }): Record<string, unknown>[];
    getOverdueTodoItems(userId?: string): Record<string, unknown>[];
    getDailyTodoSummary(userId?: string): {
        total: number;
        completed: number;
        pending: number;
        overdue: number;
    };
    createPromptTemplate(data: {
        id?: string;
        name: string;
        category: string;
        content: string;
        description?: string;
        tags?: string[];
        version?: string;
    }): {
        id: string;
        name: string;
        category: string;
        version: string;
        createdAt: number;
    };
    getPromptTemplate(id: string): Record<string, unknown> | undefined;
    getPromptTemplateByName(name: string): Record<string, unknown> | undefined;
    updatePromptTemplate(id: string, data: Partial<{
        name: string;
        category: string;
        content: string;
        description: string;
        tags: string[];
        version: string;
        enabled: boolean;
    }>): boolean;
    deletePromptTemplate(id: string): boolean;
    listPromptTemplates(filter?: {
        category?: string;
        enabled?: boolean;
        limit?: number;
    }): Record<string, unknown>[];
    searchPromptTemplates(query: string, limit?: number): Record<string, unknown>[];
    createSessionBookmark(data: {
        id?: string;
        sessionId: string;
        roundIndex: number;
        title: string;
        summary?: string;
        tags?: string[];
        userId?: string;
    }): {
        id: string;
        sessionId: string;
        roundIndex: number;
        title: string;
        createdAt: number;
    };
    listSessionBookmarks(sessionId: string, userId?: string): Record<string, unknown>[];
    deleteSessionBookmark(id: string): boolean;
    searchSessionBookmarks(query: string, userId?: string, limit?: number): Record<string, unknown>[];
    createNotificationChannel(data: {
        id?: string;
        channelType: "web" | "feishu" | "qq" | "wechat" | "work_wechat";
        name: string;
        configJson?: Record<string, unknown>;
    }): {
        id: string;
        channelType: string;
        name: string;
        enabled: boolean;
        createdAt: number;
    };
    listNotificationChannels(enabledOnly?: boolean): Record<string, unknown>[];
    updateNotificationChannel(id: string, data: Partial<{
        name: string;
        configJson: Record<string, unknown>;
        enabled: boolean;
    }>): boolean;
    deleteNotificationChannel(id: string): boolean;
    /** Prune expired and low-importance entries */
    prune(dryRun?: boolean): {
        deleted: number;
        archived: number;
    };
    /** Get all nodes regardless of status (for dream engine maintenance) */
    getAllNodes(): MemoryNode[];
    /** Close the database connection */
    close(): void;
    private rowToNode;
}
export {};
//# sourceMappingURL=database.d.ts.map