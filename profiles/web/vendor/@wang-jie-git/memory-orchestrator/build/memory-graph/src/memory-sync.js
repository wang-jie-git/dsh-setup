/**
 * memory-sync — Git 分支感知 + 跨设备记忆同步
 *
 * 参考 dsh-memory-evolve 的设计：
 * - Git 分支感知：写入记忆时自动检测当前 git 分支并标记
 * - 跨设备同步：基于 git 仓库的专属分支机制，推送/拉取记忆
 *
 * 代码风格与 todo-manager.ts 一致。
 */
import { execSync } from "node:child_process";
// ===== MemorySync =====
export class MemorySync {
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
                timeout: 3000,
                stdio: ["pipe", "pipe", "ignore"],
            }).trim();
            return branch || null;
        }
        catch {
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
                timeout: 3000,
                stdio: ["pipe", "pipe", "ignore"],
            }).trim();
            return root || null;
        }
        catch {
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
                    timeout: 3000,
                    stdio: ["pipe", "pipe", "ignore"],
                }).trim();
                if (lastCommit)
                    lastSyncAt = parseInt(lastCommit, 10) * 1000;
            }
            catch { /* ignore */ }
        }
        return {
            lastSyncAt,
            pendingChanges: 0, // 简化版：不追踪具体变更数
            remoteBranch: branch ? `origin/${branch}` : null,
            isSynced: true,
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
            // 导出记忆数据到临时文件
            const exportPath = `${gitRoot}/.memory-sync/data.json`;
            execSync(`mkdir -p ${gitRoot}/.memory-sync`, { timeout: 3000 });
            // 获取所有活跃记忆节点
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
                    createdAt: n.createdAt,
                })),
            });
            const { writeFileSync } = await import("node:fs");
            writeFileSync(exportPath, syncData, "utf-8");
            // 提交到 git
            execSync("git add .memory-sync/data.json", { cwd: gitRoot, timeout: 5000, stdio: "pipe" });
            execSync('git commit -m "memory-sync: 自动同步记忆数据" --no-verify', {
                cwd: gitRoot, timeout: 5000, stdio: ["pipe", "pipe", "ignore"],
            });
            return { pushed: allNodes.length, pulled: 0, conflicts: 0, duration: Date.now() - start };
        }
        catch {
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
            const { readFileSync, existsSync } = await import("node:fs");
            const importPath = `${gitRoot}/.memory-sync/data.json`;
            if (!existsSync(importPath)) {
                return { pushed: 0, pulled: 0, conflicts: 0, duration: Date.now() - start };
            }
            const raw = readFileSync(importPath, "utf-8");
            const data = JSON.parse(raw);
            let pulled = 0;
            for (const node of data.nodes) {
                // 去重写入：检查是否已存在
                const existing = this.db.findByHash(require("node:crypto").createHash("sha256").update(node.summary + node.body).digest("hex"));
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
                        userId: node.userId ?? "default",
                    });
                    pulled++;
                }
            }
            return { pushed: 0, pulled, conflicts: 0, duration: Date.now() - start };
        }
        catch {
            return { pushed: 0, pulled: 0, conflicts: 0, duration: Date.now() - start };
        }
    }
    // ===== Helpers =====
    resolveProjectDir() {
        // 从 codegraphDir 向上找 git 仓库根目录
        try {
            const { existsSync } = require("node:fs");
            let dir = this.codegraphDir;
            while (dir !== "/") {
                if (existsSync(`${dir}/.git`))
                    return dir;
                dir = require("node:path").dirname(dir);
            }
            return null;
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=memory-sync.js.map