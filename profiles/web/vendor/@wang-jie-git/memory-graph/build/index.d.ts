/**
 * One Memory — CodeGraph 记忆引擎集成层
 *
 * 直接打开 CodeGraph 的 SQLite 数据库，新增 memory_nodes/memory_edges 表。
 * 不修改 CodeGraph 一行代码。
 *
 * 使用方式:
 *   const db = MemoryDatabase.open("/path/to/codegraph.db");
 *   db.createNode({ title: "修复记录", ... });
 *   db.linkMemoryToCode(memoryId, "PaymentService_process", "关联的bug修复");
 *   const related = db.getRelatedMemories(memoryId);
 *
 * Session Compressor (RFC-06 Phase A):
 *   const compressor = new SessionCompressor(db);
 *   compressor.compress("session-123", memories, { title: "…", summary: "…" });
 *   const ctx = compressor.injectContext({ excludeSessionId: "session-456" });
 */
export { MemoryDatabase } from "./database";
export type { MemoryNode, MemoryEdge, MemoryNodeType, MemoryStatus, MemorySource, EdgeRelation, MemoryGraphStats, } from "./database";
export { SessionCompressor } from "./session-compressor";
export type { SessionSummary, CompressOptions, InjectContext, InjectOptions, } from "./session-compressor";
export { NudgeEngine } from "./nudge-engine";
export type { NudgeSuggestion, NudgeReason, NudgeOptions, } from "./nudge-engine";
export { UserProfileEngine } from "./user-profile";
export type { Observation, ObservationType, ProfileTrait, UserProfile, ObserveResult, ObserveOptions, UserProfileMemoryConfig, } from "./user-profile";
export { ProcedureMemoryEngine } from "./procedure-memory";
export type { ProcedureStep, ProcedureInput, ProcedureOutput, ProcedureMetadata, ProcedureRecord, ProcedureExecution, ProcedureMatch, ProcedureMemoryConfig, } from "./procedure-memory";
export { HookSystem, createHealthCheckHook, createMemoryWrittenNotificationHook, createSystemStartupHook } from "./hook-system";
export type { HookContext, HookResult, HookHandler, HookDefinition, HookEvent, HookSystemConfig, HookExecutionLog, HookStats, } from "./hook-system";
export { TodoManager } from "./todo-manager";
export type { TodoItem, TodoCreateInput, TodoUpdateInput, TodoFilter, TodoTrack, TodoPriority, TodoStatus, DailySummary, } from "./todo-manager";
export { PromptManager } from "./prompt-manager";
export type { PromptTemplate, PromptCreateInput, PromptUpdateInput, PromptFilter, } from "./prompt-manager";
export { SessionBookmarkManager } from "./session-bookmark";
export type { SessionBookmark, BookmarkCreateInput, } from "./session-bookmark";
export { MemorySync } from "./memory-sync";
export type { SyncStatus, SyncResult, } from "./memory-sync";
export { NotificationBus } from "./notification-bus";
export type { NotificationChannel, NotificationMessage, NotificationResult, ChannelType, } from "./notification-bus";
//# sourceMappingURL=index.d.ts.map