/**
 * memory-sync — Git 分支感知 + 跨设备记忆同步
 *
 * 参考 dsh-memory-evolve 的设计：
 * - Git 分支感知：写入记忆时自动检测当前 git 分支并标记
 * - 跨设备同步：基于 git 仓库的专属分支机制，推送/拉取记忆
 *
 * 代码风格与 todo-manager.ts 一致。
 */
import { MemoryDatabase } from "./database";
export interface SyncStatus {
    lastSyncAt: number | null;
    pendingChanges: number;
    remoteBranch: string | null;
    isSynced: boolean;
}
export interface SyncResult {
    pushed: number;
    pulled: number;
    conflicts: number;
    duration: number;
}
export declare class MemorySync {
    private db;
    private codegraphDir;
    constructor(db: MemoryDatabase, codegraphDir: string);
    /**
     * 检测当前 git 分支
     */
    detectGitBranch(): string | null;
    /**
     * 检测当前 git 仓库根目录
     */
    detectGitRoot(): string | null;
    /**
     * 获取同步状态
     */
    getSyncStatus(): SyncStatus;
    /**
     * 推送记忆到远端（简化版）
     * 实际实现需要将记忆数据导出到 git 仓库的专属分支
     */
    pushMemory(): Promise<SyncResult>;
    /**
     * 拉取远端记忆（简化版）
     */
    pullMemory(): Promise<SyncResult>;
    private resolveProjectDir;
}
//# sourceMappingURL=memory-sync.d.ts.map