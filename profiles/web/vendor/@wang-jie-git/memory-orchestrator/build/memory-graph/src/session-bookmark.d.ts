/**
 * session-bookmark — 会话书签管理器
 *
 * 参考 dsh-memory-evolve 的会话书签设计，支持标记关键轮次、跨会话搜索。
 * 代码风格与 todo-manager.ts / procedure-memory.ts 一致。
 */
import { MemoryDatabase } from "./database";
export interface SessionBookmark {
    id: string;
    sessionId: string;
    roundIndex: number;
    title: string;
    summary: string;
    tags: string[];
    createdAt: number;
    userId: string;
}
export interface BookmarkCreateInput {
    sessionId: string;
    roundIndex: number;
    title: string;
    summary?: string;
    tags?: string[];
    userId?: string;
}
export declare class SessionBookmarkManager {
    private db;
    constructor(db: MemoryDatabase);
    /**
     * 创建会话书签
     */
    createBookmark(data: BookmarkCreateInput): Promise<SessionBookmark>;
    /**
     * 列出某会话的书签
     */
    listBookmarks(sessionId: string, userId?: string): Promise<SessionBookmark[]>;
    /**
     * 删除书签
     */
    deleteBookmark(id: string): Promise<boolean>;
    /**
     * 跨会话搜索书签
     */
    searchBookmarks(query: string, userId?: string, limit?: number): Promise<SessionBookmark[]>;
    private rowToBookmark;
}
//# sourceMappingURL=session-bookmark.d.ts.map