/**
 * Memory Watchdog — 健康监控 + 评估报告 + 系统通知
 *
 * 职责链：
 *   定期检查 → 发现问题 → 生成评估报告 → 触发通知回调
 *
 * 评估报告 (EvaluationReport) 是结构化的诊断文档，
 * 包含组件状态、错误汇总、趋势分析和修复建议。
 */
import { MemoryDatabase } from "../../memory-graph/src/database";
import { SqliteVectorStore } from "../../memory-vector/src/vector-store";
import type { Embedder } from "../../memory-vector/src/embedder";
import type { ObsidianWriter } from "../../memory-graph/src/obsidian-writer";
import { MemoryLogger } from "./memory-logger";
export interface ComponentHealth {
    ok: boolean;
    error?: string;
    latencyMs?: number;
}
export interface HealthStatus {
    healthy: boolean;
    timestamp: number;
    uptimeMs: number;
    graphDb: ComponentHealth;
    vectorStore: ComponentHealth & {
        totalEntries?: number;
    };
    embedder: ComponentHealth;
    obsidianWriter: ComponentHealth & {
        count?: number;
    };
    operations: {
        lastWriteOk: boolean;
        lastWriteAgoMs: number;
        lastQueryOk: boolean;
        lastQueryAgoMs: number;
        lastDreamOk: boolean;
        lastDreamAgoMs: number;
    };
    recentErrors: number;
    score: number;
}
export interface WatchdogConfig {
    /** 健康检查间隔 (ms, 默认 60000 = 1分钟) */
    checkIntervalMs: number;
    /** 操作超时阈值 (ms, 默认 5000) */
    operationTimeoutMs: number;
    /** 错误阈值：超过此数量触发告警 (默认 5) */
    errorThreshold: number;
    /** 是否自动启动定时检查 (默认 true) */
    autoStart: boolean;
    /** 历史记录保留条数 (默认 60) */
    historySize: number;
}
export interface ComponentScore {
    name: string;
    status: "healthy" | "degraded" | "down";
    score: number;
    error?: string;
    latencyMs?: number;
    detail?: string;
}
export interface EvaluationReport {
    /** 报告 ID */
    id: string;
    /** 生成时间 */
    timestamp: number;
    /** 上报类型 */
    type: "periodic" | "on_demand" | "unhealthy_trigger";
    /** 运行时长 */
    uptime: string;
    overallScore: number;
    healthy: boolean;
    summary: string;
    summaryZh: string;
    components: ComponentScore[];
    errorSummary: Array<{
        module: string;
        operation: string;
        message: string;
        count: number;
        firstSeen: number;
        lastSeen: number;
    }>;
    totalErrorsLastHour: number;
    operations: {
        lastWriteOk: boolean;
        lastWriteAgo: string;
        lastQueryOk: boolean;
        lastQueryAgo: string;
        lastDreamOk: boolean;
        lastDreamAgo: string;
    };
    trend: "improving" | "stable" | "degrading";
    scoreHistory: number[];
    recommendations: string[];
    raw: HealthStatus;
}
export type HealthChangeCallback = (status: HealthStatus, previous: HealthStatus | null) => void;
export type UnhealthyCallback = (status: HealthStatus) => void;
export type ReportCallback = (report: EvaluationReport) => void;
export declare class MemoryWatchdog {
    private config;
    private memoryDb;
    private vectorStore;
    private embedder;
    private obsidianWriter?;
    private logger;
    private timer;
    private _status;
    private _previousStatus;
    private _startTime;
    private _healthHistory;
    private _totalChecks;
    private _lastWriteOk;
    private _lastWriteTime;
    private _lastQueryOk;
    private _lastQueryTime;
    private _lastDreamOk;
    private _lastDreamTime;
    private onHealthChangeCallbacks;
    private onUnhealthyCallbacks;
    private onReportCallbacks;
    constructor(memoryDb: MemoryDatabase, vectorStore: SqliteVectorStore, embedder: Embedder, logger: MemoryLogger, obsidianWriter?: ObsidianWriter, config?: Partial<WatchdogConfig>);
    recordWrite(success: boolean): void;
    recordQuery(success: boolean): void;
    recordDream(success: boolean): void;
    /** 健康状态变化时触发 */
    onHealthChange(cb: HealthChangeCallback): void;
    /** 系统不健康时触发 */
    onUnhealthy(cb: UnhealthyCallback): void;
    /** 评估报告生成时触发 */
    onReport(cb: ReportCallback): void;
    checkHealth(type?: EvaluationReport["type"]): Promise<HealthStatus>;
    /**
     * 生成系统评估报告。
     * 报告包含：组件状态、错误汇总、趋势分析、修复建议。
     * 可在不健康时自动生成，也可手动调用。
     */
    generateReport(status?: HealthStatus, type?: EvaluationReport["type"]): EvaluationReport;
    /** 生成格式化文本报告（可直接输出到控制台/通知） */
    formatReport(report?: EvaluationReport): string;
    get lastStatus(): HealthStatus | null;
    get score(): number;
    get totalChecks(): number;
    get healthHistory(): HealthStatus[];
    start(): void;
    stop(): void;
    getUptime(): string;
    private scoreComponents;
    private summarizeErrors;
    private computeTrend;
    private generateRecommendations;
    private summarize;
    private trendEmoji;
    private checkComponent;
}
//# sourceMappingURL=memory-watchdog.d.ts.map