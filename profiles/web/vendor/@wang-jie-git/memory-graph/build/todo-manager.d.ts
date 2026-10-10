/**
 * todo-manager — 四轨待办管理器
 *
 * 参考 dsh-memory-evolve 的四轨待办设计，集成到 One Memory 的图数据库架构中。
 * 四轨：life / work / project / daily
 *
 * 代码风格与 procedure-memory.ts / user-profile.ts 一致。
 */
import { MemoryDatabase } from "./database";
export type TodoTrack = "life" | "work" | "project" | "daily";
export type TodoPriority = "low" | "medium" | "high" | "urgent";
export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled" | "archived";
export interface TodoItem {
    id: string;
    title: string;
    description: string;
    track: TodoTrack;
    priority: TodoPriority;
    status: TodoStatus;
    dueDate: number | null;
    completedAt: number | null;
    projectDir: string | null;
    tags: string[];
    createdAt: number;
    updatedAt: number;
    userId: string;
}
export interface TodoCreateInput {
    title: string;
    description?: string;
    track: TodoTrack;
    priority?: TodoPriority;
    dueDate?: number | null;
    projectDir?: string | null;
    tags?: string[];
    userId?: string;
}
export interface TodoUpdateInput {
    title?: string;
    description?: string;
    track?: TodoTrack;
    priority?: TodoPriority;
    status?: TodoStatus;
    dueDate?: number | null;
    projectDir?: string | null;
    tags?: string[];
}
export interface TodoFilter {
    track?: TodoTrack;
    status?: TodoStatus;
    priority?: TodoPriority;
    dueBefore?: number;
    dueAfter?: number;
    userId?: string;
    limit?: number;
}
export interface DailySummary {
    total: number;
    completed: number;
    pending: number;
    overdue: number;
    byTrack: Record<string, number>;
}
export declare class TodoManager {
    private db;
    constructor(db: MemoryDatabase);
    /**
     * 创建待办
     */
    createTodo(data: TodoCreateInput): Promise<TodoItem>;
    /**
     * 获取单条待办
     */
    getTodo(id: string): Promise<TodoItem | null>;
    /**
     * 更新待办
     */
    updateTodo(id: string, data: TodoUpdateInput): Promise<boolean>;
    /**
     * 删除待办
     */
    deleteTodo(id: string): Promise<boolean>;
    /**
     * 标记完成
     */
    completeTodo(id: string): Promise<boolean>;
    /**
     * 列出待办（支持多种过滤条件）
     */
    listTodos(filter?: TodoFilter): Promise<TodoItem[]>;
    /**
     * 获取到期未完成的待办
     */
    getOverdueTodos(userId?: string): Promise<TodoItem[]>;
    /**
     * 按轨道分组查看
     */
    getTodosByTrack(track: TodoTrack, userId?: string): Promise<TodoItem[]>;
    /**
     * 获取指定时间内到期的待办
     */
    getDueTodosWithin(hours: number, userId?: string): Promise<TodoItem[]>;
    /**
     * 每日汇总
     */
    getDailySummary(userId?: string): Promise<DailySummary>;
    private rowToTodo;
}
//# sourceMappingURL=todo-manager.d.ts.map