/**
 * Procedure Memory — 可执行工作流程记忆
 *
 * 功能：
 * - 记录可复用工作流程（Procedure）
 * - 版本管理（创建、更新、迭代）
 * - 工作流程发现（基于标签、描述、输入输出匹配）
 * - 执行记录（追踪使用情况和成功率）
 * - MCP 工具: procedure_record / procedure_find / procedure_execute
 *
 * 参考: MemoraX Code 的 Procedure Memory 机制
 */
import { MemoryDatabase } from "./database";
export interface ProcedureStep {
    /** 步骤顺序（从 1 开始） */
    order: number;
    /** 步骤名称 */
    name: string;
    /** 步骤描述 */
    description: string;
    /** 步骤类型 */
    type: "command" | "query" | "decision" | "validation" | "output";
    /** 步骤内容（命令、查询、逻辑等） */
    content: string;
    /** 预期输出（可选） */
    expectedOutput?: string;
    /** 是否必须完成 */
    required: boolean;
    /** 依赖步骤（步骤顺序数组） */
    dependsOn: number[];
    /** 失败时的重试次数（默认 0） */
    maxRetries?: number;
    /** 超时时间（秒，默认 300） */
    timeoutSeconds?: number;
}
export interface ProcedureInput {
    /** 参数名称 */
    name: string;
    /** 参数描述 */
    description: string;
    /** 参数类型 */
    type: "string" | "number" | "boolean" | "array" | "object";
    /** 是否必须 */
    required: boolean;
    /** 默认值（可选） */
    defaultValue?: unknown;
    /** 验证规则（可选） */
    validation?: {
        pattern?: string;
        min?: number;
        max?: number;
        enum?: unknown[];
    };
}
export interface ProcedureOutput {
    /** 输出名称 */
    name: string;
    /** 输出描述 */
    description: string;
    /** 输出类型 */
    type: "string" | "number" | "boolean" | "array" | "object";
}
export interface ProcedureMetadata {
    /** 执行次数 */
    executionCount: number;
    /** 成功次数 */
    successCount: number;
    /** 失败次数 */
    failureCount: number;
    /** 最后执行时间 */
    lastExecutedAt?: number;
    /** 最后执行结果 */
    lastExecutionResult?: "success" | "failure" | "partial";
    /** 平均执行时间（毫秒） */
    averageExecutionTimeMs: number;
    /** 标签 */
    tags: string[];
    /** 分类 */
    category: string;
    /** 难度级别（1-5） */
    difficulty: number;
    /** 预计执行时间（分钟） */
    estimatedDurationMinutes: number;
}
export interface ProcedureRecord {
    /** 主键 ID */
    id: string;
    /** 标题 */
    title: string;
    /** 描述 */
    description: string;
    /** 版本 */
    version: string;
    /** 父 procedure ID（如果是从已有 procedure 更新） */
    parentId?: string;
    /** 输入参数 */
    inputs: ProcedureInput[];
    /** 输出定义 */
    outputs: ProcedureOutput[];
    /** 步骤 */
    steps: ProcedureStep[];
    /** 元数据 */
    metadata: ProcedureMetadata;
    /** 创建时间 */
    createdAt: number;
    /** 更新时间 */
    updatedAt: number;
    /** 作者 */
    author: string;
    /** 节点类型 */
    nodeType: "procedure";
}
export interface ProcedureExecution {
    /** 执行 ID */
    id: string;
    /** Procedure ID */
    procedureId: string;
    /** Procedure 版本 */
    procedureVersion: string;
    /** 输入参数 */
    inputs: Record<string, unknown>;
    /** 执行结果 */
    result: "success" | "failure" | "partial";
    /** 输出结果 */
    outputs: Record<string, unknown>;
    /** 错误信息（失败时） */
    error?: string;
    /** 执行时间（毫秒） */
    executionTimeMs: number;
    /** 执行步骤日志 */
    stepLogs: Array<{
        stepOrder: number;
        status: "pending" | "running" | "success" | "failure" | "skipped";
        startedAt: number;
        completedAt?: number;
        output?: unknown;
        error?: string;
    }>;
    /** 执行时间戳 */
    executedAt: number;
}
export interface ProcedureMatch {
    /** Procedure 记录 */
    procedure: ProcedureRecord;
    /** 匹配分数（0-1） */
    score: number;
    /** 匹配原因 */
    reasons: string[];
}
export interface ProcedureMemoryConfig {
    /** 是否启用 Procedure Memory */
    enabled: boolean;
    /** 默认最大搜索结果数 */
    defaultLimit: number;
    /** 匹配分数阈值（0-1） */
    matchThreshold: number;
    /** 自动归档过期时间（天，默认 180 天） */
    ttlDays: number;
    /** 最小执行次数才推荐（默认 3 次） */
    minExecutionCountForRecommendation: number;
}
export declare const DEFAULT_PROCEDURE_CONFIG: ProcedureMemoryConfig;
export declare class ProcedureMemoryEngine {
    private db;
    private config;
    constructor(db: MemoryDatabase, config?: Partial<ProcedureMemoryConfig>);
    /**
     * 更新配置
     */
    updateConfig(config: Partial<ProcedureMemoryConfig>): void;
    /**
     * 获取当前配置
     */
    getConfig(): ProcedureMemoryConfig;
    /**
     * 记录工作流程
     *
     * 将工作流程保存为 procedure 节点。
     */
    record(record: Omit<ProcedureRecord, "id" | "createdAt" | "updatedAt" | "nodeType">): ProcedureRecord;
    /**
     * 查找工作流程
     *
     * 基于标签、描述、输入输出的文本匹配。
     */
    find(query: {
        /** 搜索文本（描述、标签匹配） */
        text?: string;
        /** 标签过滤 */
        tags?: string[];
        /** 分类过滤 */
        category?: string;
        /** 作者过滤 */
        author?: string;
        /** 最小执行次数 */
        minExecutionCount?: number;
        /** 最小成功率（0-1） */
        minSuccessRate?: number;
        /** 最大难度（1-5） */
        maxDifficulty?: number;
        /** 返回数量限制 */
        limit?: number;
    }): ProcedureMatch[];
    /**
     * 执行工作流程
     *
     * 记录执行过程，追踪成功率。
     */
    execute(procedureId: string, inputs: Record<string, unknown>): ProcedureExecution;
    /**
     * 获取工作流程详情
     */
    get(procedureId: string): ProcedureRecord | null;
    /**
     * 列出所有工作流程
     */
    list(filters?: {
        category?: string;
        author?: string;
        tags?: string[];
        limit?: number;
    }): ProcedureRecord[];
    /**
     * 获取推荐工作流程
     *
     * 基于历史执行数据，推荐高成功率、高频次的工作流程。
     */
    getRecommendations(filters?: {
        category?: string;
        limit?: number;
    }): ProcedureMatch[];
    /**
     * 删除工作流程（软删除）
     */
    delete(procedureId: string): boolean;
    /**
     * 更新工作流程（创建新版本）
     */
    update(procedureId: string, updates: Partial<Omit<ProcedureRecord, "id" | "createdAt" | "nodeType">>): ProcedureRecord | null;
    /**
     * 验证输入参数
     */
    private _validateInputs;
    /**
     * 更新 Procedure 元数据
     */
    private _updateProcedureMetadata;
    /**
     * 版本号递增（语义化版本）
     * 1.0.0 → 1.1.0（次要版本递增）
     * 1.1.0 → 1.2.0
     * 1.1.3 → 1.2.0（修订版归零）
     */
    private _incrementVersion;
    /**
     * 节点转 ProcedureRecord
     */
    private _nodeToProcedure;
    /**
     * 数据库行转 ProcedureRecord
     */
    private _rowToProcedure;
}
//# sourceMappingURL=procedure-memory.d.ts.map