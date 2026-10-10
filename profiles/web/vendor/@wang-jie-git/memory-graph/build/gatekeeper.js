/**
 * Gatekeeper — 写入门禁（单租户多智能体记忆污染治理）
 *
 * 在记忆写入共享库之前做三层校验：
 * 1. 隐私扫描   — 邮箱/手机号/密钥/身份证 → 命中标记 privacy_flag（不拦截，仅提示）
 * 2. 质量红线   — Prompt 注入特征、纯垃圾 → 硬拦截（blocked）
 * 3. 重复检测   — 由调用方配合 findByHash 无重复写入（克隆/噪音治理）
 *
 * 设计原则：纯函数 + 依赖注入，不依赖任何 IO；查重交给上层 MemorySystem。
 */
/** 隐私模式：命中不拦截，只标记 */
const PRIVACY_PATTERNS = [
    { name: "email", re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
    { name: "phone(CN)", re: /(?<!\d)1[3-9]\d{9}(?!\d)/ },
    { name: "api_key", re: /(sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/ },
    { name: "id_card(CN)", re: /(?<!\d)\d{17}[\dXx](?!\d)/ },
];
/** 质量红线：命中硬拦截 */
const QUALITY_BLOCKERS = [
    {
        name: "prompt_injection",
        re: /忽略(之前的|以上的|所有|全部)?(指令|指示|规则)|ignore (all )?(previous|above|prior) (instructions|rules)|你是我的(助手|代理)|忘记你(的|之前)(指令|规则)/i,
    },
    {
        name: "control_override",
        re: /(system prompt|sistema)?\s*:\s*.*(override|jailbreak)|输出你的(系统|system)提示词/i,
    },
];
/**
 * 校验一次写入请求。
 * @param input 待写入内容
 * @returns ok=true 可写入；ok=false 被质量红线拦截（调用方不得写入）
 */
export function inspectMemoryWrite(input) {
    const text = `${input.title}\n${input.body ?? ""}\n${input.summary ?? ""}`;
    // 1. 质量红线（硬拦截）
    for (const q of QUALITY_BLOCKERS) {
        if (q.re.test(text)) {
            return {
                ok: false,
                blocked: `Gatekeeper 拦截：检测到疑似【${q.name}】特征，拒绝写入共享记忆库`,
                privacyFlag: false,
                privacyReasons: [],
                warnings: [],
            };
        }
    }
    // 2. 隐私扫描（标记不拦截）
    const privacyReasons = [];
    for (const p of PRIVACY_PATTERNS) {
        if (p.re.test(text))
            privacyReasons.push(p.name);
    }
    // 3. 质量提示（不拦截）
    const warnings = [];
    if (!input.title.trim())
        warnings.push("标题为空");
    const bodyLen = (input.body ?? "").trim().length;
    if (bodyLen > 0 && bodyLen < 20)
        warnings.push("正文过短(<20字符)，可能是无效记录");
    if (bodyLen > 8000)
        warnings.push("正文过长(>8000字符)，建议拆分或压缩");
    return {
        ok: true,
        privacyFlag: privacyReasons.length > 0,
        privacyReasons,
        warnings,
    };
}
//# sourceMappingURL=gatekeeper.js.map