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
export interface PrivacyPattern {
    name: string;
    re: RegExp;
}
export interface GatekeeperResult {
    ok: boolean;
    blocked?: string;
    privacyFlag: boolean;
    privacyReasons: string[];
    warnings: string[];
}
/**
 * 校验一次写入请求。
 * @param input 待写入内容
 * @returns ok=true 可写入；ok=false 被质量红线拦截（调用方不得写入）
 */
export declare function inspectMemoryWrite(input: {
    title: string;
    body?: string;
    summary?: string;
}): GatekeeperResult;
//# sourceMappingURL=gatekeeper.d.ts.map