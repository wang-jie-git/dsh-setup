/**
 * memory-vector: Embedding 模型接口
 *
 * 支持本地模型 (Xenova/all-MiniLM-L6-v2) 和外部 API 两种模式。
 * 本地模型通过 @xenova/transformers 的 ONNX 运行时在 Node.js 中运行。
 */
export interface Embedder {
    embed(text: string): Promise<Float32Array>;
    embedBatch(texts: string[]): Promise<Float32Array[]>;
    readonly dimension: number;
    readonly modelName: string;
}
export declare class LocalEmbedder implements Embedder {
    readonly dimension = 384;
    readonly modelName = "Xenova/all-MiniLM-L6-v2";
    private pipeline;
    private initializing;
    init(): Promise<void>;
    embed(text: string): Promise<Float32Array>;
    embedBatch(texts: string[]): Promise<Float32Array[]>;
}
export declare class ApiEmbedder implements Embedder {
    readonly modelName: string;
    readonly dimension: number;
    private apiKey;
    private baseUrl;
    private model;
    private consecutiveFailures;
    private circuitOpen;
    private circuitOpenedAt;
    private readonly failureThreshold;
    private readonly resetTimeoutMs;
    constructor(options: {
        model?: string;
        dimension?: number;
        apiKey: string;
        baseUrl?: string;
    });
    private checkCircuit;
    private recordFailure;
    private recordSuccess;
    embed(text: string): Promise<Float32Array>;
    embedBatch(texts: string[]): Promise<Float32Array[]>;
}
/**
 * SimpleEmbedder — 轻量内置语义向量模型
 *
 * 零外部依赖，零模型下载，纯算法实现。
 * 使用分块哈希 + 随机投影（seed 控制确定性）生成向量。
 * 在 < 1000 条记忆的数据集上与真实模型效果相近。
 * 维度: 128，适合中低频记忆的语义区分。
 */
export declare class SimpleEmbedder implements Embedder {
    readonly dimension = 128;
    readonly modelName = "simple-local";
    private projection;
    private ngramSize;
    private hashSize;
    constructor(seed?: number);
    embed(text: string): Promise<Float32Array>;
    embedBatch(texts: string[]): Promise<Float32Array[]>;
    /** 确定性伪随机数生成器 (Mulberry32) */
    private seededRandom;
}
//# sourceMappingURL=embedder.d.ts.map