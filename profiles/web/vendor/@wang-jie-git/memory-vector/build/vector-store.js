/**
 * memory-vector: SQLite 向量存储
 *
 * 在 CodeGraph DB 同目录下维护独立的 memory-vectors.db，
 * 存储 id → Float32Array BLOB + metadata JSON。
 *
 * 查询策略：余弦相似度暴力搜索（O(n)），适合 MVP 阶段 <10,000 条记录。
 * 后期可换装 LanceDB / ChromaDB 等专用向量引擎。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
// ===== Cosine Similarity =====
function cosineSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}
export class SqliteVectorStore {
    db;
    dbPath;
    _dimension = 0;
    constructor(db, dbPath) {
        this.db = db;
        this.dbPath = dbPath;
    }
    /** Open existing or create new vector store at dbPath */
    static open(dbPath) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { DatabaseSync } = _require("node:sqlite");
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        const raw = new DatabaseSync(dbPath);
        raw.exec("PRAGMA journal_mode = WAL");
        raw.exec("PRAGMA busy_timeout = 5000");
        raw.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY,
        vector BLOB NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_vectors_created ON vectors(created_at);
    `);
        const store = new SqliteVectorStore(raw, dbPath);
        return store;
    }
    /** Total number of stored vectors */
    get totalEntries() {
        const row = this.db
            .prepare("SELECT COUNT(*) as c FROM vectors")
            .get();
        return row.c;
    }
    /** Vector dimension (detected from first entry) */
    get dimension() {
        if (this._dimension > 0)
            return this._dimension;
        const row = this.db
            .prepare("SELECT vector FROM vectors LIMIT 1")
            .get();
        if (row) {
            this._dimension = row.vector.byteLength / 4;
        }
        return this._dimension;
    }
    // ===== Write =====
    upsert(id, vector, metadata) {
        this.db
            .prepare(`
        INSERT INTO vectors (id, vector, metadata_json, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          vector = excluded.vector,
          metadata_json = excluded.metadata_json
      `)
            .run(id, Buffer.from(vector.buffer), JSON.stringify(metadata), Date.now());
        if (this._dimension === 0)
            this._dimension = vector.length;
    }
    upsertBatch(entries) {
        const stmt = this.db.prepare(`
      INSERT INTO vectors (id, vector, metadata_json, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        vector = excluded.vector,
        metadata_json = excluded.metadata_json
    `);
        const now = Date.now();
        for (const entry of entries) {
            stmt.run(entry.id, Buffer.from(entry.vector.buffer), JSON.stringify(entry.metadata), now);
        }
        if (this._dimension === 0 && entries.length > 0) {
            this._dimension = entries[0].vector.length;
        }
    }
    delete(id) {
        const result = this.db.prepare("DELETE FROM vectors WHERE id = ?").run(id);
        return result.changes > 0;
    }
    // ===== Query =====
    query(queryVector, options) {
        const topK = options.topK;
        const threshold = options.scoreThreshold ?? -Infinity;
        // Build SQL with optional filters
        const conditions = [];
        const params = [];
        if (options.filter) {
            const f = options.filter;
            if (f.importanceMin !== undefined) {
                conditions.push("json_extract(metadata_json, '$.importance') >= ?");
                params.push(f.importanceMin);
            }
            if (f.sources?.length) {
                const placeholders = f.sources.map(() => "?").join(",");
                conditions.push(`json_extract(metadata_json, '$.source') IN (${placeholders})`);
                params.push(...f.sources);
            }
            if (f.types?.length) {
                const placeholders = f.types.map(() => "?").join(",");
                conditions.push(`json_extract(metadata_json, '$.type') IN (${placeholders})`);
                params.push(...f.types);
            }
            if (f.timeRange) {
                conditions.push("json_extract(metadata_json, '$.createdAt') >= ? AND json_extract(metadata_json, '$.createdAt') <= ?");
                params.push(f.timeRange[0], f.timeRange[1]);
            }
            if (f.tenantId) {
                conditions.push("json_extract(metadata_json, '$.tenantId') = ?");
                params.push(f.tenantId);
            }
            if (f.tiers?.length) {
                const placeholders = f.tiers.map(() => "?").join(",");
                conditions.push(`json_extract(metadata_json, '$.tier') IN (${placeholders})`);
                params.push(...f.tiers);
            }
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const rows = this.db
            .prepare(`SELECT id, vector, metadata_json FROM vectors ${where}`)
            .all(...params);
        // Compute cosine similarity
        const scored = [];
        for (const row of rows) {
            const buf = row.vector;
            // Buffer.buffer may be a larger internal pool — use byteOffset + byteLength
            const storedVector = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
            const score = cosineSimilarity(queryVector, storedVector);
            if (score < threshold)
                continue;
            scored.push({
                id: row.id,
                score,
                metadata: JSON.parse(row.metadata_json),
            });
        }
        // Sort by score descending, return top K
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    }
    // ===== Maintenance =====
    stats() {
        const count = this.db
            .prepare("SELECT COUNT(*) as c FROM vectors")
            .get().c;
        return {
            totalEntries: count,
            dimension: this.dimension,
            memoryUsageBytes: count * this.dimension * 4,
        };
    }
    /** Delete all vectors and rebuild from scratch */
    clear() {
        this.db.exec("DELETE FROM vectors");
    }
    // ===== Cold Storage =====
    /** Move entries to cold tier (update metadata) */
    moveToCold(nodeIds) {
        let count = 0;
        const stmt = this.db.prepare(`UPDATE vectors SET metadata_json = json_set(metadata_json, '$.tier', 'cold') WHERE id = ?`);
        for (const id of nodeIds) {
            const r = stmt.run(id);
            count += r.changes;
        }
        return count;
    }
    /** Move entries back to hot tier */
    moveToHot(nodeIds) {
        let count = 0;
        const stmt = this.db.prepare(`UPDATE vectors SET metadata_json = json_set(metadata_json, '$.tier', 'hot') WHERE id = ?`);
        for (const id of nodeIds) {
            const r = stmt.run(id);
            count += r.changes;
        }
        return count;
    }
    /** Auto-archive: entries older than N days with low importance become cold */
    autoTier(daysOld, importanceThreshold) {
        const cutoff = Date.now() - daysOld * 86400000;
        const rows = this.db
            .prepare(`
        SELECT id FROM vectors
        WHERE json_extract(metadata_json, '$.tier') IS NULL
          AND json_extract(metadata_json, '$.createdAt') < ?
          AND json_extract(metadata_json, '$.importance') < ?
      `)
            .all(cutoff, importanceThreshold);
        const ids = rows.map((r) => r.id);
        if (ids.length === 0)
            return { movedToCold: 0 };
        return { movedToCold: this.moveToCold(ids) };
    }
    /** Delete all cold entries */
    purgeCold() {
        const result = this.db
            .prepare(`DELETE FROM vectors WHERE json_extract(metadata_json, '$.tier') = 'cold'`)
            .run();
        return result.changes;
    }
    close() {
        if (this.db?.isOpen)
            this.db.close();
    }
    /** Get database file path */
    getPath() {
        return this.dbPath;
    }
}
//# sourceMappingURL=vector-store.js.map