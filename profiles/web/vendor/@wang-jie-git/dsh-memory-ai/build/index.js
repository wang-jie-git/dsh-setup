var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-orchestrator/src/dream.js
var dream_exports = {};
__export(dream_exports, {
  DEFAULT_DREAM_CONFIG: () => DEFAULT_DREAM_CONFIG,
  DreamEngine: () => DreamEngine
});
var DEFAULT_DREAM_CONFIG, UnionFind, DreamEngine;
var init_dream = __esm({
  "../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-orchestrator/src/dream.js"() {
    DEFAULT_DREAM_CONFIG = {
      redundancyThreshold: 0.92,
      clusterSimilarity: 0.75,
      minClusterSize: 3,
      lowImportanceThreshold: 3,
      maxAgeDays: 365,
      dryRun: false,
      llmEnabled: false
    };
    UnionFind = class {
      parent = /* @__PURE__ */ new Map();
      find(x) {
        if (!this.parent.has(x))
          this.parent.set(x, x);
        const p = this.parent.get(x);
        if (p !== x) {
          this.parent.set(x, this.find(p));
        }
        return this.parent.get(x);
      }
      union(a, b) {
        const ra = this.find(a), rb = this.find(b);
        if (ra !== rb)
          this.parent.set(rb, ra);
      }
      groups() {
        const map = /* @__PURE__ */ new Map();
        for (const key of this.parent.keys()) {
          const root = this.find(key);
          if (!map.has(root))
            map.set(root, []);
          map.get(root).push(key);
        }
        return map;
      }
    };
    DreamEngine = class {
      config;
      memoryDb;
      vectorStore;
      embedder;
      constructor(memoryDb, vectorStore, embedder, config = {}) {
        this.memoryDb = memoryDb;
        this.vectorStore = vectorStore;
        this.embedder = embedder;
        this.config = { ...DEFAULT_DREAM_CONFIG, ...config };
      }
      /** 更新运行时配置 */
      setConfig(config) {
        this.config = { ...this.config, ...config };
      }
      /**
       * 执行一次完整的梦境整理周期
       *
       * Phase 1: 快照 — 记录整理前的状态
       * Phase 2: 冗余合并 — 检测并合并高度相似的记忆
       * Phase 3: 主题聚类 — 聚类相关记忆并生成 insight
       * Phase 4: 价值修剪 — 归档/删除低价值记忆
       * Phase 5: 报告 — 输出梦境报告
       */
      async consolidate() {
        const dreamId = crypto.randomUUID();
        const startTime = performance.now();
        const before = this.takeSnapshot();
        const merged2 = this.config.dryRun ? [] : await this.mergeRedundant();
        const insights = this.config.dryRun ? [] : await this.clusterAndGenerateInsights();
        const { archived, deleted } = this.config.dryRun ? { archived: [], deleted: [] } : this.pruneLowValue();
        const after = this.takeSnapshot();
        const healthScore = this.computeHealthScore(before, after);
        const duration = Math.round(performance.now() - startTime);
        if (!this.config.dryRun) {
          this.logDream(dreamId, startTime, duration, before, after, merged2, archived, deleted, insights, healthScore);
        }
        return {
          dreamId,
          timestamp: startTime,
          duration,
          dryRun: this.config.dryRun,
          summary: { before, after },
          actions: { merged: merged2, archived, deleted, insights },
          healthScore
        };
      }
      // ================================================================
      //  Phase 2: Redundancy Merge
      // ================================================================
      /**
       * 检测并合并冗余记忆。
       * 条件：向量相似度 > threshold AND 标签重叠 > 80%
       */
      async mergeRedundant() {
        const allNodes = this.getActiveNodes();
        if (allNodes.length < 2)
          return [];
        const actions = [];
        const mergedIds = /* @__PURE__ */ new Set();
        for (let i = 0; i < allNodes.length; i++) {
          const nodeA = allNodes[i];
          if (mergedIds.has(nodeA.id))
            continue;
          const queryVec = await this.getNodeVector(nodeA.id);
          if (!queryVec)
            continue;
          const similar = this.vectorStore.query(queryVec, {
            topK: 6,
            // 5 similar + self
            scoreThreshold: this.config.redundancyThreshold
          });
          for (const result of similar) {
            if (result.id === nodeA.id)
              continue;
            if (mergedIds.has(result.id))
              continue;
            const nodeB = this.memoryDb.getNode(result.id);
            if (!nodeB)
              continue;
            const overlap = this.tagOverlap(nodeA.tags, nodeB.tags);
            if (overlap < 0.8)
              continue;
            const timeDelta = Math.abs(nodeA.createdAt - nodeB.createdAt);
            if (timeDelta > 7 * 864e5)
              continue;
            const [keeper, obsolete] = nodeA.importance >= nodeB.importance ? [nodeA, nodeB] : [nodeB, nodeA];
            const mergedTags = [.../* @__PURE__ */ new Set([...keeper.tags, ...obsolete.tags])];
            const mergedBody = keeper.body ? obsolete.body ? `${keeper.body}

---
${obsolete.body}` : keeper.body : obsolete.body;
            const mergedSummary = keeper.summary.length >= obsolete.summary.length ? keeper.summary : obsolete.summary;
            this.memoryDb.updateNode(keeper.id, {
              tags: mergedTags,
              summary: mergedSummary,
              body: mergedBody,
              importance: Math.min(10, keeper.importance + 1)
              // 合并后重要性略增
            });
            this.memoryDb.updateNode(obsolete.id, {
              status: "archived"
            });
            this.memoryDb.linkMemoryToMemory(obsolete.id, keeper.id, "supersedes", 1, `\u68A6\u5883\u5408\u5E76\uFF1A${obsolete.title} \u2192 ${keeper.title}`);
            mergedIds.add(obsolete.id);
            actions.push({
              targetId: keeper.id,
              targetTitle: keeper.title,
              sourceIds: [obsolete.id],
              sourceTitles: [obsolete.title],
              mergedImportance: keeper.importance,
              mergedTags
            });
            break;
          }
        }
        return actions;
      }
      // ================================================================
      //  Phase 3: Clustering & Insight Generation
      // ================================================================
      /**
       * 聚类相关记忆并生成 insight 节点。
       * 策略：按公共标签聚类（标签 → 节点倒排），合并重叠簇。
       * 避免 O(n²) 向量比较，用标签作为高效代理信号。
       */
      async clusterAndGenerateInsights() {
        const allNodes = this.getActiveNodes();
        if (allNodes.length < this.config.minClusterSize)
          return [];
        const tagToNodes = /* @__PURE__ */ new Map();
        for (const node of allNodes) {
          for (const tag of node.tags) {
            if (tag.startsWith("dream-") || tag === "auto-generated")
              continue;
            if (!tagToNodes.has(tag))
              tagToNodes.set(tag, []);
            tagToNodes.get(tag).push(node.id);
          }
        }
        const uf = new UnionFind();
        const validTags = [...tagToNodes.entries()].filter(([_, nodes]) => nodes.length >= this.config.minClusterSize);
        if (validTags.length === 0)
          return [];
        for (const [tag, nodeIds] of validTags) {
          for (let i = 1; i < nodeIds.length; i++) {
            uf.union(nodeIds[0], nodeIds[i]);
          }
        }
        const groups = uf.groups();
        const insights = [];
        for (const [rootId, memberIds] of groups) {
          if (memberIds.length < this.config.minClusterSize)
            continue;
          const members = memberIds.map((id) => allNodes.find((n) => n.id === id)).filter((n) => n !== void 0);
          if (members.length < this.config.minClusterSize)
            continue;
          const tagCount = /* @__PURE__ */ new Map();
          for (const m of members) {
            for (const t of m.tags) {
              tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
            }
          }
          const commonTags = [...tagCount.entries()].filter(([_, count]) => count >= members.length * 0.5).map(([tag]) => tag);
          const title = this.synthesizeInsightTitle(members, commonTags);
          const topImportance = Math.max(...members.map((m) => m.importance));
          const avgImportance = Math.round(members.reduce((s, m) => s + m.importance, 0) / members.length);
          const insightNode = this.memoryDb.createNode({
            title,
            summary: `\u68A6\u5883\u63D0\u70BC\uFF1A${members.length} \u6761\u76F8\u5173\u8BB0\u5FC6\u7684\u6A21\u5F0F\u5F52\u7EB3`,
            body: members.map((m, i) => `${i + 1}. **${m.title}** (\u91CD\u8981\u6027: ${m.importance}/10)
   ${m.summary}`).join("\n\n"),
            importance: Math.min(10, topImportance + 1),
            // insight 比最高成员略高
            status: "active",
            source: "system",
            sourceSession: null,
            tags: [...commonTags, "dream-insight", "auto-generated"],
            nodeType: "insight",
            ttlDays: null,
            scope: "public",
            tierMin: 1,
            negativeExamples: [],
            isDeprecated: false,
            deprecatedAt: null,
            userId: "default"
          });
          for (const m of members) {
            this.memoryDb.linkMemoryToMemory(m.id, insightNode.id, "references", 0.9, `\u68A6\u5883\u805A\u7C7B\uFF1A${m.title} \u2192 ${title}`);
          }
          for (const m of members) {
            this.memoryDb.linkMemoryToMemory(insightNode.id, m.id, "summarizes", avgImportance / 10, `\u68A6\u5883\u63D0\u70BC\u8282\u70B9`);
          }
          insights.push({
            title,
            confidence: Math.round(memberIds.length / (memberIds.length + 2) * 100) / 100,
            relatedNodeIds: members.map((m) => m.id),
            relatedTitles: members.map((m) => m.title),
            commonTags,
            insightId: insightNode.id
          });
        }
        return insights;
      }
      // ================================================================
      //  Phase 4: Pruning
      // ================================================================
      /**
       * 修剪低价值记忆：
       * 1. TTL 过期 → 直接删除
       * 2. 低重要性 + 无引用 + 旧数据 → 归档
       * 3. 归档 + 超期 → 删除
       */
      pruneLowValue() {
        const now = Date.now();
        const allNodes = this.memoryDb.getAllNodes();
        const archived = [];
        const deleted = [];
        for (const node of allNodes) {
          if (node.nodeType === "insight")
            continue;
          if (node.nodeType === "decision") {
            try {
              const body = JSON.parse(node.body);
              if (body.procedure)
                continue;
            } catch {
            }
          }
          if (this.isTemplateNode(node)) {
            if (node.isDeprecated && node.deprecatedAt) {
              const deprecatedAge = now - node.deprecatedAt;
              if (deprecatedAge > 7 * 864e5) {
                this.deleteNodeAndVector(node.id);
                deleted.push(node.id);
                continue;
              }
            }
            continue;
          }
          if (node.ttlDays !== null) {
            const expiresAt = node.createdAt + node.ttlDays * 864e5;
            if (now > expiresAt) {
              this.deleteNodeAndVector(node.id);
              deleted.push(node.id);
              continue;
            }
          }
          if (node.status === "archived") {
            const archiveAge = now - node.updatedAt;
            if (archiveAge > this.config.maxAgeDays * 2 * 864e5) {
              this.deleteNodeAndVector(node.id);
              deleted.push(node.id);
              continue;
            }
            continue;
          }
          if (node.importance <= this.config.lowImportanceThreshold) {
            const age = now - node.createdAt;
            const ageDays = age / 864e5;
            if (ageDays > 90) {
              const related = this.memoryDb.getRelatedMemories(node.id, { depth: 1, minWeight: 0.1 });
              const incomingCount = related.filter((r) => r.direction === "incoming").length;
              if (incomingCount === 0) {
                this.memoryDb.updateNode(node.id, { status: "archived" });
                archived.push(node.id);
                this.vectorStore.moveToCold([node.id]);
              }
            }
          }
        }
        return { archived, deleted };
      }
      // ================================================================
      //  Helpers
      // ================================================================
      /** 获取所有 active 节点（排除已废弃的） */
      getActiveNodes() {
        const all = this.memoryDb.searchByText("", 99999);
        return all.filter((n) => n.status === "active" && !n.isDeprecated);
      }
      /** 判断节点是否为认知模板（st_ 或 ct_ 前缀） */
      isTemplateNode(node) {
        return node.nodeType === "structure_template" || node.id.startsWith("st_") || node.id.startsWith("ct_");
      }
      /** 获取节点的向量表示 */
      async getNodeVector(nodeId) {
        const allNodes = this.getActiveNodes();
        const node = allNodes.find((n) => n.id === nodeId);
        if (!node)
          return null;
        try {
          return await this.embedder.embed(node.summary || node.title);
        } catch {
          return null;
        }
      }
      /** 标签重叠率 (Jaccard 相似度) */
      tagOverlap(tagsA, tagsB) {
        if (tagsA.length === 0 && tagsB.length === 0)
          return 0;
        const setA = new Set(tagsA);
        const setB = new Set(tagsB);
        const intersection = new Set([...setA].filter((x) => setB.has(x)));
        const union = /* @__PURE__ */ new Set([...setA, ...setB]);
        return union.size === 0 ? 0 : intersection.size / union.size;
      }
      /** 余弦相似度 */
      cosineSimilarity(a, b) {
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
      /** 删除节点及其向量 */
      deleteNodeAndVector(nodeId) {
        this.memoryDb.deleteNode(nodeId);
        this.vectorStore.delete(nodeId);
      }
      /** 从标签中合成 insight 标题 */
      synthesizeInsightTitle(members, commonTags) {
        const dates = members.map((m) => m.createdAt).sort();
        const dateRange = dates.length >= 2 ? `${new Date(dates[0]).toLocaleDateString()} ~ ${new Date(dates[dates.length - 1]).toLocaleDateString()}` : new Date(dates[0]).toLocaleDateString();
        const tagPart = commonTags.length > 0 ? commonTags.slice(0, 3).join(" \xB7 ") : "\u672A\u6807\u7B7E\u8BB0\u5FC6";
        const topMember = members.reduce((a, b) => a.importance >= b.importance ? a : b);
        const hint = topMember.title.length <= 20 ? topMember.title : topMember.title.slice(0, 20) + "\u2026";
        return `\u{1F4CA} ${tagPart} (${members.length}\u6761, ${dateRange})`;
      }
      /** 快照当前状态 */
      takeSnapshot() {
        const activeNodes = this.memoryDb.searchByText("", 99999);
        const activeByType = {};
        let totalActive = 0;
        for (const n of activeNodes) {
          if (n.status === "active" && !n.isDeprecated) {
            activeByType[n.nodeType] = (activeByType[n.nodeType] ?? 0) + 1;
            totalActive++;
          }
        }
        const stats = this.memoryDb.getStats();
        return {
          nodes: totalActive,
          // 仅 active 节点
          edges: stats.totalEdges,
          activeByType,
          coldVectors: 0
        };
      }
      /** 计算健康评分 (0-10) */
      computeHealthScore(before, after) {
        const redundancyRatio = before.nodes > 0 ? Math.max(0, 1 - after.nodes / before.nodes) : 0.5;
        const redundancyScore = Math.min(10, redundancyRatio * 20);
        const totalActive = Object.values(after.activeByType).reduce((a, b) => a + b, 0);
        const insightCount = after.activeByType["insight"] ?? 0;
        const insightDensity = totalActive > 0 ? insightCount / totalActive : 0;
        const insightScore = Math.min(10, insightDensity * 100);
        const activeRatio = after.nodes > 0 ? totalActive / after.nodes : 0.5;
        const activeScore = activeRatio * 10;
        const structureDensity = after.nodes > 0 ? after.edges / after.nodes : 0;
        const structureScore = Math.min(10, structureDensity * 5);
        return Math.round(0.3 * redundancyScore + 0.3 * insightScore + 0.2 * activeScore + 0.2 * structureScore);
      }
      /** 记录梦境日志到 dream_logs 表 */
      logDream(dreamId, startedAt, duration, before, after, merged2, archived, deleted, insights, healthScore) {
        try {
          const rawDb = this.memoryDb.getRawDb();
          rawDb.prepare(`
        INSERT INTO dream_logs (id, started_at, finished_at, duration_ms,
          before_nodes, before_edges, after_nodes, after_edges,
          merged_count, archived_count, deleted_count, insights_generated,
          health_score, report_json, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(dreamId, startedAt, Date.now(), duration, before.nodes, before.edges, after.nodes, after.edges, merged2.length, archived.length, deleted.length, insights.length, healthScore, JSON.stringify({ merged: merged2, archived, deleted, insights }), "completed");
        } catch {
        }
      }
    };
  }
});

// src/index.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
import { homedir } from "node:os";
import { join as join4 } from "node:path";
import { readFileSync as readFileSync3, existsSync as existsSync5, statSync, mkdirSync as mkdirSync4, writeFileSync as writeFileSync2 } from "node:fs";

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-graph/src/database.js
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
var _require = createRequire(import.meta.url);
function createDB(dbPath) {
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
        }
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
    }
  };
}
var MEMORY_SCHEMA_VERSION = 12;
var MemoryDatabase = class _MemoryDatabase {
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
    if (this._hasNewTierMin) {
      try {
        const info = this.db.prepare("PRAGMA table_info(memory_nodes)").all();
        const tierCol = info.find((c) => c.name === "tier_min");
        if (tierCol && tierCol.type !== "INTEGER") {
          this._hasNewTierMin = false;
        }
      } catch {
      }
    }
  }
  /** Open or create memory tables in an existing CodeGraph database */
  static open(dbPath) {
    const exists = fs.existsSync(dbPath);
    if (!exists) {
      throw new Error(`CodeGraph database not found: ${dbPath}
Run codegraph index first.`);
    }
    const db = createDB(dbPath);
    const memdb = new _MemoryDatabase(db, dbPath);
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
    const memdb = new _MemoryDatabase(db, dbPath);
    memdb.migrate();
    memdb.detectSchema();
    return memdb;
  }
  migrate() {
    const tableCheck = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_schema_versions'").get();
    let currentVersion = 0;
    if (tableCheck) {
      const row = this.db.prepare("SELECT version FROM memory_schema_versions ORDER BY version DESC LIMIT 1").get();
      currentVersion = row?.version ?? 0;
    }
    if (currentVersion >= MEMORY_SCHEMA_VERSION)
      return;
    if (!tableCheck) {
      const schemaPath = path.join(__dirname, "schema.sql");
      const schema = fs.readFileSync(schemaPath, "utf-8");
      this.db.exec(schema);
      this.db.prepare("INSERT OR IGNORE INTO memory_schema_versions (version, applied_at, description) VALUES (?, ?, ?)").run(MEMORY_SCHEMA_VERSION, Date.now(), `Schema v${MEMORY_SCHEMA_VERSION}: full init`);
      return;
    }
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
    if (currentVersion < 5) {
      const cols = this._getTableColumns("memory_nodes");
      if (!cols.includes("negative_examples")) {
        this.db.exec("ALTER TABLE memory_nodes ADD COLUMN negative_examples TEXT NOT NULL DEFAULT '[]'");
      }
    }
    if (currentVersion < 6) {
      const cols = this._getTableColumns("memory_nodes");
      if (!cols.includes("is_deprecated")) {
        this.db.exec("ALTER TABLE memory_nodes ADD COLUMN is_deprecated INTEGER NOT NULL DEFAULT 0");
      }
      if (!cols.includes("deprecated_at")) {
        this.db.exec("ALTER TABLE memory_nodes ADD COLUMN deprecated_at INTEGER");
      }
    }
    if (currentVersion < 7) {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_nodes_fts USING fts5(
          title, summary, body,
          content='memory_nodes',
          content_rowid='rowid'
        )
      `);
      this.db.exec("INSERT INTO memory_nodes_fts(memory_nodes_fts) VALUES('rebuild')");
    }
    if (currentVersion < 8) {
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_memory_nodes_scope ON memory_nodes(scope)");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_memory_nodes_node_type ON memory_nodes(node_type)");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_memory_nodes_is_deprecated ON memory_nodes(is_deprecated)");
    }
    if (currentVersion < 9) {
      this.db.exec("UPDATE memory_nodes SET node_type = node_type WHERE node_type = node_type");
    }
    if (currentVersion < 10) {
      this._runMigration(10, () => {
        const cols = this._getTableColumns("memory_nodes");
        if (!cols.includes("user_id")) {
          this.db.exec("ALTER TABLE memory_nodes ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'");
        }
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_memory_nodes_user_id ON memory_nodes(user_id)");
      });
    }
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
    if (currentVersion < 12) {
      this._runMigration(12, () => {
        const cols = this._getTableColumns("memory_nodes");
        if (!cols.includes("git_branch")) {
          this.db.exec("ALTER TABLE memory_nodes ADD COLUMN git_branch TEXT");
        }
        if (!cols.includes("project_dir")) {
          this.db.exec("ALTER TABLE memory_nodes ADD COLUMN project_dir TEXT");
        }
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
    this.db.prepare("INSERT OR IGNORE INTO memory_schema_versions (version, applied_at, description) VALUES (?, ?, ?)").run(MEMORY_SCHEMA_VERSION, Date.now(), `Schema v${MEMORY_SCHEMA_VERSION}: scope/tier_min/structure_template/FTS5/user_id`);
  }
  /** 获取表的列名列表 */
  _getTableColumns(table) {
    try {
      const rows = this.db.prepare(`PRAGMA table_info(${table})`).all();
      return rows.map((r) => r.name);
    } catch {
      return [];
    }
  }
  /** 执行单步迁移并记录版本 */
  _runMigration(version, fn) {
    fn();
    this.db.prepare("INSERT OR IGNORE INTO memory_schema_versions (version, applied_at, description) VALUES (?, ?, ?)").run(version, Date.now(), `Schema v${version}`);
  }
  // ===== Node Operations =====
  createNode(data) {
    const id = data.id ?? crypto.randomUUID();
    const now = Date.now();
    const contentHash = createHash("sha256").update(data.summary + data.body).digest("hex");
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
      newVals.push(data.agentId ?? "unknown", data.confidence ?? 0.6, data.verified ?? false ? 1 : 0, data.privacyFlag ?? 0);
    }
    if (data.gitBranch !== void 0) {
      newCols.push("git_branch");
      newVals.push(data.gitBranch);
    }
    if (data.projectDir !== void 0) {
      newCols.push("project_dir");
      newVals.push(data.projectDir);
    }
    const colStr = newCols.length > 0 ? `, ${newCols.join(", ")}` : "";
    const valStr = newVals.length > 0 ? `, ${newVals.map(() => "?").join(", ")}` : "";
    this.db.prepare(`
        INSERT INTO memory_nodes (id, title, summary, body, content_hash, importance, status, source, source_session, tags, node_type, created_at, updated_at, ttl_days${colStr})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${valStr})
      `).run(id, data.title, data.summary ?? "", data.body ?? "", contentHash, data.importance ?? 5, data.status ?? "active", data.source ?? "agent", data.sourceSession ?? null, JSON.stringify(data.tags ?? []), data.nodeType ?? "memory_entry", now, now, data.ttlDays ?? null, ...newVals);
    return {
      id,
      ...data,
      contentHash,
      createdAt: now,
      updatedAt: now,
      agentId: data.agentId ?? "unknown",
      confidence: data.confidence ?? 0.6,
      verified: data.verified ?? false,
      privacyFlag: data.privacyFlag ?? 0,
      gitBranch: data.gitBranch ?? null,
      projectDir: data.projectDir ?? null
    };
  }
  getNode(id) {
    const row = this.db.prepare("SELECT * FROM memory_nodes WHERE id = ?").get(id);
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
    if (data.title !== void 0) {
      updates.push("title = ?");
      params.push(data.title);
    }
    if (data.summary !== void 0) {
      updates.push("summary = ?");
      params.push(data.summary);
    }
    if (data.body !== void 0) {
      updates.push("body = ?");
      params.push(data.body);
    }
    if (data.importance !== void 0) {
      updates.push("importance = ?");
      params.push(data.importance);
    }
    if (data.status !== void 0) {
      updates.push("status = ?");
      params.push(data.status);
    }
    if (data.tags !== void 0) {
      updates.push("tags = ?");
      params.push(JSON.stringify(data.tags));
    }
    if (data.ttlDays !== void 0) {
      updates.push("ttl_days = ?");
      params.push(data.ttlDays);
    }
    if (data.scope !== void 0 && this._hasNewScope) {
      updates.push("scope = ?");
      params.push(data.scope);
    }
    if (data.tierMin !== void 0 && this._hasNewTierMin) {
      updates.push("tier_min = ?");
      params.push(data.tierMin);
    }
    if (data.negativeExamples !== void 0 && this._hasNewNegExamples) {
      updates.push("negative_examples = ?");
      params.push(JSON.stringify(data.negativeExamples));
    }
    if (data.isDeprecated !== void 0 && this._hasNewDeprecated) {
      updates.push("is_deprecated = ?");
      params.push(data.isDeprecated ? 1 : 0);
    }
    if (data.deprecatedAt !== void 0 && this._hasNewDeprecated) {
      updates.push("deprecated_at = ?");
      params.push(data.deprecatedAt);
    }
    if (data.userId !== void 0 && this._hasNewUserId) {
      updates.push("user_id = ?");
      params.push(data.userId);
    }
    if (data.agentId !== void 0 && this._hasNewTrust) {
      updates.push("agent_id = ?");
      params.push(data.agentId);
    }
    if (data.confidence !== void 0 && this._hasNewTrust) {
      updates.push("confidence = ?");
      params.push(data.confidence);
    }
    if (data.verified !== void 0 && this._hasNewTrust) {
      updates.push("verified = ?");
      params.push(data.verified ? 1 : 0);
    }
    if (data.privacyFlag !== void 0 && this._hasNewTrust) {
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
    const row = this.db.prepare("SELECT * FROM memory_nodes WHERE content_hash = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(hash);
    if (!row)
      return null;
    return this.rowToNode(row);
  }
  // ===== Edge Operations =====
  createEdge(data) {
    const now = Date.now();
    const result = this.db.prepare(`
        INSERT INTO memory_edges (source_type, source_id, target_type, target_id, relation, weight, description, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(data.sourceType, data.sourceId, data.targetType, data.targetId, data.relation, data.weight, data.description, now);
    return {
      id: Number(result.lastInsertRowid),
      ...data,
      createdAt: now
    };
  }
  getNodeEdges(nodeId) {
    const rows = this.db.prepare(`
        SELECT * FROM memory_edges
        WHERE source_id = ? OR target_id = ?
        ORDER BY created_at DESC
      `).all(nodeId, nodeId);
    return rows.map((r) => ({
      id: r.id,
      sourceType: r.source_type,
      sourceId: r.source_id,
      targetType: r.target_type,
      targetId: r.target_id,
      relation: r.relation,
      weight: r.weight,
      description: r.description,
      createdAt: r.created_at
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
      weight: 1,
      description: description ?? ""
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
      weight: weight ?? 1,
      description: description ?? ""
    });
  }
  /** Get memory entry with its code symbol associations */
  getMemoryWithCodeSymbols(memoryId) {
    const rows = this.db.prepare(`
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
      `).all(memoryId);
    return rows.map((r) => ({
      relation: r.relation,
      weight: r.weight,
      description: r.edge_description,
      symbol: {
        id: r.code_id,
        name: r.code_name,
        kind: r.code_kind,
        filePath: r.file_path,
        qualifiedName: r.qualified_name
      }
    }));
  }
  /** Get related memory entries (graph traversal, depth=1) */
  getRelatedMemories(memoryId, options) {
    const maxDepth = options?.depth ?? 1;
    const relationFilter = options?.relationTypes;
    const minWeight = options?.minWeight ?? 0;
    if (maxDepth < 1)
      return [];
    const rows = this.db.prepare(`
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
      `).all(memoryId, memoryId, memoryId, memoryId, ...relationFilter ?? [], minWeight);
    const results = [];
    for (const row of rows) {
      const direction = row.source_id === memoryId ? "outgoing" : "incoming";
      if (!results.some((r) => r.node.id === row.node_id)) {
        results.push({
          node: this.rowToNode(row),
          relation: row.relation,
          weight: row.weight,
          direction
        });
      }
    }
    return results;
  }
  /** Full-text search via FTS5 (v7+) */
  searchByFTS(query, limit = 20) {
    try {
      const rows = this.db.prepare(`
          SELECT mn.* FROM memory_nodes mn
          JOIN memory_nodes_fts fts ON mn.rowid = fts.rowid
          WHERE memory_nodes_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(query, limit);
      return rows.map((r) => this.rowToNode(r));
    } catch {
      return this.searchByText(query, limit);
    }
  }
  /** Full-text search across memory titles and summaries (LIKE fallback) */
  searchByText(query, limit = 20) {
    const like = `%${query}%`;
    const rows = this.db.prepare(`
        SELECT * FROM memory_nodes
        WHERE status = 'active'
          AND (title LIKE ? OR summary LIKE ? OR body LIKE ?)
        ORDER BY importance DESC, created_at DESC
        LIMIT ?
      `).all(like, like, like, limit);
    return rows.map((r) => this.rowToNode(r));
  }
  /** Search by tags */
  searchByTag(tag, limit = 20) {
    const rows = this.db.prepare(`
        SELECT * FROM memory_nodes
        WHERE status = 'active'
          AND tags LIKE ?
        ORDER BY importance DESC, created_at DESC
        LIMIT ?
      `).all(`%"${tag}"%`, limit);
    return rows.map((r) => this.rowToNode(r));
  }
  /** Get nodes by scope */
  getNodesByScope(scope, limit = 50) {
    const rows = this.db.prepare(`
        SELECT * FROM memory_nodes
        WHERE scope = ? AND status = 'active'
        ORDER BY importance DESC, created_at DESC
        LIMIT ?
      `).all(scope, limit);
    return rows.map((r) => this.rowToNode(r));
  }
  /** Get nodes by user_id（多租户查询） */
  getNodesByUserId(userId, limit = 50) {
    const rows = this.db.prepare(`
        SELECT * FROM memory_nodes
        WHERE user_id = ? AND status = 'active'
        ORDER BY importance DESC, created_at DESC
        LIMIT ?
      `).all(userId, limit);
    return rows.map((r) => this.rowToNode(r));
  }
  /** Get recent memories by time range */
  getRecentMemories(hours = 24, limit = 50) {
    const cutoff = Date.now() - hours * 60 * 60 * 1e3;
    const rows = this.db.prepare(`
        SELECT * FROM memory_nodes
        WHERE created_at >= ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(cutoff, limit);
    return rows.map((r) => this.rowToNode(r));
  }
  /** Get statistics */
  getStats() {
    const totalNodes = this.db.prepare("SELECT COUNT(*) as count FROM memory_nodes").get().count;
    const totalEdges = this.db.prepare("SELECT COUNT(*) as count FROM memory_edges").get().count;
    const codeLinked = this.db.prepare("SELECT COUNT(*) as count FROM memory_edges WHERE relation = 'links_to_code'").get().count;
    const byStatusRows = this.db.prepare("SELECT status, COUNT(*) as count FROM memory_nodes GROUP BY status").all();
    const byTypeRows = this.db.prepare("SELECT node_type, COUNT(*) as count FROM memory_nodes GROUP BY node_type").all();
    const byScopeRows = this.db.prepare("SELECT scope, COUNT(*) as count FROM memory_nodes GROUP BY scope").all();
    return {
      totalNodes,
      totalEdges,
      codeLinked,
      byStatus: Object.fromEntries(byStatusRows.map((r) => [r.status, r.count])),
      byType: Object.fromEntries(byTypeRows.map((r) => [r.node_type, r.count])),
      byScope: Object.fromEntries(byScopeRows.map((r) => [r.scope, r.count]))
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
    if (data.title !== void 0) {
      updates.push("title = ?");
      params.push(data.title);
    }
    if (data.description !== void 0) {
      updates.push("description = ?");
      params.push(data.description);
    }
    if (data.track !== void 0) {
      updates.push("track = ?");
      params.push(data.track);
    }
    if (data.priority !== void 0) {
      updates.push("priority = ?");
      params.push(data.priority);
    }
    if (data.status !== void 0) {
      updates.push("status = ?");
      params.push(data.status);
    }
    if (data.dueDate !== void 0) {
      updates.push("due_date = ?");
      params.push(data.dueDate);
    }
    if (data.projectDir !== void 0) {
      updates.push("project_dir = ?");
      params.push(data.projectDir);
    }
    if (data.tags !== void 0) {
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
    return this.db.prepare(`SELECT * FROM todo_items ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit);
  }
  getOverdueTodoItems(userId) {
    const now = Date.now();
    if (userId) {
      return this.db.prepare("SELECT * FROM todo_items WHERE status NOT IN ('completed','cancelled','archived') AND due_date IS NOT NULL AND due_date < ? AND user_id = ? ORDER BY due_date ASC").all(now, userId);
    }
    return this.db.prepare("SELECT * FROM todo_items WHERE status NOT IN ('completed','cancelled','archived') AND due_date IS NOT NULL AND due_date < ? ORDER BY due_date ASC").all(now);
  }
  getDailyTodoSummary(userId) {
    const todayStart = /* @__PURE__ */ new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = todayStart.getTime() + 864e5;
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
  getPromptTemplateByName(name2) {
    return this.db.prepare("SELECT * FROM prompt_templates WHERE name = ?").get(name2);
  }
  updatePromptTemplate(id, data) {
    const existing = this.getPromptTemplate(id);
    if (!existing)
      return false;
    const now = Date.now();
    const updates = ["updated_at = ?"];
    const params = [now];
    if (data.name !== void 0) {
      updates.push("name = ?");
      params.push(data.name);
    }
    if (data.category !== void 0) {
      updates.push("category = ?");
      params.push(data.category);
    }
    if (data.content !== void 0) {
      updates.push("content = ?");
      params.push(data.content);
    }
    if (data.description !== void 0) {
      updates.push("description = ?");
      params.push(data.description);
    }
    if (data.tags !== void 0) {
      updates.push("tags = ?");
      params.push(JSON.stringify(data.tags));
    }
    if (data.version !== void 0) {
      updates.push("version = ?");
      params.push(data.version);
    }
    if (data.enabled !== void 0) {
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
    if (filter?.enabled !== void 0) {
      conditions.push("enabled = ?");
      params.push(filter.enabled ? 1 : 0);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ?? 50;
    return this.db.prepare(`SELECT * FROM prompt_templates ${where} ORDER BY category, name LIMIT ?`).all(...params, limit);
  }
  searchPromptTemplates(query, limit = 20) {
    const like = `%${query}%`;
    return this.db.prepare("SELECT * FROM prompt_templates WHERE name LIKE ? OR description LIKE ? OR tags LIKE ? ORDER BY name LIMIT ?").all(like, like, like, limit);
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
      return this.db.prepare("SELECT * FROM session_bookmarks WHERE session_id = ? AND user_id = ? ORDER BY round_index ASC").all(sessionId, userId);
    }
    return this.db.prepare("SELECT * FROM session_bookmarks WHERE session_id = ? ORDER BY round_index ASC").all(sessionId);
  }
  deleteSessionBookmark(id) {
    return this.db.prepare("DELETE FROM session_bookmarks WHERE id = ?").run(id).changes > 0;
  }
  searchSessionBookmarks(query, userId, limit = 20) {
    const like = `%${query}%`;
    if (userId) {
      return this.db.prepare("SELECT * FROM session_bookmarks WHERE (title LIKE ? OR summary LIKE ? OR tags LIKE ?) AND user_id = ? ORDER BY created_at DESC LIMIT ?").all(like, like, like, userId, limit);
    }
    return this.db.prepare("SELECT * FROM session_bookmarks WHERE title LIKE ? OR summary LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT ?").all(like, like, like, limit);
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
    if (data.name !== void 0) {
      updates.push("name = ?");
      params.push(data.name);
    }
    if (data.configJson !== void 0) {
      updates.push("config_json = ?");
      params.push(JSON.stringify(data.configJson));
    }
    if (data.enabled !== void 0) {
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
    const expired = this.db.prepare("SELECT id FROM memory_nodes WHERE ttl_days IS NOT NULL AND (created_at + ttl_days * 86400000) < ?").all(now);
    const lowImp = this.db.prepare(`
        SELECT mn.id FROM memory_nodes mn
        WHERE mn.importance < 3 AND mn.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM memory_edges me WHERE me.source_id = mn.id OR me.target_id = mn.id)
      `).all();
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
    const rows = this.db.prepare("SELECT * FROM memory_nodes").all();
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
        } catch {
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
        } catch {
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
      projectDir: row.project_dir ?? null
    };
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-graph/src/obsidian-writer.js
import * as fs2 from "node:fs";
import * as path2 from "node:path";
var DEFAULT_CONFIG = {
  vaultPath: "",
  subDir: "",
  includeSummary: true,
  includeBody: true
};
var ObsidianWriter = class {
  config;
  constructor(config) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  /** 获取笔记目录路径 */
  getNotesDir() {
    return this.config.subDir ? path2.join(this.config.vaultPath, this.config.subDir) : this.config.vaultPath;
  }
  /** 根据 memory node 生成文件名 */
  getFilename(node) {
    const safeTitle = node.title.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60);
    return `memory-${node.id.slice(0, 12)}-${safeTitle}.md`;
  }
  /** 将 MemoryNode 写入 Obsidian */
  write(node) {
    const notesDir = this.getNotesDir();
    if (!fs2.existsSync(notesDir)) {
      fs2.mkdirSync(notesDir, { recursive: true });
    }
    this.delete(node.id);
    const filename = this.getFilename(node);
    const filePath = path2.join(notesDir, filename);
    const frontmatter = {
      title: node.title,
      importance: node.importance,
      tags: node.tags,
      source: node.source,
      sourceSession: node.sourceSession,
      nodeType: node.nodeType,
      nodeId: node.id,
      createdAt: new Date(node.createdAt).toISOString(),
      updatedAt: new Date(node.updatedAt).toISOString()
    };
    if (this.config.includeSummary && node.summary) {
      frontmatter.description = node.summary;
    }
    const lines = [];
    lines.push("---");
    lines.push(`title: "${frontmatter.title}"`);
    lines.push(`importance: ${frontmatter.importance}`);
    lines.push(`tags: [${frontmatter.tags.map((t) => `"${t}"`).join(", ")}]`);
    lines.push(`source: ${frontmatter.source}`);
    if (frontmatter.sourceSession)
      lines.push(`source_session: ${frontmatter.sourceSession}`);
    lines.push(`node_type: ${frontmatter.nodeType}`);
    lines.push(`node_id: "${frontmatter.nodeId}"`);
    lines.push(`created_at: ${frontmatter.createdAt}`);
    lines.push(`updated_at: ${frontmatter.updatedAt}`);
    if (frontmatter.description) {
      const desc = frontmatter.description.length > 80 ? frontmatter.description.slice(0, 77) + "..." : frontmatter.description;
      lines.push(`description: "${desc}"`);
    }
    lines.push("---");
    lines.push("");
    lines.push(`# ${node.title}`);
    lines.push("");
    if (this.config.includeSummary && node.summary) {
      lines.push(node.summary);
      lines.push("");
    }
    if (this.config.includeBody && node.body) {
      lines.push(node.body);
      lines.push("");
    }
    lines.push("---");
    lines.push("");
    lines.push(`_One Memory ID: \`${node.id}\`_`);
    lines.push(`_Importance: ${node.importance}/10_`);
    if (node.ttlDays) {
      lines.push(`_TTL: ${node.ttlDays} days_`);
    }
    const content = lines.join("\n");
    fs2.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }
  /** 删除 Obsidian 中的对应笔记（删除所有匹配 nodeId 的文件） */
  delete(nodeId) {
    const notesDir = this.getNotesDir();
    if (!fs2.existsSync(notesDir))
      return false;
    const files = fs2.readdirSync(notesDir);
    const prefix = nodeId.slice(0, 12);
    const matches = files.filter((f) => f.includes(prefix));
    if (matches.length === 0)
      return false;
    for (const match of matches) {
      fs2.unlinkSync(path2.join(notesDir, match));
    }
    return true;
  }
  /** 列出 Obsidian 中的笔记（用于一致性校验） */
  list() {
    const notesDir = this.getNotesDir();
    if (!fs2.existsSync(notesDir))
      return [];
    return fs2.readdirSync(notesDir).filter((f) => f.startsWith("memory-") && f.endsWith(".md")).map((f) => {
      const filePath = path2.join(notesDir, f);
      try {
        const content = fs2.readFileSync(filePath, "utf-8");
        const matchId = content.match(/node_id:\s*"([^"]+)"/);
        return {
          filename: f,
          nodeId: matchId ? matchId[1] : null
        };
      } catch {
        return { filename: f, nodeId: null };
      }
    });
  }
  /** 获取笔记总数 */
  count() {
    return this.list().length;
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-vector/src/vector-store.js
import * as fs3 from "node:fs";
import * as path3 from "node:path";
import { createRequire as createRequire2 } from "node:module";
var _require2 = createRequire2(import.meta.url);
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
var SqliteVectorStore = class _SqliteVectorStore {
  db;
  dbPath;
  _dimension = 0;
  constructor(db, dbPath) {
    this.db = db;
    this.dbPath = dbPath;
  }
  /** Open existing or create new vector store at dbPath */
  static open(dbPath) {
    const { DatabaseSync } = _require2("node:sqlite");
    const dir = path3.dirname(dbPath);
    if (!fs3.existsSync(dir))
      fs3.mkdirSync(dir, { recursive: true });
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
    const store = new _SqliteVectorStore(raw, dbPath);
    return store;
  }
  /** Total number of stored vectors */
  get totalEntries() {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM vectors").get();
    return row.c;
  }
  /** Vector dimension (detected from first entry) */
  get dimension() {
    if (this._dimension > 0)
      return this._dimension;
    const row = this.db.prepare("SELECT vector FROM vectors LIMIT 1").get();
    if (row) {
      this._dimension = row.vector.byteLength / 4;
    }
    return this._dimension;
  }
  // ===== Write =====
  upsert(id, vector, metadata) {
    this.db.prepare(`
        INSERT INTO vectors (id, vector, metadata_json, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          vector = excluded.vector,
          metadata_json = excluded.metadata_json
      `).run(id, Buffer.from(vector.buffer), JSON.stringify(metadata), Date.now());
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
    const conditions = [];
    const params = [];
    if (options.filter) {
      const f = options.filter;
      if (f.importanceMin !== void 0) {
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
    const rows = this.db.prepare(`SELECT id, vector, metadata_json FROM vectors ${where}`).all(...params);
    const scored = [];
    for (const row of rows) {
      const buf = row.vector;
      const storedVector = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      const score = cosineSimilarity(queryVector, storedVector);
      if (score < threshold)
        continue;
      scored.push({
        id: row.id,
        score,
        metadata: JSON.parse(row.metadata_json)
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
  // ===== Maintenance =====
  stats() {
    const count = this.db.prepare("SELECT COUNT(*) as c FROM vectors").get().c;
    return {
      totalEntries: count,
      dimension: this.dimension,
      memoryUsageBytes: count * this.dimension * 4
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
    const cutoff = Date.now() - daysOld * 864e5;
    const rows = this.db.prepare(`
        SELECT id FROM vectors
        WHERE json_extract(metadata_json, '$.tier') IS NULL
          AND json_extract(metadata_json, '$.createdAt') < ?
          AND json_extract(metadata_json, '$.importance') < ?
      `).all(cutoff, importanceThreshold);
    const ids = rows.map((r) => r.id);
    if (ids.length === 0)
      return { movedToCold: 0 };
    return { movedToCold: this.moveToCold(ids) };
  }
  /** Delete all cold entries */
  purgeCold() {
    const result = this.db.prepare(`DELETE FROM vectors WHERE json_extract(metadata_json, '$.tier') = 'cold'`).run();
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
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-vector/src/embedder.js
import { createHash as createHash2 } from "node:crypto";
var embedCache = /* @__PURE__ */ new Map();
var CACHE_MAX = 1e3;
function cachedEmbed(embedder, text) {
  const key = createHash2("sha256").update(text).digest("hex");
  const cached = embedCache.get(key);
  if (cached)
    return Promise.resolve(cached);
  return embedder.embed(text).then((vec) => {
    if (embedCache.size < CACHE_MAX) {
      embedCache.set(key, vec);
    }
    return vec;
  });
}
var LocalEmbedder = class {
  dimension = 384;
  modelName = "Xenova/all-MiniLM-L6-v2";
  pipeline = null;
  initializing = null;
  async init() {
    if (this.pipeline)
      return;
    if (this.initializing)
      return this.initializing;
    this.initializing = (async () => {
      try {
        const { pipeline } = await import("@xenova/transformers");
        this.pipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
          quantized: true
        });
      } catch (err) {
        throw new Error(`Failed to load embedding model. Run: npm install @xenova/transformers
Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    await this.initializing;
  }
  async embed(text) {
    await this.init();
    const result = await this.pipeline(text, { pooling: "mean", normalize: true });
    return new Float32Array(result.data);
  }
  async embedBatch(texts) {
    await this.init();
    return Promise.all(texts.map((t) => cachedEmbed(this, t)));
  }
};
var ApiEmbedder = class {
  modelName;
  dimension;
  apiKey;
  baseUrl;
  model;
  // Circuit breaker state
  consecutiveFailures = 0;
  circuitOpen = false;
  circuitOpenedAt = 0;
  failureThreshold = 3;
  resetTimeoutMs = 3e4;
  constructor(options) {
    this.modelName = options.model ?? "text-embedding-3-small";
    this.dimension = options.dimension ?? 512;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
    this.model = this.modelName;
  }
  checkCircuit() {
    if (this.circuitOpen) {
      if (Date.now() - this.circuitOpenedAt >= this.resetTimeoutMs) {
        this.circuitOpen = false;
        this.consecutiveFailures = 0;
      } else {
        throw new Error(`Embedding API circuit breaker open (${this.consecutiveFailures} consecutive failures). Retry in ${Math.ceil((this.resetTimeoutMs - (Date.now() - this.circuitOpenedAt)) / 1e3)}s.`);
      }
    }
  }
  recordFailure() {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.circuitOpen = true;
      this.circuitOpenedAt = Date.now();
    }
  }
  recordSuccess() {
    this.consecutiveFailures = 0;
  }
  async embed(text) {
    const res = await this.embedBatch([text]);
    return res[0];
  }
  async embedBatch(texts) {
    this.checkCircuit();
    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          input: texts,
          model: this.model
        })
      });
      if (!response.ok) {
        this.recordFailure();
        throw new Error(`Embedding API error: ${response.status} ${await response.text()}`);
      }
      const data = await response.json();
      this.recordSuccess();
      return data.data.map((d) => new Float32Array(d.embedding));
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("circuit breaker"))) {
        this.recordFailure();
      }
      throw err;
    }
  }
};
var SimpleEmbedder = class {
  dimension = 128;
  modelName = "simple-local";
  projection;
  // 固定随机投影矩阵
  ngramSize = 3;
  hashSize = 256;
  constructor(seed = 42) {
    this.projection = this.seededRandom(seed, this.hashSize * this.dimension);
  }
  async embed(text) {
    const vec = new Float32Array(this.dimension);
    const features = new Float32Array(this.hashSize);
    const normalized = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
    if (!normalized)
      return vec;
    const grams = /* @__PURE__ */ new Set();
    for (let i = 0; i <= normalized.length - this.ngramSize; i++) {
      grams.add(normalized.slice(i, i + this.ngramSize));
    }
    for (const gram of grams) {
      let hash = 0;
      for (let i = 0; i < gram.length; i++) {
        hash = (hash << 5) - hash + gram.charCodeAt(i);
        hash |= 0;
      }
      const idx = Math.abs(hash) % this.hashSize;
      features[idx] += 1;
    }
    for (let i = 0; i < this.hashSize; i++) {
      if (features[i] === 0)
        continue;
      const val = Math.sqrt(features[i]);
      for (let j = 0; j < this.dimension; j++) {
        vec[j] += val * this.projection[i * this.dimension + j];
      }
    }
    let norm = 0;
    for (let i = 0; i < this.dimension; i++)
      norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++)
        vec[i] /= norm;
    }
    return vec;
  }
  async embedBatch(texts) {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
  /** 确定性伪随机数生成器 (Mulberry32) */
  seededRandom(seed, count) {
    const arr = new Float32Array(count);
    let s = seed | 0;
    for (let i = 0; i < count; i++) {
      s |= 0;
      s = s + 1831565813 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      arr[i] = ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    return arr;
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-vector/src/query-optimizer.js
var NoopQueryOptimizer = class {
  modelName = "noop";
  async optimize(query) {
    return query;
  }
};
var LLMQueryOptimizer = class {
  modelName;
  config;
  constructor(config) {
    this.modelName = config.model ?? "gpt-4o-mini";
    this.config = {
      baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
      apiKey: config.apiKey,
      model: config.model ?? "gpt-4o-mini",
      temperature: config.temperature ?? 0,
      maxTokens: config.maxTokens ?? 256,
      systemPrompt: config.systemPrompt ?? DEFAULT_OPTIMIZER_PROMPT
    };
  }
  async optimize(query) {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: "system", content: this.config.systemPrompt },
          { role: "user", content: query }
        ],
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Query optimizer API error: ${response.status} ${errText}`);
    }
    const data = await response.json();
    const optimized = data.choices?.[0]?.message?.content?.trim();
    if (!optimized) {
      return query;
    }
    return optimized;
  }
};
var DEFAULT_OPTIMIZER_PROMPT = `\u4F60\u662F\u4E00\u4E2A\u641C\u7D22\u67E5\u8BE2\u4F18\u5316\u4E13\u5BB6\u3002\u4F60\u7684\u4EFB\u52A1\u662F\u5C06\u7528\u6237\u7684\u95EE\u9898\u6539\u5199\u4E3A\u66F4\u9002\u5408\u8BED\u4E49\u641C\u7D22\u548C\u5411\u91CF\u68C0\u7D22\u7684\u67E5\u8BE2\u8BED\u53E5\u3002

\u89C4\u5219\uFF1A
1. \u63D0\u53D6\u6838\u5FC3\u6982\u5FF5\uFF0C\u4F7F\u7528\u4E13\u4E1A\u672F\u8BED\u548C\u540C\u4E49\u8BCD\u6269\u5C55
2. \u79FB\u9664\u53E3\u8BED\u5316\u8868\u8FBE\u3001\u8BED\u6C14\u8BCD\u3001\u65E0\u5173\u4FEE\u9970
3. \u4FDD\u6301\u7B80\u6D01\uFF0C1-2\u53E5\u8BDD\u5373\u53EF
4. \u4FDD\u7559\u5173\u952E\u5B9E\u4F53\u540D\u79F0\uFF08\u4EBA\u540D\u3001\u4EA7\u54C1\u540D\u3001\u6280\u672F\u672F\u8BED\uFF09
5. \u5982\u679C\u7528\u6237\u95EE\u9898\u5DF2\u7ECF\u8DB3\u591F\u6E05\u6670\uFF0C\u76F4\u63A5\u8FD4\u56DE\u539F\u95EE\u9898
6. \u53EA\u8F93\u51FA\u4F18\u5316\u540E\u7684\u67E5\u8BE2\uFF0C\u4E0D\u8981\u89E3\u91CA

\u793A\u4F8B\uFF1A
\u7528\u6237\uFF1A\u5E2E\u6211\u770B\u770B\u652F\u4ED8\u6A21\u5757\u6700\u8FD1\u6709\u4EC0\u4E48\u95EE\u9898
\u4F18\u5316\uFF1A\u652F\u4ED8\u6A21\u5757 \u6545\u969C \u5F02\u5E38 \u9519\u8BEF \u95EE\u9898\u6392\u67E5

\u7528\u6237\uFF1A\u90A3\u4E2A\u7194\u65AD\u5668\u7684\u9608\u503C\u662F\u591A\u5C11\u6765\u7740
\u4F18\u5316\uFF1A\u7194\u65AD\u5668 \u9608\u503C \u914D\u7F6E \u53C2\u6570 \u7194\u65AD\u9608\u503C

\u7528\u6237\uFF1A\u600E\u4E48\u63D0\u9AD8\u8BB0\u5FC6\u7CFB\u7EDF\u7684\u641C\u7D22\u51C6\u786E\u7387
\u4F18\u5316\uFF1A\u8BB0\u5FC6\u7CFB\u7EDF \u641C\u7D22 \u53EC\u56DE\u7387 \u51C6\u786E\u7387 \u8BED\u4E49\u68C0\u7D22 \u4F18\u5316

\u7528\u6237\uFF1A${"{"}original_query}
\u4F18\u5316\uFF1A`;

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-vector/src/reranker.js
var NoopReranker = class {
  modelName = "noop";
  async rerank(_query, candidates) {
    return candidates.map((c) => ({
      id: c.id,
      score: c.originalScore,
      originalScore: c.originalScore,
      metadata: c.metadata
    }));
  }
};
var EmbeddingReranker = class {
  modelName;
  embedder;
  config;
  constructor(embedder, config = {}) {
    this.embedder = embedder;
    this.modelName = `embedding-reranker(${embedder.modelName})`;
    this.config = {
      candidateK: config.candidateK ?? 20,
      topK: config.topK ?? 5,
      rerankWeight: config.rerankWeight ?? 0.7
    };
  }
  async rerank(query, candidates) {
    if (candidates.length === 0)
      return [];
    const sorted = [...candidates].sort((a, b) => b.originalScore - a.originalScore);
    const topCandidates = sorted.slice(0, this.config.candidateK);
    const texts = [query, ...topCandidates.map((c) => c.content)];
    const vectors = await this.embedder.embedBatch(texts);
    const queryVec = vectors[0];
    const candidateVecs = vectors.slice(1);
    const maxOrig = Math.max(...topCandidates.map((c) => c.originalScore), 1e-3);
    const scored = topCandidates.map((c, i) => {
      const simScore = this.cosineSimilarity(queryVec, candidateVecs[i]);
      const normOrig = c.originalScore / maxOrig;
      const combined = this.config.rerankWeight * simScore + (1 - this.config.rerankWeight) * normOrig;
      return {
        id: c.id,
        score: combined,
        originalScore: c.originalScore,
        metadata: c.metadata
      };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.config.topK);
  }
  cosineSimilarity(a, b) {
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
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-orchestrator/src/session-compressor.js
var DEFAULT_COMPRESSOR_CONFIG = {
  minTokensForSummary: 5e3,
  maxSummaryLength: 500,
  recentSummariesCount: 3,
  summaryTtlDays: 30,
  enabled: true
};
var SessionCompressor = class {
  config;
  memoryDb;
  vectorStore;
  embedder;
  constructor(memoryDb, vectorStore, embedder, config = {}) {
    this.memoryDb = memoryDb;
    this.vectorStore = vectorStore;
    this.embedder = embedder;
    this.config = { ...DEFAULT_COMPRESSOR_CONFIG, ...config };
  }
  // ===== Public API =====
  /**
   * 压缩一次会话，生成摘要记忆节点。
   *
   * @param sessionId 会话 ID
   * @param messages 会话消息列表（原始文本）
   * @param sessionStart 会话开始时间戳
   * @param options 可选参数
   * @returns CompressedSession | null（如果 token 数不足则返回 null）
   */
  async compress(sessionId, messages, sessionStart, options) {
    if (!this.config.enabled)
      return null;
    const fullText = messages.join("\n");
    const tokenEstimate = options?.tokenCount ?? this._estimateTokens(fullText);
    if (tokenEstimate < this.config.minTokensForSummary) {
      return null;
    }
    const sessionEnd = Date.now();
    const summary = this._extractSummary(fullText, messages, options);
    const node = this.memoryDb.createNode({
      title: summary.title,
      summary: summary.summary,
      body: this._renderBody(summary, sessionId, sessionStart, sessionEnd, tokenEstimate),
      importance: summary.importance,
      status: "active",
      source: "system",
      sourceSession: sessionId,
      tags: summary.tags,
      nodeType: "session_summary",
      ttlDays: this.config.summaryTtlDays,
      scope: "public",
      tierMin: 1,
      userId: options?.userId ?? "default",
      negativeExamples: [],
      isDeprecated: false,
      deprecatedAt: null
    });
    try {
      const vector = await this.embedder.embed(summary.summary);
      this.vectorStore.upsert(node.id, vector, {
        nodeId: node.id,
        type: "session_summary",
        title: summary.title,
        summary: summary.summary,
        importance: summary.importance,
        createdAt: node.createdAt,
        source: "system",
        tags: summary.tags
      });
    } catch {
    }
    for (const refId of summary.referencedMemoryIds) {
      try {
        this.memoryDb.createEdge({
          sourceType: "memory",
          sourceId: node.id,
          targetType: "memory",
          targetId: refId,
          relation: "summarizes",
          weight: 0.7,
          description: `Session ${sessionId} referenced this memory`
        });
      } catch {
      }
    }
    for (const refId of summary.referencedCodeSymbolIds) {
      try {
        this.memoryDb.createEdge({
          sourceType: "memory",
          sourceId: node.id,
          targetType: "code",
          targetId: refId,
          relation: "links_to_code",
          weight: 0.5,
          description: `Session ${sessionId} referenced this code symbol`
        });
      } catch {
      }
    }
    return {
      sessionId,
      sessionStart,
      sessionEnd,
      tokenCount: tokenEstimate,
      summary,
      memoryNodeId: node.id
    };
  }
  /**
   * 获取最近 N 条会话摘要，用于跨会话上下文注入。
   *
   * @param count 返回数量（默认 config.recentSummariesCount）
   * @param userId 用户 ID 过滤（可选）
   * @returns 摘要列表（按时间降序）
   */
  getRecentSummaries(count, userId) {
    const limit = count ?? this.config.recentSummariesCount;
    const rows = this.memoryDb.getRawDb().prepare(`
        SELECT title, summary, body, tags, importance, created_at
        FROM memory_nodes
        WHERE node_type = 'session_summary'
          AND status = 'active'
          AND user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(userId ?? "default", limit);
    return rows.map((r) => this._parseBody(r.body, {
      title: r.title,
      summary: r.summary,
      importance: r.importance,
      tags: JSON.parse(r.tags)
    }));
  }
  /**
   * 格式化会话摘要为上下文注入文本。
   */
  formatForContext(summaries) {
    if (summaries.length === 0)
      return "";
    const lines = ["## \u8FD1\u671F\u4F1A\u8BDD\u6458\u8981", ""];
    for (const s of summaries) {
      lines.push(`### ${s.title}`);
      lines.push(s.summary);
      if (s.keyDecisions.length > 0) {
        lines.push("");
        lines.push("\u5173\u952E\u51B3\u7B56\uFF1A");
        for (const d of s.keyDecisions) {
          lines.push(`- ${d.decision}\uFF08\u7F6E\u4FE1\u5EA6: ${(d.confidence * 100).toFixed(0)}%\uFF09`);
        }
      }
      if (s.unresolvedItems.length > 0) {
        lines.push("");
        lines.push("\u672A\u5B8C\u6210\u4E8B\u9879\uFF1A");
        for (const item of s.unresolvedItems) {
          lines.push(`- ${item}`);
        }
      }
      lines.push("");
    }
    return lines.join("\n");
  }
  // ===== Private: 摘要提取 =====
  _extractSummary(fullText, messages, options) {
    const title = this._generateTitle(fullText, messages);
    const keyDecisions = this._extractDecisions(messages);
    const unresolvedItems = this._extractUnresolved(messages);
    const summary = this._generateSummary(fullText, messages);
    const tags = this._extractTags(fullText);
    const importance = this._evaluateImportance(messages.length, keyDecisions.length, fullText);
    return {
      title,
      summary,
      keyDecisions,
      unresolvedItems,
      tags,
      importance,
      referencedMemoryIds: options?.referencedMemoryIds ?? [],
      referencedCodeSymbolIds: options?.referencedCodeSymbolIds ?? []
    };
  }
  _generateTitle(fullText, messages) {
    for (const msg of messages) {
      const trimmed = msg.trim();
      if (trimmed.length > 10) {
        const firstLine = trimmed.split("\n")[0].trim();
        return firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;
      }
    }
    return "\u4F1A\u8BDD\u6458\u8981";
  }
  _extractDecisions(messages) {
    const decisions = [];
    const cnPatterns = [/决定[：:]\s*(.+)/, /选择[：:]\s*(.+)/, /采用[：:]\s*(.+)/, /使用[：:]\s*(.+)/];
    const enPatterns = [/decid(?:e|ed)[\s:]+(.+)/i, /choose[\s:]+(.+)/i, /select[\s:]+(.+)/i, /use[\s:]+(.+)/i];
    for (const msg of messages) {
      for (const pattern of [...cnPatterns, ...enPatterns]) {
        const match = msg.match(pattern);
        if (match) {
          const decision = match[1].trim().slice(0, 100);
          if (!decisions.some((d) => d.decision === decision)) {
            decisions.push({ decision, reason: "\u4ECE\u5BF9\u8BDD\u4E2D\u63D0\u53D6", confidence: 0.6 });
          }
        }
      }
    }
    return decisions;
  }
  _extractUnresolved(messages) {
    const items = [];
    const cnPatterns = [/TODO[：:]\s*(.+)/, /待办[：:]\s*(.+)/, /下次[：:]\s*(.+)/, /还需要[：:]\s*(.+)/, /尚未[：:]\s*(.+)/];
    const enPatterns = [/TODO[\s:]+(.+)/i, /next[\s:]+(.+)/i, /remaining[\s:]+(.+)/i, /still need[\s:]+(.+)/i];
    for (const msg of messages) {
      for (const pattern of [...cnPatterns, ...enPatterns]) {
        const match = msg.match(pattern);
        if (match) {
          const item = match[1].trim().slice(0, 100);
          if (!items.includes(item)) {
            items.push(item);
          }
        }
      }
    }
    return items;
  }
  _generateSummary(fullText, messages) {
    const total = messages.length;
    if (total === 0)
      return "";
    const headCount = Math.max(1, Math.ceil(total * 0.1));
    const tailCount = Math.max(1, Math.ceil(total * 0.1));
    const headParts = [];
    const tailParts = [];
    for (let i = 0; i < headCount && i < total; i++) {
      const line = messages[i].trim().split("\n")[0];
      if (line.length > 10)
        headParts.push(line.slice(0, 100));
    }
    for (let i = Math.max(0, total - tailCount); i < total; i++) {
      const line = messages[i].trim().split("\n")[0];
      if (line.length > 10)
        tailParts.push(line.slice(0, 100));
    }
    const topWords = this._extractTopKeywords(fullText, 5);
    let summary = `\u5BF9\u8BDD\u4E3B\u9898\uFF1A${headParts[0] ?? "\u672A\u8BC6\u522B"}`;
    if (tailParts.length > 0) {
      summary += `\u3002\u7ED3\u8BBA\uFF1A${tailParts[tailParts.length - 1]}`;
    }
    if (topWords.length > 0) {
      summary += `\u3002\u5173\u952E\u8BCD\uFF1A${topWords.join("\u3001")}`;
    }
    return summary.slice(0, this.config.maxSummaryLength);
  }
  _extractTags(fullText) {
    const stopWords = /* @__PURE__ */ new Set([
      "the",
      "this",
      "that",
      "and",
      "for",
      "with",
      "from",
      "were",
      "have",
      "been",
      "will",
      "would",
      "could",
      "should",
      "about",
      "which",
      "their",
      "there",
      "what",
      "when",
      "where",
      "how",
      "\u7684",
      "\u4E86",
      "\u5728",
      "\u662F",
      "\u6211",
      "\u6709",
      "\u548C",
      "\u5C31",
      "\u4E0D",
      "\u4EBA",
      "\u90FD",
      "\u4E00",
      "\u4E00\u4E2A",
      "\u4E0A",
      "\u4E5F",
      "\u5F88",
      "\u5230",
      "\u8BF4",
      "\u8981",
      "\u53BB",
      "\u4F60",
      "\u4F1A",
      "\u7740",
      "\u6CA1\u6709",
      "\u770B",
      "\u597D",
      "\u81EA\u5DF1",
      "\u8FD9",
      "\u4ED6",
      "\u5979"
    ]);
    const wordCounts = /* @__PURE__ */ new Map();
    const enWords = fullText.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    const cnChars = fullText.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
    for (const word of [...enWords, ...cnChars]) {
      if (!stopWords.has(word)) {
        wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
      }
    }
    return [...wordCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word]) => word);
  }
  _extractTopKeywords(fullText, count) {
    const tags = this._extractTags(fullText);
    return tags.slice(0, count);
  }
  _evaluateImportance(msgCount, decisionCount, fullText) {
    let score = 3;
    if (msgCount > 50)
      score = 7;
    else if (msgCount > 30)
      score = 6;
    else if (msgCount > 20)
      score = 5;
    else if (msgCount > 10)
      score = 4;
    score += Math.min(decisionCount, 2);
    if (/工具|tool|function|代码|code|api|API|修复|fix|bug/i.test(fullText)) {
      score = Math.min(score + 1, 10);
    }
    if (/error|Error|错误|异常|失败|失败|报错/i.test(fullText)) {
      score = Math.min(score + 1, 10);
    }
    return Math.max(1, Math.min(10, score));
  }
  // ===== Private: 辅助方法 =====
  _estimateTokens(text) {
    const cnChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const enChars = text.length - cnChars;
    return Math.ceil(cnChars / 1.5 + enChars / 4);
  }
  _renderBody(summary, sessionId, sessionStart, sessionEnd, tokenCount) {
    const lines = [];
    lines.push(`# \u4F1A\u8BDD\u6458\u8981: ${summary.title}`);
    lines.push("");
    lines.push(`- \u4F1A\u8BDD ID: ${sessionId}`);
    lines.push(`- \u65F6\u95F4: ${new Date(sessionStart).toISOString()} \u2192 ${new Date(sessionEnd).toISOString()}`);
    lines.push(`- Token \u4F30\u7B97: ${tokenCount}`);
    lines.push(`- \u91CD\u8981\u6027: ${summary.importance}/10`);
    lines.push("");
    if (summary.keyDecisions.length > 0) {
      lines.push("## \u5173\u952E\u51B3\u7B56");
      for (const d of summary.keyDecisions) {
        lines.push(`- **${d.decision}** \u2014 ${d.reason}\uFF08\u7F6E\u4FE1\u5EA6: ${(d.confidence * 100).toFixed(0)}%\uFF09`);
      }
      lines.push("");
    }
    if (summary.unresolvedItems.length > 0) {
      lines.push("## \u672A\u5B8C\u6210\u4E8B\u9879");
      for (const item of summary.unresolvedItems) {
        lines.push(`- ${item}`);
      }
      lines.push("");
    }
    if (summary.tags.length > 0) {
      lines.push(`\u6807\u7B7E: ${summary.tags.join(", ")}`);
    }
    return lines.join("\n");
  }
  _parseBody(body, defaults) {
    const keyDecisions = [];
    const unresolvedItems = [];
    let inDecisions = false;
    let inUnresolved = false;
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("## \u5173\u952E\u51B3\u7B56")) {
        inDecisions = true;
        inUnresolved = false;
        continue;
      }
      if (trimmed.startsWith("## \u672A\u5B8C\u6210\u4E8B\u9879")) {
        inDecisions = false;
        inUnresolved = true;
        continue;
      }
      if (trimmed.startsWith("## ")) {
        inDecisions = false;
        inUnresolved = false;
        continue;
      }
      if (inDecisions && trimmed.startsWith("- **")) {
        const match = trimmed.match(/- \*\*(.+?)\*\*/);
        if (match) {
          keyDecisions.push({ decision: match[1], reason: "", confidence: 0.6 });
        }
      }
      if (inUnresolved && trimmed.startsWith("- ")) {
        unresolvedItems.push(trimmed.slice(2));
      }
    }
    return {
      title: defaults.title,
      summary: defaults.summary,
      keyDecisions,
      unresolvedItems,
      tags: defaults.tags,
      importance: defaults.importance,
      referencedMemoryIds: [],
      referencedCodeSymbolIds: []
    };
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-orchestrator/src/auto-writeback.js
import { createHash as createHash3 } from "node:crypto";
var PrivacyRedactor = class {
  patterns = [
    // API Key patterns
    { regex: /\b(sk|pk|api[_-]?key)[_-][a-zA-Z0-9]{20,}\b/gi, placeholder: "[REDACTED:API_KEY]" },
    { regex: /\b(api[_-]?key|apikey)\s*[:=]\s*['\"]?([a-zA-Z0-9_\-]{20,})['\"]?/gi, placeholder: "[REDACTED:API_KEY]" },
    // Bearer Token
    { regex: /bearer\s+[a-zA-Z0-9_\-\.]+/gi, placeholder: "[REDACTED:BEARER_TOKEN]" },
    // Authorization header
    { regex: /authorization\s*[:=]\s*['\"]?bearer\s+[a-zA-Z0-9_\-\.]+['\"]?/gi, placeholder: "[REDACTED:AUTH_TOKEN]" },
    // Generic token
    { regex: /\b(token|access_token|refresh_token)\s*[:=]\s*['\"]?([a-zA-Z0-9_\-\.]+)['\"]?/gi, placeholder: "[REDACTED:TOKEN]" },
    // Email
    { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, placeholder: "[REDACTED:EMAIL]" },
    // Long numbers (16+ digits) - credit cards, phone numbers
    { regex: /\b\d{16,}\b/g, placeholder: "[REDACTED:LONG_NUMBER]" },
    // UUID
    { regex: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, placeholder: "[REDACTED:UUID]" },
    // Hex strings (32+ chars)
    { regex: /\b[0-9a-fA-F]{32,}\b/g, placeholder: "[REDACTED:HEX]" },
    // Cookie
    { regex: /cookie\s*[:=]\s*['\"]?([a-zA-Z0-9_\-\.]+)['\"]?/gi, placeholder: "[REDACTED:COOKIE]" }
  ];
  /**
   * 替换敏感信息
   */
  redact(text) {
    let result = text;
    for (const { regex, placeholder } of this.patterns) {
      result = result.replace(regex, placeholder);
    }
    return result;
  }
  /**
   * 检查文本是否包含敏感信息
   */
  containsSensitive(text) {
    const sample = text.slice(0, 1e3);
    for (const { regex } of this.patterns) {
      if (regex.test(sample)) {
        return true;
      }
    }
    return false;
  }
};
function computeContentHash(title, summary) {
  const content = `${title}
${summary}`;
  return createHash3("sha256").update(content).digest("hex").slice(0, 16);
}
var WritebackExtractor = class {
  redactor;
  constructor() {
    this.redactor = new PrivacyRedactor();
  }
  /**
   * 从对话中提取记忆候选
   *
   * @param userMessage 用户消息
   * @param assistantResponse AI 回复
   * @returns 提取的记忆候选列表
   */
  extract(userMessage, assistantResponse) {
    const candidates = [];
    if (this.redactor.containsSensitive(userMessage) || this.redactor.containsSensitive(assistantResponse)) {
      console.log("[AutoWriteback] \u68C0\u6D4B\u5230\u654F\u611F\u4FE1\u606F\uFF0C\u8DF3\u8FC7\u63D0\u53D6");
      return [];
    }
    const safeUserMessage = this.redactor.redact(userMessage);
    const safeResponse = this.redactor.redact(assistantResponse);
    if (/(记住|记住一下|帮我记住|记录一下)/i.test(safeUserMessage)) {
      const title = this.extractTitle(safeUserMessage);
      const summary = safeResponse.slice(0, 200);
      if (title && summary) {
        candidates.push({
          id: crypto.randomUUID(),
          title,
          summary,
          importance: 7,
          tags: ["auto-writeback", "user-requested"],
          source: "auto-writeback",
          contentHash: computeContentHash(title, summary),
          confidence: 0.9
        });
      }
    }
    if (/(建议|最佳实践|注意事项|经验|教训|坑)/i.test(safeResponse)) {
      const title = this.extractBestPracticeTitle(safeUserMessage, safeResponse);
      const summary = this.extractBestPracticeSummary(safeResponse);
      if (title && summary) {
        candidates.push({
          id: crypto.randomUUID(),
          title,
          summary,
          importance: 6,
          tags: ["auto-writeback", "best-practice"],
          source: "auto-writeback",
          contentHash: computeContentHash(title, summary),
          confidence: 0.7
        });
      }
    }
    if (/(错误|bug|修复|解决|问题)/i.test(safeResponse) && /(如何|怎么|为什么)/i.test(safeUserMessage)) {
      const title = this.extractBugFixTitle(safeUserMessage, safeResponse);
      const summary = this.extractBugFixSummary(safeResponse);
      if (title && summary) {
        candidates.push({
          id: crypto.randomUUID(),
          title,
          summary,
          importance: 8,
          tags: ["auto-writeback", "bug-fix"],
          source: "auto-writeback",
          contentHash: computeContentHash(title, summary),
          confidence: 0.8
        });
      }
    }
    return candidates;
  }
  /**
   * 提取标题（从用户消息）
   */
  extractTitle(message) {
    const cleaned = message.replace(/^(记住|帮我记住|记录一下)\s*/i, "").replace(/[。，！？.!?，,]$/g, "").trim();
    return cleaned.slice(0, 100) || "\u672A\u547D\u540D\u8BB0\u5FC6";
  }
  /**
   * 提取最佳实践标题
   */
  extractBestPracticeTitle(userMessage, assistantResponse) {
    const firstSentence = assistantResponse.split(/[。！？.!?]/)[0];
    return `\u6700\u4F73\u5B9E\u8DF5: ${firstSentence.slice(0, 80)}`;
  }
  /**
   * 提取最佳实践摘要
   */
  extractBestPracticeSummary(response) {
    const sentences = response.split(/[。！？.!?]/);
    const relevant = sentences.filter((s) => /(建议|注意|最佳实践|经验|教训)/i.test(s));
    return relevant.join("\u3002").slice(0, 200) || response.slice(0, 200);
  }
  /**
   * 提取 Bug 修复标题
   */
  extractBugFixTitle(userMessage, assistantResponse) {
    const match = userMessage.match(/(.+?)(?:怎么|如何|为什么|问题|错误|bug)/i);
    return `\u4FEE\u590D\u65B9\u6848: ${match?.[1]?.trim() || "\u672A\u77E5\u95EE\u9898"}`;
  }
  /**
   * 提取 Bug 修复摘要
   */
  extractBugFixSummary(response) {
    const match = response.match(/(?:修复|解决|方案)[：:]\s*(.+?)(?=[。！？.!?]|$)/i);
    return match?.[1]?.trim().slice(0, 200) || response.slice(0, 200);
  }
};
var AutoWritebackRuntime = class {
  config;
  redactor;
  extractor;
  buffer = [];
  seenHashes = /* @__PURE__ */ new Set();
  flushTimer;
  writeCallback;
  startedAt;
  constructor(config = {}) {
    this.config = {
      minConfidence: 0.6,
      bufferSize: 10,
      flushIntervalMs: 5e3,
      enabled: true,
      ...config
    };
    this.redactor = new PrivacyRedactor();
    this.extractor = new WritebackExtractor();
    this.startedAt = Date.now();
  }
  /**
   * 注册写入回调（连接到 MemorySystem）
   */
  setWriteCallback(cb) {
    this.writeCallback = cb;
  }
  /**
   * 启动自动写回
   */
  start() {
    if (!this.config.enabled) {
      console.log("[AutoWriteback] \u5DF2\u7981\u7528");
      return;
    }
    console.log(`[AutoWriteback] \u542F\u52A8 (buffer=${this.config.bufferSize}, interval=${this.config.flushIntervalMs}ms)`);
    this.flushTimer = setInterval(() => {
      this.flush().catch((error) => {
        console.error("[AutoWriteback] \u5B9A\u65F6\u5237\u65B0\u5931\u8D25:", error);
      });
    }, this.config.flushIntervalMs);
  }
  /**
   * 停止自动写回
   */
  stop() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = void 0;
    }
    console.log("[AutoWriteback] \u505C\u6B62");
  }
  /**
   * 处理对话（提取 + 缓冲）
   */
  async processTurn(userMessage, assistantResponse) {
    if (!this.config.enabled) {
      return { extracted: 0, written: 0, skipped: 0, duplicates: 0, lowConfidence: 0 };
    }
    const startTime = Date.now();
    console.log("[AutoWriteback] \u5904\u7406\u5BF9\u8BDD...");
    const candidates = this.extractor.extract(userMessage, assistantResponse);
    const filtered = candidates.filter((c) => {
      if (c.confidence < this.config.minConfidence) {
        console.log(`[AutoWriteback] \u8DF3\u8FC7 (\u53EF\u4FE1\u5EA6\u8FC7\u4F4E: ${c.confidence})`);
        return false;
      }
      if (this.seenHashes.has(c.contentHash)) {
        console.log(`[AutoWriteback] \u8DF3\u8FC7 (\u91CD\u590D: ${c.contentHash})`);
        return false;
      }
      return true;
    });
    for (const candidate of filtered) {
      this.buffer.push(candidate);
      this.seenHashes.add(candidate.contentHash);
    }
    let written = 0;
    if (this.buffer.length >= this.config.bufferSize) {
      written = await this.flush();
    }
    const duration = Date.now() - startTime;
    console.log(`[AutoWriteback] \u5B8C\u6210 (${duration}ms, \u63D0\u53D6=${candidates.length}, \u7F13\u51B2=${this.buffer.length})`);
    return {
      extracted: candidates.length,
      written,
      skipped: candidates.length - filtered.length,
      duplicates: candidates.length - filtered.length,
      lowConfidence: 0
    };
  }
  /**
   * 刷新缓冲（批量写入）
   */
  async flush() {
    if (this.buffer.length === 0 || !this.writeCallback) {
      return 0;
    }
    const toWrite = [...this.buffer];
    this.buffer = [];
    console.log(`[AutoWriteback] \u6279\u91CF\u5199\u5165 ${toWrite.length} \u6761\u8BB0\u5FC6...`);
    try {
      await this.writeCallback(toWrite);
      console.log(`[AutoWriteback] \u5199\u5165\u5B8C\u6210`);
      return toWrite.length;
    } catch (error) {
      console.error("[AutoWriteback] \u5199\u5165\u5931\u8D25:", error);
      if (this.buffer.length < this.config.bufferSize * 2) {
        this.buffer.unshift(...toWrite);
      }
      return 0;
    }
  }
  /**
   * 获取统计信息
   */
  getStats() {
    return {
      bufferSize: this.buffer.length,
      seenHashes: this.seenHashes.size,
      uptime: Date.now() - this.startedAt,
      enabled: this.config.enabled
    };
  }
  /**
   * 手动添加记忆候选（用于测试）
   */
  addCandidate(candidate) {
    if (candidate.confidence >= this.config.minConfidence && !this.seenHashes.has(candidate.contentHash)) {
      this.buffer.push(candidate);
      this.seenHashes.add(candidate.contentHash);
    }
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-orchestrator/src/index.js
var DEFAULT_CONFIG2 = {
  alpha: 0.35,
  beta: 0.35,
  gamma: 0.2,
  delta: 0.1,
  topK: 5,
  candidateK: 20,
  maxGraphDepth: 3,
  timeoutMs: 1e3,
  enableQueryOptimization: true,
  enableReranking: true
};
var HybridQueryEngine = class {
  config;
  memoryDb;
  vectorStore;
  embedder;
  queryOptimizer;
  reranker;
  constructor(memoryDb, vectorStore, embedder, config = {}, queryOptimizer, reranker) {
    this.memoryDb = memoryDb;
    this.vectorStore = vectorStore;
    this.embedder = embedder;
    this.config = { ...DEFAULT_CONFIG2, ...config };
    this.queryOptimizer = queryOptimizer ?? new NoopQueryOptimizer();
    this.reranker = reranker ?? new NoopReranker();
  }
  /**
   * Hybrid query: (optional) query optimization → vector semantic recall →
   * (optional) reranking → graph traversal refine → fusion scoring
   */
  async query(queryText, filter) {
    const startTime = performance.now();
    let vectorTimeMs = 0;
    let graphTimeMs = 0;
    let degraded = false;
    let queryOptimized = false;
    let optimizedQuery;
    let effectiveQuery = queryText;
    if (this.config.enableQueryOptimization) {
      try {
        const t0 = performance.now();
        const optimized = await this.queryOptimizer.optimize(queryText);
        vectorTimeMs += performance.now() - t0;
        if (optimized && optimized !== queryText) {
          effectiveQuery = optimized;
          queryOptimized = true;
          optimizedQuery = optimized;
        }
      } catch {
      }
    }
    let queryVector;
    try {
      const t0 = performance.now();
      queryVector = await this.embedder.embed(effectiveQuery);
      vectorTimeMs += performance.now() - t0;
    } catch (err) {
      degraded = "vector_timeout";
      return this._buildFallbackResponse(queryText, filter, startTime, queryOptimized, optimizedQuery);
    }
    let candidates;
    try {
      const t0 = performance.now();
      const results2 = this.vectorStore.query(queryVector, {
        topK: this.config.candidateK,
        filter
      });
      vectorTimeMs += performance.now() - t0;
      candidates = results2.map((r) => ({
        id: r.id,
        score: r.score,
        metadata: r.metadata
      }));
    } catch {
      degraded = "vector_timeout";
      return this._buildFallbackResponse(queryText, filter, startTime, queryOptimized, optimizedQuery);
    }
    if (candidates.length === 0) {
      degraded = "vector_timeout";
      return this._buildFallbackResponse(queryText, filter, startTime, queryOptimized, optimizedQuery);
    }
    let rerankedCandidates = candidates;
    if (this.config.enableReranking && candidates.length > 1) {
      try {
        const t0 = performance.now();
        const rerankerInput = candidates.map((c) => ({
          id: c.id,
          content: `${c.metadata.title} ${c.metadata.summary}`,
          originalScore: c.score,
          metadata: { nodeId: c.metadata.nodeId }
        }));
        const reranked = await this.reranker.rerank(effectiveQuery, rerankerInput);
        vectorTimeMs += performance.now() - t0;
        const rerankedMap = new Map(reranked.map((r) => [r.id, r]));
        rerankedCandidates = candidates.filter((c) => rerankedMap.has(c.id)).map((c) => ({
          ...c,
          score: rerankedMap.get(c.id).score
        }));
      } catch {
      }
    }
    const graphStart = performance.now();
    const withGraphScores = rerankedCandidates.map((candidate) => {
      let graphScore = 0;
      let trustScore = 0.5;
      try {
        const node = this.memoryDb.getNode(candidate.metadata.nodeId);
        if (!node) {
          graphScore = 0;
          trustScore = 0.5;
        } else {
          const codeLinks = this.memoryDb.getMemoryWithCodeSymbols(node.id);
          const codeLinkageScore = Math.min(codeLinks.length / 3, 1);
          const related = this.memoryDb.getRelatedMemories(node.id, {
            depth: 1,
            minWeight: 0.1
          });
          const incomingCount = related.filter((r) => r.direction === "incoming").length;
          const outgoingCount = related.filter((r) => r.direction === "outgoing").length;
          const relationDensity = Math.min((incomingCount + outgoingCount) / 10, 1);
          const importanceScore = node.importance / 10;
          trustScore = node.verified ? 1 : node.confidence;
          graphScore = 0.4 * codeLinkageScore + 0.3 * relationDensity + 0.3 * importanceScore;
        }
      } catch {
        graphScore = 0;
        trustScore = 0.5;
      }
      return { ...candidate, graphScore, trustScore, nodeId: candidate.metadata.nodeId };
    });
    graphTimeMs = performance.now() - graphStart;
    const scored = withGraphScores.map((item) => {
      const vectorScore = Math.max((item.score + 1) / 2, 0);
      const graphScore = item.graphScore;
      const recencyScore = this._computeRecency(item.metadata.createdAt);
      const trustScore = item.trustScore ?? 0.5;
      const finalScore = this.config.alpha * vectorScore + this.config.beta * graphScore + this.config.gamma * recencyScore + this.config.delta * trustScore;
      return { item, finalScore, vectorScore, graphScore, recencyScore, trustScore };
    });
    scored.sort((a, b) => b.finalScore - a.finalScore);
    const topResults = scored.slice(0, this.config.topK);
    const results = [];
    for (const sr of topResults) {
      let relations = [];
      try {
        const related = this.memoryDb.getRelatedMemories(sr.item.metadata.nodeId, { depth: 1 });
        relations = related.map((r) => ({
          type: r.relation,
          direction: r.direction,
          strength: r.weight
        }));
      } catch {
      }
      results.push({
        nodeId: sr.item.metadata.nodeId,
        title: sr.item.metadata.title,
        summary: sr.item.metadata.summary,
        score: sr.finalScore,
        vectorScore: sr.vectorScore,
        graphScore: sr.graphScore,
        recencyScore: sr.recencyScore,
        trustScore: sr.trustScore ?? 0.5,
        relations,
        metadata: {
          type: sr.item.metadata.type,
          tags: [],
          importance: sr.item.metadata.importance,
          createdAt: sr.item.metadata.createdAt,
          source: sr.item.metadata.source
        }
      });
    }
    const totalTimeMs = performance.now() - startTime;
    return {
      results,
      telemetry: {
        totalTimeMs: Math.round(totalTimeMs),
        vectorTimeMs: Math.round(vectorTimeMs),
        graphTimeMs: Math.round(graphTimeMs),
        candidatesCount: candidates.length,
        returnedCount: results.length,
        degraded,
        top1Score: results.length > 0 ? results[0].score : 0,
        queryOptimized,
        originalQuery: queryText,
        ...optimizedQuery ? { optimizedQuery } : {}
      }
    };
  }
  /** Fallback: text search when vector store is unavailable */
  _buildFallbackResponse(queryText, filter, startTime, queryOptimized, optimizedQuery) {
    const nodes = this.memoryDb.searchByText(queryText, this.config.topK);
    let filtered = nodes;
    if (filter?.importanceMin !== void 0) {
      filtered = filtered.filter((n) => n.importance >= filter.importanceMin);
    }
    if (filter?.types !== void 0) {
      filtered = filtered.filter((n) => filter.types.includes(n.nodeType));
    }
    const results = filtered.map((node) => ({
      nodeId: node.id,
      title: node.title,
      summary: node.summary,
      score: node.importance / 10,
      vectorScore: 0,
      graphScore: node.importance / 10,
      recencyScore: this._computeRecency(node.createdAt),
      trustScore: node.verified ? 1 : node.confidence,
      relations: [],
      metadata: {
        type: node.nodeType,
        tags: node.tags,
        importance: node.importance,
        createdAt: node.createdAt,
        source: node.source
      }
    }));
    const totalTimeMs = performance.now() - startTime;
    return {
      results,
      telemetry: {
        totalTimeMs: Math.round(totalTimeMs),
        vectorTimeMs: 0,
        graphTimeMs: 0,
        candidatesCount: results.length,
        returnedCount: results.length,
        degraded: "vector_timeout",
        top1Score: results.length > 0 ? results[0].score : 0,
        queryOptimized,
        originalQuery: queryText,
        ...optimizedQuery ? { optimizedQuery } : {}
      }
    };
  }
  // ===== Scoring Helpers =====
  _computeRecency(timestamp) {
    const now = Date.now();
    const ageMs = now - timestamp;
    const ageDays = ageMs / (1e3 * 60 * 60 * 24);
    if (ageDays < 1)
      return 1;
    if (ageDays < 7)
      return 0.8;
    if (ageDays < 30)
      return 0.5;
    if (ageDays < 90)
      return 0.2;
    if (ageDays < 365)
      return 0.05;
    return 0.01;
  }
  /** Update config at runtime */
  setConfig(config) {
    this.config = { ...this.config, ...config };
  }
  /** Replace optimizer at runtime */
  setQueryOptimizer(optimizer) {
    this.queryOptimizer = optimizer;
  }
  /** Replace reranker at runtime */
  setReranker(reranker) {
    this.reranker = reranker;
  }
  /** Close all underlying connections */
  close() {
    try {
      this.memoryDb.close();
    } catch {
    }
    try {
      this.vectorStore.close();
    } catch {
    }
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-graph/src/nudge-engine.js
var NudgeEngine = class _NudgeEngine {
  db;
  options;
  // 默认配置
  static DEFAULTS = {
    enabledScenes: ["complex_task", "repeated_pattern", "error_revisit"],
    repeatThreshold: 2,
    repeatWindowMs: 36e5,
    // 1 小时
    complexTaskMinImportance: 7,
    complexTaskMinMemories: 3,
    userId: "default"
  };
  constructor(db, options = {}) {
    this.db = db;
    this.options = { ..._NudgeEngine.DEFAULTS, ...options };
  }
  /**
   * 当新记忆写入时调用，返回 nudge 建议列表
   *
   * 在写路径外异步调用，不阻塞主流程。
   * 每条新记忆独立分析，去重后返回。
   */
  onMemoryWritten(memories, options) {
    if (memories.length === 0)
      return [];
    const suggestions = [];
    const seenKeys = /* @__PURE__ */ new Set();
    for (const mem of memories) {
      if (mem.source === "system" || mem.nodeType === "session_summary")
        continue;
      const sceneHints = this._detectScene(mem);
      for (const scene of sceneHints) {
        const key = `${scene.reason}:${mem.id}`;
        if (seenKeys.has(key))
          continue;
        seenKeys.add(key);
        if (scene.confidence < 0.3)
          continue;
        suggestions.push(scene);
      }
    }
    return suggestions;
  }
  /**
   * 批量分析：扫描近期所有记忆，发现跨会话模式
   *
   * 适合定时触发（如每 5 分钟），
   * 发现新 nudge 时返回建议列表。
   */
  analyzeRecent(hours = 1) {
    const recent = this.db.getRecentMemories(hours, 100);
    if (recent.length === 0)
      return [];
    const suggestions = [];
    const sessionId = `batch-${Date.now()}`;
    suggestions.push(...this._detectRepeatedPatterns(recent));
    suggestions.push(...this._detectErrorRevisits(recent));
    suggestions.push(...this._detectKnowledgeGaps(recent));
    return this._deduplicate(suggestions);
  }
  /**
   * 更新配置（运行时动态调整）
   */
  updateOptions(options) {
    this.options = { ...this.options, ...options };
  }
  // ===== Private: Scene Detection =====
  /**
   * 对单条新记忆检测所有可能的 nudge 场景
   */
  _detectScene(mem) {
    const results = [];
    if (this.options.enabledScenes.includes("complex_task") && (mem.importance ?? 5) >= this.options.complexTaskMinImportance) {
      results.push({
        reason: "complex_task",
        message: `\u68C0\u6D4B\u5230\u9AD8\u91CD\u8981\u6027\u8BB0\u5FC6"${mem.title}"\uFF08\u91CD\u8981\u6027 ${mem.importance}\uFF09\uFF0C\u5EFA\u8BAE\u8BB0\u5F55\u4E3A\u7ECF\u9A8C\u3002`,
        action: "write_memory",
        suggestedMemory: {
          title: `[\u7ECF\u9A8C] ${mem.title}`,
          summary: mem.summary,
          tags: ["experience", ...mem.tags ?? []],
          importance: mem.importance ?? 7
        },
        triggeredBy: [mem.id],
        confidence: 0.6
      });
    }
    if (mem.nodeType === "memory_entry" && (!mem.summary || mem.summary.length < 20) && (mem.body && mem.body.length > 100)) {
      results.push({
        reason: "knowledge_gap",
        message: `"${mem.title}" \u6709\u8BE6\u7EC6\u5185\u5BB9\u4F46\u6CA1\u6709\u6458\u8981\uFF0C\u5EFA\u8BAE\u8865\u5145\u3002`,
        action: "update_memory",
        suggestedMemory: {
          title: mem.title,
          summary: mem.body.slice(0, 200) + (mem.body.length > 200 ? "..." : ""),
          tags: mem.tags ?? [],
          importance: mem.importance ?? 5
        },
        triggeredBy: [mem.id],
        confidence: 0.5
      });
    }
    return results;
  }
  /**
   * 检测重复模式：同一话题短时间多次出现
   */
  _detectRepeatedPatterns(memories) {
    const results = [];
    if (!this.options.enabledScenes.includes("repeated_pattern"))
      return results;
    const windowMs = this.options.repeatWindowMs;
    const threshold = this.options.repeatThreshold;
    const now = Date.now();
    const tagGroups = /* @__PURE__ */ new Map();
    for (const mem of memories) {
      const tags = mem.tags ?? [];
      for (const tag of tags) {
        if (tag === "session_summary")
          continue;
        if (!tagGroups.has(tag))
          tagGroups.set(tag, []);
        tagGroups.get(tag).push(mem);
      }
    }
    for (const [tag, tagged] of tagGroups) {
      if (tagged.length < threshold)
        continue;
      tagged.sort((a, b) => a.createdAt - b.createdAt);
      let maxCount = 0;
      let maxWindow = [];
      for (let i = 0; i < tagged.length; i++) {
        const windowStart = tagged[i].createdAt;
        const windowEnd = windowStart + windowMs;
        const inWindow = tagged.filter((m) => m.createdAt >= windowStart && m.createdAt <= windowEnd);
        if (inWindow.length > maxCount) {
          maxCount = inWindow.length;
          maxWindow = inWindow;
        }
      }
      if (maxCount >= threshold) {
        const titles = maxWindow.map((m) => m.title).join(", ");
        const latest = maxWindow[maxWindow.length - 1];
        const hasDecision = this._hasRelatedDecision(latest, tag);
        if (!hasDecision) {
          results.push({
            reason: "repeated_pattern",
            message: `\u6807\u7B7E"${tag}"\u5728 ${maxWindow.length} \u6B21\u64CD\u4F5C\u4E2D\u91CD\u590D\u51FA\u73B0\uFF08${titles}\uFF09\u3002\u5EFA\u8BAE\u8BB0\u5F55\u4E3A\u901A\u7528\u7ECF\u9A8C\u3002`,
            action: "create_decision",
            suggestedMemory: {
              title: `[\u89C4\u5219] \u5173\u4E8E ${tag} \u7684\u901A\u7528\u7ECF\u9A8C`,
              summary: `\u4ECE ${maxWindow.length} \u6B21\u5B9E\u8DF5\u4E2D\u603B\u7ED3\u5173\u4E8E"${tag}"\u7684\u901A\u7528\u7ECF\u9A8C\u3002`,
              tags: [tag, "rule", "experience"],
              importance: 6
            },
            triggeredBy: maxWindow.map((m) => m.id),
            confidence: Math.min(0.4 + maxCount * 0.1, 0.9)
          });
        }
      }
    }
    return results;
  }
  /**
   * 检测错误复现：新记忆与已知的 decision/错误记录匹配
   */
  _detectErrorRevisits(memories) {
    const results = [];
    if (!this.options.enabledScenes.includes("error_revisit"))
      return results;
    const rawDb = this.db.getRawDb();
    const decisions = rawDb.prepare(`SELECT * FROM memory_nodes
         WHERE node_type = 'decision'
           AND status = 'active'
           AND importance >= 4
         ORDER BY created_at DESC
         LIMIT 50`).all();
    if (decisions.length === 0)
      return results;
    for (const mem of memories) {
      if (mem.nodeType !== "memory_entry" && mem.nodeType !== "insight")
        continue;
      const memTerms = this._extractTerms(mem.title + " " + mem.summary);
      for (const dec of decisions) {
        const decTitle = dec.title ?? "";
        const decSummary = dec.summary ?? "";
        const decTerms = this._extractTerms(decTitle + " " + decSummary);
        const overlap = memTerms.filter((t) => decTerms.includes(t)).length;
        const overlapRatio = decTerms.length > 0 ? overlap / decTerms.length : 0;
        if (overlapRatio >= 0.4) {
          results.push({
            reason: "error_revisit",
            message: `\u65B0\u8BB0\u5FC6"${mem.title}"\u4E0E\u5DF2\u6709\u51B3\u7B56"${decTitle}"\u9AD8\u5EA6\u76F8\u5173\uFF08\u91CD\u53E0\u5EA6 ${Math.round(overlapRatio * 100)}%\uFF09\u3002\u5EFA\u8BAE\u56DE\u987E\u3002`,
            action: "review",
            suggestedMemory: {
              title: mem.title,
              summary: mem.summary,
              tags: mem.tags ?? [],
              importance: mem.importance ?? 5
            },
            triggeredBy: [mem.id],
            relatedMemoryId: dec.id,
            confidence: overlapRatio * 0.8
          });
        }
      }
    }
    return results;
  }
  /**
   * 检测知识缺口：高重要性记忆但未被关联到代码符号
   */
  _detectKnowledgeGaps(memories) {
    const results = [];
    if (!this.options.enabledScenes.includes("knowledge_gap"))
      return results;
    for (const mem of memories) {
      if (mem.importance < 6)
        continue;
      if (mem.nodeType === "session_summary")
        continue;
      const edges = this.db.getNodeEdges(mem.id);
      const hasCodeLink = edges.some((e) => e.relation === "links_to_code");
      if (!hasCodeLink) {
        results.push({
          reason: "knowledge_gap",
          message: `\u9AD8\u91CD\u8981\u6027\u8BB0\u5FC6"${mem.title}"\uFF08\u91CD\u8981\u6027 ${mem.importance}\uFF09\u672A\u5173\u8054\u5230\u4EFB\u4F55\u4EE3\u7801\u7B26\u53F7\u3002\u5EFA\u8BAE\u5173\u8054\u4EE5\u589E\u5F3A\u53EF\u8FFD\u6EAF\u6027\u3002`,
          action: "update_memory",
          suggestedMemory: {
            title: mem.title,
            summary: mem.summary,
            tags: [...mem.tags ?? [], "needs_code_link"],
            importance: mem.importance
          },
          triggeredBy: [mem.id],
          confidence: 0.5
        });
      }
    }
    return results;
  }
  // ===== Private: Helpers =====
  /**
   * 检查是否已有相关的 decision 节点
   */
  _hasRelatedDecision(mem, tag) {
    const rawDb = this.db.getRawDb();
    const row = rawDb.prepare(`SELECT id FROM memory_nodes
         WHERE node_type = 'decision'
           AND status = 'active'
           AND tags LIKE ?
         LIMIT 1`).get(`%"${tag}"%`);
    return row !== void 0;
  }
  /**
   * 提取文本中的关键词（去停用词）
   */
  _extractTerms(text) {
    const stopWords = /* @__PURE__ */ new Set([
      "\u7684",
      "\u4E86",
      "\u5728",
      "\u662F",
      "\u6211",
      "\u6709",
      "\u548C",
      "\u5C31",
      "\u4E0D",
      "\u4EBA",
      "\u90FD",
      "\u4E00",
      "\u4E00\u4E2A",
      "\u4E0A",
      "\u4E5F",
      "\u5F88",
      "\u5230",
      "\u8BF4",
      "\u8981",
      "\u53BB",
      "\u4F60",
      "\u4F1A",
      "\u7740",
      "\u6CA1\u6709",
      "\u770B",
      "\u597D",
      "\u81EA\u5DF1",
      "\u8FD9",
      "\u4ED6",
      "\u5979",
      "\u5B83",
      "\u4EEC",
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "can",
      "shall",
      "to",
      "of",
      "in",
      "for",
      "on",
      "with",
      "at",
      "by",
      "from",
      "as",
      "into",
      "through",
      "during",
      "before",
      "after",
      "and",
      "but",
      "or",
      "nor",
      "not",
      "so",
      "yet",
      "if",
      "then",
      "this",
      "that",
      "these",
      "those",
      "it",
      "its",
      "my",
      "your",
      "\u6211\u4EEC",
      "\u4F60\u4EEC",
      "\u4ED6\u4EEC",
      "\u8FD9\u4E2A",
      "\u90A3\u4E2A",
      "\u4EC0\u4E48",
      "\u600E\u4E48",
      "\u4E3A\u4EC0\u4E48"
    ]);
    return text.toLowerCase().split(/[\s,，。！？、；：""''（）()\[\]【】{}]+/).filter((t) => t.length >= 2 && !stopWords.has(t));
  }
  /**
   * 去重：相同 reason + 相同 triggeredBy
   */
  _deduplicate(suggestions) {
    const seen = /* @__PURE__ */ new Set();
    return suggestions.filter((s) => {
      const key = `${s.reason}:${s.triggeredBy.sort().join(",")}`;
      if (seen.has(key))
        return false;
      seen.add(key);
      return true;
    });
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-graph/src/user-profile.js
var DEFAULT_MEMORY_CONFIG = {
  ttlDays: 90,
  decayRate: 0.02,
  contradictionThreshold: 0.3,
  minConfidenceForContradiction: 0.5
};
var UserProfileEngine = class {
  db;
  config;
  // 矛盾检测阈值：同一 domain 下，两条观察的内容相似度低于此值视为矛盾
  static DEFAULT_CONTRADICTION_THRESHOLD = 0.3;
  // 置信度衰减：每天衰减比例
  static DEFAULT_CONFIDENCE_DECAY_PER_DAY = 0.02;
  // 观察过期时间（天）：超过此时间未更新的观察被标记为低置信度
  static DEFAULT_OBSERVATION_TTL_DAYS = 90;
  constructor(db, config = {}) {
    this.db = db;
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
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
   * 记录一条用户观察
   *
   * 流程：
   * 1. 创建/更新 observation 记忆节点
   * 2. 与同 domain 的已有观察对比，检测矛盾
   * 3. 如果检测到矛盾，创建 contradicts 边
   * 4. 返回观察结果和矛盾列表
   */
  observe(type, domain, content, options = {}) {
    const userId = options.userId ?? "default";
    const confidence = options.confidence ?? 0.7;
    const sourceSession = options.sourceSession ?? null;
    const tags = options.tags ?? ["user_profile", domain, type];
    const now = Date.now();
    const existing = this._findLatestObservation(type, domain, userId);
    const observationId = `obs-${userId}-${type}-${domain}-${now}`;
    const node = this.db.createNode({
      title: `[${type}] ${domain}: ${content}`,
      summary: content,
      body: JSON.stringify({
        type,
        domain,
        confidence,
        userId,
        sourceSession,
        contradicted: false,
        contradictedBy: null
      }),
      importance: Math.round(confidence * 10),
      status: "active",
      source: "system",
      sourceSession: sourceSession ?? null,
      tags: [.../* @__PURE__ */ new Set(["user_profile", type, domain, ...tags])],
      nodeType: "insight",
      ttlDays: this.config.ttlDays,
      scope: "public",
      tierMin: 1,
      negativeExamples: [],
      isDeprecated: false,
      deprecatedAt: null,
      userId
    });
    const observation = {
      id: node.id,
      type,
      domain,
      content,
      confidence,
      sourceSession,
      createdAt: now,
      updatedAt: now,
      tags,
      contradicted: false,
      contradictedBy: null
    };
    const contradictions = [];
    if (existing) {
      const similarity = this._computeSimilarity(content, existing.content);
      if (similarity < this.config.contradictionThreshold && confidence >= this.config.minConfidenceForContradiction && existing.confidence >= this.config.minConfidenceForContradiction) {
        const message = this._buildContradictionMessage(type, domain, existing.content, content, existing.createdAt, now);
        const existingUserId = existing.userId ?? "default";
        this.db.updateNode(existing.id, {
          status: "pending_review",
          tags: [...existing.tags, "contradicted"],
          body: JSON.stringify({
            type: existing.type,
            domain: existing.domain,
            confidence: existing.confidence,
            userId: existingUserId,
            sourceSession: existing.sourceSession,
            contradicted: true,
            contradictedBy: node.id
          })
        });
        this.db.linkMemoryToMemory(node.id, existing.id, "contradicts", 0.8, `${type}:${domain} \u2014 "${existing.content}" \u2192 "${content}"`);
        this.db.updateNode(node.id, {
          body: JSON.stringify({
            type,
            domain,
            confidence,
            userId,
            sourceSession,
            contradicted: true,
            contradictedBy: existing.id
          })
        });
        contradictions.push({
          existing,
          message
        });
        observation.contradicted = true;
        observation.contradictedBy = existing.id;
      }
    }
    return {
      observation,
      contradictions,
      isNew: !existing
    };
  }
  /**
   * 获取用户画像
   *
   * 聚合所有观察，按 domain 分组，
   * 返回每个 domain 的核心观点和矛盾历史。
   */
  getProfile(userId = "default") {
    const rawDb = this.db.getRawDb();
    const rows = rawDb.prepare(`SELECT * FROM memory_nodes
         WHERE user_id = ?
           AND node_type = 'insight'
           AND tags LIKE '%"user_profile"%'
           AND status != 'archived'
         ORDER BY created_at DESC`).all(userId);
    const observations = rows.map((r) => this._rowToObservation(r));
    const domainGroups = /* @__PURE__ */ new Map();
    for (const obs of observations) {
      if (!domainGroups.has(obs.domain)) {
        domainGroups.set(obs.domain, []);
      }
      domainGroups.get(obs.domain).push(obs);
    }
    const traits = [];
    const contradictionPairs = /* @__PURE__ */ new Set();
    for (const [domain, obsList] of domainGroups) {
      const typeGroups = /* @__PURE__ */ new Map();
      for (const obs of obsList) {
        if (!typeGroups.has(obs.type))
          typeGroups.set(obs.type, []);
        typeGroups.get(obs.type).push(obs);
      }
      for (const [type, typedObs] of typeGroups) {
        typedObs.sort((a, b) => b.createdAt - a.createdAt);
        const active = typedObs.filter((o) => !o.contradicted);
        const current = active.length > 0 ? active.reduce((a, b) => a.confidence >= b.confidence ? a : b) : typedObs[0];
        const contradictions = [];
        for (const obs of typedObs) {
          if (obs.contradicted && obs.contradictedBy) {
            const pairKey = [obs.id, obs.contradictedBy].sort().join("\u2192");
            if (!contradictionPairs.has(pairKey)) {
              contradictionPairs.add(pairKey);
              const contradictor = typedObs.find((o) => o.id === obs.contradictedBy);
              if (contradictor) {
                contradictions.push({
                  old: obs.content,
                  new: contradictor.content,
                  detectedAt: contradictor.createdAt
                });
              }
            }
          }
        }
        const history = typedObs.map((o) => ({
          content: o.content,
          confidence: o.confidence,
          timestamp: o.createdAt
        }));
        traits.push({
          domain: `${type}:${domain}`,
          current: current.content,
          confidence: this._applyDecay(current.confidence, current.updatedAt),
          history,
          hasContradiction: contradictions.length > 0,
          contradictions
        });
      }
    }
    traits.sort((a, b) => b.confidence - a.confidence);
    const strongTraitCount = traits.filter((t) => t.confidence >= 0.7).length;
    const totalObservationCount = observations.length;
    return {
      userId,
      traits,
      observations,
      contradictionCount: contradictionPairs.size,
      lastUpdated: Date.now(),
      strongTraitCount,
      totalObservationCount
    };
  }
  /**
   * 获取用户画像摘要（用于上下文注入）
   *
   * 返回格式化的文本摘要，可直接注入系统 prompt。
   */
  getProfileSummary(userId = "default", maxTraits = 10) {
    const profile = this.getProfile(userId);
    if (profile.traits.length === 0)
      return "";
    const lines = [`[\u7528\u6237\u753B\u50CF: ${userId}]`];
    const topTraits = profile.traits.slice(0, maxTraits);
    for (const trait of topTraits) {
      const badge = trait.hasContradiction ? " \u26A0\uFE0F" : "";
      lines.push(`- ${trait.domain}: ${trait.current} (\u7F6E\u4FE1\u5EA6 ${Math.round(trait.confidence * 100)}%)${badge}`);
    }
    if (profile.contradictionCount > 0) {
      lines.push(`
\u26A0\uFE0F \u68C0\u6D4B\u5230 ${profile.contradictionCount} \u5904\u77DB\u76FE\uFF0C\u5EFA\u8BAE\u5173\u6CE8\u3002`);
    }
    return lines.join("\n");
  }
  /**
   * 获取系统 Prompt 片段（自动注入用）
   *
   * 返回格式化的用户画像摘要，可直接注入到系统 prompt 中。
   * 包含关键特征、矛盾警告和沟通偏好。
   */
  getSystemPromptSnippet(userId = "default", maxTraits = 5) {
    const summary = this.getProfileSummary(userId, maxTraits);
    if (!summary) {
      return "";
    }
    const lines = [
      "## \u7528\u6237\u753B\u50CF",
      "",
      "\u4EE5\u4E0B\u662F\u6839\u636E\u5386\u53F2\u5BF9\u8BDD\u89C2\u5BDF\u5230\u7684\u7528\u6237\u7279\u5F81\uFF1A",
      "",
      summary,
      "",
      "> \u{1F4A1} **\u4F7F\u7528\u5EFA\u8BAE**",
      "> - \u6839\u636E\u7528\u6237\u504F\u597D\u8C03\u6574\u6C9F\u901A\u98CE\u683C",
      "> - \u5982\u68C0\u6D4B\u5230 \u26A0\uFE0F \u77DB\u76FE\uFF0C\u4E3B\u52A8\u786E\u8BA4\u7528\u6237\u6700\u65B0\u504F\u597D",
      "> - \u968F\u7740\u65F6\u95F4\u63A8\u79FB\uFF0C\u7F6E\u4FE1\u5EA6\u4F1A\u8870\u51CF\uFF0C\u4F18\u5148\u53C2\u8003\u8FD1\u671F\u89C2\u5BDF"
    ];
    return lines.join("\n");
  }
  /**
   * 删除观察（软删除）
   *
   * 将观察标记为 archived，不物理删除。
   */
  deleteObservation(observationId) {
    try {
      this.db.updateNode(observationId, {
        status: "archived",
        importance: 1
      });
      return true;
    } catch {
      return false;
    }
  }
  /**
   * 获取观察详情
   */
  getObservation(observationId) {
    try {
      const rawDb = this.db.getRawDb();
      const rows = rawDb.prepare(`SELECT * FROM memory_nodes WHERE id = ? AND status = 'active'`).all(observationId);
      if (rows.length === 0)
        return null;
      return this._rowToObservation(rows[0]);
    } catch {
      return null;
    }
  }
  /**
   * 统计用户画像健康度
   */
  getHealthStats(userId = "default") {
    const profile = this.getProfile(userId);
    const now = Date.now();
    const activeObservations = profile.observations.filter((o) => o.contradicted === false);
    const avgConfidence = activeObservations.length > 0 ? activeObservations.reduce((sum, o) => sum + o.confidence, 0) / activeObservations.length : 0;
    const ages = profile.observations.map((o) => now - o.createdAt);
    const oldestAge = ages.length > 0 ? Math.max(...ages) : 0;
    const newestAge = ages.length > 0 ? Math.min(...ages) : 0;
    return {
      totalTraits: profile.traits.length,
      strongTraits: profile.strongTraitCount,
      contradictions: profile.contradictionCount,
      avgConfidence,
      oldestObservationAge: oldestAge,
      newestObservationAge: newestAge,
      needsRefresh: profile.traits.length > 0 && (profile.contradictionCount > 0 || avgConfidence < 0.5)
    };
  }
  /**
   * 清理过期观察
   */
  refreshExpired(dryRun = true) {
    const rawDb = this.db.getRawDb();
    const cutoff = Date.now() - this.config.ttlDays * 864e5;
    const expired = rawDb.prepare(`SELECT id FROM memory_nodes
         WHERE node_type = 'insight'
           AND tags LIKE '%"user_profile"%'
           AND updated_at < ?
           AND status = 'active'`).all(cutoff);
    if (dryRun) {
      return { archived: expired.length };
    }
    for (const row of expired) {
      this.db.updateNode(row.id, {
        status: "archived",
        importance: 1
      });
    }
    return { archived: expired.length };
  }
  // ===== Private: Helpers =====
  /**
   * 查找同 domain 同类型的最新观察
   *
   * 优先按 body JSON 精确匹配，降级到 tag 宽松匹配。
   */
  _findLatestObservation(type, domain, userId) {
    const rawDb = this.db.getRawDb();
    const bodyLike = `%"type":"${type}","domain":"${domain}"%`;
    const rows = rawDb.prepare(`SELECT * FROM memory_nodes
         WHERE user_id = ?
           AND node_type = 'insight'
           AND tags LIKE '%"user_profile"%'
           AND body LIKE ?
           AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`).all(userId, bodyLike);
    if (rows.length > 0) {
      return this._rowToObservation(rows[0]);
    }
    const fallback = rawDb.prepare(`SELECT * FROM memory_nodes
         WHERE user_id = ?
           AND node_type = 'insight'
           AND tags LIKE '%"user_profile"%'
           AND tags LIKE ?
           AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`).all(userId, `%"${domain}"%`);
    if (fallback.length === 0)
      return null;
    return this._rowToObservation(fallback[0]);
  }
  /**
   * 计算文本相似度（Jaccard 相似度）
   *
   * 轻量级，无 LLM 依赖。
   */
  _computeSimilarity(a, b) {
    const termsA = this._extractTerms(a);
    const termsB = this._extractTerms(b);
    if (termsA.length === 0 && termsB.length === 0)
      return 1;
    if (termsA.length === 0 || termsB.length === 0)
      return 0;
    const setA = new Set(termsA);
    const setB = new Set(termsB);
    let intersection = 0;
    for (const term of setA) {
      if (setB.has(term))
        intersection++;
    }
    const union = (/* @__PURE__ */ new Set([...setA, ...setB])).size;
    return intersection / union;
  }
  /**
   * 构建矛盾信息
   */
  _buildContradictionMessage(type, domain, oldContent, newContent, oldTime, newTime) {
    const oldDate = new Date(oldTime).toISOString().slice(0, 10);
    const newDate = new Date(newTime).toISOString().slice(0, 10);
    const timeDiff = Math.round((newTime - oldTime) / 864e5);
    return `[${type}:${domain}] "${oldContent}" (${oldDate}) \u2192 "${newContent}" (${newDate})\uFF0C\u95F4\u9694 ${timeDiff} \u5929\u3002`;
  }
  /**
   * 置信度衰减
   */
  _applyDecay(confidence, lastUpdated) {
    const daysSinceUpdate = (Date.now() - lastUpdated) / 864e5;
    const decay = daysSinceUpdate * this.config.decayRate;
    return Math.max(0.1, confidence - decay);
  }
  /**
   * 提取关键词（去停用词）
   */
  _extractTerms(text) {
    const stopWords = /* @__PURE__ */ new Set([
      "\u7684",
      "\u4E86",
      "\u5728",
      "\u662F",
      "\u6211",
      "\u6709",
      "\u548C",
      "\u5C31",
      "\u4E0D",
      "\u4EBA",
      "\u90FD",
      "\u4E00",
      "\u4E00\u4E2A",
      "\u4E0A",
      "\u4E5F",
      "\u5F88",
      "\u5230",
      "\u8BF4",
      "\u8981",
      "\u53BB",
      "\u4F60",
      "\u4F1A",
      "\u7740",
      "\u6CA1\u6709",
      "\u770B",
      "\u597D",
      "\u81EA\u5DF1",
      "\u8FD9",
      "\u4ED6",
      "\u5979",
      "\u5B83",
      "\u4EEC",
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "can",
      "shall",
      "to",
      "of",
      "in",
      "for",
      "on",
      "with",
      "at",
      "by",
      "from",
      "as",
      "into",
      "through",
      "during",
      "before",
      "after",
      "and",
      "but",
      "or",
      "nor",
      "not",
      "so",
      "yet",
      "if",
      "then",
      "this",
      "that",
      "these",
      "those",
      "it",
      "its",
      "my",
      "your",
      "\u6211\u4EEC",
      "\u4F60\u4EEC",
      "\u4ED6\u4EEC",
      "\u8FD9\u4E2A",
      "\u90A3\u4E2A",
      "\u4EC0\u4E48",
      "\u600E\u4E48",
      "\u4E3A\u4EC0\u4E48",
      "\u504F\u597D",
      "\u559C\u6B22",
      "\u9700\u8981",
      "\u60F3\u8981",
      "\u53EF\u4EE5",
      "\u5E94\u8BE5",
      "\u4F1A",
      "\u80FD"
    ]);
    return text.toLowerCase().split(/[\s,，。！？、；：""''（）()\[\]【】{}]+/).filter((t) => t.length >= 2 && !stopWords.has(t));
  }
  /**
   * 将数据库行转为 Observation
   */
  _rowToObservation(row) {
    let parsedBody = {};
    try {
      parsedBody = JSON.parse(row.body ?? "{}");
    } catch {
    }
    return {
      id: row.id,
      type: parsedBody.type ?? "preference",
      domain: parsedBody.domain ?? "general",
      content: row.summary ?? "",
      confidence: parsedBody.confidence ?? 0.5,
      sourceSession: parsedBody.sourceSession ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tags: (() => {
        try {
          return JSON.parse(row.tags ?? "[]");
        } catch {
          return [];
        }
      })(),
      contradicted: parsedBody.contradicted ?? false,
      contradictedBy: parsedBody.contradictedBy ?? null
    };
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-graph/src/procedure-memory.js
var DEFAULT_PROCEDURE_CONFIG = {
  enabled: true,
  defaultLimit: 10,
  matchThreshold: 0.5,
  ttlDays: 180,
  minExecutionCountForRecommendation: 3
};
var ProcedureMemoryEngine = class {
  db;
  config;
  constructor(db, config = {}) {
    this.db = db;
    this.config = { ...DEFAULT_PROCEDURE_CONFIG, ...config };
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
   * 记录工作流程
   *
   * 将工作流程保存为 procedure 节点。
   */
  record(record) {
    const now = Date.now();
    const id = `proc-${now}-${crypto.randomUUID().slice(0, 8)}`;
    const node = this.db.createNode({
      id,
      title: record.title,
      summary: record.description,
      body: JSON.stringify({
        version: record.version,
        parentId: record.parentId,
        inputs: record.inputs,
        outputs: record.outputs,
        steps: record.steps,
        metadata: record.metadata
      }),
      importance: 7,
      status: "active",
      source: "system",
      sourceSession: null,
      tags: ["procedure", ...record.metadata.tags, record.metadata.category],
      nodeType: "procedure",
      ttlDays: this.config.ttlDays,
      scope: "public",
      tierMin: 1,
      negativeExamples: [],
      isDeprecated: false,
      deprecatedAt: null,
      userId: record.author
    });
    const procedure = {
      ...record,
      id: node.id,
      createdAt: now,
      updatedAt: now,
      nodeType: "procedure"
    };
    return procedure;
  }
  /**
   * 查找工作流程
   *
   * 基于标签、描述、输入输出的文本匹配。
   */
  find(query) {
    const limit = query.limit || this.config.defaultLimit;
    const conditions = ["node_type = 'procedure' AND status = 'active'"];
    const params = [];
    if (query.tags && query.tags.length > 0) {
      const tagConditions = query.tags.map((tag) => `tags LIKE ?`).join(" OR ");
      conditions.push(`(${tagConditions})`);
      query.tags.forEach((tag) => params.push(`%"${tag}"%`));
    }
    if (query.category) {
      conditions.push("tags LIKE ?");
      params.push(`%"${query.category}"%`);
    }
    if (query.author) {
      conditions.push("user_id = ?");
      params.push(query.author);
    }
    if (query.minExecutionCount !== void 0) {
      conditions.push(`CAST(JSON_EXTRACT(body, '$.metadata.executionCount') AS INTEGER) >= ?`);
      params.push(query.minExecutionCount);
    }
    const whereClause = conditions.join(" AND ");
    const sql = `SELECT * FROM memory_nodes WHERE ${whereClause} ORDER BY created_at DESC LIMIT ?`;
    params.push(limit * 2);
    const rawDb = this.db.getRawDb();
    const rows = rawDb.prepare(sql).all(...params);
    const candidates = rows.map((row) => ({
      procedure: this._rowToProcedure(row),
      text: `${row.title} ${row.summary}`.toLowerCase()
    }));
    const matches = candidates.map(({ procedure, text }) => {
      const reasons = [];
      let score = 0;
      if (query.text) {
        const queryLower = query.text.toLowerCase();
        const queryTerms = queryLower.split(/\s+/).filter((t) => t.length >= 2);
        let textMatchCount = 0;
        for (const term of queryTerms) {
          if (text.includes(term)) {
            textMatchCount++;
            reasons.push(`\u6587\u672C\u5339\u914D: ${term}`);
          }
        }
        const textScore = queryTerms.length > 0 ? textMatchCount / queryTerms.length : 0;
        score += textScore * 0.4;
      }
      if (query.tags && query.tags.length > 0) {
        const matchedTags = query.tags.filter((tag) => procedure.metadata.tags.includes(tag));
        const tagScore = matchedTags.length / query.tags.length;
        score += tagScore * 0.3;
        if (matchedTags.length > 0) {
          reasons.push(`\u6807\u7B7E\u5339\u914D: ${matchedTags.join(", ")}`);
        }
      }
      const successRate = procedure.metadata.executionCount > 0 ? procedure.metadata.successCount / procedure.metadata.executionCount : 0;
      score += successRate * 0.2;
      const frequencyScore = Math.min(procedure.metadata.executionCount / 10, 1);
      score += frequencyScore * 0.1;
      if (score < this.config.matchThreshold) {
        return null;
      }
      return { procedure, score: Math.min(score, 1), reasons };
    }).filter(Boolean);
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit);
  }
  /**
   * 执行工作流程
   *
   * 记录执行过程，追踪成功率。
   */
  execute(procedureId, inputs) {
    const startTime = Date.now();
    const executionId = `exec-${startTime}-${crypto.randomUUID().slice(0, 8)}`;
    const node = this.db.getNode(procedureId);
    if (!node) {
      throw new Error(`Procedure not found: ${procedureId}`);
    }
    const procedure = this._nodeToProcedure(node);
    this._validateInputs(procedure.inputs, inputs);
    const stepLogs = procedure.steps.map((step) => ({
      stepOrder: step.order,
      status: "success",
      startedAt: startTime,
      completedAt: startTime + 100,
      output: `\u6A21\u62DF\u6267\u884C: ${step.name}`
    }));
    const executionTimeMs = Date.now() - startTime;
    const result = "success";
    this._updateProcedureMetadata(procedureId, result, executionTimeMs);
    const execution = {
      id: executionId,
      procedureId,
      procedureVersion: procedure.version,
      inputs,
      result,
      outputs: {},
      executionTimeMs,
      stepLogs,
      executedAt: startTime
    };
    return execution;
  }
  /**
   * 获取工作流程详情
   */
  get(procedureId) {
    const node = this.db.getNode(procedureId);
    if (!node || node.nodeType !== "procedure" || node.status !== "active") {
      return null;
    }
    return this._nodeToProcedure(node);
  }
  /**
   * 列出所有工作流程
   */
  list(filters) {
    const conditions = ["node_type = 'procedure' AND status = 'active'"];
    const params = [];
    if (filters?.category) {
      conditions.push("tags LIKE ?");
      params.push(`%"${filters.category}"%`);
    }
    if (filters?.author) {
      conditions.push("user_id = ?");
      params.push(filters.author);
    }
    if (filters?.tags && filters.tags.length > 0) {
      const tagConditions = filters.tags.map((tag) => `tags LIKE ?`).join(" OR ");
      conditions.push(`(${tagConditions})`);
      filters.tags.forEach((tag) => params.push(`%"${tag}"%`));
    }
    const whereClause = conditions.join(" AND ");
    const limit = filters?.limit || 50;
    const sql = `SELECT * FROM memory_nodes WHERE ${whereClause} ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    const rawDb = this.db.getRawDb();
    const rows = rawDb.prepare(sql).all(...params);
    return rows.map((row) => this._rowToProcedure(row));
  }
  /**
   * 获取推荐工作流程
   *
   * 基于历史执行数据，推荐高成功率、高频次的工作流程。
   */
  getRecommendations(filters) {
    const limit = filters?.limit || 5;
    const matches = this.find({
      category: filters?.category,
      minExecutionCount: this.config.minExecutionCountForRecommendation,
      minSuccessRate: 0.8,
      limit: limit * 2
    });
    matches.sort((a, b) => {
      const scoreA = a.score + a.procedure.metadata.successCount / Math.max(a.procedure.metadata.executionCount, 1) * 0.3;
      const scoreB = b.score + b.procedure.metadata.successCount / Math.max(b.procedure.metadata.executionCount, 1) * 0.3;
      return scoreB - scoreA;
    });
    return matches.slice(0, limit);
  }
  /**
   * 删除工作流程（软删除）
   */
  delete(procedureId) {
    try {
      this.db.updateNode(procedureId, {
        status: "archived",
        importance: 1
      });
      return true;
    } catch {
      return false;
    }
  }
  /**
   * 更新工作流程（创建新版本）
   */
  update(procedureId, updates) {
    const existing = this.get(procedureId);
    if (!existing) {
      return null;
    }
    const newRecord = this.record({
      ...existing,
      ...updates,
      version: this._incrementVersion(existing.version),
      parentId: existing.id
    });
    this.db.updateNode(procedureId, {
      status: "archived",
      importance: 1
    });
    return newRecord;
  }
  // ===== Private: Helpers =====
  /**
   * 验证输入参数
   */
  _validateInputs(schema, inputs) {
    const missing = [];
    const invalid = [];
    for (const input of schema) {
      const value = inputs[input.name];
      if (input.required && value === void 0) {
        missing.push(input.name);
        continue;
      }
      if (value !== void 0) {
        const typeMatch = input.type === "string" && typeof value === "string" || input.type === "number" && typeof value === "number" || input.type === "boolean" && typeof value === "boolean" || input.type === "array" && Array.isArray(value) || input.type === "object" && typeof value === "object" && !Array.isArray(value);
        if (!typeMatch) {
          invalid.push(`${input.name} (expected ${input.type})`);
        }
        if (input.validation) {
          if (input.validation.pattern && typeof value === "string") {
            const regex = new RegExp(input.validation.pattern);
            if (!regex.test(value)) {
              invalid.push(`${input.name} (pattern mismatch)`);
            }
          }
          if (input.validation.min !== void 0 && typeof value === "number" && value < input.validation.min) {
            invalid.push(`${input.name} (min: ${input.validation.min})`);
          }
          if (input.validation.max !== void 0 && typeof value === "number" && value > input.validation.max) {
            invalid.push(`${input.name} (max: ${input.validation.max})`);
          }
          if (input.validation.enum && !input.validation.enum.includes(value)) {
            invalid.push(`${input.name} (not in enum)`);
          }
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(`Missing required inputs: ${missing.join(", ")}`);
    }
    if (invalid.length > 0) {
      throw new Error(`Invalid inputs: ${invalid.join(", ")}`);
    }
  }
  /**
   * 更新 Procedure 元数据
   */
  _updateProcedureMetadata(procedureId, result, executionTimeMs) {
    const node = this.db.getNode(procedureId);
    if (!node)
      return;
    const procedure = this._nodeToProcedure(node);
    const metadata = procedure.metadata;
    const newMetadata = {
      ...metadata,
      executionCount: metadata.executionCount + 1,
      successCount: result === "success" ? metadata.successCount + 1 : metadata.successCount,
      failureCount: result === "failure" ? metadata.failureCount + 1 : metadata.failureCount,
      lastExecutedAt: Date.now(),
      lastExecutionResult: result,
      averageExecutionTimeMs: (metadata.averageExecutionTimeMs * metadata.executionCount + executionTimeMs) / (metadata.executionCount + 1)
    };
    this.db.updateNode(procedureId, {
      body: JSON.stringify({
        ...JSON.parse(node.body),
        metadata: newMetadata
      })
    });
  }
  /**
   * 版本号递增（语义化版本）
   * 1.0.0 → 1.1.0（次要版本递增）
   * 1.1.0 → 1.2.0
   * 1.1.3 → 1.2.0（修订版归零）
   */
  _incrementVersion(version) {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
    if (!match) {
      return `1.0.0`;
    }
    const [_, major, minor, patch, suffix = ""] = match;
    return `${major}.${Number(minor) + 1}.0${suffix}`;
  }
  /**
   * 节点转 ProcedureRecord
   */
  _nodeToProcedure(node) {
    let body = {};
    try {
      body = JSON.parse(node.body || "{}");
    } catch {
    }
    return {
      id: node.id,
      title: node.title,
      description: node.summary,
      version: body.version || "1.0.0",
      parentId: body.parentId,
      inputs: body.inputs || [],
      outputs: body.outputs || [],
      steps: body.steps || [],
      metadata: body.metadata || {
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        averageExecutionTimeMs: 0,
        tags: [],
        category: "general",
        difficulty: 3,
        estimatedDurationMinutes: 10
      },
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      author: node.userId,
      nodeType: "procedure"
    };
  }
  /**
   * 数据库行转 ProcedureRecord
   */
  _rowToProcedure(row) {
    const node = row;
    return this._nodeToProcedure(node);
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-graph/src/hook-system.js
var DEFAULT_HOOK_CONFIG = {
  enabled: true,
  globalMaxRetries: 3,
  globalRetryDelayMs: 1e3,
  globalAllowDegraded: true,
  executionTimeoutMs: 3e4,
  enableLogging: true
};
var HookSystem = class {
  config;
  hooks = /* @__PURE__ */ new Map();
  executionLogs = [];
  maxLogSize = 1e3;
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
      console.warn(`[HookSystem] Hook ${hook.name} \u6CE8\u518C\u4F46\u7CFB\u7EDF\u5DF2\u7981\u7528`);
    }
    const fullHook = {
      ...hook,
      registeredAt: Date.now(),
      executionCount: 0,
      failureCount: 0
    };
    this.hooks.set(hook.id, fullHook);
    if (this.config.enableLogging) {
      console.log(`[HookSystem] Hook \u5DF2\u6CE8\u518C: ${hook.name} (\u4E8B\u4EF6: ${hook.event}, \u4F18\u5148\u7EA7: ${hook.priority})`);
    }
  }
  /**
   * 注销 Hook
   */
  unregister(hookId) {
    const deleted = this.hooks.delete(hookId);
    if (deleted && this.config.enableLogging) {
      console.log(`[HookSystem] Hook \u5DF2\u6CE8\u9500: ${hookId}`);
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
      ...context
    };
    const matchingHooks = Array.from(this.hooks.values()).filter((hook) => hook.event === event && hook.enabled).filter((hook) => this.checkPermissions(hook, context)).filter((hook) => this.checkVersion(hook)).sort((a, b) => a.priority - b.priority);
    if (this.config.enableLogging) {
      console.log(`[HookSystem] \u89E6\u53D1\u4E8B\u4EF6: ${event} (${matchingHooks.length} \u4E2A Hook)`);
    }
    const results = await Promise.allSettled(matchingHooks.map((hook) => this.executeHook(hook, fullContext, payload)));
    const hookResults = results.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        return {
          success: false,
          executionTimeMs: 0,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason)
        };
      }
    });
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
    if (filters?.event !== void 0) {
      hooks = hooks.filter((h) => h.event === filters.event);
    }
    if (filters?.enabled !== void 0) {
      hooks = hooks.filter((h) => h.enabled === filters.enabled);
    }
    if (filters?.clientId !== void 0) {
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
      system_shutdown: 0
    };
    hooks.forEach((hook) => {
      byEvent[hook.event] += hook.executionCount;
    });
    const avgExecutionTimeMs = this.executionLogs.length > 0 ? this.executionLogs.reduce((sum, log) => sum + log.result.executionTimeMs, 0) / this.executionLogs.length : 0;
    return {
      totalHooks: hooks.length,
      enabledHooks: hooks.filter((h) => h.enabled).length,
      totalExecutions,
      totalFailures,
      byEvent,
      avgExecutionTimeMs
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
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Hook \u6267\u884C\u8D85\u65F6 (${this.config.executionTimeoutMs}ms)`)), this.config.executionTimeoutMs);
        });
        const result = await Promise.race([hook.handler(context, payload), timeoutPromise]);
        const executionTimeMs = Date.now() - startTime;
        hook.executionCount++;
        hook.lastExecutedAt = Date.now();
        if (this.config.enableLogging) {
          console.log(`[HookSystem] \u2705 ${hook.name} \u6267\u884C\u6210\u529F (${executionTimeMs}ms)`);
        }
        return {
          success: true,
          executionTimeMs,
          data: result.data
        };
      } catch (err) {
        const executionTimeMs = Date.now() - startTime;
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          if (this.config.enableLogging) {
            console.warn(`[HookSystem] \u26A0\uFE0F ${hook.name} \u6267\u884C\u5931\u8D25\uFF0C\u91CD\u8BD5 (${attempt + 1}/${maxRetries})...`);
          }
          await this.sleep(retryDelayMs * (attempt + 1));
          continue;
        }
        hook.failureCount++;
        if (this.config.enableLogging) {
          console.error(`[HookSystem] \u274C ${hook.name} \u6267\u884C\u5931\u8D25 (${maxRetries + 1} \u6B21\u5C1D\u8BD5):`, lastError.message);
        }
        if (allowDegraded) {
          return {
            success: false,
            executionTimeMs,
            error: lastError.message,
            degraded: true
          };
        }
        return {
          success: false,
          executionTimeMs,
          error: lastError.message
        };
      }
    }
    return {
      success: false,
      executionTimeMs: 0,
      error: lastError?.message ?? "\u672A\u77E5\u9519\u8BEF"
    };
  }
  /**
   * 检查客户端权限
   */
  checkPermissions(hook, context) {
    if (!hook.allowedClients || hook.allowedClients.length === 0) {
      return true;
    }
    if (!context.clientId) {
      return false;
    }
    return hook.allowedClients.includes(context.clientId);
  }
  /**
   * 检查版本约束
   */
  checkVersion(hook) {
    if (!hook.versionConstraint) {
      return true;
    }
    const currentVersion = this.config.enabled ? "1.0.0" : "0.0.0";
    const constraint = hook.versionConstraint;
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
        executionTimeMs: Math.max(...results.map((r) => r.executionTimeMs))
      },
      startedAt: context.timestamp,
      completedAt: Date.now(),
      context,
      payload
    };
    this.executionLogs.push(log);
    if (this.executionLogs.length > this.maxLogSize) {
      this.executionLogs = this.executionLogs.slice(-this.maxLogSize);
    }
  }
  /**
   * 延迟函数
   */
  sleep(ms2) {
    return new Promise((resolve) => setTimeout(resolve, ms2));
  }
};
function createHealthCheckHook() {
  return {
    id: "health-check-logger",
    name: "\u5065\u5EB7\u68C0\u67E5\u65E5\u5FD7",
    description: "\u5728\u5065\u5EB7\u68C0\u67E5\u65F6\u81EA\u52A8\u8BB0\u5F55\u65E5\u5FD7",
    event: "health_check",
    priority: 100,
    enabled: true,
    maxRetries: 0,
    retryDelayMs: 0,
    allowDegraded: true,
    handler: async (context, payload) => {
      console.log(`[Hook:health-check] \u7528\u6237 ${context.userId ?? "unknown"} \u89E6\u53D1\u5065\u5EB7\u68C0\u67E5`);
      return { success: true, executionTimeMs: 0 };
    }
  };
}
function createSystemStartupHook() {
  return {
    id: "system-startup-init",
    name: "\u7CFB\u7EDF\u542F\u52A8\u521D\u59CB\u5316",
    description: "\u7CFB\u7EDF\u542F\u52A8\u65F6\u6267\u884C\u521D\u59CB\u5316\u68C0\u67E5",
    event: "system_startup",
    priority: 10,
    enabled: true,
    maxRetries: 3,
    retryDelayMs: 1e3,
    allowDegraded: true,
    handler: async (context, payload) => {
      console.log(`[Hook:system-startup] \u7CFB\u7EDF\u542F\u52A8\u5B8C\u6210\uFF0CHook \u7CFB\u7EDF\u5C31\u7EEA`);
      return { success: true, executionTimeMs: 0 };
    }
  };
}

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-orchestrator/src/memory-logger.js
var LEVEL_NUM = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4
};
var DEFAULT_CONFIG3 = {
  bufferSize: 1e3,
  minLevel: "debug",
  persistErrors: true
};
var MemoryLogger = class {
  config;
  buffer = [];
  nextId = 0;
  onLogCallbacks = [];
  onErrorCallbacks = [];
  persistDb = null;
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG3, ...config };
  }
  /** 绑定 SQLite 持久化（会在 MemorySystem.init 时自动设置） */
  setPersistDb(db) {
    this.persistDb = db;
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
      context: ctx
    });
  }
  fatal(module, operation, message, err, ctx) {
    this.log("fatal", module, operation, message, {
      error: err?.message ?? String(err),
      stack: err?.stack,
      context: ctx
    });
  }
  /** 带耗时的操作日志 */
  timed(module, operation, fn, ctx) {
    const start = performance.now();
    return fn().then((result) => {
      const duration = Math.round(performance.now() - start);
      this.log("info", module, operation, "OK", { duration, context: ctx });
      return result;
    }).catch((err) => {
      const duration = Math.round(performance.now() - start);
      this.log("error", module, operation, err.message, {
        duration,
        error: err.message,
        stack: err.stack,
        context: ctx
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
  getRecentErrorCount(sinceMs = 36e5) {
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
      ...extra
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.config.bufferSize) {
      this.buffer.shift();
    }
    for (const cb of this.onLogCallbacks) {
      try {
        cb(entry);
      } catch {
      }
    }
    if (LEVEL_NUM[level] >= LEVEL_NUM.error) {
      for (const cb of this.onErrorCallbacks) {
        try {
          cb(entry);
        } catch {
        }
      }
    }
    if (this.persistDb && this.config.persistErrors && LEVEL_NUM[level] >= LEVEL_NUM.error) {
      try {
        this.persistDb.run(`INSERT INTO memory_logs (timestamp, level, module, operation, message, duration, error, stack, context_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, entry.timestamp, entry.level, entry.module, entry.operation, entry.message, entry.duration ?? null, entry.error ?? null, entry.stack ?? null, entry.context ? JSON.stringify(entry.context) : null);
      } catch {
      }
    }
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-orchestrator/src/memory-watchdog.js
var DEFAULT_CONFIG4 = {
  checkIntervalMs: 6e4,
  operationTimeoutMs: 5e3,
  errorThreshold: 5,
  autoStart: true,
  historySize: 60
};
var MemoryWatchdog = class {
  config;
  memoryDb;
  vectorStore;
  embedder;
  obsidianWriter;
  logger;
  timer = null;
  _status = null;
  _previousStatus = null;
  _startTime = Date.now();
  _healthHistory = [];
  _totalChecks = 0;
  // 操作状态追踪
  _lastWriteOk = true;
  _lastWriteTime = Date.now();
  _lastQueryOk = true;
  _lastQueryTime = Date.now();
  _lastDreamOk = true;
  _lastDreamTime = Date.now();
  onHealthChangeCallbacks = [];
  onUnhealthyCallbacks = [];
  onReportCallbacks = [];
  constructor(memoryDb, vectorStore, embedder, logger, obsidianWriter, config = {}) {
    this.memoryDb = memoryDb;
    this.vectorStore = vectorStore;
    this.embedder = embedder;
    this.logger = logger;
    this.obsidianWriter = obsidianWriter;
    this.config = { ...DEFAULT_CONFIG4, ...config };
  }
  // ===== Operation Status =====
  recordWrite(success) {
    this._lastWriteOk = success;
    this._lastWriteTime = Date.now();
  }
  recordQuery(success) {
    this._lastQueryOk = success;
    this._lastQueryTime = Date.now();
  }
  recordDream(success) {
    this._lastDreamOk = success;
    this._lastDreamTime = Date.now();
  }
  // ===== Callbacks =====
  /** 健康状态变化时触发 */
  onHealthChange(cb) {
    this.onHealthChangeCallbacks.push(cb);
  }
  /** 系统不健康时触发 */
  onUnhealthy(cb) {
    this.onUnhealthyCallbacks.push(cb);
  }
  /** 评估报告生成时触发 */
  onReport(cb) {
    this.onReportCallbacks.push(cb);
  }
  // ===== Health Check =====
  async checkHealth(type = "periodic") {
    const startTime = performance.now();
    const now = Date.now();
    const graphDb = await this.checkComponent(async () => {
      const stats = this.memoryDb.getStats();
      if (stats.totalNodes < 0)
        throw new Error("Invalid node count");
    });
    const vectorStore = await this.checkComponent(async () => {
      const vecStats = this.vectorStore.stats();
      return { totalEntries: vecStats.totalEntries };
    });
    const embedder = await this.checkComponent(async () => {
      const vec = await this.embedder.embed("health check");
      if (!vec || vec.length === 0)
        throw new Error("Embedder returned empty vector");
    });
    let obsidianWriter = { ok: true };
    if (this.obsidianWriter) {
      obsidianWriter = await this.checkComponent(async () => {
        const count = this.obsidianWriter.count?.() ?? 0;
        return { count };
      });
    }
    const recentErrors = this.logger.getRecentErrorCount(36e5);
    const operations = {
      lastWriteOk: this._lastWriteOk,
      lastWriteAgoMs: now - this._lastWriteTime,
      lastQueryOk: this._lastQueryOk,
      lastQueryAgoMs: now - this._lastQueryTime,
      lastDreamOk: this._lastDreamOk,
      lastDreamAgoMs: now - this._lastDreamTime
    };
    const healthy = graphDb.ok && vectorStore.ok && embedder.ok && obsidianWriter.ok && recentErrors < this.config.errorThreshold;
    let score = 10;
    if (!graphDb.ok)
      score -= 3;
    if (!vectorStore.ok)
      score -= 2;
    if (!embedder.ok)
      score -= 2;
    if (!obsidianWriter.ok)
      score -= 1;
    if (recentErrors >= this.config.errorThreshold)
      score -= 2;
    score = Math.max(0, Math.min(10, score));
    const status = {
      healthy,
      timestamp: Date.now(),
      uptimeMs: now - this._startTime,
      graphDb,
      vectorStore: { ...vectorStore, ...vectorStore.extra },
      embedder,
      obsidianWriter: { ...obsidianWriter, ...obsidianWriter.extra },
      operations,
      recentErrors,
      score
    };
    delete status.vectorStore.extra;
    delete status.obsidianWriter.extra;
    this._healthHistory.push(status);
    if (this._healthHistory.length > this.config.historySize) {
      this._healthHistory.shift();
    }
    this._totalChecks++;
    this._previousStatus = this._status;
    this._status = status;
    const previous = this._previousStatus;
    const healthChanged = previous && previous.healthy !== healthy;
    if (healthChanged) {
      for (const cb of this.onHealthChangeCallbacks) {
        try {
          cb(status, previous);
        } catch {
        }
      }
    }
    if (!healthy) {
      this.logger.warn("watchdog", "checkHealth", `\u7CFB\u7EDF\u4E0D\u5065\u5EB7 \u8BC4\u5206:${score}/10 graphDb:${graphDb.ok} vectorStore:${vectorStore.ok} embedder:${embedder.ok} \u9519\u8BEF\u6570:${recentErrors}`);
      const report = this.generateReport(status, type);
      for (const cb of this.onReportCallbacks) {
        try {
          cb(report);
        } catch {
        }
      }
      for (const cb of this.onUnhealthyCallbacks) {
        try {
          cb(status);
        } catch {
        }
      }
    }
    const elapsed = Math.round(performance.now() - startTime);
    if (elapsed > 1e3) {
      this.logger.warn("watchdog", "checkHealth", `\u5065\u5EB7\u68C0\u67E5\u8017\u65F6 ${elapsed}ms\uFF0C\u8D85\u8FC7\u9884\u671F`);
    }
    return status;
  }
  // ===== Evaluation Report =====
  /**
   * 生成系统评估报告。
   * 报告包含：组件状态、错误汇总、趋势分析、修复建议。
   * 可在不健康时自动生成，也可手动调用。
   */
  generateReport(status, type = "on_demand") {
    const s = status ?? this._status;
    const now = Date.now();
    if (!s) {
      return {
        id: crypto.randomUUID(),
        timestamp: now,
        type,
        uptime: this.getUptime(),
        overallScore: 10,
        healthy: true,
        summary: "\u7CFB\u7EDF\u521D\u59CB\u5316\u4E2D\uFF0C\u5C1A\u65E0\u6570\u636E",
        summaryZh: "\u7CFB\u7EDF\u521D\u59CB\u5316\u4E2D\uFF0C\u5C1A\u65E0\u6570\u636E",
        components: [],
        errorSummary: [],
        totalErrorsLastHour: 0,
        operations: {
          lastWriteOk: true,
          lastWriteAgo: "N/A",
          lastQueryOk: true,
          lastQueryAgo: "N/A",
          lastDreamOk: true,
          lastDreamAgo: "N/A"
        },
        trend: "stable",
        scoreHistory: [],
        recommendations: ["\u7CFB\u7EDF\u521D\u59CB\u5316\u4E2D\uFF0C\u8BF7\u7B49\u5F85\u9996\u6B21\u5065\u5EB7\u68C0\u67E5"],
        raw: {}
      };
    }
    const components = this.scoreComponents(s);
    const recentErrors = this.logger.getErrorsSince(now - 36e5);
    const errorSummary = this.summarizeErrors(recentErrors);
    const trend = this.computeTrend();
    const scoreHistory = this._healthHistory.map((h) => h.score);
    const fmt = (agoMs) => {
      if (agoMs < 6e4)
        return `${Math.round(agoMs / 1e3)}s \u524D`;
      if (agoMs < 36e5)
        return `${Math.round(agoMs / 6e4)}m \u524D`;
      return `${Math.round(agoMs / 36e5)}h \u524D`;
    };
    const ops = {
      lastWriteOk: s.operations.lastWriteOk,
      lastWriteAgo: fmt(s.operations.lastWriteAgoMs),
      lastQueryOk: s.operations.lastQueryOk,
      lastQueryAgo: fmt(s.operations.lastQueryAgoMs),
      lastDreamOk: s.operations.lastDreamOk,
      lastDreamAgo: fmt(s.operations.lastDreamAgoMs)
    };
    const recommendations = this.generateRecommendations(s);
    const { summary, summaryZh } = this.summarize(s);
    return {
      id: crypto.randomUUID(),
      timestamp: now,
      type,
      uptime: this.getUptime(),
      overallScore: s.score,
      healthy: s.healthy,
      summary,
      summaryZh,
      components,
      errorSummary,
      totalErrorsLastHour: s.recentErrors,
      operations: ops,
      trend,
      scoreHistory,
      recommendations,
      raw: s
    };
  }
  /** 生成格式化文本报告（可直接输出到控制台/通知） */
  formatReport(report) {
    const r = report ?? this.generateReport();
    const lines = [];
    lines.push("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501");
    lines.push(`  \u8BB0\u5FC6\u7CFB\u7EDF\u8BC4\u4F30\u62A5\u544A`);
    lines.push(`  ${r.summaryZh}`);
    lines.push(`  \u8BC4\u5206: ${r.overallScore}/10  |  \u72B6\u6001: ${r.healthy ? "\u2705 \u5065\u5EB7" : "\u26A0 \u5F02\u5E38"}  |  \u8D8B\u52BF: ${this.trendEmoji(r.trend)}`);
    lines.push(`  \u8FD0\u884C\u65F6\u957F: ${r.uptime}  |  \u62A5\u544A\u7C7B\u578B: ${r.type}`);
    lines.push("\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501");
    lines.push("");
    lines.push("\u{1F4CA} \u7EC4\u4EF6\u72B6\u6001:");
    for (const c of r.components) {
      const icon = c.status === "healthy" ? "\u2705" : c.status === "degraded" ? "\u26A0" : "\u274C";
      const lat = c.latencyMs != null ? ` ${c.latencyMs}ms` : "";
      const err = c.error ? `  \u2192 ${c.error}` : "";
      lines.push(`  ${icon} ${c.name.padEnd(16)} ${c.score}/10${lat}${err}`);
    }
    lines.push("");
    lines.push("\u26A1 \u64CD\u4F5C\u72B6\u6001:");
    for (const [name2, ok, ago] of [
      ["\u5199\u5165", r.operations.lastWriteOk, r.operations.lastWriteAgo],
      ["\u67E5\u8BE2", r.operations.lastQueryOk, r.operations.lastQueryAgo],
      ["\u68A6\u5883", r.operations.lastDreamOk, r.operations.lastDreamAgo]
    ]) {
      lines.push(`  ${ok ? "\u2705" : "\u274C"} ${name2.padEnd(8)} ${ago}`);
    }
    if (r.errorSummary.length > 0) {
      lines.push("");
      lines.push(`\u{1F6A8} \u8FD1\u671F\u9519\u8BEF (${r.totalErrorsLastHour} \u6761/\u5C0F\u65F6):`);
      for (const e of r.errorSummary.slice(0, 5)) {
        lines.push(`  [${e.module}] ${e.message} (\xD7${e.count})`);
      }
      if (r.errorSummary.length > 5) {
        lines.push(`  ... \u8FD8\u6709 ${r.errorSummary.length - 5} \u7C7B\u9519\u8BEF\u672A\u663E\u793A`);
      }
    }
    if (r.scoreHistory.length >= 2) {
      const window = r.scoreHistory.slice(-10);
      const bar = window.map((s) => {
        const full = Math.round(s / 2);
        return "\u2588".repeat(full) + "\u2591".repeat(5 - full);
      }).join(" ");
      lines.push("");
      lines.push(`\u{1F4C8} \u8BC4\u5206\u8D8B\u52BF (\u6700\u8FD1 ${window.length} \u6B21):`);
      lines.push(`  ${bar}`);
    }
    if (r.recommendations.length > 0) {
      lines.push("");
      lines.push("\u{1F4A1} \u4FEE\u590D\u5EFA\u8BAE:");
      for (const rec of r.recommendations) {
        lines.push(`  \u2022 ${rec}`);
      }
    }
    lines.push("");
    lines.push(`\u62A5\u544A ID: ${r.id}  |  \u751F\u6210\u65F6\u95F4: ${new Date(r.timestamp).toLocaleString()}`);
    return lines.join("\n");
  }
  // ===== Getters =====
  get lastStatus() {
    return this._status;
  }
  get score() {
    return this._status?.score ?? 10;
  }
  get totalChecks() {
    return this._totalChecks;
  }
  get healthHistory() {
    return [...this._healthHistory];
  }
  // ===== Auto Check =====
  start() {
    if (this.timer)
      return;
    this.timer = setInterval(() => {
      this.checkHealth("periodic").catch((err) => {
        this.logger.error("watchdog", "autoCheck", `\u5B9A\u65F6\u68C0\u67E5\u5931\u8D25: ${err.message}`, err);
      });
    }, this.config.checkIntervalMs);
    this.logger.info("watchdog", "start", `\u5065\u5EB7\u68C0\u67E5\u5DF2\u542F\u52A8\uFF0C\u95F4\u9694 ${this.config.checkIntervalMs}ms`);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("watchdog", "stop", "\u5065\u5EB7\u68C0\u67E5\u5DF2\u505C\u6B62");
  }
  getUptime() {
    const ms2 = Date.now() - this._startTime;
    const hours = Math.floor(ms2 / 36e5);
    const minutes = Math.floor(ms2 % 36e5 / 6e4);
    const seconds = Math.floor(ms2 % 6e4 / 1e3);
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  // ===== Private: Component Scoring =====
  scoreComponents(s) {
    return [
      {
        name: "\u56FE\u6570\u636E\u5E93",
        status: s.graphDb.ok ? "healthy" : "down",
        score: s.graphDb.ok ? 10 : 0,
        error: s.graphDb.error,
        latencyMs: s.graphDb.latencyMs,
        detail: s.graphDb.ok ? void 0 : "\u56FE\u6570\u636E\u5E93\u65E0\u54CD\u5E94\uFF0C\u8BB0\u5FC6\u5173\u8054\u67E5\u8BE2\u5C06\u5931\u8D25"
      },
      {
        name: "\u5411\u91CF\u5E93",
        status: s.vectorStore.ok ? "healthy" : "down",
        score: s.vectorStore.ok ? 10 : 0,
        error: s.vectorStore.error,
        latencyMs: s.vectorStore.latencyMs,
        detail: s.vectorStore.ok ? `\u5171 ${s.vectorStore.totalEntries} \u6761\u5411\u91CF\u7D22\u5F15` : "\u5411\u91CF\u5E93\u4E0D\u53EF\u7528\uFF0C\u8BED\u4E49\u641C\u7D22\u5C06\u964D\u7EA7"
      },
      {
        name: "Embedder",
        status: s.embedder.ok ? "healthy" : "down",
        score: s.embedder.ok ? 10 : 0,
        error: s.embedder.error,
        latencyMs: s.embedder.latencyMs,
        detail: s.embedder.ok ? void 0 : "\u6A21\u578B\u65E0\u6CD5\u54CD\u5E94\uFF0C\u4EFB\u4F55\u5199\u5165/\u67E5\u8BE2\u90FD\u4F1A\u5931\u8D25"
      },
      {
        name: "Obsidian \u540C\u6B65",
        status: s.obsidianWriter.ok ? "healthy" : "degraded",
        score: s.obsidianWriter.ok ? 10 : 3,
        error: s.obsidianWriter.error,
        latencyMs: s.obsidianWriter.latencyMs,
        detail: s.obsidianWriter.ok ? s.obsidianWriter.count != null ? `\u5DF2\u540C\u6B65 ${s.obsidianWriter.count} \u7BC7` : "" : "Obsidian \u540C\u6B65\u5DF2\u5173\u95ED\u6216\u521D\u59CB\u5316\u5931\u8D25"
      }
    ];
  }
  // ===== Private: Error Summarization =====
  summarizeErrors(errors) {
    const groups = /* @__PURE__ */ new Map();
    for (const e of errors) {
      const key = `${e.module}:${e.operation}:${e.message}`;
      const existing = groups.get(key);
      if (existing) {
        existing.count++;
        existing.lastSeen = Math.max(existing.lastSeen, e.timestamp);
        existing.firstSeen = Math.min(existing.firstSeen, e.timestamp);
      } else {
        groups.set(key, { count: 1, firstSeen: e.timestamp, lastSeen: e.timestamp });
      }
    }
    return [...groups.entries()].map(([_, v]) => {
      const parts = _.split(":");
      return {
        module: parts[0] ?? "unknown",
        operation: parts[1] ?? "unknown",
        message: parts.slice(2).join(":") ?? "unknown",
        count: v.count,
        firstSeen: v.firstSeen,
        lastSeen: v.lastSeen
      };
    }).sort((a, b) => b.count - a.count);
  }
  // ===== Private: Trend =====
  computeTrend() {
    if (this._healthHistory.length < 3)
      return "stable";
    const recent = this._healthHistory.slice(-5);
    const scores = recent.map((h) => h.score);
    const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
    const secondHalf = scores.slice(Math.floor(scores.length / 2));
    const avg1 = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avg2 = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    if (avg2 - avg1 > 0.5)
      return "improving";
    if (avg1 - avg2 > 0.5)
      return "degrading";
    return "stable";
  }
  // ===== Private: Recommendations =====
  generateRecommendations(s) {
    const recs = [];
    if (!s.graphDb.ok) {
      recs.push("\u56FE\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25 \u2014 \u68C0\u67E5 codegraph.db \u6587\u4EF6\u6743\u9650\u6216\u78C1\u76D8\u7A7A\u95F4");
      recs.push("\u8FD0\u884C ai-memory check \u91CD\u7F6E\u7D22\u5F15");
    }
    if (!s.vectorStore.ok) {
      recs.push("\u5411\u91CF\u5E93\u5F02\u5E38 \u2014 \u5C1D\u8BD5\u8FD0\u884C ai-memory rebuild \u91CD\u5EFA\u5411\u91CF\u7D22\u5F15");
    }
    if (!s.embedder.ok) {
      recs.push(`Embedding \u6A21\u578B\u4E0D\u53EF\u7528 \u2014 ${s.embedder.error}`);
      recs.push("\u68C0\u67E5\u6A21\u578B\u6587\u4EF6\u662F\u5426\u5B8C\u6574\uFF0C\u6216\u5207\u6362\u5230 API embedder");
    }
    if (!s.obsidianWriter.ok) {
      recs.push("Obsidian \u540C\u6B65\u5F02\u5E38 \u2014 \u68C0\u67E5 vault \u8DEF\u5F84\u914D\u7F6E\u548C\u5199\u5165\u6743\u9650");
    }
    if (!s.operations.lastWriteOk) {
      recs.push("\u6700\u8FD1\u5199\u5165\u5931\u8D25 \u2014 \u68C0\u67E5\u5B58\u50A8\u7A7A\u95F4\u548C Embedder \u72B6\u6001");
    }
    if (!s.operations.lastDreamOk) {
      recs.push("\u6700\u8FD1\u68A6\u5883\u6574\u7406\u5931\u8D25 \u2014 \u8FD0\u884C ai-memory dream \u624B\u52A8\u89E6\u53D1");
    }
    if (s.recentErrors >= this.config.errorThreshold) {
      recs.push(`1 \u5C0F\u65F6\u5185\u9519\u8BEF\u6570 (${s.recentErrors}) \u8D85\u8FC7\u9608\u503C (${this.config.errorThreshold}) \u2014 \u5EFA\u8BAE\u68C0\u67E5\u65E5\u5FD7\u5B9A\u4F4D\u6839\u56E0`);
    }
    if (s.score < 4) {
      recs.push("\u7CFB\u7EDF\u5065\u5EB7\u4E25\u91CD\u4E0D\u8DB3 \u2014 \u5EFA\u8BAE\u7ACB\u5373\u6392\u67E5\u5E76\u91CD\u542F\u8BB0\u5FC6\u7CFB\u7EDF");
    }
    return recs;
  }
  // ===== Private: Summary =====
  summarize(s) {
    const failed = [
      !s.graphDb.ok && "GraphDB",
      !s.vectorStore.ok && "VectorStore",
      !s.embedder.ok && "Embedder",
      !s.obsidianWriter.ok && "Obsidian"
    ].filter(Boolean);
    if (failed.length === 0) {
      return {
        summary: `All systems operational, score ${s.score}/10`,
        summaryZh: `\u6240\u6709\u7EC4\u4EF6\u6B63\u5E38\u8FD0\u884C\uFF0C\u8BC4\u5206 ${s.score}/10`
      };
    }
    return {
      summary: `${failed.join(", ")} malfunctioning, score ${s.score}/10`,
      summaryZh: `${failed.join("\u3001")} \u5F02\u5E38\uFF0C\u8BC4\u5206 ${s.score}/10`
    };
  }
  trendEmoji(t) {
    switch (t) {
      case "improving":
        return "\u{1F4C8}";
      case "degrading":
        return "\u{1F4C9}";
      default:
        return "\u27A1";
    }
  }
  // ===== Private: Component Check =====
  async checkComponent(fn) {
    const start = performance.now();
    try {
      const result = await fn();
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - start),
        extra: result
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Math.round(performance.now() - start)
      };
    }
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-graph/src/todo-manager.js
var TodoManager = class {
  db;
  constructor(db) {
    this.db = db;
  }
  /**
   * 创建待办
   */
  createTodo(data) {
    const result = this.db.createTodoItem({
      title: data.title,
      description: data.description,
      track: data.track,
      priority: data.priority ?? "medium",
      dueDate: data.dueDate ?? null,
      projectDir: data.projectDir ?? null,
      tags: data.tags ?? [],
      userId: data.userId ?? "default"
    });
    return Promise.resolve({
      id: result.id,
      title: result.title,
      description: data.description ?? "",
      track: result.track,
      priority: result.priority,
      status: "pending",
      dueDate: data.dueDate ?? null,
      completedAt: null,
      projectDir: data.projectDir ?? null,
      tags: data.tags ?? [],
      createdAt: result.createdAt,
      updatedAt: result.createdAt,
      userId: data.userId ?? "default"
    });
  }
  /**
   * 获取单条待办
   */
  getTodo(id) {
    const row = this.db.getTodoItem(id);
    if (!row)
      return Promise.resolve(null);
    return Promise.resolve(this.rowToTodo(row));
  }
  /**
   * 更新待办
   */
  updateTodo(id, data) {
    return Promise.resolve(this.db.updateTodoItem(id, data));
  }
  /**
   * 删除待办
   */
  deleteTodo(id) {
    return Promise.resolve(this.db.deleteTodoItem(id));
  }
  /**
   * 标记完成
   */
  completeTodo(id) {
    return Promise.resolve(this.db.completeTodoItem(id));
  }
  /**
   * 列出待办（支持多种过滤条件）
   */
  listTodos(filter) {
    const rows = this.db.listTodoItems({
      track: filter?.track,
      status: filter?.status,
      priority: filter?.priority,
      dueBefore: filter?.dueBefore,
      dueAfter: filter?.dueAfter,
      userId: filter?.userId,
      limit: filter?.limit
    });
    return Promise.resolve(rows.map((r) => this.rowToTodo(r)));
  }
  /**
   * 获取到期未完成的待办
   */
  getOverdueTodos(userId) {
    const rows = this.db.getOverdueTodoItems(userId);
    return Promise.resolve(rows.map((r) => this.rowToTodo(r)));
  }
  /**
   * 按轨道分组查看
   */
  getTodosByTrack(track, userId) {
    return this.listTodos({ track, userId });
  }
  /**
   * 获取指定时间内到期的待办
   */
  getDueTodosWithin(hours, userId) {
    const dueBefore = Date.now() + hours * 36e5;
    return this.listTodos({ dueBefore, dueAfter: Date.now(), userId });
  }
  /**
   * 每日汇总
   */
  getDailySummary(userId) {
    const base = this.db.getDailyTodoSummary(userId);
    const allTracks = ["life", "work", "project", "daily"];
    const byTrack = {};
    for (const track of allTracks) {
      const rows = this.db.listTodoItems({ track, userId, limit: 9999 });
      byTrack[track] = rows.length;
    }
    return Promise.resolve({
      ...base,
      byTrack
    });
  }
  // ===== Helpers =====
  rowToTodo(row) {
    return {
      id: row.id,
      title: row.title,
      description: row.description ?? "",
      track: row.track,
      priority: row.priority,
      status: row.status,
      dueDate: row.due_date ?? null,
      completedAt: row.completed_at ?? null,
      projectDir: row.project_dir ?? null,
      tags: (() => {
        try {
          return JSON.parse(row.tags ?? "[]");
        } catch {
          return [];
        }
      })(),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      userId: row.user_id ?? "default"
    };
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-graph/src/prompt-manager.js
var PromptManager = class {
  db;
  constructor(db) {
    this.db = db;
  }
  /**
   * 创建提示词模板
   */
  createTemplate(data) {
    const result = this.db.createPromptTemplate({
      name: data.name,
      category: data.category,
      content: data.content,
      description: data.description,
      tags: data.tags,
      version: data.version ?? "1.0.0"
    });
    return Promise.resolve({
      id: result.id,
      name: result.name,
      category: result.category,
      content: data.content,
      description: data.description ?? "",
      tags: data.tags ?? [],
      version: result.version,
      enabled: true,
      createdAt: result.createdAt,
      updatedAt: result.createdAt
    });
  }
  /**
   * 获取单条模板
   */
  getTemplate(id) {
    const row = this.db.getPromptTemplate(id);
    if (!row)
      return Promise.resolve(null);
    return Promise.resolve(this.rowToTemplate(row));
  }
  /**
   * 按名称获取模板
   */
  getTemplateByName(name2) {
    const row = this.db.getPromptTemplateByName(name2);
    if (!row)
      return Promise.resolve(null);
    return Promise.resolve(this.rowToTemplate(row));
  }
  /**
   * 更新模板（自动版本递增）
   */
  updateTemplate(id, data) {
    if (data.content !== void 0) {
      const existing = this.db.getPromptTemplate(id);
      if (existing) {
        const currentVersion = existing.version ?? "1.0.0";
        const parts = currentVersion.split(".").map(Number);
        const newVersion = `${parts[0]}.${(parts[1] ?? 0) + 1}.0`;
        data.version = newVersion;
      }
    }
    return Promise.resolve(this.db.updatePromptTemplate(id, data));
  }
  /**
   * 删除模板
   */
  deleteTemplate(id) {
    return Promise.resolve(this.db.deletePromptTemplate(id));
  }
  /**
   * 列出模板（支持分类/启用状态过滤）
   */
  listTemplates(filter) {
    const rows = this.db.listPromptTemplates({
      category: filter?.category,
      enabled: filter?.enabled,
      limit: filter?.limit
    });
    return Promise.resolve(rows.map((r) => this.rowToTemplate(r)));
  }
  /**
   * 搜索模板
   */
  findTemplates(query, limit) {
    const rows = this.db.searchPromptTemplates(query, limit);
    return Promise.resolve(rows.map((r) => this.rowToTemplate(r)));
  }
  /**
   * 获取所有启用的模板
   */
  getEnabledTemplates() {
    return this.listTemplates({ enabled: true });
  }
  /**
   * 注入模板内容到目标上下文
   * 返回注入后的完整提示词文本（不做实际注入，只拼接）
   */
  injectTemplate(id, context) {
    const row = this.db.getPromptTemplate(id);
    if (!row)
      return Promise.reject(new Error(`Template not found: ${id}`));
    const template = this.rowToTemplate(row);
    const result = context ? `${context}

---
${template.content}` : template.content;
    return Promise.resolve(result);
  }
  // ===== Helpers =====
  rowToTemplate(row) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      content: row.content,
      description: row.description ?? "",
      tags: (() => {
        try {
          return JSON.parse(row.tags ?? "[]");
        } catch {
          return [];
        }
      })(),
      version: row.version ?? "1.0.0",
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-graph/src/session-bookmark.js
var SessionBookmarkManager = class {
  db;
  constructor(db) {
    this.db = db;
  }
  /**
   * 创建会话书签
   */
  createBookmark(data) {
    const result = this.db.createSessionBookmark({
      sessionId: data.sessionId,
      roundIndex: data.roundIndex,
      title: data.title,
      summary: data.summary,
      tags: data.tags,
      userId: data.userId ?? "default"
    });
    return Promise.resolve({
      id: result.id,
      sessionId: result.sessionId,
      roundIndex: result.roundIndex,
      title: result.title,
      summary: data.summary ?? "",
      tags: data.tags ?? [],
      createdAt: result.createdAt,
      userId: data.userId ?? "default"
    });
  }
  /**
   * 列出某会话的书签
   */
  listBookmarks(sessionId, userId) {
    const rows = this.db.listSessionBookmarks(sessionId, userId);
    return Promise.resolve(rows.map((r) => this.rowToBookmark(r)));
  }
  /**
   * 删除书签
   */
  deleteBookmark(id) {
    return Promise.resolve(this.db.deleteSessionBookmark(id));
  }
  /**
   * 跨会话搜索书签
   */
  searchBookmarks(query, userId, limit) {
    const rows = this.db.searchSessionBookmarks(query, userId, limit);
    return Promise.resolve(rows.map((r) => this.rowToBookmark(r)));
  }
  // ===== Helpers =====
  rowToBookmark(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      roundIndex: row.round_index,
      title: row.title,
      summary: row.summary ?? "",
      tags: (() => {
        try {
          return JSON.parse(row.tags ?? "[]");
        } catch {
          return [];
        }
      })(),
      createdAt: row.created_at,
      userId: row.user_id ?? "default"
    };
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-graph/src/memory-sync.js
import { execSync } from "node:child_process";
var MemorySync = class {
  db;
  codegraphDir;
  constructor(db, codegraphDir) {
    this.db = db;
    this.codegraphDir = codegraphDir;
  }
  /**
   * 检测当前 git 分支
   */
  detectGitBranch() {
    try {
      const projectDir = this.resolveProjectDir();
      if (!projectDir)
        return null;
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 3e3,
        stdio: ["pipe", "pipe", "ignore"]
      }).trim();
      return branch || null;
    } catch {
      return null;
    }
  }
  /**
   * 检测当前 git 仓库根目录
   */
  detectGitRoot() {
    try {
      const projectDir = this.resolveProjectDir();
      if (!projectDir)
        return null;
      const root = execSync("git rev-parse --show-toplevel", {
        cwd: projectDir,
        encoding: "utf-8",
        timeout: 3e3,
        stdio: ["pipe", "pipe", "ignore"]
      }).trim();
      return root || null;
    } catch {
      return null;
    }
  }
  /**
   * 获取同步状态
   */
  getSyncStatus() {
    const branch = this.detectGitBranch();
    const gitRoot = this.detectGitRoot();
    let lastSyncAt = null;
    if (gitRoot) {
      try {
        const lastCommit = execSync("git log -1 --format=%ct memory-sync 2>/dev/null || echo ''", {
          cwd: gitRoot,
          encoding: "utf-8",
          timeout: 3e3,
          stdio: ["pipe", "pipe", "ignore"]
        }).trim();
        if (lastCommit)
          lastSyncAt = parseInt(lastCommit, 10) * 1e3;
      } catch {
      }
    }
    return {
      lastSyncAt,
      pendingChanges: 0,
      // 简化版：不追踪具体变更数
      remoteBranch: branch ? `origin/${branch}` : null,
      isSynced: true
    };
  }
  /**
   * 推送记忆到远端（简化版）
   * 实际实现需要将记忆数据导出到 git 仓库的专属分支
   */
  async pushMemory() {
    const start = Date.now();
    const gitRoot = this.detectGitRoot();
    if (!gitRoot) {
      return { pushed: 0, pulled: 0, conflicts: 0, duration: 0 };
    }
    try {
      const exportPath = `${gitRoot}/.memory-sync/data.json`;
      execSync(`mkdir -p ${gitRoot}/.memory-sync`, { timeout: 3e3 });
      const allNodes = this.db.getAllNodes();
      const syncData = JSON.stringify({
        version: 1,
        exportedAt: Date.now(),
        nodes: allNodes.map((n) => ({
          id: n.id,
          title: n.title,
          summary: n.summary,
          body: n.body,
          importance: n.importance,
          tags: n.tags,
          scope: n.scope,
          userId: n.userId,
          createdAt: n.createdAt
        }))
      });
      const { writeFileSync: writeFileSync3 } = await import("node:fs");
      writeFileSync3(exportPath, syncData, "utf-8");
      execSync("git add .memory-sync/data.json", { cwd: gitRoot, timeout: 5e3, stdio: "pipe" });
      execSync('git commit -m "memory-sync: \u81EA\u52A8\u540C\u6B65\u8BB0\u5FC6\u6570\u636E" --no-verify', {
        cwd: gitRoot,
        timeout: 5e3,
        stdio: ["pipe", "pipe", "ignore"]
      });
      return { pushed: allNodes.length, pulled: 0, conflicts: 0, duration: Date.now() - start };
    } catch {
      return { pushed: 0, pulled: 0, conflicts: 0, duration: Date.now() - start };
    }
  }
  /**
   * 拉取远端记忆（简化版）
   */
  async pullMemory() {
    const start = Date.now();
    const gitRoot = this.detectGitRoot();
    if (!gitRoot) {
      return { pushed: 0, pulled: 0, conflicts: 0, duration: 0 };
    }
    try {
      const { readFileSync: readFileSync4, existsSync: existsSync6 } = await import("node:fs");
      const importPath = `${gitRoot}/.memory-sync/data.json`;
      if (!existsSync6(importPath)) {
        return { pushed: 0, pulled: 0, conflicts: 0, duration: Date.now() - start };
      }
      const raw = readFileSync4(importPath, "utf-8");
      const data = JSON.parse(raw);
      let pulled = 0;
      for (const node of data.nodes) {
        const existing = this.db.findByHash(__require("node:crypto").createHash("sha256").update(node.summary + node.body).digest("hex"));
        if (!existing) {
          this.db.createNode({
            id: node.id,
            title: node.title,
            summary: node.summary,
            body: node.body,
            importance: node.importance ?? 5,
            status: "active",
            source: "imported",
            sourceSession: null,
            tags: node.tags ?? [],
            nodeType: "memory_entry",
            ttlDays: null,
            scope: node.scope ?? "public",
            tierMin: 1,
            negativeExamples: [],
            isDeprecated: false,
            deprecatedAt: null,
            userId: node.userId ?? "default"
          });
          pulled++;
        }
      }
      return { pushed: 0, pulled, conflicts: 0, duration: Date.now() - start };
    } catch {
      return { pushed: 0, pulled: 0, conflicts: 0, duration: Date.now() - start };
    }
  }
  // ===== Helpers =====
  resolveProjectDir() {
    try {
      const { existsSync: existsSync6 } = __require("node:fs");
      let dir = this.codegraphDir;
      while (dir !== "/") {
        if (existsSync6(`${dir}/.git`))
          return dir;
        dir = __require("node:path").dirname(dir);
      }
      return null;
    } catch {
      return null;
    }
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-graph/src/notification-bus.js
var WebChannelAdapter = class {
  async send(message) {
    console.log(`[Notification/Web] ${message.severity ?? "info"}: ${message.title} - ${message.body}`);
    return true;
  }
};
var ExternalChannelAdapter = class {
  channelType;
  config;
  constructor(channelType, config) {
    this.channelType = channelType;
    this.config = config;
  }
  async send(message) {
    console.log(`[Notification/${this.channelType}] ${message.title} - ${message.body}`);
    console.warn(`[Notification/${this.channelType}] \u5916\u90E8\u901A\u9053\u9002\u914D\u5668\u672A\u5B9E\u73B0\uFF0C\u9700\u914D\u7F6E API \u5BC6\u94A5`);
    return false;
  }
};
var NotificationBus = class {
  db;
  adapters = /* @__PURE__ */ new Map();
  constructor(db) {
    this.db = db;
    this.adapters.set("web", new WebChannelAdapter());
  }
  /**
   * 配置通知通道
   */
  configureChannel(data) {
    const result = this.db.createNotificationChannel({
      channelType: data.channelType,
      name: data.name,
      configJson: data.configJson
    });
    if (data.channelType === "web") {
      this.adapters.set(result.id, new WebChannelAdapter());
    } else {
      this.adapters.set(result.id, new ExternalChannelAdapter(data.channelType, data.configJson ?? {}));
    }
    return Promise.resolve({
      id: result.id,
      channelType: result.channelType,
      name: result.name,
      configJson: data.configJson ?? {},
      enabled: true,
      createdAt: result.createdAt,
      updatedAt: result.createdAt
    });
  }
  /**
   * 发送通知到指定通道
   */
  async sendNotification(channelId, message) {
    const adapter = this.adapters.get(channelId);
    if (!adapter) {
      return {
        channelId,
        channelType: "web",
        success: false,
        error: `Channel not found: ${channelId}`
      };
    }
    try {
      const success = await adapter.send(message);
      return {
        channelId,
        channelType: "web",
        // 简化版
        success
      };
    } catch (err) {
      return {
        channelId,
        channelType: "web",
        success: false,
        error: err.message
      };
    }
  }
  /**
   * 发送通知到所有启用的通道
   */
  async broadcast(message) {
    const channels = this.db.listNotificationChannels(true);
    const results = [];
    for (const channel of channels) {
      const result = await this.sendNotification(channel.id, message);
      results.push(result);
    }
    return results;
  }
  /**
   * 列出配置的通道
   */
  listChannels(enabledOnly = false) {
    const rows = this.db.listNotificationChannels(enabledOnly);
    return Promise.resolve(rows.map((r) => ({
      id: r.id,
      channelType: r.channel_type,
      name: r.name,
      configJson: (() => {
        try {
          return JSON.parse(r.config_json ?? "{}");
        } catch {
          return {};
        }
      })(),
      enabled: r.enabled === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    })));
  }
  /**
   * 删除通道
   */
  deleteChannel(id) {
    this.adapters.delete(id);
    return Promise.resolve(this.db.deleteNotificationChannel(id));
  }
};

// ../../node_modules/.pnpm/@wang-jie-git+memory-orchestrator@1.1.1/node_modules/@wang-jie-git/memory-orchestrator/build/memory-orchestrator/src/memory-system.js
import * as path4 from "node:path";
import * as fs4 from "node:fs";
var DEFAULT_CONFIG5 = {
  vectorDbFilename: "memory-vectors.db",
  embedder: "local",
  writeBufferSize: 10,
  writeBufferIntervalMs: 2e3
};
var MemorySystem = class _MemorySystem {
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
    this.watchdog = null;
    this.sessionCompressor = void 0;
    this.nudgeEngine = void 0;
    this.userProfileEngine = void 0;
    this.autoWriteback = void 0;
  }
  // ===== Initialize =====
  static async init(config) {
    const fullConfig = { ...DEFAULT_CONFIG5, ...config };
    const startedAt = Date.now();
    const cgDbPath = path4.join(fullConfig.codegraphDir, "codegraph.db");
    if (!fs4.existsSync(cgDbPath)) {
      throw new Error(`CodeGraph database not found: ${cgDbPath}
Run 'codegraph index' first.`);
    }
    const sys = new _MemorySystem(fullConfig);
    try {
      sys.memoryDb = MemoryDatabase.open(cgDbPath);
      sys.logger.info("init", "openGraph", "\u56FE\u6570\u636E\u5E93\u5DF2\u8FDE\u63A5", { path: cgDbPath });
    } catch (err) {
      sys.logger.error("init", "openGraph", "\u56FE\u6570\u636E\u5E93\u8FDE\u63A5\u5931\u8D25", err, { path: cgDbPath });
      throw err;
    }
    try {
      const vecDbPath = path4.join(fullConfig.codegraphDir, fullConfig.vectorDbFilename);
      sys.vectorStore = SqliteVectorStore.open(vecDbPath);
      sys.logger.info("init", "openVector", "\u5411\u91CF\u5E93\u5DF2\u8FDE\u63A5", { path: vecDbPath, entries: sys.vectorStore.stats().totalEntries });
    } catch (err) {
      sys.logger.error("init", "openVector", "\u5411\u91CF\u5E93\u8FDE\u63A5\u5931\u8D25", err);
      throw err;
    }
    try {
      if (fullConfig.embedder === "api") {
        sys.embedder = new ApiEmbedder({
          model: fullConfig.embedderModel ?? "text-embedding-3-small",
          apiKey: fullConfig.embedderApiKey,
          baseUrl: fullConfig.embedderBaseUrl
        });
        sys.logger.info("init", "initEmbedder", "API embedder \u5DF2\u521B\u5EFA", { model: sys.embedder.modelName });
      } else if (fullConfig.embedder === "simple") {
        sys.embedder = new SimpleEmbedder();
        sys.logger.info("init", "initEmbedder", "\u8F7B\u91CF\u5185\u7F6E embedder \u5DF2\u521B\u5EFA", { dim: sys.embedder.dimension });
      } else {
        const local = new LocalEmbedder();
        await local.init();
        sys.embedder = local;
        sys.logger.info("init", "initEmbedder", "\u672C\u5730 embedder \u5DF2\u52A0\u8F7D", { model: local.modelName, dim: local.dimension });
      }
    } catch (err) {
      sys.logger.error("init", "initEmbedder", "Embedder \u521D\u59CB\u5316\u5931\u8D25", err);
      throw err;
    }
    if (fullConfig.obsidianVaultPath) {
      try {
        sys.obsidianWriter = new ObsidianWriter({
          vaultPath: fullConfig.obsidianVaultPath,
          subDir: fullConfig.obsidianSubDir
        });
        sys.logger.info("init", "initObsidian", "Obsidian \u540C\u6B65\u5DF2\u542F\u7528", { vault: fullConfig.obsidianVaultPath });
      } catch (err) {
        sys.logger.warn("init", "initObsidian", "Obsidian \u521D\u59CB\u5316\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u6838\u5FC3\u529F\u80FD\uFF09", { error: err.message });
      }
    }
    try {
      let queryOptimizer = new NoopQueryOptimizer();
      if (fullConfig.queryOptimizer?.type === "llm" && fullConfig.queryOptimizer.apiKey) {
        queryOptimizer = new LLMQueryOptimizer({
          baseUrl: fullConfig.queryOptimizer.baseUrl,
          apiKey: fullConfig.queryOptimizer.apiKey,
          model: fullConfig.queryOptimizer.model
        });
        sys.logger.info("init", "initQueryOptimizer", "LLM \u67E5\u8BE2\u4F18\u5316\u5668\u5DF2\u542F\u7528", {
          model: fullConfig.queryOptimizer.model ?? "gpt-4o-mini"
        });
      }
      let reranker = new NoopReranker();
      if (fullConfig.reranker?.type === "embedding") {
        reranker = new EmbeddingReranker(sys.embedder, {
          candidateK: fullConfig.reranker.candidateK,
          topK: fullConfig.reranker.topK
        });
        sys.logger.info("init", "initReranker", "Embedding \u91CD\u6392\u5E8F\u5668\u5DF2\u542F\u7528", {
          model: sys.embedder.modelName
        });
      }
      sys.queryEngine = new HybridQueryEngine(sys.memoryDb, sys.vectorStore, sys.embedder, fullConfig.hybridQuery, queryOptimizer, reranker);
    } catch (err) {
      sys.logger.error("init", "initQueryEngine", "\u67E5\u8BE2\u5F15\u64CE\u521D\u59CB\u5316\u5931\u8D25", err);
      throw err;
    }
    try {
      const scConfig = fullConfig.sessionCompressor ?? {};
      sys.sessionCompressor = new SessionCompressor(sys.memoryDb, sys.vectorStore, sys.embedder, scConfig);
      if (scConfig.enabled !== false) {
        sys.logger.info("init", "initSessionCompressor", "\u4F1A\u8BDD\u538B\u7F29\u5668\u5DF2\u521D\u59CB\u5316");
      }
    } catch (err) {
      sys.logger.warn("init", "initSessionCompressor", "\u4F1A\u8BDD\u538B\u7F29\u5668\u521D\u59CB\u5316\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u6838\u5FC3\u529F\u80FD\uFF09", { error: err.message });
    }
    try {
      sys.nudgeEngine = new NudgeEngine(sys.memoryDb);
      sys.logger.info("init", "initNudgeEngine", "Nudge \u5F15\u64CE\u5DF2\u521D\u59CB\u5316");
    } catch (err) {
      sys.logger.warn("init", "initNudgeEngine", "Nudge \u5F15\u64CE\u521D\u59CB\u5316\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u6838\u5FC3\u529F\u80FD\uFF09", { error: err.message });
    }
    try {
      const userProfileConfig = fullConfig.userProfile ?? {};
      sys.userProfileEngine = new UserProfileEngine(sys.memoryDb, userProfileConfig);
      sys.logger.info("init", "initUserProfile", "\u7528\u6237\u753B\u50CF\u5F15\u64CE\u5DF2\u521D\u59CB\u5316", userProfileConfig);
    } catch (err) {
      sys.logger.warn("init", "initUserProfile", "\u7528\u6237\u753B\u50CF\u5F15\u64CE\u521D\u59CB\u5316\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u6838\u5FC3\u529F\u80FD\uFF09", { error: err.message });
    }
    try {
      const procedureConfig = fullConfig.procedureMemory ?? {};
      sys.procedureEngine = new ProcedureMemoryEngine(sys.memoryDb, procedureConfig);
      sys.logger.info("init", "initProcedureMemory", "Procedure Memory \u5F15\u64CE\u5DF2\u521D\u59CB\u5316", procedureConfig);
    } catch (err) {
      sys.logger.warn("init", "initProcedureMemory", "Procedure Memory \u5F15\u64CE\u521D\u59CB\u5316\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u6838\u5FC3\u529F\u80FD\uFF09", { error: err.message });
    }
    try {
      const hookConfig = fullConfig.hooks ?? {};
      sys.hookSystem = new HookSystem(hookConfig);
      sys.logger.info("init", "initHookSystem", "Hook \u7CFB\u7EDF\u5DF2\u521D\u59CB\u5316", hookConfig);
      sys.hookSystem.register(createSystemStartupHook());
      sys.hookSystem.register(createHealthCheckHook());
    } catch (err) {
      sys.logger.warn("init", "initHookSystem", "Hook \u7CFB\u7EDF\u521D\u59CB\u5316\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u6838\u5FC3\u529F\u80FD\uFF09", { error: err.message });
    }
    try {
      sys.autoWriteback = new AutoWritebackRuntime(fullConfig.autoWriteback);
      sys.logger.info("init", "initAutoWriteback", "\u81EA\u52A8\u5199\u56DE\u8FD0\u884C\u65F6\u5DF2\u521D\u59CB\u5316");
    } catch (err) {
      sys.logger.warn("init", "initAutoWriteback", "\u81EA\u52A8\u5199\u56DE\u521D\u59CB\u5316\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u6838\u5FC3\u529F\u80FD\uFF09", { error: err.message });
    }
    try {
      sys.todoManager = new TodoManager(sys.memoryDb);
      sys.logger.info("init", "initTodoManager", "\u5F85\u529E\u7BA1\u7406\u5668\u5DF2\u521D\u59CB\u5316");
    } catch (err) {
      sys.logger.warn("init", "initTodoManager", "\u5F85\u529E\u7BA1\u7406\u5668\u521D\u59CB\u5316\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u6838\u5FC3\u529F\u80FD\uFF09", { error: err.message });
    }
    try {
      sys.promptManager = new PromptManager(sys.memoryDb);
      sys.logger.info("init", "initPromptManager", "\u63D0\u793A\u8BCD\u7BA1\u7406\u5668\u5DF2\u521D\u59CB\u5316");
    } catch (err) {
      sys.logger.warn("init", "initPromptManager", "\u63D0\u793A\u8BCD\u7BA1\u7406\u5668\u521D\u59CB\u5316\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u6838\u5FC3\u529F\u80FD\uFF09", { error: err.message });
    }
    try {
      sys.bookmarkManager = new SessionBookmarkManager(sys.memoryDb);
      sys.logger.info("init", "initBookmark", "\u4F1A\u8BDD\u4E66\u7B7E\u5DF2\u521D\u59CB\u5316");
    } catch (err) {
      sys.logger.warn("init", "initBookmark", "\u4F1A\u8BDD\u4E66\u7B7E\u521D\u59CB\u5316\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u6838\u5FC3\u529F\u80FD\uFF09", { error: err.message });
    }
    try {
      sys.notificationBus = new NotificationBus(sys.memoryDb);
      sys.logger.info("init", "initNotificationBus", "\u901A\u77E5\u603B\u7EBF\u5DF2\u521D\u59CB\u5316");
    } catch (err) {
      sys.logger.warn("init", "initNotificationBus", "\u901A\u77E5\u603B\u7EBF\u521D\u59CB\u5316\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u6838\u5FC3\u529F\u80FD\uFF09", { error: err.message });
    }
    try {
      sys.memorySync = new MemorySync(sys.memoryDb, fullConfig.codegraphDir);
      sys.logger.info("init", "initMemorySync", "\u8BB0\u5FC6\u540C\u6B65\u5DF2\u521D\u59CB\u5316");
    } catch (err) {
      sys.logger.warn("init", "initMemorySync", "\u8BB0\u5FC6\u540C\u6B65\u521D\u59CB\u5316\u5931\u8D25\uFF08\u4E0D\u5F71\u54CD\u6838\u5FC3\u529F\u80FD\uFF09", { error: err.message });
    }
    try {
      sys.logger.setPersistDb({
        run: (sql, ...params) => {
          sys.memoryDb.getRawDb().prepare(sql).run(...params);
        }
      });
    } catch (err) {
      sys.logger.warn("init", "initLogger", "\u65E5\u5FD7\u6301\u4E45\u5316\u8BBE\u7F6E\u5931\u8D25", { error: err.message });
    }
    const watchdog = new MemoryWatchdog(sys.memoryDb, sys.vectorStore, sys.embedder, sys.logger, sys.obsidianWriter, fullConfig.watchdog);
    sys.watchdog = watchdog;
    if (fullConfig.onError) {
      sys.logger.onError(fullConfig.onError);
    }
    if (fullConfig.onUnhealthy) {
      watchdog.onUnhealthy(fullConfig.onUnhealthy);
    }
    sys._initialized = true;
    const initDuration = Date.now() - startedAt;
    sys.logger.info("init", "complete", `MemorySystem \u521D\u59CB\u5316\u5B8C\u6210`, {
      duration: initDuration,
      codegraphDir: fullConfig.codegraphDir,
      embedderType: fullConfig.embedder
    });
    watchdog.checkHealth().catch(() => {
    });
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
      throw new Error(`[checkSystemTier] \u6743\u9650\u4E0D\u8DB3\uFF1A\u9700\u8981 AI_MEMORY_TIER=prime \u624D\u80FD\u6267\u884C\u5168\u5C40\u64CD\u4F5C\uFF0C\u5F53\u524D=${tier}`);
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
    const cutoff = Date.now() - hours * 36e5;
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
    if (status) {
      this.hookSystem?.trigger("health_check", status, {}).catch((err) => {
        this.logger.warn("hook", "health_check", `Hook \u6267\u884C\u5931\u8D25`, err);
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
    return this.watchdog.generateReport(void 0, "on_demand");
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
      projectDir: data.projectDir ?? null
    });
    this.logger.info("write", "createNode", `\u5DF2\u521B\u5EFA\u8BB0\u5FC6\u8282\u70B9: ${node.title}`, {
      nodeId: node.id,
      importance: node.importance,
      tags: node.tags
    });
    return new Promise((resolve, reject) => {
      this.writeBuffer.push({
        node,
        resolve: () => {
          this.watchdog.recordWrite(true);
          this.hookSystem?.trigger("memory_written", node, {
            userId: data.userId,
            sessionId: data.sourceSession ?? void 0
          }).catch((err) => {
            this.logger.warn("hook", "memory_written", `Hook \u6267\u884C\u5931\u8D25`, err);
          });
          resolve(node);
        },
        reject: (err) => {
          this.watchdog.recordWrite(false);
          this.logger.error("write", "flush", `\u5199\u5165\u5931\u8D25: ${node.title}`, err, { nodeId: node.id });
          try {
            this.memoryDb.deleteNode(node.id);
            this.logger.warn("write", "rollback", `\u5DF2\u56DE\u6EDA graph \u8282\u70B9: ${node.title}`, { nodeId: node.id });
          } catch (rollbackErr) {
            this.logger.error("write", "rollback", `\u56DE\u6EDA\u5931\u8D25: ${node.title}`, rollbackErr, { nodeId: node.id });
          }
          reject(err);
        }
      });
      this.scheduleFlush();
    });
  }
  async writeBatch(entries) {
    this.logger.info("write", "writeBatch", `\u6279\u91CF\u5199\u5165 ${entries.length} \u6761\u8BB0\u5FC6`);
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
        verified: data.verified ?? false
      });
      nodes.push(node);
      let vector;
      try {
        const summary = data.summary ?? data.title;
        vector = await this.embedder.embed(summary);
      } catch (err) {
        this.logger.error("write", "embedBatch", `Embedding \u5931\u8D25: ${data.title}`, err);
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
          tenantId: node.userId === "default" ? void 0 : node.userId
        }
      });
      if (this.obsidianWriter) {
        try {
          this.obsidianWriter.write(node);
        } catch (err) {
          this.logger.warn("write", "obsidianSync", `Obsidian \u540C\u6B65\u5931\u8D25: ${node.title}`, { error: err.message });
        }
      }
    }
    try {
      this.vectorStore.upsertBatch(vectorEntries);
      this.logger.info("write", "embedBatch", `\u5411\u91CF\u6279\u91CF\u7D22\u5F15\u5B8C\u6210: ${vectorEntries.length} \u6761`);
    } catch (err) {
      this.logger.error("write", "embedBatch", "\u5411\u91CF\u6279\u91CF\u7D22\u5F15\u5931\u8D25", err);
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
    } catch (err) {
      this.logger.error("write", "writeAsync", `\u5F02\u6B65\u5199\u5165\u5931\u8D25`, err, { title: data.title });
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
    this.logger.info("write", "flush", `Flush ${batch.length} \u6761\u7F13\u51B2\u8BB0\u5FC6`);
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
            tenantId: entry.node.userId === "default" ? void 0 : entry.node.userId
          });
          if (this.obsidianWriter) {
            this.obsidianWriter.write(entry.node);
          }
          entry.resolve();
          successCount++;
        } catch (err) {
          this.logger.error("write", "flushItem", `\u5355\u6761 flush \u5931\u8D25: ${entry.node.title}`, err);
          entry.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
      this.watchdog.recordWrite(successCount === batch.length);
    })();
  }
  // ===== Query =====
  async query(text, filter) {
    this.logger.info("query", "hybridSearch", `\u67E5\u8BE2: "${text.slice(0, 60)}"`, filter);
    const startTime = performance.now();
    try {
      const vectorFilter = {};
      if (filter?.importanceMin !== void 0)
        vectorFilter.importanceMin = filter.importanceMin;
      if (filter?.userId !== void 0 && filter.userId !== "default")
        vectorFilter.tenantId = filter.userId;
      const result = await this.queryEngine.query(text, vectorFilter);
      const duration = Math.round(performance.now() - startTime);
      this.logger.info("query", "hybridSearch", `\u67E5\u8BE2\u5B8C\u6210: ${result.results.length} \u6761\u7ED3\u679C`, {
        duration,
        top1Score: result.telemetry.top1Score,
        degraded: result.telemetry.degraded
      });
      this.watchdog.recordQuery(true);
      this.hookSystem?.trigger("memory_queried", { query: text, resultCount: result.results.length, duration }, {
        userId: filter?.userId
      }).catch((err) => {
        this.logger.warn("hook", "memory_queried", `Hook \u6267\u884C\u5931\u8D25`, err);
      });
      return result;
    } catch (err) {
      this.watchdog.recordQuery(false);
      this.logger.error("query", "hybridSearch", `\u67E5\u8BE2\u5931\u8D25: "${text.slice(0, 60)}"`, err);
      throw err;
    }
  }
  // ===== Link =====
  linkMemoryToCode(memoryId, codeSymbolId, description) {
    this.logger.info("link", "memoryToCode", `\u5173\u8054\u8BB0\u5FC6 \u2192 \u4EE3\u7801\u7B26\u53F7`, { memoryId, codeSymbolId });
    this.memoryDb.linkMemoryToCode(memoryId, codeSymbolId, description);
  }
  linkMemoryToMemory(sourceId, targetId, relation, description) {
    this.logger.info("link", "memoryToMemory", `\u5173\u8054\u8BB0\u5FC6 \u2192 \u8BB0\u5FC6`, { sourceId, targetId, relation });
    this.memoryDb.linkMemoryToMemory(sourceId, targetId, relation, 1, description);
  }
  // ===== Dream (熵减) =====
  async dream(dryRun = false) {
    this.logger.info("dream", "consolidate", `\u542F\u52A8\u68A6\u5883\u6574\u7406${dryRun ? " (\u9884\u89C8\u6A21\u5F0F)" : ""}`);
    this.flush();
    const { DreamEngine: DreamEngine2 } = await Promise.resolve().then(() => (init_dream(), dream_exports));
    const engine = new DreamEngine2(this.memoryDb, this.vectorStore, this.embedder, { dryRun });
    try {
      const report = await engine.consolidate();
      this.logger.info("dream", "consolidate", `\u68A6\u5883\u5B8C\u6210: \u5408\u5E76${report.actions.merged.length} \u805A\u7C7B${report.actions.insights.length} \u5F52\u6863${report.actions.archived.length} \u5220\u9664${report.actions.deleted.length}`, {
        healthScore: report.healthScore,
        beforeNodes: report.summary.before.nodes,
        afterNodes: report.summary.after.nodes,
        duration: report.duration
      });
      this.watchdog.recordDream(true);
      this.hookSystem?.trigger("dream_completed", report, { dryRun }).catch((err) => {
        this.logger.warn("hook", "dream_completed", `Hook \u6267\u884C\u5931\u8D25`, err);
      });
      return report;
    } catch (err) {
      this.watchdog.recordDream(false);
      this.logger.error("dream", "consolidate", "\u68A6\u5883\u6574\u7406\u5931\u8D25", err);
      throw err;
    }
  }
  /** 按内容哈希查重（v11 gatekeeper 支持） */
  async findDuplicateByHash(summary, body) {
    const { createHash: createHash4 } = await import("node:crypto");
    const hash = createHash4("sha256").update(summary + body).digest("hex");
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
      this.logger.warn("session", "compress", "\u4F1A\u8BDD\u538B\u7F29\u5668\u672A\u521D\u59CB\u5316\uFF0C\u8DF3\u8FC7\u538B\u7F29");
      return null;
    }
    const result = await this.sessionCompressor.compress(sessionId, messages, options?.sessionStart ?? Date.now(), options);
    if (result) {
      this.hookSystem?.trigger("session_compressed", result, {
        userId: options?.userId,
        sessionId
      }).catch((err) => {
        this.logger.warn("hook", "session_compressed", `Hook \u6267\u884C\u5931\u8D25`, err);
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
    const nodes = nodeIds.map((id) => this.memoryDb.getNode(id)).filter((n) => !!n);
    return this.nudgeEngine.onMemoryWritten(nodes);
  }
  // ===== User Profile =====
  /**
   * 记录一条用户观察（创建/更新 observation 节点，检测矛盾）。
   */
  observeUser(type, domain, content, options) {
    if (!this.userProfileEngine) {
      throw new Error("\u7528\u6237\u753B\u50CF\u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    const result = this.userProfileEngine.observe(type, domain, content, options);
    this.hookSystem?.trigger("user_observed", result, {
      userId: options?.userId,
      sessionId: options?.sourceSession ?? void 0
    }).catch((err) => {
      this.logger.warn("hook", "user_observed", `Hook \u6267\u884C\u5931\u8D25`, err);
    });
    return result;
  }
  /**
   * 获取用户画像（累积的 trait 与 domain 统计）。
   */
  getUserProfile(userId = "default") {
    if (!this.userProfileEngine) {
      throw new Error("\u7528\u6237\u753B\u50CF\u5F15\u64CE\u672A\u521D\u59CB\u5316");
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
      throw new Error("\u7528\u6237\u753B\u50CF\u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    return this.userProfileEngine.deleteObservation(observationId);
  }
  /**
   * 获取观察详情
   */
  getUserObservation(observationId) {
    if (!this.userProfileEngine) {
      throw new Error("\u7528\u6237\u753B\u50CF\u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    return this.userProfileEngine.getObservation(observationId);
  }
  // ===== Procedure Memory（工作流程记忆）=====
  /**
   * 记录工作流程
   */
  recordProcedure(record) {
    if (!this.procedureEngine) {
      throw new Error("Procedure Memory \u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    return this.procedureEngine.record(record);
  }
  /**
   * 查找工作流程
   */
  findProcedures(query) {
    if (!this.procedureEngine) {
      throw new Error("Procedure Memory \u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    return this.procedureEngine.find(query);
  }
  /**
   * 执行工作流程
   */
  executeProcedure(procedureId, inputs) {
    if (!this.procedureEngine) {
      throw new Error("Procedure Memory \u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    const result = this.procedureEngine.execute(procedureId, inputs);
    this.hookSystem?.trigger("procedure_executed", result, {}).catch((err) => {
      this.logger.warn("hook", "procedure_executed", `Hook \u6267\u884C\u5931\u8D25`, err);
    });
    return result;
  }
  /**
   * 获取工作流程详情
   */
  getProcedure(procedureId) {
    if (!this.procedureEngine) {
      throw new Error("Procedure Memory \u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    return this.procedureEngine.get(procedureId);
  }
  /**
   * 列出所有工作流程
   */
  listProcedures(filters) {
    if (!this.procedureEngine) {
      throw new Error("Procedure Memory \u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    return this.procedureEngine.list(filters);
  }
  /**
   * 获取推荐工作流程
   */
  getRecommendedProcedures(filters) {
    if (!this.procedureEngine) {
      throw new Error("Procedure Memory \u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    return this.procedureEngine.getRecommendations(filters);
  }
  /**
   * 删除工作流程（软删除）
   */
  deleteProcedure(procedureId) {
    if (!this.procedureEngine) {
      throw new Error("Procedure Memory \u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    return this.procedureEngine.delete(procedureId);
  }
  /**
   * 更新工作流程（创建新版本）
   */
  updateProcedure(procedureId, updates) {
    if (!this.procedureEngine) {
      throw new Error("Procedure Memory \u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    return this.procedureEngine.update(procedureId, updates);
  }
  /**
   * 更新 Procedure Memory 配置
   */
  updateProcedureConfig(config) {
    if (!this.procedureEngine) {
      throw new Error("Procedure Memory \u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    this.procedureEngine.updateConfig(config);
  }
  /**
   * 获取用户画像健康统计
   */
  getUserProfileHealth(userId = "default") {
    if (!this.userProfileEngine) {
      throw new Error("\u7528\u6237\u753B\u50CF\u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    return this.userProfileEngine.getHealthStats(userId);
  }
  /**
   * 更新用户画像配置
   */
  updateUserProfileConfig(config) {
    if (!this.userProfileEngine) {
      throw new Error("\u7528\u6237\u753B\u50CF\u5F15\u64CE\u672A\u521D\u59CB\u5316");
    }
    this.userProfileEngine.updateConfig(config);
  }
  // ===== Maintenance =====
  prune(options) {
    this.flush();
    this.logger.info("maintenance", "prune", `\u6267\u884C\u526A\u679D${options?.dryRun ? " (\u9884\u89C8)" : ""}`);
    const result = this.memoryDb.prune(options?.dryRun ?? false);
    this.logger.info("maintenance", "prune", `\u526A\u679D\u5B8C\u6210: \u5220\u9664${result.deleted} \u5F52\u6863${result.archived}`);
    return result;
  }
  checkConsistency() {
    this.flush();
    this.logger.info("maintenance", "consistency", "\u68C0\u67E5\u4E00\u81F4\u6027");
    const stats = this.memoryDb.getStats();
    const vecStats = this.vectorStore.stats();
    const ok = Math.abs(stats.totalNodes - vecStats.totalEntries) < 10;
    if (!ok) {
      this.logger.warn("maintenance", "consistency", `\u56FE\u5E93\u4E0E\u5411\u91CF\u5E93\u4E0D\u4E00\u81F4`, {
        graphNodes: stats.totalNodes,
        vectorEntries: vecStats.totalEntries
      });
    }
    return {
      inGraph: stats.totalNodes,
      inVector: vecStats.totalEntries,
      graphOnly: [],
      vectorOnly: [],
      ok
    };
  }
  async rebuildVectorIndex() {
    this.flush();
    this.logger.info("maintenance", "rebuildVector", "\u91CD\u5EFA\u5411\u91CF\u7D22\u5F15\u5F00\u59CB");
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
            tenantId: node.userId === "default" ? void 0 : node.userId
          }
        });
      } catch (err) {
        errors++;
        this.logger.error("maintenance", "rebuildVector", `\u91CD\u5EFA\u5411\u91CF\u5931\u8D25: ${node.title}`, err);
      }
    }
    if (batch.length > 0) {
      this.vectorStore.upsertBatch(batch);
    }
    this.logger.info("maintenance", "rebuildVector", `\u91CD\u5EFA\u5B8C\u6210: ${batch.length} \u6761, ${errors} \u6761\u5931\u8D25`);
    return batch.length;
  }
  // ===== Stats =====
  stats() {
    this.flush();
    const graphStats = this.memoryDb.getStats();
    const vecStats = this.vectorStore.stats();
    const obsidianCount = this.obsidianWriter?.count() ?? 0;
    const health = this.watchdog.lastStatus;
    const recentErrors = this.logger.getRecentErrorCount(36e5);
    return {
      graph: graphStats,
      vector: { total: vecStats.totalEntries, dimension: vecStats.dimension },
      obsidian: obsidianCount,
      bufferPending: this.writeBuffer.length,
      health: health ? {
        score: health.score,
        healthy: health.healthy,
        uptime: this.watchdog.getUptime()
      } : null,
      recentErrors,
      logger: { buffered: this.logger.getRecent(1).length > 0 ? "active" : "empty" }
    };
  }
  // ===== Shutdown =====
  async shutdown() {
    this.logger.info("shutdown", "begin", "MemorySystem \u5173\u95ED\u4E2D...");
    this.watchdog.stop();
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
    await this.hookSystem?.trigger("system_shutdown", { uptime: this.watchdog.getUptime() });
    this._initialized = false;
    this.logger.info("shutdown", "complete", "MemorySystem \u5DF2\u5173\u95ED");
  }
};

// src/index.ts
var name = "@wang-jie-git/dsh-memory-ai";
var inject = ["tools", "connection"];
var DEFAULT_CG_DIR = join4(homedir(), ".codegraph");
var CONFIG_FILE = join4(homedir(), ".dsh", "memory-ai-config.json");
var ms = null;
var merged = {};
function renderText(_args, value) {
  return [{ type: "text", text: value.output || value.error || "" }];
}
var outputSchema = {
  type: "object",
  properties: { ok: { type: "boolean" }, output: { type: "string" }, error: { type: "string" } },
  additionalProperties: true
};
function registerTool(ctx, name2, description, params, execute) {
  ctx.tools.register(
    defineTool({
      name: name2,
      description,
      parameters: params,
      output: { schema: outputSchema, render: renderText },
      execute
    })
  );
}
function readPersistedConfig() {
  try {
    if (!existsSync5(CONFIG_FILE)) return {};
    const raw = readFileSync3(CONFIG_FILE, "utf8");
    const data = JSON.parse(raw);
    const result = {};
    if (data.codegraphDir) result.codegraphDir = data.codegraphDir;
    if (data.embedder) result.embedder = data.embedder;
    if (data.apiKey) result.embedderApiKey = data.apiKey;
    if (data.apiModel) result.embedderModel = data.apiModel;
    if (data.apiBaseUrl) result.embedderBaseUrl = data.apiBaseUrl;
    return result;
  } catch {
    return {};
  }
}
function formatQueryResults(results) {
  if (!results || results.length === 0) return "\uFF08\u65E0\u7ED3\u679C\uFF09";
  return results.map((r, i) => {
    const title = r.title || r.node?.title || "";
    const importance = r.importance ?? r.node?.importance;
    const score = r.score ?? 0;
    const summary = r.summary || r.node?.summary || "";
    const body = r.body || r.node?.body || "";
    const tags = r.tags || r.node?.tags || [];
    const lines = [`[${i + 1}] ${title}`];
    if (importance !== void 0) lines.push(`    \u91CD\u8981\u6027: ${importance}/10  |  \u8BC4\u5206: ${score.toFixed(2)}`);
    else lines.push(`    \u8BC4\u5206: ${score.toFixed(2)}`);
    if (summary) lines.push(`    \u6458\u8981: ${summary}`);
    if (body) lines.push(`    \u8BE6\u7EC6\u5185\u5BB9: ${body.slice(0, 200)}`);
    if (tags.length > 0) lines.push(`    \u6807\u7B7E: ${tags.slice(0, 5).join(", ")}`);
    return lines.join("\n");
  }).join("\n\n");
}
function formatHealth(health) {
  const lines = ["\u8BB0\u5FC6\u7CFB\u7EDF\u5065\u5EB7\u68C0\u67E5", "\u2501".repeat(25)];
  lines.push(`  \u8BC4\u5206: ${health.score ?? "?"}/10  |  \u72B6\u6001: ${health.healthy ? "\u2705 \u5065\u5EB7" : "\u274C \u5F02\u5E38"}`);
  if (health.graphDb) lines.push(`  \u2705 \u56FE\u6570\u636E\u5E93   ${health.graphDb.latencyMs ?? "?"}ms`);
  if (health.vectorStore) lines.push(`  \u2705 \u5411\u91CF\u5E93     ${health.vectorStore.latencyMs ?? "?"}ms  (${health.vectorStore.totalEntries ?? "?"} \u6761)`);
  if (health.embedder) lines.push(`  \u2705 Embedder   ${health.embedder.latencyMs ?? "?"}ms`);
  if (health.uptimeMs) lines.push(`  \u8FD0\u884C\u65F6\u957F: ${Math.floor(health.uptimeMs / 1e3)}s`);
  if (health.recentErrors) lines.push(`  \u26A0\uFE0F \u8FD1\u671F\u9519\u8BEF: ${health.recentErrors} \u6761`);
  return lines.join("\n");
}
function formatStats(report) {
  const lines = ["\u8BB0\u5FC6\u7CFB\u7EDF\u7EDF\u8BA1", "\u2501".repeat(25)];
  const components = report.components || [];
  for (const c of components) {
    if (c.name === "memory-graph" || c.name === "memory_nodes") {
      lines.push(`  \u56FE\u8282\u70B9: ${c.nodeCount ?? c.totalNodes ?? "?"}`);
      lines.push(`  \u56FE\u8FB9:   ${c.edgeCount ?? c.totalEdges ?? "?"}`);
    }
    if (c.name === "memory-vector" || c.name === "vectorStore") {
      lines.push(`  \u5411\u91CF:   ${c.totalEntries ?? "?"} \u6761 (${c.dimension ?? "?"} \u7EF4)`);
    }
    if (c.name === "obsidian-writer" || c.name === "obsidianWriter") {
      lines.push(`  Obsidian: ${c.count ?? "0"} \u7BC7`);
    }
  }
  lines.push(`  \u5065\u5EB7\u8BC4\u5206: ${report.overallScore ?? "?"}/10`);
  if (report.uptime) lines.push(`  \u8FD0\u884C\u65F6\u957F: ${report.uptime}`);
  if (report.totalErrorsLastHour) lines.push(`  \u8FD1\u671F\u9519\u8BEF: ${report.totalErrorsLastHour} \u6761/\u5C0F\u65F6`);
  return lines.join("\n");
}
function formatDream(report) {
  const lines = ["\u{1F9E0} \u68A6\u5883\u6574\u7406\u62A5\u544A", "\u2501".repeat(25)];
  lines.push(`  \u68A6\u5883 ID: ${report.id ?? "?"}`);
  if (report.actions) {
    lines.push(`  \u5408\u5E76\u5197\u4F59: ${report.actions.merged?.length ?? 0} \u6761`);
    lines.push(`  \u805A\u7C7B\u6D1E\u5BDF: ${report.actions.insights?.length ?? 0} \u6761`);
    lines.push(`  \u5F52\u6863: ${report.actions.archived?.length ?? 0} \u6761`);
    lines.push(`  \u5220\u9664: ${report.actions.deleted?.length ?? 0} \u6761`);
  }
  if (report.insights && report.insights.length > 0) {
    lines.push("", "\u{1F4CC} \u6D1E\u5BDF:");
    for (const ins of report.insights) {
      lines.push(`  - ${ins.title ?? ins}`);
    }
  }
  if (report.healthScore !== void 0) lines.push("", `  \u5065\u5EB7\u8BC4\u5206: ${report.healthScore}/10`);
  return lines.join("\n");
}
function formatNudge(suggestions) {
  if (!suggestions || suggestions.length === 0) return "\u6682\u65E0\u63D0\u9192\u5EFA\u8BAE\u3002";
  return suggestions.map((s, i) => {
    const lines = [`[${i + 1}] ${s.title || s.scene || "\u63D0\u9192"}`];
    if (s.message) lines.push(`    \u6D88\u606F: ${s.message}`);
    if (s.confidence !== void 0) lines.push(`    \u7F6E\u4FE1\u5EA6: ${(s.confidence * 100).toFixed(0)}%`);
    if (s.reason) lines.push(`    \u539F\u56E0: ${s.reason}`);
    return lines.join("\n");
  }).join("\n\n");
}
function formatLogs(entries) {
  if (!entries || entries.length === 0) return "\u6682\u65E0\u65E5\u5FD7\u3002";
  return entries.map((e) => {
    const time = e.timestamp ? new Date(e.timestamp).toLocaleString() : "?";
    return `[${time}] [${e.module ?? "?"}] ${e.level ?? "INFO"}: ${e.message ?? ""}`;
  }).join("\n");
}
function formatProfile(profile) {
  const lines = ["\u{1F464} \u7528\u6237\u753B\u50CF", "\u2501".repeat(25)];
  if (profile.userId) lines.push(`  \u7528\u6237: ${profile.userId}`);
  if (profile.totalMemories !== void 0) lines.push(`  \u603B\u8BB0\u5FC6\u6570: ${profile.totalMemories}`);
  if (profile.topics && profile.topics.length > 0) lines.push(`  \u4E3B\u9898: ${profile.topics.join(", ")}`);
  if (profile.stats) {
    for (const [k, v] of Object.entries(profile.stats)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  return lines.join("\n");
}
function formatConsistency(report) {
  const lines = ["\u2705 \u4E00\u81F4\u6027\u68C0\u67E5", "\u2501".repeat(25)];
  lines.push(`  \u56FE\u5E93\u8282\u70B9: ${report.inGraph ?? "?"}`);
  lines.push(`  \u5411\u91CF\u6761\u76EE: ${report.inVector ?? "?"}`);
  lines.push(`  \u72B6\u6001: ${report.ok ? "\u2705 \u4E00\u81F4" : "\u274C \u4E0D\u4E00\u81F4"}`);
  if (report.graphOnly?.length > 0) lines.push(`  \u4EC5\u56FE\u5E93\u5B58\u5728: ${report.graphOnly.length} \u6761`);
  if (report.vectorOnly?.length > 0) lines.push(`  \u4EC5\u5411\u91CF\u5B58\u5728: ${report.vectorOnly.length} \u6761`);
  return lines.join("\n");
}
function registerErrorTools(ctx, errorMsg) {
  const allTools = [
    ["memory_query", "\u8BED\u4E49\u68C0\u7D22 AI-memory \u8BB0\u5FC6\u5E93", { query: { type: "string", required: true, description: "\u81EA\u7136\u8BED\u8A00\u67E5\u8BE2" }, limit: { type: "number", description: "\u8FD4\u56DE\u7ED3\u679C\u6570\u91CF\u4E0A\u9650\uFF0C\u9ED8\u8BA4 5" } }],
    ["memory_write", "\u5199\u5165\u8BB0\u5FC6\u5230 AI-memory \u8BED\u4E49\u5E93", { title: { type: "string", required: true, description: "\u8BB0\u5FC6\u6807\u9898" }, summary: { type: "string", description: "\u8BB0\u5FC6\u6458\u8981" }, body: { type: "string", description: "\u8BB0\u5FC6\u8BE6\u7EC6\u5185\u5BB9" }, importance: { type: "number", description: "\u91CD\u8981\u6027 1-10\uFF0C\u9ED8\u8BA4 5" }, tags: { type: "string", description: "\u9017\u53F7\u5206\u9694\u7684\u6807\u7B7E" } }],
    ["memory_write_batch", "\u6279\u91CF\u5199\u5165\u8BB0\u5FC6", { entries: { type: "array", description: "\u8BB0\u5FC6\u6761\u76EE\u6570\u7EC4\uFF08\u6BCF\u4E2A\u6761\u76EE\u5FC5\u9700 title \u5B57\u6BB5\uFF09", items: { type: "object", additionalProperties: true, properties: { title: { type: "string" }, summary: { type: "string" }, body: { type: "string" }, importance: { type: "number" }, tags: { type: "string" } } } } }],
    ["memory_health", "\u68C0\u67E5 AI-memory \u8BED\u4E49\u5E93\u5065\u5EB7\u72B6\u6001", {}],
    ["memory_stats", "\u67E5\u770B AI-memory \u8BED\u4E49\u5E93\u7EDF\u8BA1\u4FE1\u606F", {}],
    ["memory_dream", "\u68A6\u5883\u6574\u7406\uFF1A\u5408\u5E76\u5197\u4F59\u8BB0\u5FC6\u3001\u805A\u7C7B\u6D1E\u5BDF\u3001\u6E05\u7406\u4F4E\u4EF7\u503C\u6761\u76EE", { dryRun: { type: "boolean", description: "\u9884\u89C8\u6A21\u5F0F\uFF08\u4E0D\u5B9E\u9645\u6267\u884C\uFF09" } }],
    ["memory_compress", "\u4F1A\u8BDD\u538B\u7F29\uFF1A\u63D0\u53D6\u5173\u952E\u51B3\u7B56\u548C\u672A\u89E3\u51B3\u95EE\u9898", { sessionId: { type: "string", required: true, description: "\u4F1A\u8BDD ID" }, messages: { type: "array", required: true, description: "\u6D88\u606F\u6570\u7EC4", items: { type: "string" } }, sessionStart: { type: "number", description: "\u5F00\u59CB\u65F6\u95F4\u6233" } }],
    ["memory_nudge", "\u667A\u80FD\u63D0\u9192\uFF1A\u5206\u6790\u8FD1\u671F\u8BB0\u5FC6\uFF0C\u68C0\u6D4B\u91CD\u590D\u6A21\u5F0F\u548C\u9519\u8BEF\u590D\u73B0", { hours: { type: "number", description: "\u5206\u6790\u65F6\u95F4\u8303\u56F4\uFF08\u5C0F\u65F6\uFF09\uFF0C\u9ED8\u8BA4 24" } }],
    ["memory_prune", "\u6E05\u7406\u8FC7\u671F/\u4F4E\u91CD\u8981\u6027\u8BB0\u5FC6", { dryRun: { type: "boolean", description: "\u9884\u89C8\u6A21\u5F0F\uFF08\u4E0D\u5B9E\u9645\u6267\u884C\uFF09" } }],
    ["memory_consistency", "\u68C0\u67E5\u56FE\u5E93\u4E0E\u5411\u91CF\u5E93\u4E00\u81F4\u6027", {}],
    ["memory_rebuild_index", "\u91CD\u5EFA\u5411\u91CF\u7D22\u5F15\uFF08\u4ECE\u56FE\u5E93\u91CD\u65B0\u751F\u6210\u6240\u6709\u5411\u91CF\uFF09", {}],
    ["memory_errors", "\u9519\u9898\u672C\uFF1A\u67E5\u770B\u8FD1\u671F\u9519\u8BEF\u65E5\u5FD7", { hours: { type: "number", description: "\u65F6\u95F4\u8303\u56F4\uFF08\u5C0F\u65F6\uFF09\uFF0C\u9ED8\u8BA4 24" } }],
    ["memory_profile", "\u7528\u6237\u753B\u50CF\uFF1A\u67E5\u770B\u7528\u6237\u884C\u4E3A\u6A21\u5F0F\u5206\u6790", { userId: { type: "string", description: "\u7528\u6237 ID\uFF0C\u9ED8\u8BA4 default" } }],
    ["memory_logs", "\u7CFB\u7EDF\u65E5\u5FD7\uFF1A\u67E5\u770B\u8BB0\u5FC6\u7CFB\u7EDF\u8FD0\u884C\u65E5\u5FD7", { limit: { type: "number", description: "\u8FD4\u56DE\u6761\u6570\u4E0A\u9650\uFF0C\u9ED8\u8BA4 50" }, minLevel: { type: "string", description: "\u6700\u4F4E\u65E5\u5FD7\u7EA7\u522B" } }]
  ];
  for (const [n, d, p] of allTools) {
    registerTool(ctx, n, d, p, async () => ({ ok: false, output: "", error: errorMsg }));
  }
}
async function apply(ctx, config) {
  const persisted = readPersistedConfig();
  merged = {
    codegraphDir: DEFAULT_CG_DIR,
    embedder: "simple",
    ...persisted,
    ...config
  };
  const codegraphDir = merged.codegraphDir ?? DEFAULT_CG_DIR;
  console.log(`[dsh-memory-ai] \u521D\u59CB\u5316 MemorySystem... codegraph-dir=${codegraphDir}, embedder=${merged.embedder}`);
  try {
    ms = await MemorySystem.init(merged);
    console.log(`[dsh-memory-ai] MemorySystem \u521D\u59CB\u5316\u5B8C\u6210`);
  } catch (err) {
    console.error(`[dsh-memory-ai] \u521D\u59CB\u5316\u5931\u8D25:`, err.message);
    registerErrorTools(ctx, `AI-memory \u521D\u59CB\u5316\u5931\u8D25: ${err.message}`);
    return;
  }
  registerTool(ctx, "memory_query", "\u8BED\u4E49\u68C0\u7D22 AI-memory \u8BB0\u5FC6\u5E93\u3002\u4F7F\u7528\u81EA\u7136\u8BED\u8A00\u67E5\u8BE2\uFF0C\u8FD4\u56DE\u8BED\u4E49\u76F8\u5173\u7684\u8BB0\u5FC6\u6761\u76EE\uFF08\u5411\u91CF + \u56FE\u8C31\u6DF7\u5408\u68C0\u7D22\uFF09\u3002", {
    query: { type: "string", required: true, description: "\u81EA\u7136\u8BED\u8A00\u67E5\u8BE2" },
    limit: { type: "number", description: "\u8FD4\u56DE\u7ED3\u679C\u6570\u91CF\u4E0A\u9650\uFF0C\u9ED8\u8BA4 5" }
  }, async ({ query, limit = 5 }) => {
    try {
      const result = await ms.query(query, {});
      return { ok: true, output: formatQueryResults((result.results || []).slice(0, limit)), error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_query \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_write", "\u5199\u5165\u8BB0\u5FC6\u5230 AI-memory \u8BED\u4E49\u5E93\u3002\u5199\u5165\u5185\u5BB9\u53EF\u4F9B memory_query \u8BED\u4E49\u68C0\u7D22\u3002", {
    title: { type: "string", required: true, description: "\u8BB0\u5FC6\u6807\u9898" },
    summary: { type: "string", description: "\u8BB0\u5FC6\u6458\u8981" },
    body: { type: "string", description: "\u8BB0\u5FC6\u8BE6\u7EC6\u5185\u5BB9" },
    importance: { type: "number", description: "\u91CD\u8981\u6027 1-10\uFF0C\u9ED8\u8BA4 5" },
    tags: { type: "string", description: "\u9017\u53F7\u5206\u9694\u7684\u6807\u7B7E" }
  }, async ({ title, summary = "", body = "", importance = 5, tags = "" }) => {
    try {
      const node = await ms.write({ title, summary, body, importance, tags: tags ? tags.split(",").map((t) => t.trim()) : [] });
      return { ok: true, output: JSON.stringify(node, null, 2), error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_write \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_write_batch", "\u6279\u91CF\u5199\u5165\u591A\u6761\u8BB0\u5FC6\u5230\u8BED\u4E49\u5E93\u3002\u9002\u5408\u4E00\u6B21\u6027\u5BFC\u5165\u5927\u91CF\u6570\u636E\u3002", {
    entries: { type: "array", required: true, description: "\u8BB0\u5FC6\u6761\u76EE\u6570\u7EC4\uFF08\u6BCF\u4E2A\u6761\u76EE\u5FC5\u9700 title \u5B57\u6BB5\uFF09", items: { type: "object", additionalProperties: true, properties: { title: { type: "string" }, summary: { type: "string" }, body: { type: "string" }, importance: { type: "number" }, tags: { type: "string" } } } }
  }, async ({ entries }) => {
    try {
      const nodes = await ms.writeBatch(entries.map((e) => ({
        title: e.title,
        summary: e.summary || "",
        body: e.body || "",
        importance: e.importance ?? 5,
        tags: e.tags ? e.tags.split(",").map((t) => t.trim()) : []
      })));
      return { ok: true, output: `\u5DF2\u5199\u5165 ${nodes.length} \u6761\u8BB0\u5FC6`, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_write_batch \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_dream", "\u68A6\u5883\u6574\u7406\uFF1A\u5408\u5E76\u5197\u4F59\u8BB0\u5FC6\u3001\u805A\u7C7B\u751F\u6210\u6D1E\u5BDF\u3001\u6E05\u7406\u4F4E\u4EF7\u503C\u6761\u76EE\u3002\u7CFB\u7EDF\u81EA\u52A8\u8FD0\u884C\u7684\u71B5\u51CF\u8FC7\u7A0B\u3002", {
    dryRun: { type: "boolean", description: "\u9884\u89C8\u6A21\u5F0F\uFF08\u4E0D\u5B9E\u9645\u6267\u884C\uFF0C\u4EC5\u663E\u793A\u9884\u6D4B\u7ED3\u679C\uFF09" }
  }, async ({ dryRun = false }) => {
    try {
      const report = await ms.dream(dryRun);
      return { ok: true, output: formatDream(report), error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_dream \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_compress", "\u4F1A\u8BDD\u538B\u7F29\uFF1A\u5C06\u957F\u4F1A\u8BDD\u6587\u672C\u538B\u7F29\u4E3A\u7ED3\u6784\u5316\u6458\u8981\uFF0C\u63D0\u53D6\u5173\u952E\u51B3\u7B56\u548C\u672A\u89E3\u51B3\u95EE\u9898\u3002", {
    sessionId: { type: "string", required: true, description: "\u4F1A\u8BDD ID" },
    messages: { type: "array", required: true, description: "\u4F1A\u8BDD\u6D88\u606F\u6587\u672C\u6570\u7EC4", items: { type: "string" } },
    sessionStart: { type: "number", description: "\u4F1A\u8BDD\u5F00\u59CB\u65F6\u95F4\u6233\uFF08\u6BEB\u79D2\uFF09\uFF0C\u9ED8\u8BA4\u5F53\u524D\u65F6\u95F4" }
  }, async ({ sessionId, messages, sessionStart = Date.now() }) => {
    try {
      if (!ms.sessionCompressor) return { ok: false, output: "", error: "\u4F1A\u8BDD\u538B\u7F29\u5F15\u64CE\u672A\u521D\u59CB\u5316\uFF08\u9700\u914D\u7F6E\uFF09" };
      const result = await ms.sessionCompressor.compress(sessionId, messages, sessionStart);
      return { ok: true, output: JSON.stringify(result, null, 2), error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_compress \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_nudge", "\u667A\u80FD\u63D0\u9192\uFF1A\u5206\u6790\u8FD1\u671F\u8BB0\u5FC6\uFF0C\u68C0\u6D4B\u91CD\u590D\u6A21\u5F0F\u3001\u9519\u8BEF\u590D\u73B0\u548C\u573A\u666F\u5316\u63D0\u9192\u3002", {
    hours: { type: "number", description: "\u5206\u6790\u7684\u6700\u8FD1\u65F6\u95F4\u8303\u56F4\uFF08\u5C0F\u65F6\uFF09\uFF0C\u9ED8\u8BA4 24" }
  }, async ({ hours = 24 }) => {
    try {
      if (!ms.nudgeEngine) return { ok: false, output: "", error: "\u63D0\u9192\u5F15\u64CE\u672A\u521D\u59CB\u5316" };
      const suggestions = ms.nudgeEngine.analyzeRecent(hours);
      return { ok: true, output: formatNudge(suggestions), error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_nudge \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_profile", "\u7528\u6237\u753B\u50CF\uFF1A\u67E5\u770B\u7528\u6237\u884C\u4E3A\u6A21\u5F0F\u5206\u6790\uFF0C\u5305\u62EC\u4E3B\u9898\u504F\u597D\u3001\u6D3B\u8DC3\u5EA6\u7B49\u3002", {
    userId: { type: "string", description: "\u7528\u6237 ID\uFF0C\u9ED8\u8BA4 default" }
  }, async ({ userId = "default" }) => {
    try {
      const profile = ms.getUserProfile(userId);
      return { ok: true, output: formatProfile(profile), error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_profile \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_health", "\u68C0\u67E5 AI-memory \u8BED\u4E49\u5E93\u5065\u5EB7\u72B6\u6001\u3002", {}, async () => {
    try {
      const health = await ms.checkHealth();
      return { ok: true, output: formatHealth(health), error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_health \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_stats", "\u67E5\u770B AI-memory \u8BED\u4E49\u5E93\u7684\u7EDF\u8BA1\u4FE1\u606F\u3002", {}, async () => {
    try {
      const report = await ms.generateReport();
      return { ok: true, output: formatStats(report), error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_stats \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_logs", "\u7CFB\u7EDF\u65E5\u5FD7\uFF1A\u67E5\u770B\u8BB0\u5FC6\u7CFB\u7EDF\u8FD0\u884C\u65E5\u5FD7\u3002", {
    limit: { type: "number", description: "\u8FD4\u56DE\u6761\u6570\u4E0A\u9650\uFF0C\u9ED8\u8BA4 50" },
    minLevel: { type: "string", description: "\u6700\u4F4E\u65E5\u5FD7\u7EA7\u522B\uFF08\u5982 error\u3001warn\u3001info\uFF09" }
  }, async ({ limit = 50, minLevel }) => {
    try {
      const entries = ms.getLogs(limit, minLevel);
      return { ok: true, output: formatLogs(entries), error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_logs \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_errors", "\u9519\u9898\u672C\uFF1A\u67E5\u770B\u8FD1\u671F\u9519\u8BEF\u65E5\u5FD7\uFF0C\u5206\u6790\u5931\u8D25\u6A21\u5F0F\u3002", {
    hours: { type: "number", description: "\u65F6\u95F4\u8303\u56F4\uFF08\u5C0F\u65F6\uFF09\uFF0C\u9ED8\u8BA4 24" }
  }, async ({ hours = 24 }) => {
    try {
      const entries = ms.getRecentErrors(hours);
      if (entries.length === 0) return { ok: true, output: "\u{1F389} \u8FD1\u671F\u65E0\u9519\u8BEF\u65E5\u5FD7", error: "" };
      return { ok: true, output: formatLogs(entries), error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_errors \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_prune", "\u6E05\u7406\u8FC7\u671F/\u4F4E\u91CD\u8981\u6027\u8BB0\u5FC6\u3002\u53EF\u5148 dryRun \u9884\u89C8\u5F71\u54CD\u3002", {
    dryRun: { type: "boolean", description: "\u9884\u89C8\u6A21\u5F0F\uFF08\u4E0D\u5B9E\u9645\u6267\u884C\uFF0C\u4EC5\u663E\u793A\u9884\u6D4B\u7ED3\u679C\uFF09" }
  }, async ({ dryRun = false }) => {
    try {
      const result = ms.prune({ dryRun });
      const label = dryRun ? "\u9884\u89C8" : "\u5DF2\u6267\u884C";
      return { ok: true, output: `${label}\uFF1A\u5220\u9664 ${result.deleted} \u6761\uFF0C\u5F52\u6863 ${result.archived} \u6761`, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_prune \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_consistency", "\u68C0\u67E5\u56FE\u5E93\u4E0E\u5411\u91CF\u5E93\u7684\u4E00\u81F4\u6027\uFF0C\u53D1\u73B0\u5B64\u7ACB\u8282\u70B9\u3002", {}, async () => {
    try {
      const report = ms.checkConsistency();
      return { ok: true, output: formatConsistency(report), error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_consistency \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_rebuild_index", "\u91CD\u5EFA\u5411\u91CF\u7D22\u5F15\uFF1A\u4ECE\u56FE\u5E93\u91CD\u65B0\u751F\u6210\u6240\u6709\u5411\u91CF\u3002\u9002\u7528\u4E8E\u5411\u91CF\u5E93\u635F\u574F\u6216\u5347\u7EA7\u540E\u6062\u590D\u3002", {}, async () => {
    try {
      const count = await ms.rebuildVectorIndex();
      return { ok: true, output: `\u2705 \u5411\u91CF\u7D22\u5F15\u91CD\u5EFA\u5B8C\u6210\uFF0C\u5DF2\u4E3A ${count} \u6761\u8BB0\u5FC6\u751F\u6210\u5411\u91CF`, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `memory_rebuild_index \u5931\u8D25: ${err.message}` };
    }
  });
  console.log("[dsh-memory-ai] \u5DF2\u6CE8\u518C 14 \u4E2A\u5DE5\u5177: memory_query/write/write_batch/dream/compress/nudge/health/stats/logs/errors/prune/consistency/rebuild_index/profile");
  registerTool(ctx, "memory-config-read", "\u8BFB\u53D6\u8BB0\u5FC6\u7CFB\u7EDF\u914D\u7F6E", {}, async () => {
    try {
      const config2 = readPersistedConfig();
      const dbPath = join4(merged.codegraphDir || DEFAULT_CG_DIR, "codegraph.db");
      const dbExists = existsSync5(dbPath);
      let dbSize = 0;
      if (dbExists) {
        dbSize = statSync(dbPath).size;
      }
      return {
        ok: true,
        output: "",
        config: {
          codegraphDir: merged.codegraphDir || DEFAULT_CG_DIR,
          embedder: merged.embedder || "simple",
          apiKey: merged.embedderApiKey || "",
          apiModel: merged.embedderModel || "",
          apiBaseUrl: merged.embedderBaseUrl || "",
          dbExists,
          dbSize
        },
        error: ""
      };
    } catch (err) {
      return { ok: false, output: "", config: {}, error: err.message };
    }
  });
  registerTool(ctx, "memory-config-write", "\u5199\u5165\u8BB0\u5FC6\u7CFB\u7EDF\u914D\u7F6E", { config: { type: "object", description: "\u914D\u7F6E\u5BF9\u8C61", additionalProperties: false } }, async ({ config: config2 }) => {
    try {
      const configFile = join4(homedir(), ".dsh", "memory-ai-config.json");
      mkdirSync4(join4(homedir(), ".dsh"), { recursive: true });
      writeFileSync2(configFile, JSON.stringify(config2, null, 2), "utf8");
      return { ok: true, output: "\u2705 \u914D\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u91CD\u542F DSH \u540E\u751F\u6548", error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `\u4FDD\u5B58\u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory-config-health", "\u68C0\u67E5\u8BB0\u5FC6\u7CFB\u7EDF\u914D\u7F6E\u72B6\u6001", {}, async () => {
    try {
      const dbPath = join4(merged.codegraphDir || DEFAULT_CG_DIR, "codegraph.db");
      const dbExists = existsSync5(dbPath);
      return { ok: true, output: "", dbExists, error: "" };
    } catch (err) {
      return { ok: false, output: "", dbExists: false, error: err.message };
    }
  });
  if (ctx.connection) {
    ctx.connection.rpc.handle(
      "/memory-config",
      async (endpoint, payload) => {
        if (endpoint === "read") {
          const config2 = readPersistedConfig();
          const dbPath = join4(merged.codegraphDir || DEFAULT_CG_DIR, "codegraph.db");
          const dbExists = existsSync5(dbPath);
          let dbSize = 0;
          if (dbExists) dbSize = statSync(dbPath).size;
          return {
            ok: true,
            value: {
              ok: true,
              config: {
                codegraphDir: merged.codegraphDir || DEFAULT_CG_DIR,
                embedder: merged.embedder || "simple",
                apiKey: merged.embedderApiKey || "",
                apiModel: merged.embedderModel || "",
                apiBaseUrl: merged.embedderBaseUrl || "",
                dbExists,
                dbSize
              }
            }
          };
        }
        if (endpoint === "write") {
          const configFile = join4(homedir(), ".dsh", "memory-ai-config.json");
          mkdirSync4(join4(homedir(), ".dsh"), { recursive: true });
          writeFileSync2(configFile, JSON.stringify(payload.config, null, 2), "utf8");
          return { ok: true, value: { ok: true } };
        }
        if (endpoint === "health") {
          const dbPath = join4(merged.codegraphDir || DEFAULT_CG_DIR, "codegraph.db");
          const dbExists = existsSync5(dbPath);
          return { ok: true, value: { ok: true, dbExists, dbSize: dbExists ? statSync(dbPath).size : 0 } };
        }
        return { ok: false, error: { code: "not-found", message: `unknown endpoint: ${endpoint}` } };
      },
      { authority: "loopback" }
    );
  }
  registerTool(ctx, "todo_create", "\u521B\u5EFA\u5F85\u529E\u4E8B\u9879\uFF08\u56DB\u8F68\uFF1Alife/work/project/daily\uFF09", {
    title: { type: "string", required: true, description: "\u5F85\u529E\u6807\u9898\uFF08\u5FC5\u586B\uFF09" },
    description: { type: "string", description: "\u8BE6\u7EC6\u63CF\u8FF0" },
    track: { type: "string", enum: ["life", "work", "project", "daily"], description: "\u8F68\u9053\uFF08\u9ED8\u8BA4 work\uFF09" },
    priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "\u4F18\u5148\u7EA7\uFF08\u9ED8\u8BA4 medium\uFF09" },
    due_date: { type: "number", description: "\u622A\u6B62\u65E5\u671F\u65F6\u95F4\u6233\uFF08\u6BEB\u79D2\uFF09" },
    project_dir: { type: "string", description: "\u9879\u76EE\u76EE\u5F55\uFF08\u4EC5 project \u8F68\u4F7F\u7528\uFF09" },
    tags: { type: "array", items: { type: "string" }, description: "\u6807\u7B7E\u6570\u7EC4" }
  }, async (args) => {
    if (!ms.todoManager) return { ok: false, output: "", error: "\u5F85\u529E\u7BA1\u7406\u5668\u672A\u521D\u59CB\u5316" };
    try {
      const todo = await ms.todoManager.createTodo({
        title: String(args.title),
        description: args.description ?? "",
        track: args.track ?? "work",
        priority: args.priority ?? "medium",
        dueDate: args.due_date ?? null,
        projectDir: args.project_dir ?? null,
        tags: args.tags ?? []
      });
      return { ok: true, output: `\u2705 \u5F85\u529E\u5DF2\u521B\u5EFA: ${todo.title}
ID: ${todo.id}
\u8F68\u9053: ${todo.track} | \u4F18\u5148\u7EA7: ${todo.priority} | \u72B6\u6001: ${todo.status}`, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `todo_create \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "todo_list", "\u5217\u51FA\u5F85\u529E\u4E8B\u9879\uFF08\u652F\u6301\u6309\u8F68\u9053/\u72B6\u6001/\u4F18\u5148\u7EA7\u8FC7\u6EE4\uFF09", {
    track: { type: "string", enum: ["life", "work", "project", "daily"], description: "\u6309\u8F68\u9053\u8FC7\u6EE4" },
    status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled", "archived"], description: "\u6309\u72B6\u6001\u8FC7\u6EE4" },
    priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "\u6309\u4F18\u5148\u7EA7\u8FC7\u6EE4" },
    limit: { type: "number", description: "\u6700\u591A\u8FD4\u56DE\u6761\u6570\uFF08\u9ED8\u8BA4 20\uFF09" }
  }, async (args) => {
    if (!ms.todoManager) return { ok: false, output: "", error: "\u5F85\u529E\u7BA1\u7406\u5668\u672A\u521D\u59CB\u5316" };
    try {
      const todos = await ms.todoManager.listTodos({
        track: args.track,
        status: args.status,
        priority: args.priority,
        limit: args.limit ?? 20
      });
      if (todos.length === 0) return { ok: true, output: "\u{1F4ED} \u65E0\u5339\u914D\u7684\u5F85\u529E\u4E8B\u9879", error: "" };
      const text = todos.map((t, i) => {
        const icon = t.status === "completed" ? "\u2705" : t.status === "in_progress" ? "\u{1F504}" : t.status === "cancelled" ? "\u274C" : "\u2B1C";
        return `${icon} [${i + 1}] ${t.title}
    ID: ${t.id} | \u8F68\u9053: ${t.track} | \u4F18\u5148\u7EA7: ${t.priority} | \u72B6\u6001: ${t.status}${t.dueDate ? `
    \u622A\u6B62: ${new Date(t.dueDate).toLocaleString()}` : ""}`;
      }).join("\n\n");
      return { ok: true, output: text, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `todo_list \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "todo_complete", "\u6807\u8BB0\u5F85\u529E\u4E3A\u5DF2\u5B8C\u6210", {
    id: { type: "string", required: true, description: "\u5F85\u529E ID\uFF08\u5FC5\u586B\uFF09" }
  }, async (args) => {
    if (!ms.todoManager) return { ok: false, output: "", error: "\u5F85\u529E\u7BA1\u7406\u5668\u672A\u521D\u59CB\u5316" };
    try {
      const success = await ms.todoManager.completeTodo(String(args.id));
      return success ? { ok: true, output: `\u2705 \u5F85\u529E\u5DF2\u5B8C\u6210: ${args.id}`, error: "" } : { ok: false, output: "", error: `\u5F85\u529E\u4E0D\u5B58\u5728: ${args.id}` };
    } catch (err) {
      return { ok: false, output: "", error: `todo_complete \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "todo_update", "\u66F4\u65B0\u5F85\u529E\u4E8B\u9879", {
    id: { type: "string", required: true, description: "\u5F85\u529E ID\uFF08\u5FC5\u586B\uFF09" },
    title: { type: "string", description: "\u65B0\u6807\u9898" },
    description: { type: "string", description: "\u65B0\u63CF\u8FF0" },
    status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled", "archived"], description: "\u65B0\u72B6\u6001" },
    priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "\u65B0\u4F18\u5148\u7EA7" },
    due_date: { type: "number", description: "\u65B0\u622A\u6B62\u65E5\u671F" },
    tags: { type: "array", items: { type: "string" }, description: "\u65B0\u6807\u7B7E" }
  }, async (args) => {
    if (!ms.todoManager) return { ok: false, output: "", error: "\u5F85\u529E\u7BA1\u7406\u5668\u672A\u521D\u59CB\u5316" };
    try {
      const data = {};
      if (args.title !== void 0) data.title = String(args.title);
      if (args.description !== void 0) data.description = String(args.description);
      if (args.status !== void 0) data.status = String(args.status);
      if (args.priority !== void 0) data.priority = String(args.priority);
      if (args.due_date !== void 0) data.dueDate = Number(args.due_date);
      if (args.tags !== void 0) data.tags = args.tags;
      const success = await ms.todoManager.updateTodo(String(args.id), data);
      return success ? { ok: true, output: `\u2705 \u5F85\u529E\u5DF2\u66F4\u65B0: ${args.id}`, error: "" } : { ok: false, output: "", error: `\u5F85\u529E\u4E0D\u5B58\u5728: ${args.id}` };
    } catch (err) {
      return { ok: false, output: "", error: `todo_update \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "todo_daily_summary", "\u83B7\u53D6\u6BCF\u65E5\u5F85\u529E\u6C47\u603B", {}, async () => {
    if (!ms.todoManager) return { ok: false, output: "", error: "\u5F85\u529E\u7BA1\u7406\u5668\u672A\u521D\u59CB\u5316" };
    try {
      const summary = await ms.todoManager.getDailySummary();
      const text = [
        `\u{1F4CA} \u6BCF\u65E5\u5F85\u529E\u6C47\u603B`,
        `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
        `  \u603B\u5F85\u529E: ${summary.total}`,
        `  \u4ECA\u65E5\u5B8C\u6210: ${summary.completed}`,
        `  \u5F85\u5904\u7406: ${summary.pending}`,
        `  \u5DF2\u903E\u671F: ${summary.overdue}`,
        ``,
        `  \u6309\u8F68\u9053:`,
        ...Object.entries(summary.byTrack).map(([track, count]) => `    ${track}: ${count} \u9879`)
      ].join("\n");
      return { ok: true, output: text, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `todo_daily_summary \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "prompt_create", "\u521B\u5EFA\u63D0\u793A\u8BCD\u6A21\u677F", {
    name: { type: "string", required: true, description: "\u6A21\u677F\u540D\u79F0\uFF08\u5FC5\u586B\uFF0C\u552F\u4E00\uFF09" },
    category: { type: "string", required: true, description: "\u5206\u7C7B\uFF08\u5FC5\u586B\uFF0C\u5982 code_review/debug/prd\uFF09" },
    content: { type: "string", required: true, description: "\u6A21\u677F\u5185\u5BB9\uFF08\u5FC5\u586B\uFF09" },
    description: { type: "string", description: "\u63CF\u8FF0" },
    tags: { type: "array", items: { type: "string" }, description: "\u6807\u7B7E\u6570\u7EC4" }
  }, async (args) => {
    if (!ms.promptManager) return { ok: false, output: "", error: "\u63D0\u793A\u8BCD\u7BA1\u7406\u5668\u672A\u521D\u59CB\u5316" };
    try {
      const tpl = await ms.promptManager.createTemplate({
        name: String(args.name),
        category: String(args.category),
        content: String(args.content),
        description: args.description ?? "",
        tags: args.tags ?? []
      });
      return { ok: true, output: `\u2705 \u63D0\u793A\u8BCD\u6A21\u677F\u5DF2\u521B\u5EFA: ${tpl.name}
ID: ${tpl.id} | \u5206\u7C7B: ${tpl.category} | \u7248\u672C: ${tpl.version}`, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `prompt_create \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "prompt_list", "\u5217\u51FA\u63D0\u793A\u8BCD\u6A21\u677F\uFF08\u652F\u6301\u6309\u5206\u7C7B\u8FC7\u6EE4\uFF09", {
    category: { type: "string", description: "\u6309\u5206\u7C7B\u8FC7\u6EE4" },
    enabled_only: { type: "boolean", description: "\u4EC5\u663E\u793A\u5DF2\u542F\u7528\u7684\u6A21\u677F" },
    limit: { type: "number", description: "\u6700\u591A\u8FD4\u56DE\u6761\u6570\uFF08\u9ED8\u8BA4 20\uFF09" }
  }, async (args) => {
    if (!ms.promptManager) return { ok: false, output: "", error: "\u63D0\u793A\u8BCD\u7BA1\u7406\u5668\u672A\u521D\u59CB\u5316" };
    try {
      const templates = await ms.promptManager.listTemplates({
        category: args.category,
        enabled: args.enabled_only,
        limit: args.limit ?? 20
      });
      if (templates.length === 0) return { ok: true, output: "\u{1F4ED} \u65E0\u5339\u914D\u7684\u63D0\u793A\u8BCD\u6A21\u677F", error: "" };
      const text = templates.map(
        (t, i) => `[${i + 1}] ${t.name} (${t.category}) v${t.version} ${t.enabled ? "\u2705" : "\u23F8"}
    ID: ${t.id} | \u63CF\u8FF0: ${t.description || "\u65E0"}`
      ).join("\n\n");
      return { ok: true, output: text, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `prompt_list \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "prompt_find", "\u641C\u7D22\u63D0\u793A\u8BCD\u6A21\u677F", {
    query: { type: "string", required: true, description: "\u641C\u7D22\u5173\u952E\u8BCD\uFF08\u5FC5\u586B\uFF09" },
    limit: { type: "number", description: "\u6700\u591A\u8FD4\u56DE\u6761\u6570\uFF08\u9ED8\u8BA4 10\uFF09" }
  }, async (args) => {
    if (!ms.promptManager) return { ok: false, output: "", error: "\u63D0\u793A\u8BCD\u7BA1\u7406\u5668\u672A\u521D\u59CB\u5316" };
    try {
      const templates = await ms.promptManager.findTemplates(String(args.query), args.limit ?? 10);
      if (templates.length === 0) return { ok: true, output: "\u{1F4ED} \u672A\u627E\u5230\u5339\u914D\u7684\u63D0\u793A\u8BCD\u6A21\u677F", error: "" };
      const text = templates.map(
        (t, i) => `[${i + 1}] ${t.name} (${t.category}) v${t.version}
    ID: ${t.id} | \u63CF\u8FF0: ${t.description || "\u65E0"}`
      ).join("\n\n");
      return { ok: true, output: text, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `prompt_find \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "prompt_inject", "\u6CE8\u5165\u63D0\u793A\u8BCD\u6A21\u677F\u5230\u5F53\u524D\u4E0A\u4E0B\u6587", {
    id: { type: "string", required: true, description: "\u6A21\u677F ID\uFF08\u5FC5\u586B\uFF09" },
    context: { type: "string", description: "\u5DF2\u6709\u4E0A\u4E0B\u6587\uFF08\u53EF\u9009\uFF0C\u4F1A\u62FC\u63A5\u5230\u6A21\u677F\u524D\uFF09" }
  }, async (args) => {
    if (!ms.promptManager) return { ok: false, output: "", error: "\u63D0\u793A\u8BCD\u7BA1\u7406\u5668\u672A\u521D\u59CB\u5316" };
    try {
      const result = await ms.promptManager.injectTemplate(String(args.id), args.context ?? "");
      return { ok: true, output: `\u{1F4DD} \u63D0\u793A\u8BCD\u6A21\u677F\u5DF2\u6CE8\u5165:
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
${result}`, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `prompt_inject \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "bookmark_create", "\u521B\u5EFA\u4F1A\u8BDD\u4E66\u7B7E", {
    session_id: { type: "string", required: true, description: "\u4F1A\u8BDD ID\uFF08\u5FC5\u586B\uFF09" },
    round_index: { type: "number", required: true, description: "\u8F6E\u6B21\u7D22\u5F15\uFF08\u5FC5\u586B\uFF09" },
    title: { type: "string", required: true, description: "\u4E66\u7B7E\u6807\u9898\uFF08\u5FC5\u586B\uFF09" },
    summary: { type: "string", description: "\u6458\u8981" },
    tags: { type: "array", items: { type: "string" }, description: "\u6807\u7B7E" }
  }, async (args) => {
    if (!ms.bookmarkManager) return { ok: false, output: "", error: "\u4F1A\u8BDD\u4E66\u7B7E\u672A\u521D\u59CB\u5316" };
    try {
      const bm = await ms.bookmarkManager.createBookmark({
        sessionId: String(args.session_id),
        roundIndex: Number(args.round_index),
        title: String(args.title),
        summary: args.summary ?? "",
        tags: args.tags ?? []
      });
      return { ok: true, output: `\u{1F516} \u4E66\u7B7E\u5DF2\u521B\u5EFA: ${bm.title}
ID: ${bm.id} | \u4F1A\u8BDD: ${bm.sessionId} | \u8F6E\u6B21: ${bm.roundIndex}`, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `bookmark_create \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "bookmark_list", "\u5217\u51FA\u4F1A\u8BDD\u4E66\u7B7E", {
    session_id: { type: "string", required: true, description: "\u4F1A\u8BDD ID\uFF08\u5FC5\u586B\uFF09" }
  }, async (args) => {
    if (!ms.bookmarkManager) return { ok: false, output: "", error: "\u4F1A\u8BDD\u4E66\u7B7E\u672A\u521D\u59CB\u5316" };
    try {
      const bookmarks = await ms.bookmarkManager.listBookmarks(String(args.session_id));
      if (bookmarks.length === 0) return { ok: true, output: "\u{1F4ED} \u8BE5\u4F1A\u8BDD\u65E0\u4E66\u7B7E", error: "" };
      const text = bookmarks.map(
        (b, i) => `[${i + 1}] ${b.title} (\u8F6E\u6B21 ${b.roundIndex})
    ID: ${b.id} | \u6458\u8981: ${b.summary || "\u65E0"}`
      ).join("\n\n");
      return { ok: true, output: text, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `bookmark_list \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "bookmark_search", "\u8DE8\u4F1A\u8BDD\u641C\u7D22\u4E66\u7B7E", {
    query: { type: "string", required: true, description: "\u641C\u7D22\u5173\u952E\u8BCD\uFF08\u5FC5\u586B\uFF09" },
    limit: { type: "number", description: "\u6700\u591A\u8FD4\u56DE\u6761\u6570\uFF08\u9ED8\u8BA4 10\uFF09" }
  }, async (args) => {
    if (!ms.bookmarkManager) return { ok: false, output: "", error: "\u4F1A\u8BDD\u4E66\u7B7E\u672A\u521D\u59CB\u5316" };
    try {
      const bookmarks = await ms.bookmarkManager.searchBookmarks(String(args.query), void 0, args.limit ?? 10);
      if (bookmarks.length === 0) return { ok: true, output: "\u{1F4ED} \u672A\u627E\u5230\u5339\u914D\u7684\u4E66\u7B7E", error: "" };
      const text = bookmarks.map(
        (b, i) => `[${i + 1}] ${b.title}
    ID: ${b.id} | \u4F1A\u8BDD: ${b.sessionId} \u8F6E\u6B21 ${b.roundIndex} | \u6458\u8981: ${b.summary || "\u65E0"}`
      ).join("\n\n");
      return { ok: true, output: text, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `bookmark_search \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "notification_send", "\u53D1\u9001\u901A\u77E5\u5230\u6307\u5B9A\u901A\u9053", {
    channel_id: { type: "string", required: true, description: "\u901A\u9053 ID\uFF08\u5FC5\u586B\uFF09" },
    title: { type: "string", required: true, description: "\u901A\u77E5\u6807\u9898\uFF08\u5FC5\u586B\uFF09" },
    body: { type: "string", required: true, description: "\u901A\u77E5\u5185\u5BB9\uFF08\u5FC5\u586B\uFF09" },
    severity: { type: "string", enum: ["info", "warning", "error"], description: "\u4E25\u91CD\u7A0B\u5EA6\uFF08\u9ED8\u8BA4 info\uFF09" }
  }, async (args) => {
    if (!ms.notificationBus) return { ok: false, output: "", error: "\u901A\u77E5\u603B\u7EBF\u672A\u521D\u59CB\u5316" };
    try {
      const result = await ms.notificationBus.sendNotification(String(args.channel_id), {
        title: String(args.title),
        body: String(args.body),
        severity: args.severity ?? "info"
      });
      return result.success ? { ok: true, output: `\u2705 \u901A\u77E5\u5DF2\u53D1\u9001\u5230\u901A\u9053: ${args.channel_id}`, error: "" } : { ok: false, output: "", error: `\u901A\u77E5\u53D1\u9001\u5931\u8D25: ${result.error}` };
    } catch (err) {
      return { ok: false, output: "", error: `notification_send \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "notification_list", "\u5217\u51FA\u5DF2\u914D\u7F6E\u7684\u901A\u77E5\u901A\u9053", {
    enabled_only: { type: "boolean", description: "\u4EC5\u663E\u793A\u5DF2\u542F\u7528\u7684\u901A\u9053" }
  }, async (args) => {
    if (!ms.notificationBus) return { ok: false, output: "", error: "\u901A\u77E5\u603B\u7EBF\u672A\u521D\u59CB\u5316" };
    try {
      const channels = await ms.notificationBus.listChannels(args.enabled_only ?? false);
      if (channels.length === 0) return { ok: true, output: "\u{1F4ED} \u65E0\u901A\u77E5\u901A\u9053", error: "" };
      const text = channels.map(
        (c, i) => `[${i + 1}] ${c.name} (${c.channelType}) ${c.enabled ? "\u2705" : "\u23F8"}
    ID: ${c.id}`
      ).join("\n\n");
      return { ok: true, output: text, error: "" };
    } catch (err) {
      return { ok: false, output: "", error: `notification_list \u5931\u8D25: ${err.message}` };
    }
  });
  registerTool(ctx, "memory_sync", "\u63A8\u9001/\u62C9\u53D6\u8BB0\u5FC6\u5230\u8FDC\u7AEF\u4ED3\u5E93\uFF08\u8DE8\u8BBE\u5907\u540C\u6B65\uFF09", {
    direction: { type: "string", enum: ["push", "pull", "status"], required: true, description: "\u540C\u6B65\u65B9\u5411\uFF08\u5FC5\u586B\uFF09" }
  }, async (args) => {
    if (!ms.memorySync) return { ok: false, output: "", error: "\u8BB0\u5FC6\u540C\u6B65\u672A\u521D\u59CB\u5316" };
    try {
      const direction = String(args.direction);
      if (direction === "status") {
        const status = ms.memorySync.getSyncStatus();
        const text = [
          `\u{1F4E1} \u8BB0\u5FC6\u540C\u6B65\u72B6\u6001`,
          `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`,
          `  \u8FDC\u7AEF\u5206\u652F: ${status.remoteBranch ?? "\u672A\u68C0\u6D4B\u5230"}`,
          `  \u4E0A\u6B21\u540C\u6B65: ${status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "\u4ECE\u672A"}`,
          `  \u72B6\u6001: ${status.isSynced ? "\u2705 \u5DF2\u540C\u6B65" : "\u26A0\uFE0F \u672A\u540C\u6B65"}`
        ].join("\n");
        return { ok: true, output: text, error: "" };
      }
      if (direction === "push") {
        const result = await ms.memorySync.pushMemory();
        return { ok: true, output: `\u{1F4E4} \u8BB0\u5FC6\u63A8\u9001\u5B8C\u6210: ${result.pushed} \u6761 (\u8017\u65F6 ${result.duration}ms)`, error: "" };
      }
      if (direction === "pull") {
        const result = await ms.memorySync.pullMemory();
        return { ok: true, output: `\u{1F4E5} \u8BB0\u5FC6\u62C9\u53D6\u5B8C\u6210: ${result.pulled} \u6761, \u51B2\u7A81 ${result.conflicts} \u6761 (\u8017\u65F6 ${result.duration}ms)`, error: "" };
      }
      return { ok: false, output: "", error: `\u672A\u77E5\u65B9\u5411: ${direction}\uFF0C\u4F7F\u7528 push/pull/status` };
    } catch (err) {
      return { ok: false, output: "", error: `memory_sync \u5931\u8D25: ${err.message}` };
    }
  });
  console.log("[dsh-memory-ai] \u5DF2\u6CE8\u518C 30+ \u4E2A\u5DE5\u5177\uFF08\u542B v12 \u65B0\u589E\u5F85\u529E/\u63D0\u793A\u8BCD/\u4E66\u7B7E/\u901A\u77E5/\u540C\u6B65\uFF09");
}
export {
  apply,
  inject,
  name
};
