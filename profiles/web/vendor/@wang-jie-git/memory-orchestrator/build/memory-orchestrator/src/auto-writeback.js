/**
 * AutoWritebackRuntime — 自动写回机制
 *
 * 功能：
 * - 从对话中提取可复用知识
 * - 隐私替换 (API Key, Token, Email 等)
 * - 哈希去重（避免重复写入）
 * - 缓冲 + 异步批量写入
 * - MCP 工具: memory_suggest
 *
 * 参考: MemoraX Code 的 Automatic Writeback 机制
 */
import { createHash } from "node:crypto";
// ===== Privacy Redactor =====
/**
 * 隐私替换器
 *
 * 替换敏感信息为占位符:
 * - API Keys
 * - Tokens
 * - Email addresses
 * - Long numbers (credit cards, phone numbers)
 * - UUIDs
 * - Opaque IDs
 */
export class PrivacyRedactor {
    patterns = [
        // API Key patterns
        { regex: /\b(sk|pk|api[_-]?key)[_-][a-zA-Z0-9]{20,}\b/gi, placeholder: "[REDACTED:API_KEY]" },
        { regex: /\b(api[_-]?key|apikey)\s*[:=]\s*['\"]?([a-zA-Z0-9_\-]{20,})['\"]?/gi, placeholder: "[REDACTED:API_KEY]" },
        // Bearer Token
        { regex: /bearer\s+[a-zA-Z0-9_\-\.]+/gi, placeholder: "[REDACTED:BEARER_TOKEN]" },
        // Authorization header
        { regex: /authorization\s*[:=]\s*['\"]?bearer\s+[a-zA-Z0-9_\-\.]+['\"]?/gi, placeholder: "[REDACTED:AUTH_TOKEN]" },
        // Generic token
        { regex: /\b(token|access_token|refresh_token)\s*[:=]\s*['\"]?([a-zA-Z0-9_\-\.]+)['\"]?/gi, placeholder: "[REDACTED:TOKEN]" },
        // Email
        { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, placeholder: "[REDACTED:EMAIL]" },
        // Long numbers (16+ digits) - credit cards, phone numbers
        { regex: /\b\d{16,}\b/g, placeholder: "[REDACTED:LONG_NUMBER]" },
        // UUID
        { regex: /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, placeholder: "[REDACTED:UUID]" },
        // Hex strings (32+ chars)
        { regex: /\b[0-9a-fA-F]{32,}\b/g, placeholder: "[REDACTED:HEX]" },
        // Cookie
        { regex: /cookie\s*[:=]\s*['\"]?([a-zA-Z0-9_\-\.]+)['\"]?/gi, placeholder: "[REDACTED:COOKIE]" },
    ];
    /**
     * 替换敏感信息
     */
    redact(text) {
        let result = text;
        for (const { regex, placeholder } of this.patterns) {
            result = result.replace(regex, placeholder);
        }
        return result;
    }
    /**
     * 检查文本是否包含敏感信息
     */
    containsSensitive(text) {
        const sample = text.slice(0, 1000); // 只检查前 1000 字符
        for (const { regex } of this.patterns) {
            if (regex.test(sample)) {
                return true;
            }
        }
        return false;
    }
}
// ===== Content Hash =====
/**
 * 内容哈希计算
 *
 * 用于去重：相同内容的记忆只写入一次
 */
export function computeContentHash(title, summary) {
    const content = `${title}\n${summary}`;
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
// ===== Writeback Extractor =====
/**
 * 从对话中提取可复用知识
 *
 * 当前版本：基于规则的简单提取
 * 未来版本：LLM 驱动的智能提取
 */
export class WritebackExtractor {
    redactor;
    constructor() {
        this.redactor = new PrivacyRedactor();
    }
    /**
     * 从对话中提取记忆候选
     *
     * @param userMessage 用户消息
     * @param assistantResponse AI 回复
     * @returns 提取的记忆候选列表
     */
    extract(userMessage, assistantResponse) {
        const candidates = [];
        // 1. 检查是否包含敏感信息
        if (this.redactor.containsSensitive(userMessage) || this.redactor.containsSensitive(assistantResponse)) {
            console.log("[AutoWriteback] 检测到敏感信息，跳过提取");
            return [];
        }
        // 2. 隐私替换
        const safeUserMessage = this.redactor.redact(userMessage);
        const safeResponse = this.redactor.redact(assistantResponse);
        // 3. 简单规则提取（未来可以用 LLM 增强）
        // 规则 1: 用户要求"记住"某事
        if (/(记住|记住一下|帮我记住|记录一下)/i.test(safeUserMessage)) {
            const title = this.extractTitle(safeUserMessage);
            const summary = safeResponse.slice(0, 200);
            if (title && summary) {
                candidates.push({
                    id: crypto.randomUUID(),
                    title,
                    summary,
                    importance: 7,
                    tags: ["auto-writeback", "user-requested"],
                    source: "auto-writeback",
                    contentHash: computeContentHash(title, summary),
                    confidence: 0.9,
                });
            }
        }
        // 规则 2: AI 回复包含"建议"、"最佳实践"、"注意事项"
        if (/(建议|最佳实践|注意事项|经验|教训|坑)/i.test(safeResponse)) {
            const title = this.extractBestPracticeTitle(safeUserMessage, safeResponse);
            const summary = this.extractBestPracticeSummary(safeResponse);
            if (title && summary) {
                candidates.push({
                    id: crypto.randomUUID(),
                    title,
                    summary,
                    importance: 6,
                    tags: ["auto-writeback", "best-practice"],
                    source: "auto-writeback",
                    contentHash: computeContentHash(title, summary),
                    confidence: 0.7,
                });
            }
        }
        // 规则 3: AI 回复包含"错误"、"bug"、"修复"
        if (/(错误|bug|修复|解决|问题)/i.test(safeResponse) && /(如何|怎么|为什么)/i.test(safeUserMessage)) {
            const title = this.extractBugFixTitle(safeUserMessage, safeResponse);
            const summary = this.extractBugFixSummary(safeResponse);
            if (title && summary) {
                candidates.push({
                    id: crypto.randomUUID(),
                    title,
                    summary,
                    importance: 8,
                    tags: ["auto-writeback", "bug-fix"],
                    source: "auto-writeback",
                    contentHash: computeContentHash(title, summary),
                    confidence: 0.8,
                });
            }
        }
        return candidates;
    }
    /**
     * 提取标题（从用户消息）
     */
    extractTitle(message) {
        // 移除"记住"等关键词
        const cleaned = message
            .replace(/^(记住|帮我记住|记录一下)\s*/i, "")
            .replace(/[。，！？.!?，,]$/g, "")
            .trim();
        return cleaned.slice(0, 100) || "未命名记忆";
    }
    /**
     * 提取最佳实践标题
     */
    extractBestPracticeTitle(userMessage, assistantResponse) {
        const firstSentence = assistantResponse.split(/[。！？.!?]/)[0];
        return `最佳实践: ${firstSentence.slice(0, 80)}`;
    }
    /**
     * 提取最佳实践摘要
     */
    extractBestPracticeSummary(response) {
        // 提取包含"建议"、"注意"的句子
        const sentences = response.split(/[。！？.!?]/);
        const relevant = sentences.filter((s) => /(建议|注意|最佳实践|经验|教训)/i.test(s));
        return relevant.join("。").slice(0, 200) || response.slice(0, 200);
    }
    /**
     * 提取 Bug 修复标题
     */
    extractBugFixTitle(userMessage, assistantResponse) {
        const match = userMessage.match(/(.+?)(?:怎么|如何|为什么|问题|错误|bug)/i);
        return `修复方案: ${match?.[1]?.trim() || "未知问题"}`;
    }
    /**
     * 提取 Bug 修复摘要
     */
    extractBugFixSummary(response) {
        // 提取解决方案
        const match = response.match(/(?:修复|解决|方案)[：:]\s*(.+?)(?=[。！？.!?]|$)/i);
        return match?.[1]?.trim().slice(0, 200) || response.slice(0, 200);
    }
}
// ===== AutoWritebackRuntime =====
export class AutoWritebackRuntime {
    config;
    redactor;
    extractor;
    buffer = [];
    seenHashes = new Set();
    flushTimer;
    writeCallback;
    startedAt;
    constructor(config = {}) {
        this.config = {
            minConfidence: 0.6,
            bufferSize: 10,
            flushIntervalMs: 5000,
            enabled: true,
            ...config,
        };
        this.redactor = new PrivacyRedactor();
        this.extractor = new WritebackExtractor();
        this.startedAt = Date.now();
    }
    /**
     * 注册写入回调（连接到 MemorySystem）
     */
    setWriteCallback(cb) {
        this.writeCallback = cb;
    }
    /**
     * 启动自动写回
     */
    start() {
        if (!this.config.enabled) {
            console.log("[AutoWriteback] 已禁用");
            return;
        }
        console.log(`[AutoWriteback] 启动 (buffer=${this.config.bufferSize}, interval=${this.config.flushIntervalMs}ms)`);
        // 定时刷新缓冲
        this.flushTimer = setInterval(() => {
            this.flush().catch((error) => {
                console.error("[AutoWriteback] 定时刷新失败:", error);
            });
        }, this.config.flushIntervalMs);
    }
    /**
     * 停止自动写回
     */
    stop() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = undefined;
        }
        console.log("[AutoWriteback] 停止");
    }
    /**
     * 处理对话（提取 + 缓冲）
     */
    async processTurn(userMessage, assistantResponse) {
        if (!this.config.enabled) {
            return { extracted: 0, written: 0, skipped: 0, duplicates: 0, lowConfidence: 0 };
        }
        const startTime = Date.now();
        console.log("[AutoWriteback] 处理对话...");
        // 1. 提取记忆候选
        const candidates = this.extractor.extract(userMessage, assistantResponse);
        // 2. 过滤（可信度 + 去重）
        const filtered = candidates.filter((c) => {
            // 可信度过滤
            if (c.confidence < this.config.minConfidence) {
                console.log(`[AutoWriteback] 跳过 (可信度过低: ${c.confidence})`);
                return false;
            }
            // 去重
            if (this.seenHashes.has(c.contentHash)) {
                console.log(`[AutoWriteback] 跳过 (重复: ${c.contentHash})`);
                return false;
            }
            return true;
        });
        // 3. 添加到缓冲
        for (const candidate of filtered) {
            this.buffer.push(candidate);
            this.seenHashes.add(candidate.contentHash);
        }
        // 4. 如果缓冲满了，立即刷新
        let written = 0;
        if (this.buffer.length >= this.config.bufferSize) {
            written = await this.flush();
        }
        const duration = Date.now() - startTime;
        console.log(`[AutoWriteback] 完成 (${duration}ms, 提取=${candidates.length}, 缓冲=${this.buffer.length})`);
        return {
            extracted: candidates.length,
            written,
            skipped: candidates.length - filtered.length,
            duplicates: candidates.length - filtered.length,
            lowConfidence: 0,
        };
    }
    /**
     * 刷新缓冲（批量写入）
     */
    async flush() {
        if (this.buffer.length === 0 || !this.writeCallback) {
            return 0;
        }
        const toWrite = [...this.buffer];
        this.buffer = [];
        console.log(`[AutoWriteback] 批量写入 ${toWrite.length} 条记忆...`);
        try {
            await this.writeCallback(toWrite);
            console.log(`[AutoWriteback] 写入完成`);
            return toWrite.length;
        }
        catch (error) {
            console.error("[AutoWriteback] 写入失败:", error);
            // 写回失败时，将条目放回缓冲（限制重试次数）
            if (this.buffer.length < this.config.bufferSize * 2) {
                this.buffer.unshift(...toWrite);
            }
            return 0;
        }
    }
    /**
     * 获取统计信息
     */
    getStats() {
        return {
            bufferSize: this.buffer.length,
            seenHashes: this.seenHashes.size,
            uptime: Date.now() - this.startedAt,
            enabled: this.config.enabled,
        };
    }
    /**
     * 手动添加记忆候选（用于测试）
     */
    addCandidate(candidate) {
        if (candidate.confidence >= this.config.minConfidence && !this.seenHashes.has(candidate.contentHash)) {
            this.buffer.push(candidate);
            this.seenHashes.add(candidate.contentHash);
        }
    }
}
//# sourceMappingURL=auto-writeback.js.map