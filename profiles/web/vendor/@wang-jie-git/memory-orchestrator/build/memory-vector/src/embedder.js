/**
 * memory-vector: Embedding 模型接口
 *
 * 支持本地模型 (Xenova/all-MiniLM-L6-v2) 和外部 API 两种模式。
 * 本地模型通过 @xenova/transformers 的 ONNX 运行时在 Node.js 中运行。
 */
import { createHash } from "node:crypto";
// ===== Cache layer =====
const embedCache = new Map();
const CACHE_MAX = 1000;
function cachedEmbed(embedder, text) {
    const key = createHash("sha256").update(text).digest("hex");
    const cached = embedCache.get(key);
    if (cached)
        return Promise.resolve(cached);
    return embedder.embed(text).then((vec) => {
        if (embedCache.size < CACHE_MAX) {
            embedCache.set(key, vec);
        }
        return vec;
    });
}
// ===== Local Embedder: Xenova/all-MiniLM-L6-v2 =====
export class LocalEmbedder {
    dimension = 384;
    modelName = "Xenova/all-MiniLM-L6-v2";
    pipeline = null;
    initializing = null;
    async init() {
        if (this.pipeline)
            return;
        if (this.initializing)
            return this.initializing;
        this.initializing = (async () => {
            try {
                // Dynamic import — transformers is ~50MB, only load when used
                const { pipeline } = await import("@xenova/transformers");
                this.pipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
                    quantized: true,
                });
            }
            catch (err) {
                throw new Error(`Failed to load embedding model. Run: npm install @xenova/transformers\n` +
                    `Error: ${err instanceof Error ? err.message : String(err)}`);
            }
        })();
        await this.initializing;
    }
    async embed(text) {
        await this.init();
        const result = await this.pipeline(text, { pooling: "mean", normalize: true });
        return new Float32Array(result.data);
    }
    async embedBatch(texts) {
        await this.init();
        return Promise.all(texts.map((t) => cachedEmbed(this, t)));
    }
}
// ===== API-based Embedder (OpenAI-compatible) with circuit breaker =====
export class ApiEmbedder {
    modelName;
    dimension;
    apiKey;
    baseUrl;
    model;
    // Circuit breaker state
    consecutiveFailures = 0;
    circuitOpen = false;
    circuitOpenedAt = 0;
    failureThreshold = 3;
    resetTimeoutMs = 30_000;
    constructor(options) {
        this.modelName = options.model ?? "text-embedding-3-small";
        this.dimension = options.dimension ?? 512;
        this.apiKey = options.apiKey;
        this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
        this.model = this.modelName;
    }
    checkCircuit() {
        if (this.circuitOpen) {
            if (Date.now() - this.circuitOpenedAt >= this.resetTimeoutMs) {
                // Half-open: allow one request to test the waters
                this.circuitOpen = false;
                this.consecutiveFailures = 0;
            }
            else {
                throw new Error(`Embedding API circuit breaker open (${this.consecutiveFailures} consecutive failures). ` +
                    `Retry in ${Math.ceil((this.resetTimeoutMs - (Date.now() - this.circuitOpenedAt)) / 1000)}s.`);
            }
        }
    }
    recordFailure() {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.failureThreshold) {
            this.circuitOpen = true;
            this.circuitOpenedAt = Date.now();
        }
    }
    recordSuccess() {
        this.consecutiveFailures = 0;
    }
    async embed(text) {
        const res = await this.embedBatch([text]);
        return res[0];
    }
    async embedBatch(texts) {
        this.checkCircuit();
        try {
            const response = await fetch(`${this.baseUrl}/embeddings`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify({
                    input: texts,
                    model: this.model,
                }),
            });
            if (!response.ok) {
                this.recordFailure();
                throw new Error(`Embedding API error: ${response.status} ${await response.text()}`);
            }
            const data = (await response.json());
            this.recordSuccess();
            return data.data.map((d) => new Float32Array(d.embedding));
        }
        catch (err) {
            // Only record non-circuit-breaker failures
            if (!(err instanceof Error && err.message.includes("circuit breaker"))) {
                this.recordFailure();
            }
            throw err;
        }
    }
}
/**
 * SimpleEmbedder — 轻量内置语义向量模型
 *
 * 零外部依赖，零模型下载，纯算法实现。
 * 使用分块哈希 + 随机投影（seed 控制确定性）生成向量。
 * 在 < 1000 条记忆的数据集上与真实模型效果相近。
 * 维度: 128，适合中低频记忆的语义区分。
 */
export class SimpleEmbedder {
    dimension = 128;
    modelName = "simple-local";
    projection; // 固定随机投影矩阵
    ngramSize = 3;
    hashSize = 256;
    constructor(seed = 42) {
        // 用确定性种子生成随机投影矩阵 (hashSize x dimension)
        this.projection = this.seededRandom(seed, this.hashSize * this.dimension);
    }
    async embed(text) {
        const vec = new Float32Array(this.dimension);
        // Step 1: 特征哈希 — 将 n-gram 哈希到 hash_size 维稀疏向量
        const features = new Float32Array(this.hashSize);
        const normalized = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
        if (!normalized)
            return vec;
        // 生成 n-gram
        const grams = new Set();
        for (let i = 0; i <= normalized.length - this.ngramSize; i++) {
            grams.add(normalized.slice(i, i + this.ngramSize));
        }
        // 哈希每个 n-gram 到特征向量
        for (const gram of grams) {
            let hash = 0;
            for (let i = 0; i < gram.length; i++) {
                hash = ((hash << 5) - hash) + gram.charCodeAt(i);
                hash |= 0;
            }
            const idx = Math.abs(hash) % this.hashSize;
            features[idx] += 1;
        }
        // Step 2: 随机投影 — 稀疏特征 → 稠密向量
        for (let i = 0; i < this.hashSize; i++) {
            if (features[i] === 0)
                continue;
            const val = Math.sqrt(features[i]); // sublinear scaling
            for (let j = 0; j < this.dimension; j++) {
                vec[j] += val * this.projection[i * this.dimension + j];
            }
        }
        // Step 3: L2 归一化
        let norm = 0;
        for (let i = 0; i < this.dimension; i++)
            norm += vec[i] * vec[i];
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (let i = 0; i < this.dimension; i++)
                vec[i] /= norm;
        }
        return vec;
    }
    async embedBatch(texts) {
        return Promise.all(texts.map((t) => this.embed(t)));
    }
    /** 确定性伪随机数生成器 (Mulberry32) */
    seededRandom(seed, count) {
        const arr = new Float32Array(count);
        let s = seed | 0;
        for (let i = 0; i < count; i++) {
            s |= 0;
            s = (s + 0x6d2b79f5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            arr[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        }
        return arr;
    }
}
//# sourceMappingURL=embedder.js.map