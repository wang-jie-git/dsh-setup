// Song-Cao L2 评价引擎插件：把计算美学量化 + AI 评分注册为 dsh 工具
// 供 CAO 智能体在评估图片时调用（dsh-plugin-dev 规范场景 B）
// 不依赖 @deepseek-ai/dsh-tools 包：直接用 ctx.tools.register（register 接受普通定义对象）
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, readdirSync } from 'node:fs'

const execFileP = promisify(execFile)
const BASE = '/Users/mac/Desktop/宋式美学智能体'
const TREND_KEYWORDS_JSON = `${BASE}/golden-dataset/trend/keywords.json`

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

  // 工具 4：提示词工厂（场景卡 schema v1.2 + cards/*.json → H3 提示词包骨架，按 dynasty_mode 注入参数包）
  ctx.tools.register({
    name: 'song_cao_prompt',
    description:
      'CAO 提示词工厂：读取场景卡（schema v1.2 + cards/*.json）→ 按 dynasty_mode 注入参数包 → 输出 H3 结构化提示词包骨架（含当前模式名 + 饱和度上限 + 消费审美：场景标签/面料质感/改良声明/实用性约束/爆款关键词）。生成喂给 MiniMax H3/LibTV/可灵 的提示词前先调。',
    parameters: {
      card: {
        type: 'string',
        required: false,
        description: '场景卡文件名（如 通勤女装-秋季.json）；省略则列出 cards/ 下所有可用卡 + schema 说明',
      },
    },
    output: defineRender(),
    async execute(args) {
      try {
        const schema = JSON.parse(readFileSync(`${BASE}/prompt-factory/schema.json`, 'utf-8'))
        if (!args.card) {
          const cards = readdirSync(`${BASE}/prompt-factory/cards`).filter((f) => f.endsWith('.json'))
          return {
            ok: true,
            schema_version: schema.version,
            positioning: schema.positioning,
            dynasty_mode: schema.dynasty_mode,
            available_cards: cards,
            usage: schema.usage,
            hint: '指定 card 文件名可读取完整场景卡参数（如 song_cao_prompt card="通勤女装-秋季.json"）',
          }
        }
        const card = JSON.parse(readFileSync(`${BASE}/prompt-factory/cards/${args.card}`, 'utf-8'))

        // 按 dynasty_mode 注入参数包（超级CAO 多模式架构）
        const modeKey = card.card.dynasty_mode
        const modeParams = modeKey ? (schema.dynasty_mode && schema.dynasty_mode.params[modeKey]) : null
        const modeHeader = modeKey
          ? `# 国风提示词包 · ${card.card.title}（当前模式：${modeParams ? modeParams.name : modeKey}，饱和度上限 ≤${modeParams ? modeParams.saturation_max : '?'}%）`
          : `# 国风提示词包 · ${card.card.title}`

        // L5 市场层：合并静态基准词 + 卡片 trend_ref + 模式 trend_keywords
        let trend_merged = []
        if (modeKey && modeParams) trend_merged.push(...(modeParams.trend_keywords || []))
        if (card.card.trend_ref && Array.isArray(card.card.trend_ref.keywords)) trend_merged.push(...card.card.trend_ref.keywords)
        try {
          const staticKw = JSON.parse(readFileSync(TREND_KEYWORDS_JSON, 'utf-8'))
          if (modeKey && staticKw.keywords && staticKw.keywords[modeKey]) trend_merged.push(...staticKw.keywords[modeKey])
          if (staticKw.global_keywords) trend_merged.push(...staticKw.global_keywords)
        } catch (_) { /* 静态层缺失则忽略 */ }
        trend_merged = Array.from(new Set(trend_merged))

        return {
          ok: true,
          schema_version: schema.version,
          positioning: schema.positioning,
          dynasty_mode: modeKey || '(未指定，按 auto_infer 推断)',
          mode_params: modeParams || null,
          trend_keywords_merged: trend_merged,
          template: schema.usage.step1,
          card: card.card,
          output_template: [
            modeHeader,
            '## 1. 主题描述（主体+动作；场景标签 + 改良声明 + 模式场景）',
            '## 2. 环境设置（模式场景 × 宋元素）',
            '## 3. 美学风格（模式色卡 + 面料质感 + 妆造 + 光影 + 留白）',
            '## 4. 镜头（机位/运镜/景深）',
            '## 5. 动态指令（节拍/稳定性/时长）',
            '## 6. 音频（可选）',
            '## 7. 负面提示词（§11.5 原生 + negative_add + 模式 negative_add）',
            '## 8. 参考素材职责（可选；趋势关键词：' + trend_merged.join(' / ') + '）',
            '## 9. 合规自检（§一~§十 + colors.json ΔE + 实用性 + 模式饱和度上限 + 留白比例）',
          ].join('\n'),
        }
      } catch (e) {
        return { ok: false, error: String(e.message || e) }
      }
    },
  })

  // 工具 5：市场层 / 网红数据池（趋势关键词，schema v1.2 trend_ref 升级）
  ctx.tools.register({
    name: 'song_cao_trend',
    description:
      'CAO 市场层 / 网红数据池：合并「静态基准关键词（golden-dataset/trend/keywords.json，按模式分桶）+ 记忆系统沉淀的爆款词」→ 输出当前模式可用的趋势关键词包。出卡前（song_cao_prompt 读卡后）先调，把词注入提示词包 §8 参考节 + 卡片 trend_ref.keywords。',
    parameters: {
      dynasty_mode: {
        type: 'string',
        required: false,
        description: 'song_minimal | tang_festive | ming_commuting；省略则合并全模式',
      },
    },
    output: defineRender(),
    async execute(args) {
      const result = { ok: true }
      const mode = args.dynasty_mode

      // ① 静态基准层
      try {
        const staticKw = JSON.parse(readFileSync(TREND_KEYWORDS_JSON, 'utf-8'))
        result.static_keywords = {
          updated: staticKw.updated,
          global: staticKw.global_keywords || [],
          by_mode: staticKw.keywords || {},
          sample_count: staticKw.samples ? staticKw.samples.count : 0,
          sources: staticKw.sources || [],
        }
        if (mode) {
          result.selected_mode = mode
          result.selected_keywords = [
            ...(staticKw.keywords ? (staticKw.keywords[mode] || []) : []),
            ...(staticKw.global_keywords || []),
          ]
        } else {
          result.selected_mode = '(all)'
          const all = new Set()
          for (const v of Object.values(staticKw.keywords || {})) for (const k of v) all.add(k)
          for (const k of staticKw.global_keywords || []) all.add(k)
          result.selected_keywords = Array.from(all)
        }
      } catch (e) {
        result.static_keywords = { error: `读取失败：${e.message}`, sample_count: 0 }
        result.selected_keywords = []
      }

      // ② 动态查询层（dsh 记忆系统）—— CLI 插件不直连 MCP，输出查询契约由 agent 执行
      result.dynamic_query_hint = {
        tool: 'mcp__ai-memory__memory_query',
        query: mode ? `新中式 ${mode} 爆款 关键词 小红书 抖音` : '新中式 爆款 关键词 小红书 抖音',
        note: '命中条目 → 把摘要里的卖点词追加进 selected_keywords 去重；0 命中则仅用静态词',
        writeback: '新增爆款样本 → 把卖点词回填 golden-dataset/trend/keywords.json 对应 mode 桶',
      }

      return result
    },
  })
}
