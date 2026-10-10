/**
 * memory-graph: DecisionTracker — 结构化决策记录
 *
 * 将决策过程结构化为标准格式，方便后续回溯。
 *
 * 决策流程:
 *   背景(context) → 备选方案(options) → 选择(chosen) → 理由(rationale) → 结果(outcome)
 *
 * 每个决策自动写入 memory_nodes（node_type='decision'），
 * 并通过 links_to_memory 关联相关上下文。
 */
import { MemoryDatabase } from "./database";
export interface DecisionOption {
    name: string;
    description: string;
    pros: string[];
    cons: string[];
}
export interface DecisionInput {
    title: string;
    context: string;
    options: DecisionOption[];
    chosen: string;
    rationale: string;
    /** 可选：操作步骤/流程描述，用于程序记忆召回 */
    procedure?: string;
    tags?: string[];
    source?: "agent" | "user" | "system";
    sourceSession?: string | null;
    importance?: number;
}
export interface DecisionRecord {
    nodeId: string;
    title: string;
    context: string;
    options: DecisionOption[];
    chosen: string;
    rationale: string;
    procedure: string | null;
    outcome: "pending" | "success" | "failure" | "unknown";
    outcomeEvidence: string | null;
    createdAt: number;
    importance: number;
}
export declare class DecisionTracker {
    private memoryDb;
    constructor(memoryDb: MemoryDatabase);
    /**
     * 记录一项决策。
     * 将决策的 context/options/rationale 存储在 body 字段中，
     * 以结构化 JSON 格式保存以便程序读取。
     */
    recordDecision(input: DecisionInput): DecisionRecord;
    /**
     * 更新决策结果
     */
    updateOutcome(nodeId: string, outcome: "success" | "failure" | "unknown", evidence?: string): boolean;
    /**
     * 将决策关联到相关记忆
     */
    linkDecision(decisionId: string, relatedMemoryId: string, relation?: "causes" | "fixes" | "precedes" | "references" | "contradicts" | "supersedes" | "relates_to" | "implements" | "summarizes" | "dream_log"): void;
    /**
     * 获取所有决策记录
     */
    getAllDecisions(status?: "pending" | "success" | "failure"): DecisionRecord[];
    /**
     * 查找包含 procedure 的决策记录（程序记忆召回）。
     * 搜索 procedure 文本，按相关性排序返回。
     * 用于 agent 在遇到类似问题时自动获取经验步骤。
     */
    findProcedures(query: string, limit?: number): DecisionRecord[];
    /**
     * 生成决策回溯报告
     */
    generateReport(): string;
}
//# sourceMappingURL=decision-tracker.d.ts.map