/**
 * memory-graph: Database Connection
 *
 * Opens the same SQLite database as CodeGraph (node:sqlite, Node 22.5+)
 * and manages memory-specific schema migrations.
 *
 * Schema v10: scope/tier_min 隔离 | structure_template | negative_examples | is_deprecated | FTS5 | user_id 多租户
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
function createDB(dbPath) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = _require("node:sqlite");
    const raw = new DatabaseSync(dbPath);
    raw.exec("PRAGMA journal_mode = WAL");
    raw.exec("PRAGMA foreign_keys = ON");
    raw.exec("PRAGMA busy_timeout = 5000");
    return {
        prepare(sql) {
            const stmt = raw.prepare(sql);
            return {
                run(...params) {
                    const r = stmt.run(...params);
                    return { changes: Number(r?.changes ?? 0), lastInsertRowid: r?.lastInsertRowid ?? 0 };
                },
                get(...params) {
                    return stmt.get(...params);
                },
                all(...params) {
                    return stmt.all(...params);
                },
            };
        },
        exec(sql) {
            raw.exec(sql);
        },
        close() {
            if (raw.isOpen)
                raw.close();
        },
        get open() {
            return raw.isOpen;
        },
    };
}
// ===== Database Connection =====
const MEMORY_SCHEMA_VERSION = 12;
export class MemoryDatabase {
    db;
    dbPath;
    _hasNewColumns = false;
    _hasNewScope = false;
    _hasNewTierMin = false;
    _hasNewNegExamples = false;
    _hasNewDeprecated = false;
    _hasNewUserId = false;
    _hasNewTrust = false;
    constructor(db, dbPath) {
        this.db = db;
        this.dbPath = dbPath;
    }
    /** 检测表结构中是否有新列 */
    detectSchema() {
        const cols = this._getTableColumns("memory_nodes");
        this._hasNewScope = cols.includes("scope");
        this._hasNewTierMin = cols.includes("tier_min");
        this._hasNewNegExamples = cols.includes("negative_examples");
        this._hasNewDeprecated = cols.includes("is_deprecated");
        this._hasNewUserId = cols.includes("user_id");
        this._hasNewTrust = cols.includes("agent_id");
        this._hasNewColumns = this._hasNewScope || this._hasNewTierMin || this._hasNewNegExamples || this._hasNewDeprecated || this._hasNewUserId || this._hasNewTrust;
        // 如果 tier_min 已存在但类型不是 INTEGER，说明是旧版 schema（生产数据库兼容）
        if (this._hasNewTierMin) {
            try {
                const info = this.db
                    .prepare("PRAGMA table_info(memory_nodes)")
                    .all();
                const tierCol = info.find((c) => c.name === "tier_min");
                if (tierCol && tierCol.type !== "INTEGER") {
                    this._hasNewTierMin = false; // 旧版 TEXT 类型，不写入新值
                }
            }
            catch {
                // 忽略
            }
        }
    }
    /** Open or create memory tables in an existing CodeGraph database */
    static open(dbPath) {
        const exists = fs.existsSync(dbPath);
        if (!exists) {
            throw new Error(`CodeGraph database not found: ${dbPath}\nRun codegraph index first.`);
        }
        const db = createDB(dbPath);
        const memdb = new MemoryDatabase(db, dbPath);
        memdb.migrate();
        memdb.detectSchema();
        return memdb;
    }
    /** Expose raw DB for advanced queries (AutoLinker, etc.) */
    getRawDb() {
        return this.db;
    }
    /** Create a fresh database (for testing) */
    static create(dbPath) {
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        const db = createDB(dbPath);
        const memdb = new MemoryDatabase(db, dbPath);
        memdb.migrate();
        memdb.detectSchema();
        return memdb;
    }
    migrate() {
        // Check if memory_schema_versions table exists
        const tableCheck = this.db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_schema_versions'")
            .get();
        let currentVersion = 0;
        if (tableCheck) {
            const row = this.db
                .prepare("SELECT version FROM memory_schema_versions ORDER BY version DESC LIMIT 1")
                .get();
            currentVersion = row?.version ?? 0;
        }
        if (currentVersion >= MEMORY_SCHEMA_VERSION)
            return;
        if (!tableCheck) {
            // 首次运行：执行完整 schema.sql 创建所有表
            const schemaPath = path.join(__dirname, "schema.sql");
            const schema = fs.readFileSync(schemaPath, "utf-8");
            this.db.exec(schema);
            this.db
                .prepare("INSERT OR IGNORE INTO memory_schema_versions (version, applied_at, description) VALUES (?, ?, ?)")
                .run(MEMORY_SCHEMA_VERSION, Date.now(), `Schema v${MEMORY_SCHEMA_VERSION}: full init`);
            return;
        }
        // ── 已有数据库：增量迁移 ──
        // v4: 双层级隔离 (scope, tier_min)
        if (currentVersion < 4) {
            this._runMigration(4, () => {
                const cols = this._getTableColumns("memory_nodes");
                if (!cols.includes("scope")) {
                    this.db.exec("ALTER TABLE memory_nodes ADD COLUMN scope TEXT NOT NULL DEFAULT 'public'");
                }
                if (!cols.includes("tier_min")) {
                    this.db.exec("ALTER TABLE memory_nodes ADD COLUMN tier_min INTEGER NOT NULL DEFAULT 1");
                }
            });
        }
        // v5: 反模式存储 (negative_examples)
        if (currentVersion < 5) {
            const cols = this._getTableColumns("memory_nodes");
            if (!cols.includes("negative_examples")) {
                this.db.exec("ALTER TABLE memory_nodes ADD COLUMN negative_examples TEXT NOT NULL DEFAULT '[]'");
            }
        }
        // v6: 结构坍缩标记 (is_deprecated, deprecated_at)
        if (currentVersion < 6) {
            const cols = this._getTableColumns("memory_nodes");
            if (!cols.includes("is_deprecated")) {
                this.db.exec("ALTER TABLE memory_nodes ADD COLUMN is_deprecated INTEGER NOT NULL DEFAULT 0");
            }
            if (!cols.includes("deprecated_at")) {
                this.db.exec("ALTER TABLE memory_nodes ADD COLUMN deprecated_at INTEGER");
            }
        }
        // v7: FTS5 全文搜索
        if (currentVersion < 7) {
            this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_nodes_fts USING fts5(
          title, summary, body,
          content='memory_nodes',
          content_rowid='rowid'
        )
      `);
            // 重建 FTS 索引
            this.db.exec("INSERT INTO memory_nodes_fts(memory_nodes_fts) VALUES('rebuild')");
        }
        // v8: 新增索引
        if (currentVersion < 8) {
            this.db.exec("CREATE INDEX IF NOT EXISTS idx_memory_nodes_scope ON memory_nodes(scope)");
            this.db.exec("CREATE INDEX IF NOT EXISTS idx_memory_nodes_node_type ON memory_nodes(node_type)");
            this.db.exec("CREATE INDEX IF NOT EXISTS idx_memory_nodes_is_deprecated ON memory_nodes(is_deprecated)");
        }
        // v9: 更新 node_type CHECK（SQLite 不支持 ALTER CHECK，需重建表）
        // 用应用层校验替代，确保新旧数据兼容
        if (currentVersion < 9) {
            // 标记所有现有 structure_template 类型数据（即使旧 schema 拒绝）
            // 更新已存在的记录
            this.db.exec("UPDATE memory_nodes SET node_type = node_type WHERE node_type = node_type");
        }
        // v10: 多租户隔离 (user_id)
        if (currentVersion < 10) {
            this._runMigration(10, () => {
                const cols = this._getTableColumns("memory_nodes");
                if (!cols.includes("user_id")) {
                    this.db.exec("ALTER TABLE memory_nodes ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'");
                }
                // 重建索引
                this.db.exec("CREATE INDEX IF NOT EXISTS idx_memory_nodes_user_id ON memory_nodes(user_id)");
            });
        }
        // v11: 单租户多智能体信任体系 (agent_id, confidence, verified, privacy_flag)
        if (currentVersion < 11) {
            this._runMigration(11, () => {
                const cols = this._getTableColumns("memory_nodes");
                if (!cols.includes("agent_id")) {
                    this.db.exec("ALTER TABLE memory_nodes ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'unknown'");
                }
                if (!cols.includes("confidence")) {
                    this.db.exec("ALTER TABLE memory_nodes ADD COLUMN confidence REAL NOT NULL DEFAULT 0.6 CHECK (confidence >= 0 AND confidence <= 1)");
                }
                if (!cols.includes("verified")) {
                    this.db.exec("ALTER TABLE memory_nodes ADD COLUMN verified INTEGER NOT NULL DEFAULT 0");
                }
                if (!cols.includes("privacy_flag")) {
                    this.db.exec("ALTER TABLE memory_nodes ADD COLUMN privacy_flag INTEGER NOT NULL DEFAULT 0");
                }
            });
        }
        // v12: git 分支感知 + 项目目录 + 待办/提示词/书签/通知表
        if (currentVersion < 12) {
            this._runMigration(12, () => {
                const cols = this._getTableColumns("memory_nodes");
                if (!cols.includes("git_branch")) {
                    this.db.exec("ALTER TABLE memory_nodes ADD COLUMN git_branch TEXT");
                }
                if (!cols.includes("project_dir")) {
                    this.db.exec("ALTER TABLE memory_nodes ADD COLUMN project_dir TEXT");
                }
                // 新增表（使用 IF NOT EXISTS 保证幂等）
                this.db.exec(`
          CREATE TABLE IF NOT EXISTS todo_items (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            track TEXT NOT NULL DEFAULT 'work' CHECK (track IN ('life','work','project','daily')),
            priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled','archived')),
            due_date INTEGER, completed_at INTEGER, project_dir TEXT,
            tags TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            user_id TEXT NOT NULL DEFAULT 'default'
          );
          CREATE INDEX IF NOT EXISTS idx_todo_track ON todo_items(track);
          CREATE INDEX IF NOT EXISTS idx_todo_status ON todo_items(status);
          CREATE INDEX IF NOT EXISTS idx_todo_due ON todo_items(due_date);
          CREATE INDEX IF NOT EXISTS idx_todo_project ON todo_items(project_dir);
          CREATE INDEX IF NOT EXISTS idx_todo_user ON todo_items(user_id);

          CREATE TABLE IF NOT EXISTS prompt_templates (
            id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
            content TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            tags TEXT NOT NULL DEFAULT '[]', version TEXT NOT NULL DEFAULT '1.0.0',
            enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_prompt_category ON prompt_templates(category);
          CREATE INDEX IF NOT EXISTS idx_prompt_enabled ON prompt_templates(enabled);

          CREATE TABLE IF NOT EXISTS session_bookmarks (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, round_index INTEGER NOT NULL,
            title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL, user_id TEXT NOT NULL DEFAULT 'default'
          );
          CREATE INDEX IF NOT EXISTS idx_bookmark_session ON session_bookmarks(session_id);
          CREATE INDEX IF NOT EXISTS idx_bookmark_user ON session_bookmarks(user_id);

          CREATE TABLE IF NOT EXISTS notification_channels (
            id TEXT PRIMARY KEY,
            channel_type TEXT NOT NULL CHECK (channel_type IN ('web','feishu','qq','wechat','work_wechat')),
            name TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
            enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          );
        `);
            });
        }
        // 记录版本
        this.db
            .prepare("INSERT OR IGNORE INTO memory_schema_versions (version, applied_at, description) VALUES (?, ?, ?)")
            .run(MEMORY_SCHEMA_VERSION, Date.now(), `Schema v${MEMORY_SCHEMA_VERSION}: scope/tier_min/structure_template/FTS5/user_id`);
    }
    /** 获取表的列名列表 */
    _getTableColumns(table) {
        try {
            const rows = this.db
                .prepare(`PRAGMA table_info(${table})`)
                .all();
            return rows.map((r) => r.name);
        }
        catch {
            return [];
        }
    }
    /** 执行单步迁移并记录版本 */
    _runMigration(version, fn) {
        fn();
        this.db
            .prepare("INSERT OR IGNORE INTO memory_schema_versions (version, applied_at, description) VALUES (?, ?, ?)")
            .run(version, Date.now(), `Schema v${version}`);
    }
    // ===== Node Operations =====
    createNode(data) {
        const id = data.id ?? crypto.randomUUID();
        const now = Date.now();
        const contentHash = createHash("sha256").update(data.summary + data.body).digest("hex");
        // 检测 schema 并动态构建 INSERT，兼容旧版数据库
        const newCols = [];
        const newVals = [];
        if (this._hasNewScope) {
            newCols.push("scope");
            newVals.push(data.scope ?? "public");
        }
        if (this._hasNewTierMin) {
            newCols.push("tier_min");
            newVals.push(data.tierMin ?? 1);
        }
        if (this._hasNewNegExamples) {
            newCols.push("negative_examples");
            newVals.push(JSON.stringify(data.negativeExamples ?? []));
        }
        if (this._hasNewDeprecated) {
            newCols.push("is_deprecated, deprecated_at");
            newVals.push(data.isDeprecated ? 1 : 0, data.deprecatedAt ?? null);
        }
        if (this._hasNewUserId) {
            newCols.push("user_id");
            newVals.push(data.userId ?? "default");
        }
        if (this._hasNewTrust) {
            newCols.push("agent_id, confidence, verified, privacy_flag");
            newVals.push(data.agentId ?? "unknown", data.confidence ?? 0.6, (data.verified ?? false) ? 1 : 0, data.privacyFlag ?? 0);
        }
        // v12: git 分支感知 + 项目目录
        if (data.gitBranch !== undefined) {
            newCols.push("git_branch");
            newVals.push(data.gitBranch);
        }
        if (data.projectDir !== undefined) {
            newCols.push("project_dir");
            newVals.push(data.projectDir);
        }
        const colStr = newCols.length > 0 ? `, ${newCols.join(", ")}` : "";
        const valStr = newVals.length > 0 ? `, ${newVals.map(() => "?").join(", ")}` : "";
        this.db
            .prepare(`
        INSERT INTO memory_nodes (id, title, summary, body, content_hash, importance, status, source, source_session, tags, node_type, created_at, updated_at, ttl_days${colStr})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${valStr})
      `)
            .run(id, data.title, data.summary ?? "", data.body ?? "", contentHash, data.importance ?? 5, data.status ?? "active", data.source ?? "agent", data.sourceSession ?? null, JSON.stringify(data.tags ?? []), data.nodeType ?? "memory_entry", now, now, data.ttlDays ?? null, ...newVals);
        return {
            id, ...data,
            contentHash,
            createdAt: now,
            updatedAt: now,
            agentId: data.agentId ?? "unknown",
            confidence: data.confidence ?? 0.6,
            verified: data.verified ?? false,
            privacyFlag: data.privacyFlag ?? 0,
            gitBranch: data.gitBranch ?? null,
            projectDir: data.projectDir ?? null,
        };
    }
    getNode(id) {
        const row = this.db
            .prepare("SELECT * FROM memory_nodes WHERE id = ?")
            .get(id);
        if (!row)
            return null;
        return this.rowToNode(row);
    }
    updateNode(id, data) {
        const existing = this.getNode(id);
        if (!existing)
            return false;
        const now = Date.now();
        const updates = ["updated_at = ?"];
        const params = [now];
        if (data.title !== undefined) {
            updates.push("title = ?");
            params.push(data.title);
        }
        if (data.summary !== undefined) {
            updates.push("summary = ?");
            params.push(data.summary);
        }
        if (data.body !== undefined) {
            updates.push("body = ?");
            params.push(data.body);
        }
        if (data.importance !== undefined) {
            updates.push("importance = ?");
            params.push(data.importance);
        }
        if (data.status !== undefined) {
            updates.push("status = ?");
            params.push(data.status);
        }
        if (data.tags !== undefined) {
            updates.push("tags = ?");
            params.push(JSON.stringify(data.tags));
        }
        if (data.ttlDays !== undefined) {
            updates.push("ttl_days = ?");
            params.push(data.ttlDays);
        }
        if (data.scope !== undefined && this._hasNewScope) {
            updates.push("scope = ?");
            params.push(data.scope);
        }
        if (data.tierMin !== undefined && this._hasNewTierMin) {
            updates.push("tier_min = ?");
            params.push(data.tierMin);
        }
        if (data.negativeExamples !== undefined && this._hasNewNegExamples) {
            updates.push("negative_examples = ?");
            params.push(JSON.stringify(data.negativeExamples));
        }
        if (data.isDeprecated !== undefined && this._hasNewDeprecated) {
            updates.push("is_deprecated = ?");
            params.push(data.isDeprecated ? 1 : 0);
        }
        if (data.deprecatedAt !== undefined && this._hasNewDeprecated) {
            updates.push("deprecated_at = ?");
            params.push(data.deprecatedAt);
        }
        if (data.userId !== undefined && this._hasNewUserId) {
            updates.push("user_id = ?");
            params.push(data.userId);
        }
        // v11: 信任体系字段更新（dream 验证、来源校正等）
        if (data.agentId !== undefined && this._hasNewTrust) {
            updates.push("agent_id = ?");
            params.push(data.agentId);
        }
        if (data.confidence !== undefined && this._hasNewTrust) {
            updates.push("confidence = ?");
            params.push(data.confidence);
        }
        if (data.verified !== undefined && this._hasNewTrust) {
            updates.push("verified = ?");
            params.push(data.verified ? 1 : 0);
        }
        if (data.privacyFlag !== undefined && this._hasNewTrust) {
            updates.push("privacy_flag = ?");
            params.push(data.privacyFlag);
        }
        params.push(id);
        this.db.prepare(`UPDATE memory_nodes SET ${updates.join(", ")} WHERE id = ?`).run(...params);
        return true;
    }
    deleteNode(id) {
        const result = this.db.prepare("DELETE FROM memory_nodes WHERE id = ?").run(id);
        return result.changes > 0;
    }
    /** 按 content_hash 查找活跃节点（重复检测用） */
    findByHash(hash) {
        const row = this.db
            .prepare("SELECT * FROM memory_nodes WHERE content_hash = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
            .get(hash);
        if (!row)
            return null;
        return this.rowToNode(row);
    }
    // ===== Edge Operations =====
    createEdge(data) {
        const now = Date.now();
        const result = this.db
            .prepare(`
        INSERT INTO memory_edges (source_type, source_id, target_type, target_id, relation, weight, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
            .run(data.sourceType, data.sourceId, data.targetType, data.targetId, data.relation, data.weight, data.description, now);
        return {
            id: Number(result.lastInsertRowid),
            ...data,
            createdAt: now,
        };
    }
    getNodeEdges(nodeId) {
        const rows = this.db
            .prepare(`
        SELECT * FROM memory_edges
        WHERE source_id = ? OR target_id = ?
        ORDER BY created_at DESC
      `)
            .all(nodeId, nodeId);
        return rows.map((r) => ({
            id: r.id,
            sourceType: r.source_type,
            sourceId: r.source_id,
            targetType: r.target_type,
            targetId: r.target_id,
            relation: r.relation,
            weight: r.weight,
            description: r.description,
            createdAt: r.created_at,
        }));
    }
    deleteEdge(id) {
        const result = this.db.prepare("DELETE FROM memory_edges WHERE id = ?").run(id);
        return result.changes > 0;
    }
    /** Link a memory node to a code symbol */
    linkMemoryToCode(memoryId, codeSymbolId, description) {
        return this.createEdge({
            sourceType: "memory",
            sourceId: memoryId,
            targetType: "code",
            targetId: codeSymbolId,
            relation: "links_to_code",
            weight: 1.0,
            description: description ?? "",
        });
    }
    /** Link two memory nodes */
    linkMemoryToMemory(sourceId, targetId, relation, weight, description) {
        return this.createEdge({
            sourceType: "memory",
            sourceId,
            targetType: "memory",
            targetId,
            relation,
            weight: weight ?? 1.0,
            description: description ?? "",
        });
    }
    /** Get memory entry with its code symbol associations */
    getMemoryWithCodeSymbols(memoryId) {
        const rows = this.db
            .prepare(`
        SELECT
          me.relation, me.weight, me.description AS edge_description,
          n.id AS code_id, n.name AS code_name, n.kind AS code_kind,
          n.file_path, n.qualified_name, n.signature
        FROM memory_edges me
        JOIN nodes n ON n.id = me.target_id
        WHERE me.source_id = ?
          AND me.source_type = 'memory'
          AND me.target_type = 'code'
          AND me.relation = 'links_to_code'
      `)
            .all(memoryId);
        return rows.map((r) => ({
            relation: r.relation,
            weight: r.weight,
            description: r.edge_description,
            symbol: {
                id: r.code_id,
                name: r.code_name,
                kind: r.code_kind,
                filePath: r.file_path,
                qualifiedName: r.qualified_name,
            },
        }));
    }
    /** Get related memory entries (graph traversal, depth=1) */
    getRelatedMemories(memoryId, options) {
        const maxDepth = options?.depth ?? 1;
        const relationFilter = options?.relationTypes;
        const minWeight = options?.minWeight ?? 0;
        if (maxDepth < 1)
            return [];
        const rows = this.db
            .prepare(`
        SELECT
          me.relation, me.weight, me.source_type, me.target_type,
          me.source_id, me.target_id,
          mn.id AS node_id, mn.title, mn.summary,
          mn.importance, mn.status, mn.tags, mn.node_type,
          mn.created_at, mn.updated_at, mn.source,
          mn.scope, mn.tier_min, mn.negative_examples, mn.is_deprecated, mn.deprecated_at,
          mn.user_id
        FROM memory_edges me
        JOIN memory_nodes mn ON (
          (me.source_id = ? AND me.target_type = 'memory' AND me.target_id = mn.id)
          OR
          (me.target_id = ? AND me.source_type = 'memory' AND me.source_id = mn.id)
        )
        WHERE (
          (me.source_id = ? AND me.source_type = 'memory')
          OR
          (me.target_id = ? AND me.target_type = 'memory')
        )
        ${relationFilter ? `AND me.relation IN (${relationFilter.map(() => "?").join(",")})` : ""}
        AND me.weight >= ?
      `)
            .all(memoryId, memoryId, memoryId, memoryId, ...(relationFilter ?? []), minWeight);
        const results = [];
        for (const row of rows) {
            const direction = row.source_id === memoryId ? "outgoing" : "incoming";
            if (!results.some((r) => r.node.id === row.node_id)) {
                results.push({
                    node: this.rowToNode(row),
                    relation: row.relation,
                    weight: row.weight,
                    direction,
                });
            }
        }
        return results;
    }
    /** Full-text search via FTS5 (v7+) */
    searchByFTS(query, limit = 20) {
        try {
            const rows = this.db
                .prepare(`
          SELECT mn.* FROM memory_nodes mn
          JOIN memory_nodes_fts fts ON mn.rowid = fts.rowid
          WHERE memory_nodes_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `)
                .all(query, limit);
            return rows.map((r) => this.rowToNode(r));
        }
        catch {
            // FTS5 表不存在或查询失败，降级到 LIKE
            return this.searchByText(query, limit);
        }
    }
    /** Full-text search across memory titles and summaries (LIKE fallback) */
    searchByText(query, limit = 20) {
        const like = `%${query}%`;
        const rows = this.db
            .prepare(`
        SELECT * FROM memory_nodes
        WHERE status = 'active'
          AND (title LIKE ? OR summary LIKE ? OR body LIKE ?)
        ORDER BY importance DESC, created_at DESC
        LIMIT ?
      `)
            .all(like, like, like, limit);
        return rows.map((r) => this.rowToNode(r));
    }
    /** Search by tags */
    searchByTag(tag, limit = 20) {
        const rows = this.db
            .prepare(`
        SELECT * FROM memory_nodes
        WHERE status = 'active'
          AND tags LIKE ?
        ORDER BY importance DESC, created_at DESC
        LIMIT ?
      `)
            .all(`%"${tag}"%`, limit);
        return rows.map((r) => this.rowToNode(r));
    }
    /** Get nodes by scope */
    getNodesByScope(scope, limit = 50) {
        const rows = this.db
            .prepare(`
        SELECT * FROM memory_nodes
        WHERE scope = ? AND status = 'active'
        ORDER BY importance DESC, created_at DESC
        LIMIT ?
      `)
            .all(scope, limit);
        return rows.map((r) => this.rowToNode(r));
    }
    /** Get nodes by user_id（多租户查询） */
    getNodesByUserId(userId, limit = 50) {
        const rows = this.db
            .prepare(`
        SELECT * FROM memory_nodes
        WHERE user_id = ? AND status = 'active'
        ORDER BY importance DESC, created_at DESC
        LIMIT ?
      `)
            .all(userId, limit);
        return rows.map((r) => this.rowToNode(r));
    }
    /** Get recent memories by time range */
    getRecentMemories(hours = 24, limit = 50) {
        const cutoff = Date.now() - hours * 60 * 60 * 1000;
        const rows = this.db
            .prepare(`
        SELECT * FROM memory_nodes
        WHERE created_at >= ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
            .all(cutoff, limit);
        return rows.map((r) => this.rowToNode(r));
    }
    /** Get statistics */
    getStats() {
        const totalNodes = this.db.prepare("SELECT COUNT(*) as count FROM memory_nodes").get().count;
        const totalEdges = this.db.prepare("SELECT COUNT(*) as count FROM memory_edges").get().count;
        const codeLinked = this.db
            .prepare("SELECT COUNT(*) as count FROM memory_edges WHERE relation = 'links_to_code'")
            .get().count;
        const byStatusRows = this.db.prepare("SELECT status, COUNT(*) as count FROM memory_nodes GROUP BY status").all();
        const byTypeRows = this.db.prepare("SELECT node_type, COUNT(*) as count FROM memory_nodes GROUP BY node_type").all();
        const byScopeRows = this.db.prepare("SELECT scope, COUNT(*) as count FROM memory_nodes GROUP BY scope").all();
        return {
            totalNodes,
            totalEdges,
            codeLinked,
            byStatus: Object.fromEntries(byStatusRows.map((r) => [r.status, r.count])),
            byType: Object.fromEntries(byTypeRows.map((r) => [r.node_type, r.count])),
            byScope: Object.fromEntries(byScopeRows.map((r) => [r.scope, r.count])),
        };
    }
    // ===== Todo Items (v12) =====
    createTodoItem(data) {
        const id = data.id ?? crypto.randomUUID();
        const now = Date.now();
        this.db.prepare(`
      INSERT INTO todo_items (id, title, description, track, priority, status, due_date, project_dir, tags, created_at, updated_at, user_id)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
    `).run(id, data.title, data.description ?? "", data.track, data.priority ?? "medium", data.dueDate ?? null, data.projectDir ?? null, JSON.stringify(data.tags ?? []), now, now, data.userId ?? "default");
        return { id, title: data.title, track: data.track, priority: data.priority ?? "medium", status: "pending", createdAt: now };
    }
    getTodoItem(id) {
        return this.db.prepare("SELECT * FROM todo_items WHERE id = ?").get(id);
    }
    updateTodoItem(id, data) {
        const existing = this.getTodoItem(id);
        if (!existing)
            return false;
        const now = Date.now();
        const updates = ["updated_at = ?"];
        const params = [now];
        if (data.title !== undefined) {
            updates.push("title = ?");
            params.push(data.title);
        }
        if (data.description !== undefined) {
            updates.push("description = ?");
            params.push(data.description);
        }
        if (data.track !== undefined) {
            updates.push("track = ?");
            params.push(data.track);
        }
        if (data.priority !== undefined) {
            updates.push("priority = ?");
            params.push(data.priority);
        }
        if (data.status !== undefined) {
            updates.push("status = ?");
            params.push(data.status);
        }
        if (data.dueDate !== undefined) {
            updates.push("due_date = ?");
            params.push(data.dueDate);
        }
        if (data.projectDir !== undefined) {
            updates.push("project_dir = ?");
            params.push(data.projectDir);
        }
        if (data.tags !== undefined) {
            updates.push("tags = ?");
            params.push(JSON.stringify(data.tags));
        }
        params.push(id);
        this.db.prepare(`UPDATE todo_items SET ${updates.join(", ")} WHERE id = ?`).run(...params);
        return true;
    }
    deleteTodoItem(id) {
        return this.db.prepare("DELETE FROM todo_items WHERE id = ?").run(id).changes > 0;
    }
    completeTodoItem(id) {
        const now = Date.now();
        return this.db.prepare("UPDATE todo_items SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?").run(now, now, id).changes > 0;
    }
    listTodoItems(filter) {
        const conditions = [];
        const params = [];
        if (filter?.track) {
            conditions.push("track = ?");
            params.push(filter.track);
        }
        if (filter?.status) {
            conditions.push("status = ?");
            params.push(filter.status);
        }
        if (filter?.priority) {
            conditions.push("priority = ?");
            params.push(filter.priority);
        }
        if (filter?.dueBefore) {
            conditions.push("due_date <= ?");
            params.push(filter.dueBefore);
        }
        if (filter?.dueAfter) {
            conditions.push("due_date >= ?");
            params.push(filter.dueAfter);
        }
        if (filter?.userId) {
            conditions.push("user_id = ?");
            params.push(filter.userId);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const limit = filter?.limit ?? 50;
        return this.db
            .prepare(`SELECT * FROM todo_items ${where} ORDER BY created_at DESC LIMIT ?`)
            .all(...params, limit);
    }
    getOverdueTodoItems(userId) {
        const now = Date.now();
        if (userId) {
            return this.db
                .prepare("SELECT * FROM todo_items WHERE status NOT IN ('completed','cancelled','archived') AND due_date IS NOT NULL AND due_date < ? AND user_id = ? ORDER BY due_date ASC")
                .all(now, userId);
        }
        return this.db
            .prepare("SELECT * FROM todo_items WHERE status NOT IN ('completed','cancelled','archived') AND due_date IS NOT NULL AND due_date < ? ORDER BY due_date ASC")
            .all(now);
    }
    getDailyTodoSummary(userId) {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = todayStart.getTime() + 86400000;
        const todayStartTs = todayStart.getTime();
        const userIdFilter = userId ? " AND user_id = ?" : "";
        const params = userId ? [userId] : [];
        const total = this.db.prepare(`SELECT COUNT(*) as c FROM todo_items${userIdFilter ? " WHERE user_id = ?" : ""}`).all(...params)[0].c;
        const completed = this.db.prepare(`SELECT COUNT(*) as c FROM todo_items WHERE completed_at >= ? AND completed_at < ?${userIdFilter}`).all(todayStartTs, todayEnd, ...params)[0].c;
        const pending = this.db.prepare(`SELECT COUNT(*) as c FROM todo_items WHERE status = 'pending'${userIdFilter ? " AND user_id = ?" : ""}`).all(...params)[0].c;
        const overdue = this.db.prepare(`SELECT COUNT(*) as c FROM todo_items WHERE status NOT IN ('completed','cancelled','archived') AND due_date IS NOT NULL AND due_date < ?${userIdFilter}`).all(Date.now(), ...params)[0].c;
        return { total, completed, pending, overdue };
    }
    // ===== Prompt Templates (v12) =====
    createPromptTemplate(data) {
        const id = data.id ?? crypto.randomUUID();
        const now = Date.now();
        this.db.prepare(`
      INSERT INTO prompt_templates (id, name, category, content, description, tags, version, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, data.name, data.category, data.content, data.description ?? "", JSON.stringify(data.tags ?? []), data.version ?? "1.0.0", now, now);
        return { id, name: data.name, category: data.category, version: data.version ?? "1.0.0", createdAt: now };
    }
    getPromptTemplate(id) {
        return this.db.prepare("SELECT * FROM prompt_templates WHERE id = ?").get(id);
    }
    getPromptTemplateByName(name) {
        return this.db.prepare("SELECT * FROM prompt_templates WHERE name = ?").get(name);
    }
    updatePromptTemplate(id, data) {
        const existing = this.getPromptTemplate(id);
        if (!existing)
            return false;
        const now = Date.now();
        const updates = ["updated_at = ?"];
        const params = [now];
        if (data.name !== undefined) {
            updates.push("name = ?");
            params.push(data.name);
        }
        if (data.category !== undefined) {
            updates.push("category = ?");
            params.push(data.category);
        }
        if (data.content !== undefined) {
            updates.push("content = ?");
            params.push(data.content);
        }
        if (data.description !== undefined) {
            updates.push("description = ?");
            params.push(data.description);
        }
        if (data.tags !== undefined) {
            updates.push("tags = ?");
            params.push(JSON.stringify(data.tags));
        }
        if (data.version !== undefined) {
            updates.push("version = ?");
            params.push(data.version);
        }
        if (data.enabled !== undefined) {
            updates.push("enabled = ?");
            params.push(data.enabled ? 1 : 0);
        }
        params.push(id);
        this.db.prepare(`UPDATE prompt_templates SET ${updates.join(", ")} WHERE id = ?`).run(...params);
        return true;
    }
    deletePromptTemplate(id) {
        return this.db.prepare("DELETE FROM prompt_templates WHERE id = ?").run(id).changes > 0;
    }
    listPromptTemplates(filter) {
        const conditions = [];
        const params = [];
        if (filter?.category) {
            conditions.push("category = ?");
            params.push(filter.category);
        }
        if (filter?.enabled !== undefined) {
            conditions.push("enabled = ?");
            params.push(filter.enabled ? 1 : 0);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
        const limit = filter?.limit ?? 50;
        return this.db
            .prepare(`SELECT * FROM prompt_templates ${where} ORDER BY category, name LIMIT ?`)
            .all(...params, limit);
    }
    searchPromptTemplates(query, limit = 20) {
        const like = `%${query}%`;
        return this.db
            .prepare("SELECT * FROM prompt_templates WHERE name LIKE ? OR description LIKE ? OR tags LIKE ? ORDER BY name LIMIT ?")
            .all(like, like, like, limit);
    }
    // ===== Session Bookmarks (v12) =====
    createSessionBookmark(data) {
        const id = data.id ?? crypto.randomUUID();
        const now = Date.now();
        this.db.prepare(`
      INSERT INTO session_bookmarks (id, session_id, round_index, title, summary, tags, created_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.sessionId, data.roundIndex, data.title, data.summary ?? "", JSON.stringify(data.tags ?? []), now, data.userId ?? "default");
        return { id, sessionId: data.sessionId, roundIndex: data.roundIndex, title: data.title, createdAt: now };
    }
    listSessionBookmarks(sessionId, userId) {
        if (userId) {
            return this.db
                .prepare("SELECT * FROM session_bookmarks WHERE session_id = ? AND user_id = ? ORDER BY round_index ASC")
                .all(sessionId, userId);
        }
        return this.db
            .prepare("SELECT * FROM session_bookmarks WHERE session_id = ? ORDER BY round_index ASC")
            .all(sessionId);
    }
    deleteSessionBookmark(id) {
        return this.db.prepare("DELETE FROM session_bookmarks WHERE id = ?").run(id).changes > 0;
    }
    searchSessionBookmarks(query, userId, limit = 20) {
        const like = `%${query}%`;
        if (userId) {
            return this.db
                .prepare("SELECT * FROM session_bookmarks WHERE (title LIKE ? OR summary LIKE ? OR tags LIKE ?) AND user_id = ? ORDER BY created_at DESC LIMIT ?")
                .all(like, like, like, userId, limit);
        }
        return this.db
            .prepare("SELECT * FROM session_bookmarks WHERE title LIKE ? OR summary LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT ?")
            .all(like, like, like, limit);
    }
    // ===== Notification Channels (v12) =====
    createNotificationChannel(data) {
        const id = data.id ?? crypto.randomUUID();
        const now = Date.now();
        this.db.prepare(`
      INSERT INTO notification_channels (id, channel_type, name, config_json, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(id, data.channelType, data.name, JSON.stringify(data.configJson ?? {}), now, now);
        return { id, channelType: data.channelType, name: data.name, enabled: true, createdAt: now };
    }
    listNotificationChannels(enabledOnly = false) {
        if (enabledOnly) {
            return this.db.prepare("SELECT * FROM notification_channels WHERE enabled = 1 ORDER BY name").all();
        }
        return this.db.prepare("SELECT * FROM notification_channels ORDER BY name").all();
    }
    updateNotificationChannel(id, data) {
        const existing = this.db.prepare("SELECT * FROM notification_channels WHERE id = ?").get(id);
        if (!existing)
            return false;
        const now = Date.now();
        const updates = ["updated_at = ?"];
        const params = [now];
        if (data.name !== undefined) {
            updates.push("name = ?");
            params.push(data.name);
        }
        if (data.configJson !== undefined) {
            updates.push("config_json = ?");
            params.push(JSON.stringify(data.configJson));
        }
        if (data.enabled !== undefined) {
            updates.push("enabled = ?");
            params.push(data.enabled ? 1 : 0);
        }
        params.push(id);
        this.db.prepare(`UPDATE notification_channels SET ${updates.join(", ")} WHERE id = ?`).run(...params);
        return true;
    }
    deleteNotificationChannel(id) {
        return this.db.prepare("DELETE FROM notification_channels WHERE id = ?").run(id).changes > 0;
    }
    /** Prune expired and low-importance entries */
    prune(dryRun = true) {
        const now = Date.now();
        const expired = this.db
            .prepare("SELECT id FROM memory_nodes WHERE ttl_days IS NOT NULL AND (created_at + ttl_days * 86400000) < ?")
            .all(now);
        const lowImp = this.db
            .prepare(`
        SELECT mn.id FROM memory_nodes mn
        WHERE mn.importance < 3 AND mn.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM memory_edges me WHERE me.source_id = mn.id OR me.target_id = mn.id)
      `)
            .all();
        if (dryRun) {
            return { deleted: expired.length, archived: lowImp.length };
        }
        for (const row of expired) {
            this.db.prepare("DELETE FROM memory_nodes WHERE id = ?").run(row.id);
        }
        for (const row of lowImp) {
            this.db.prepare("UPDATE memory_nodes SET status = 'archived' WHERE id = ?").run(row.id);
        }
        return { deleted: expired.length, archived: lowImp.length };
    }
    /** Get all nodes regardless of status (for dream engine maintenance) */
    getAllNodes() {
        const rows = this.db
            .prepare("SELECT * FROM memory_nodes")
            .all();
        return rows.map((r) => this.rowToNode(r));
    }
    /** Close the database connection */
    close() {
        if (this.db.open)
            this.db.close();
    }
    // ===== Helpers =====
    rowToNode(row) {
        return {
            id: row.id,
            title: row.title,
            summary: row.summary ?? "",
            body: row.body ?? "",
            contentHash: row.content_hash,
            importance: row.importance ?? 5,
            status: row.status ?? "active",
            source: row.source ?? "agent",
            sourceSession: row.source_session ?? null,
            tags: (() => {
                try {
                    return JSON.parse(row.tags ?? "[]");
                }
                catch {
                    return [];
                }
            })(),
            nodeType: row.node_type ?? "memory_entry",
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            ttlDays: row.ttl_days ?? null,
            scope: row.scope ?? "public",
            tierMin: row.tier_min ?? 1,
            negativeExamples: (() => {
                try {
                    return JSON.parse(row.negative_examples ?? "[]");
                }
                catch {
                    return [];
                }
            })(),
            isDeprecated: row.is_deprecated === 1,
            deprecatedAt: row.deprecated_at ?? null,
            userId: row.user_id ?? "default",
            agentId: row.agent_id ?? "unknown",
            confidence: typeof row.confidence === "number" ? row.confidence : 0.6,
            verified: row.verified === 1,
            privacyFlag: row.privacy_flag ?? 0,
            // v12+: Git 分支感知 + 项目目录
            gitBranch: row.git_branch ?? null,
            projectDir: row.project_dir ?? null,
        };
    }
}
//# sourceMappingURL=database.js.map