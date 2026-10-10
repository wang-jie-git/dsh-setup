// Song-Cao L2 评价引擎插件：把计算美学量化 + AI 评分注册为 dsh 工具
// 供 CAO 智能体在评估图片时调用（dsh-plugin-dev 规范场景 B）
// 不依赖 @deepseek-ai/dsh-tools 包：直接用 ctx.tools.register（register 接受普通定义对象）
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const BASE = '/Users/mac/Desktop/宋式美学智能体'

export const name = 'song-cao-tools'
export const inject = ['tools']

async function runPython(pythonBin, script, args) {
  const { stdout } = await execFileP(pythonBin, [script, ...args], { timeout: 300000, cwd: BASE })
  return stdout.trim()
}

function defineRender() {
  return {
    schema: { type: 'object' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

export function apply(ctx) {
  // 工具 1：量化特征（计算美学）
  ctx.tools.register({
    name: 'song_cao_quant',
    description: '宋韵量化特征分析：输入图片路径，输出亮度/对比度/色彩丰富度/饱和度/色相数（基于金标基线判定是否偏离宋韵）。',
    parameters: {
      image: { type: 'string', required: true, description: '图片绝对路径' },
    },
    output: defineRender(),
    async execute(args) {
      try {
        const out = await runPython(`${BASE}/.venv/bin/python3`, `${BASE}/analysis/aesthetic_metrics.py`, [args.image, '--json'])
        const parsed = JSON.parse(out)
        return { ok: true, ...parsed }
      } catch (e) {
        return { ok: false, error: String(e.message || e) }
      }
    },
  })

  // 工具 2：AI 美学评分（v2.5 SigLIP）
  ctx.tools.register({
    name: 'song_cao_ai_score',
    description: 'AI 美学评分：输入图片路径，用 aesthetic-predictor-v2.5 (SigLIP) 输出 1-10 分（5.5+ 优秀）。注意是通用美学非宋韵专属。',
    parameters: {
      image: { type: 'string', required: true, description: '图片绝对路径' },
    },
    output: defineRender(),
    async execute(args) {
      try {
        const out = await runPython(`${BASE}/.venv-v25/bin/python3`, `${BASE}/analysis/aesthetic_score.py`, [args.image])
        const m = out.match(/AI 美学评分: ([\d.]+)/)
        return { ok: true, score: m ? parseFloat(m[1]) : null, raw: out }
      } catch (e) {
        return { ok: false, error: String(e.message || e) }
      }
    },
  })

  // 工具 3：一键三轨评估（编排 L1+L2+L3）
  ctx.tools.register({
    name: 'song_cao_eval',
    description: 'CAO 一键三轨评估：输入图片路径，输出量化特征 + AI 评分 + CAO 规则评语（完整报告）。',
    parameters: {
      image: { type: 'string', required: true, description: '图片绝对路径' },
    },
    output: defineRender(),
    async execute(args) {
      try {
        const out = await execFileP(`${BASE}/cao-eval.sh`, [args.image], { timeout: 600000, cwd: BASE })
        return { ok: true, report: out.stdout }
      } catch (e) {
        return { ok: false, error: String(e.message || e), stderr: String(e.stderr || '') }
      }
    },
  })
}
