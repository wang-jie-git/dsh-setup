/**
 * todo-manager — 四轨待办管理器
 *
 * 参考 dsh-memory-evolve 的四轨待办设计，集成到 One Memory 的图数据库架构中。
 * 四轨：life / work / project / daily
 *
 * 代码风格与 procedure-memory.ts / user-profile.ts 一致。
 */
// ===== TodoManager =====
export class TodoManager {
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
            userId: data.userId ?? "default",
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
            userId: data.userId ?? "default",
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
            limit: filter?.limit,
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
        const dueBefore = Date.now() + hours * 3600000;
        return this.listTodos({ dueBefore, dueAfter: Date.now(), userId });
    }
    /**
     * 每日汇总
     */
    getDailySummary(userId) {
        const base = this.db.getDailyTodoSummary(userId);
        // 计算各轨道数量
        const allTracks = ["life", "work", "project", "daily"];
        const byTrack = {};
        for (const track of allTracks) {
            const rows = this.db.listTodoItems({ track, userId, limit: 9999 });
            byTrack[track] = rows.length;
        }
        return Promise.resolve({
            ...base,
            byTrack,
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
                }
                catch {
                    return [];
                }
            })(),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            userId: row.user_id ?? "default",
        };
    }
}
//# sourceMappingURL=todo-manager.js.map