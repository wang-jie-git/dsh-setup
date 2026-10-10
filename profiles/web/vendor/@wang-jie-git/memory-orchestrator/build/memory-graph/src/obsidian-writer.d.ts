/**
 * memory-graph: Obsidian 双写同步器
 *
 * 将 memory_nodes 中的条目自动同步写入 Obsidian Vault，
 * 保持人类可读的 markdown 版本。
 *
 * 架构：
 *   CodeGraph DB (source of truth)
 *     ↓ 异步同步（idempotent）
 *   Obsidian Vault (人类可读缓存，可重建)
 */
import type { MemoryNode } from "./database";
export interface ObsidianSyncConfig {
    /** Obsidian Vault 根目录 */
    vaultPath: string;
    /** 记忆子目录（相对 vaultPath） */
    subDir?: string;
    /** 是否把 summary 写入 frontmatter description */
    includeSummary?: boolean;
    /** 是否写入完整 body */
    includeBody?: boolean;
}
export declare class ObsidianWriter {
    private config;
    constructor(config: Partial<ObsidianSyncConfig>);
    /** 获取笔记目录路径 */
    private getNotesDir;
    /** 根据 memory node 生成文件名 */
    getFilename(node: MemoryNode): string;
    /** 将 MemoryNode 写入 Obsidian */
    write(node: MemoryNode): string;
    /** 删除 Obsidian 中的对应笔记（删除所有匹配 nodeId 的文件） */
    delete(nodeId: string): boolean;
    /** 列出 Obsidian 中的笔记（用于一致性校验） */
    list(): Array<{
        filename: string;
        nodeId: string | null;
    }>;
    /** 获取笔记总数 */
    count(): number;
}
//# sourceMappingURL=obsidian-writer.d.ts.map