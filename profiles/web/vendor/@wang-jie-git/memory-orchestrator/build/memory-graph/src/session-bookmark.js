/**
 * session-bookmark — 会话书签管理器
 *
 * 参考 dsh-memory-evolve 的会话书签设计，支持标记关键轮次、跨会话搜索。
 * 代码风格与 todo-manager.ts / procedure-memory.ts 一致。
 */
// ===== SessionBookmarkManager =====
export class SessionBookmarkManager {
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
            userId: data.userId ?? "default",
        });
        return Promise.resolve({
            id: result.id,
            sessionId: result.sessionId,
            roundIndex: result.roundIndex,
            title: result.title,
            summary: data.summary ?? "",
            tags: data.tags ?? [],
            createdAt: result.createdAt,
            userId: data.userId ?? "default",
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
                }
                catch {
                    return [];
                }
            })(),
            createdAt: row.created_at,
            userId: row.user_id ?? "default",
        };
    }
}
//# sourceMappingURL=session-bookmark.js.map