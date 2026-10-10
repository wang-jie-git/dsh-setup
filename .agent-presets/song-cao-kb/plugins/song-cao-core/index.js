// song-cao-core — CAO 智能体预设的核心插件
//
// 三层贡献（本地 JS，零外部依赖；工具注册进 host 的 tools 注册表，不发布服务）：
//   L1 knowledge : song_cao_knowledge —— 按需读取 SKILL.md（规则库 + 量化基线 + SOP）
//   L2 critic    : song_cao_quant / song_cao_ai_score / song_cao_eval —— 评价引擎
//   L3 report    : song_cao_report —— 一键三轨纠偏报告（含 headless 规则层）
//
// 知识库文件位于 preset 的 skills 目录（skill-filesystem 会自动发现）：
//   /Users/mac/.dsh/.agent-presets/song-cao-kb/skills/song-cao-kb/SKILL.md
// 插件只负责"把文件读回来"，技能目录由 host 的 skill-registry 扫描发现，
// 因此插件本身不需要知道 SKILL.md 的精确路径——它由 skill-filesystem 负责。
// 这里的 song_cao_knowledge 工具是"模型手动调用"的兜底：模型忘了调技能时
// 可用它强制拉取全文（token 经济上不如技能自动触发，但保证规则库可达）。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, existsSync } from 'node:fs'

const execFileP = promisify(execFile)

const BASE = '/Users/mac/Desktop/宋式美学智能体'
const SKILL_MD = '/Users/mac/.dsh/.agent-presets/song-cao-kb/skills/song-cao-kb/SKILL.md'
const TREND_KEYWORDS_JSON = `${BASE}/golden-dataset/trend/keywords.json`

export const name = 'song-cao-core'
export const inject = ['tools']

async function runPython(pythonBin, script, args) {
  const { stdout } = await execFileP(pythonBin, [script, ...args], { timeout: 300000, cwd: BASE })
  return stdout.trim()
}

function jsonRender() {
  return {
    schema: { type: 'object' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

function textRender() {
  return {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  }
}

export function apply(ctx) {
  const fs = ctx.get('fs')

  // ── L1 知识库层 ──────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'song_cao_knowledge',
    description:
      'CAO 宋式美学规则库（完整文本）：色彩/构图/元素/装裱/形制/意境的硬性规则、金标量化基线、评分标尺与三轨纠偏 SOP。评估图片、审核产出、给设计建议前必须先读。',
    parameters: {},
    output: textRender(),
    async execute() {
      try {
        const target = await fs.resolve(SKILL_MD)
        const text = await fs.readText(target)
        return text
      } catch (e) {
        return `⚠️ 规则库读取失败：${e.code || e.message}\n（路径：${SKILL_MD}）`
      }
    },
  })

  // ── L2 评价引擎层 ────────────────────────────────────────────────────

  ctx.tools.register({
    name: 'song_cao_quant',
    description:
      '宋韵量化特征分析：输入图片路径，输出亮度/对比度/色彩丰富度/饱和度/色相数（基于金标基线判定是否偏离宋韵分布）。',
    parameters: {
      image: { type: 'string', required: true, description: '图片绝对路径' },
    },
    output: jsonRender(),
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

  ctx.tools.register({
    name: 'song_cao_ai_score',
    description:
      'AI 美学评分：输入图片路径，用 aesthetic-predictor-v2.5 (SigLIP) 输出 1-10 分（5.5+ 优秀）。注意是通用美学非宋韵专属。',
    parameters: {
      image: { type: 'string', required: true, description: '图片绝对路径' },
    },
    output: jsonRender(),
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

  ctx.tools.register({
    name: 'song_cao_eval',
    description:
      'CAO 一键三轨评估：输入图片路径，输出量化特征 + AI 评分 + CAO 规则评语（完整原始报告；需要结构化结论请用 song_cao_report）。',
    parameters: {
      image: { type: 'string', required: true, description: '图片绝对路径' },
    },
    output: jsonRender(),
    async execute(args) {
      try {
        const { stdout } = await execFileP(`${BASE}/cao-eval.sh`, [args.image], { timeout: 600000, cwd: BASE })
        return { ok: true, report: stdout }
      } catch (e) {
        return { ok: false, error: String(e.message || e), stderr: String(e.stderr || '') }
      }
    },
  })

  // ── L3 一键报告层 ────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'song_cao_report',
    description:
      'CAO 一键生成三轨纠偏报告：量化 + AI 评分 + 规则引擎（headless dsh），输出结构化 Markdown（范式/色彩/构图/元素/形制/意境/评分/纠偏建议）。边界案例需人工裁定时再读规则库细判。',
    parameters: {
      image: { type: 'string', required: true, description: '图片绝对路径' },
    },
    output: textRender(),
    async execute(args) {
      try {
        const { stdout } = await execFileP('bash', [`${BASE}/cao-eval.sh`, args.image], { timeout: 600000, cwd: BASE })
        const mQuant = stdout.match(/【🔵 轨 1[\s\S]*?(?=【🟢 轨 2|$)/)
        const mScore = stdout.match(/AI 美学评分:\s*([\d.]+)/)
        const mReport = stdout.match(/【🔴 轨 3[\s\S]*/)
        const fname = args.image.split('/').pop()
        return (
          `# CAO 三轨报告：${fname}\n\n` +
          `## 🔵 量化层\n${(mQuant ? mQuant[0] : '（无数据）').trim()}\n\n` +
          `## 🟢 AI 评分\n${mScore ? mScore[0] : '（无数据）'}\n\n` +
          `## 🔴 规则层\n${(mReport ? mReport[0] : '（无数据）').trim()}\n\n` +
          `---\n综合结论：三轨全过 → 可入金标；AI 分 <5 → 仅参照，不单独裁定。`
        )
      } catch (e) {
        return `⚠️ 报告生成失败：${e.message}\n${e.stderr || ''}`
      }
    },
  })

  // ── L4 提示词工厂层（2026-09-14 消费审美定位）────────────────────────
  const PROMPT_FACTORY = `${BASE}/prompt-factory`
  const SCHEMA_JSON = `${PROMPT_FACTORY}/schema.json`
  const CARDS_DIR = `${PROMPT_FACTORY}/cards`

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
    output: jsonRender(),
    async execute(args) {
      try {
        const fs = ctx.get('fs')
        const schemaTarget = await fs.resolve(SCHEMA_JSON)
        const schemaText = await fs.readText(schemaTarget)
        const schema = JSON.parse(schemaText)

        if (!args.card) {
          const dirTarget = await fs.resolve(CARDS_DIR)
          const files = await fs.readdir(dirTarget)
          const cards = files.filter((f) => f.endsWith('.json'))
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

        const cardPath = `${CARDS_DIR}/${args.card}`
        const cardTarget = await fs.resolve(cardPath)
        const cardText = await fs.readText(cardTarget)
        const card = JSON.parse(cardText)

        // 按 dynasty_mode 注入参数包（超级CAO 多模式架构）
        const modeKey = card.card.dynasty_mode
        const modeParams = modeKey ? (schema.dynasty_mode && schema.dynasty_mode.params[modeKey]) : null
        const modeHeader = modeKey
          ? `# 国风提示词包 · ${card.card.title}（当前模式：${modeParams ? modeParams.name : modeKey}，饱和度上限 ≤${modeParams ? modeParams.saturation_max : '?'}%）`
          : `# 国风提示词包 · ${card.card.title}`

        // L5 市场层：合并静态基准词 + 卡片 trend_ref + 模式 trend_keywords（动态词由 agent 调 song_cao_trend 取回后追加）
        let trend_merged = []
        if (modeKey && modeParams) trend_merged.push(...(modeParams.trend_keywords || []))
        if (card.card.trend_ref && Array.isArray(card.card.trend_ref.keywords)) trend_merged.push(...card.card.trend_ref.keywords)
        try {
          const staticKw = JSON.parse(readFileSync(TREND_KEYWORDS_JSON, 'utf-8'))
          if (modeKey && staticKw.keywords && staticKw.keywords[modeKey]) trend_merged.push(...staticKw.keywords[modeKey])
          if (staticKw.global_keywords) trend_merged.push(...staticKw.global_keywords)
        } catch (_) { /* 静态层缺失则忽略 */ }
        trend_merged = Array.from(new Set(trend_merged))

        // 组合 schema 生成原则 + 卡片字段 + 模式参数包 + 市场层关键词 → 提示词包骨架
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
            '## 8. 参考素材职责（可选；趋势关键词：' + trend_merged.join(' / ') + '；动态词可再调 song_cao_trend 追加记忆系统沉淀）',
            '## 9. 合规自检（§一~§十 + colors.json ΔE + 实用性 + 模式饱和度上限 + 留白比例）',
          ].join('\n'),
        }
      } catch (e) {
        return { ok: false, error: String(e.message || e) }
      }
    },
  })

  // ── L4b 款转译模式入口（2026-09-18 standard / differentiation / abstract 三模式）───
  // 数据源：guofeng-cao/pattern-translation.json（8 款现代款 × 源形制 × 差异化变体）
  //         guofeng-cao/abstraction-filter.json（抽象滤镜意象库：残山剩水/寒江独钓/水图）
  // 与 dynasty_mode（朝代维度：宋/唐/明）正交——design_mode 是"设计策略维度"：
  //   standard       → image_prompt_seed，四维校验合规，进打样/生产（形似）
  //   differentiation→ differentiation_variant.prompt，陌生化四维度商业张力，合规软指标（形变）
  //   abstract       → 意象 prompt_core（去符号化抽象：线条密度/灰度层次/负空间→剪裁/褶皱/材质），量化仍须 pass（神似）
  // 一次调用返回：提示词（正/负）+ 生图命令 + 校验命令 + 降饱和命令 + 差异化/意象审查建议。
  const GFC_BASE = '/Users/mac/Desktop/guofeng-cao'
  const PATTERN_TRANSLATION_JSON = `${GFC_BASE}/pattern-translation.json`
  const ABSTRACTION_FILTER_JSON = `${GFC_BASE}/abstraction-filter.json`

  ctx.tools.register({
    name: 'song_cao_style_prompt',
    description:
      '款转译提示词入口（design_mode 三模式）：按现代款名 + design_mode 输出图片提示词包（正向/负向）+ agnes 生图命令 + 四维校验命令 + 降饱和命令 + 差异化/意象审查建议。standard=四维校验合规进打样（形似）；differentiation=陌生化四维度商业张力（形变，合规软指标）；abstract=抽象滤镜去符号化（神似，意象库 abstraction-filter.json，量化仍须 pass）。生成款图前先调。',
    parameters: {
      style: {
        type: 'string',
        required: true,
        description: '现代款名：西装外套/风衣/连帽卫衣/工装裤/阔腿裤/衬衫/连衣裙/针织衫',
      },
      design_mode: {
        type: 'string',
        required: false,
        description: 'standard（默认，合规进打样）| differentiation（商业张力，合规软指标）| abstract（抽象滤镜，去符号化，量化仍须 pass）',
      },
      imagery: {
        type: 'string',
        required: false,
        description: '（仅 abstract 模式）意象源：canshan 残山剩水 / handiao 寒江独钓 / shuitu 水图；省略则列出全部意象供选',
      },
      scene: {
        type: 'string',
        required: false,
        description: '校验场景：consumer（浅色款 S上限49）| dark_structure（深色结构款 S上限55）',
      },
    },
    output: jsonRender(),
    async execute(args) {
      try {
        const styleName = args.style || ''
        const mode = args.design_mode === 'differentiation'
          ? 'differentiation'
          : args.design_mode === 'abstract' ? 'abstract' : 'standard'
        const scene = args.scene === 'dark_structure' ? 'dark_structure' : 'consumer'
        const desatTarget = scene === 'dark_structure' ? 54 : 48

        const pt = JSON.parse(readFileSync(PATTERN_TRANSLATION_JSON, 'utf-8'))
        const t = pt.translations.find(
          (x) => x.modern_key === styleName || (x.aliases || []).includes(styleName)
        )
        if (!t) {
          return {
            ok: false,
            error: `未找到款「${styleName}」`,
            available: pt.translations.map((x) => x.modern_key),
          }
        }

        // ── abstract 分支：抽象滤镜（去符号化，神似）──────────────
        if (mode === 'abstract') {
          const af = JSON.parse(readFileSync(ABSTRACTION_FILTER_JSON, 'utf-8'))
          const imageryArg = (args.imagery || '').trim()
          const pick = imageryArg
            ? af.imagery.find(
                (x) => x.id === imageryArg || x.name === imageryArg
              )
            : null
          if (!pick) {
            return {
              ok: true,
              style: t.modern_key,
              design_mode: 'abstract',
              error: imageryArg ? `未找到意象「${imageryArg}」` : '请选意象源',
              available_imagery: af.imagery.map((x) => ({
                id: x.id, name: x.name, artist: x.artist,
                usage: x.usage, negative_space: x.negative_space,
              })),
              red_line: af.red_line,
              hint: 'song_cao_style_prompt style=<款> design_mode=abstract imagery=<canshan|handiao|shuitu>',
            }
          }

          const prompt = pick.prompt_core.replace('<款>', t.modern_key)
          const forbidden = af.abstraction_rules.forbidden_words.join(' / ')
          return {
            ok: true,
            style: t.modern_key,
            source_pattern: t.source_pattern,
            design_mode: 'abstract',
            design_mode_note:
              '抽象滤镜版：去文化符号化，留美学意象（神似）。量化轨仍须 pass——抽象是表达方式的抽象，不是美学标准的放松。',
            imagery: {
              id: pick.id, name: pick.name, artist: pick.artist,
              visual_logic: pick.visual_logic,
              line_density: pick.line_density,
              gray_scale: pick.gray_scale,
              negative_space: pick.negative_space,
              mapping: pick.mapping,
            },
            prompt,
            negative: `${t.image_negative_seed}，${forbidden}`,
            generate_cmd:
              `npx -y bun /Users/mac/.dsh/skills/baoyu-image-gen/scripts/main.ts ` +
              `--prompt "${prompt}" --image <输出路径>.png --provider openai --ar 3:4 --quality 2k`,
            check_cmd:
              `SONG_YUN_AGNES_KEY=xxx python3 ${GFC_BASE}/scripts/song-yun-deviate.py ` +
              `<图> --scene ${scene} --vision --pattern ${t.modern_key}`,
            desat_cmd:
              `python3 ${GFC_BASE}/scripts/song-yun-desaturate.py ` +
              `<图> --target ${desatTarget} --check --scene ${scene} --pattern ${t.modern_key}`,
            abstraction_review: {
              note: 'structure_check 不适用（无具体形制可落）——用"意象命中"软提示：量化轨 pass + L2 留白/L7 偏角视觉判定负空间意象',
              forbidden_words: af.abstraction_rules.forbidden_words,
              red_line: af.red_line,
            },
            validation: t.validation || null,
          }
        }

        const dv = t.differentiation_variant || null
        const useDv = mode === 'differentiation' && dv
        const prompt = useDv ? dv.prompt : t.image_prompt_seed

        return {
          ok: true,
          style: t.modern_key,
          source_pattern: t.source_pattern,
          design_mode: mode,
          design_mode_note: useDv
            ? '差异化版：追求"0.5 秒抓目光"，合规为软指标（可能量化 fail 属预期，用于营销/概念）'
            : '标准版：四维校验合规，进打样/生产',
          prompt,
          negative: t.image_negative_seed,
          generate_cmd:
            `npx -y bun /Users/mac/.dsh/skills/baoyu-image-gen/scripts/main.ts ` +
            `--prompt "${prompt}" --image <输出路径>.png --provider openai --ar 3:4 --quality 2k`,
          check_cmd:
            `SONG_YUN_AGNES_KEY=xxx python3 ${GFC_BASE}/scripts/song-yun-deviate.py ` +
            `<图> --scene ${scene} --structure --pattern ${t.modern_key}`,
          desat_cmd:
            `python3 ${GFC_BASE}/scripts/song-yun-desaturate.py ` +
            `<图> --target ${desatTarget} --check --scene ${scene} --pattern ${t.modern_key}`,
          structure_check: {
            min_hits: t.structure_check.min_hits,
            features: t.structure_check.features.map((f) => f.id),
          },
          differentiation_review: mode === 'differentiation'
            ? {
                strategy: dv.strategy,
                note: dv.differentiation_note,
                validation: dv.validation || null,
                caveat: '合规≠差异化：差异化版量化可能 fail 属预期，不强制回炉',
              }
            : {
                hint: '标准版合规后可切 differentiation 做商业升级',
                strategy: dv ? dv.strategy : null,
                note: dv ? dv.differentiation_note : '该款尚无差异化变体',
                trigger: 'song_cao_style_prompt style=<款> design_mode=differentiation',
              },
          validation: t.validation || null,
          doubao_validation: t.doubao_validation || null,
        }
      } catch (e) {
        return { ok: false, error: String(e.message || e) }
      }
    },
  })

  // ── L4c 提示词增强器（2026-09-18 自由核心词 → 专业 prompt 翻译器）────
  // 解决"每次都要自己想怎么描述意境"痛点：输入简短核心词（如"宋式 职业 裙 禅意"），
  // 自动翻译为 4 段式专业 prompt（结构形态 + 东方叙事 + 材质色彩 + 抽象意境）。
  // 复核修正（2026-09-18）：优先查 pattern-translation.json（命中 8 款复用数据，
  // 不重复造）；未命中走 aesthetic-lexicon.json（气质词）；palette 运行时取
  // dynasty_mode.params[mode].palette_base（单一数据源，lexicon 不存 palette）；
  // negative 复用现有模板逻辑（§7 原生 + dynasty_mode negative_add）。
  const AESTHETIC_LEXICON_JSON = `${GFC_BASE}/aesthetic-lexicon.json`
  const SCHEMA_JSON2 = `${BASE}/prompt-factory/schema.json`

  ctx.tools.register({
    name: 'song_cao_enhance_prompt',
    description:
      '提示词增强器（美学翻译器）：输入简短核心词（空格分隔，如"宋式 职业 裙 禅意"）→ 自动翻译为 4 段式专业图片提示词（结构形态+东方叙事+材质色彩+抽象意境）+ 负向 + 生图命令 + 校验命令。命中 8 款（西装外套/风衣/卫衣/工装裤/阔腿裤/衬衫/连衣裙/针织衫）优先复用 pattern-translation.json 数据；未命中走 aesthetic-lexicon.json 气质词（极简/禅意/空灵/内敛/雄浑/写意/水韵）。不知道怎么写描述时先调。',
    parameters: {
      keywords: {
        type: 'string',
        required: true,
        description: '自由核心词，空格分隔。支持：朝代（宋式/唐式/明式）、品类（8款名 或 裙/裤/衫等）、气质词（极简/禅意/空灵/内敛/雄浑/写意/水韵）、场景（职业/通勤/休闲/正式）',
      },
      dynasty_mode: {
        type: 'string',
        required: false,
        description: '朝代模式：song_minimal（默认）/ tang_festive / ming_commuting。关键词里有"宋式"等自动推断，否则用此参数',
      },
    },
    output: jsonRender(),
    async execute(args) {
      try {
        const kws = (args.keywords || '').trim().split(/\s+/).filter(Boolean)
        if (!kws.length) {
          return { ok: false, error: '请输入关键词（如：宋式 职业 裙 禅意）' }
        }

        const pt = JSON.parse(readFileSync(PATTERN_TRANSLATION_JSON, 'utf-8'))
        const lex = JSON.parse(readFileSync(AESTHETIC_LEXICON_JSON, 'utf-8'))
        const schema = JSON.parse(readFileSync(SCHEMA_JSON2, 'utf-8'))

        // 朝代推断：宋式→song_minimal / 唐式→tang_festive / 明式→ming_commuting
        let mode = args.dynasty_mode || 'song_minimal'
        if (/唐/.test(args.keywords)) mode = 'tang_festive'
        else if (/明/.test(args.keywords)) mode = 'ming_commuting'
        else if (/宋/.test(args.keywords)) mode = 'song_minimal'
        const modeParams = schema.dynasty_mode.params[mode] || schema.dynasty_mode.params.song_minimal
        const palette = (modeParams.palette_base || []).join('、')

        // 品类匹配（优先 8 款，精确/别名优先，子串最后且排除过泛词）
        const styleMatch = pt.translations.find(
          (t) => kws.some((k) => t.modern_key === k || (t.aliases || []).includes(k))
        ) || pt.translations.find(
          (t) => kws.some((k) => k.length >= 2 && t.modern_key.includes(k))
        )
        // 气质词匹配
        const tags = Object.keys(lex.tags).filter((tag) => kws.includes(tag))
        const tag = tags.length ? lex.tags[tags[0]] : null
        // 场景/结构/叙事/面料词
        const structureHit = lex.structures.廓形.concat(lex.structures.剪裁)
          .find((s) => kws.some((k) => s.includes(k)))
        const narrativeHit = lex.narratives.东方叙事.find((n) => kws.some((k) => n.includes(k)))
        const materialHit = lex.materials.面料.find((m) => kws.some((k) => m.includes(k)))

        let prompt
        let promptSource
        if (styleMatch) {
          // 复核修正：命中 8 款 → 复用该款数据（standard prompt + 气质词修饰）
          const base = styleMatch.image_prompt_seed
          prompt = tag
            ? `${base}，${tag.prompt_seed}`
            : base
          promptSource = `pattern-translation.json → ${styleMatch.modern_key}（复用）`
        } else {
          // 自由组合：结构 + 叙事 + 材质 + 气质
          const seg1 = structureHit || lex.structures.廓形[0]
          const seg2 = narrativeHit || (tag ? '' : '宋代山水起伏线条')
          const seg3 = materialHit || lex.materials.面料[0]
          const seg4 = tag ? tag.prompt_seed : '低饱和灰调宋韵'
          const satNote = mode === 'tang_festive' ? `节庆华丽（饱和度上限≤${modeParams.saturation_max || 75}%，留白≥30%）` : `低饱和莫兰迪灰调（${palette}），留白≥40%`
          prompt = `现代${kws.filter((k) => /裙|裤|衫|衣|外套|风衣|西装|汉服/.test(k)).join('') || '服装'}，${seg1}廓形，${seg2}，${seg3}面料，${seg4}，${satNote}`
          promptSource = `aesthetic-lexicon.json 自由翻译（${mode}）`
        }

        const negative = `高饱和, 荧光色, 霓虹, 元素堆砌, 多机位, 分镜, 时间轴, 浓妆, 影楼感${tag ? ', ' + (tag.vibe ? '花鸟刺绣盘扣龙凤织锦（抽象版禁传统元素堆砌）' : '') : ''}`

        return {
          ok: true,
          keywords: kws,
          dynasty_mode: mode,
          prompt_source: promptSource,
          palette: palette ? `运行时取 ${mode}.palette_base: ${palette}` : null,
          tag_hit: tag ? tags[0] : null,
          style_hit: styleMatch ? styleMatch.modern_key : null,
          four_segment: {
            structure: structureHit || (styleMatch ? '复用款数据' : lex.structures.廓形[0]),
            narrative: narrativeHit || (tag ? '气质词自带' : '宋代山水起伏线条'),
            material_color: `${materialHit || lex.materials.面料[0]} + 低饱和（${palette}）`,
            vibe: tag ? tag.vibe : '低饱和灰调宋韵',
          },
          prompt,
          negative,
          generate_cmd:
            `npx -y bun /Users/mac/.dsh/skills/baoyu-image-gen/scripts/main.ts ` +
            `--prompt "${prompt}" --image <输出路径>.png --provider openai --ar 3:4 --quality 2k`,
          check_cmd:
            `SONG_YUN_AGNES_KEY=xxx python3 ${GFC_BASE}/scripts/song-yun-deviate.py ` +
            `<图> --scene consumer --vision`,
        }
      } catch (e) {
        return { ok: false, error: String(e.message || e) }
      }
    },
  })

  // ── L4d 参考图转设计模板（2026-09-18 "让机器教你审美"学习路径）──────
  // 输入一张"一眼不一样"的设计图 → agnès 多模态分析 4 维设计逻辑
  // （结构/比例/色彩/留白如何体现东方韵味）→ 输出可复用 prompt 模板 +
  // 词库回填建议（是否值得进 abstraction-filter.json / aesthetic-lexicon.json）。
  // 与 song_cao_eval 区别：eval=评估合规；本工具=提取可复用规律。
  // 输出供人工判断后回填词库（不自动写文件，保持词库可审计）。
  ctx.tools.register({
    name: 'song_cao_image2prompt',
    description:
      '参考图转设计模板（学习路径）：丢一张"一眼不一样"的设计图 → 自动分析 4 维设计逻辑（结构/比例/色彩/留白如何体现东方韵味）→ 输出可复用 4 段式 prompt 模板 + 词库回填建议（是否值得进 abstraction-filter.json 意象库 / aesthetic-lexicon.json 气质词库）。分析结果供人工判断后回填，不自动写文件。看到好图不知道它为什么高级时先调。',
    parameters: {
      imgpath: {
        type: 'string',
        required: true,
        description: '参考图路径（本地文件）',
      },
    },
    output: jsonRender(),
    async execute(args) {
      try {
        const script = `${GFC_BASE}/scripts/song-yun-image2prompt.py`
        const py = '/Users/mac/Desktop/宋式美学智能体/.venv/bin/python3'
        // 用系统 python3（脚本是纯标准库，venv 也可用）；带 --json
        const out = await runPython(py, script, [args.imgpath, '--json'])
        return { ok: true, ...JSON.parse(out) }
      } catch (e) {
        return { ok: false, error: String(e.message || e) }
      }
    },
  })

  // ── L5 市场层：网红数据池（趋势关键词，schema v1.2 trend_ref 升级）────────
  // 两层数据源：
  //   ① 静态基准层 —— golden-dataset/trend/keywords.json（人工策展，按 dynasty_mode 分桶）
  //   ② 动态查询层 —— dsh 记忆系统里跨会话沉淀的"爆款关键词"（memory_query 命中即引用）
  // song_cao_prompt 出卡前自动调本工具逻辑，合并 ①② 注入 §11.6 §8 参考节 + 卡片 trend_ref。
  // 用法：song_cao_trend [dynasty_mode] —— 不传 mode 则返回全模式合并词。
  ctx.tools.register({
    name: 'song_cao_trend',
    description:
      'CAO 市场层 / 网红数据池：合并「静态基准关键词（golden-dataset/trend/keywords.json，按模式分桶）+ 记忆系统沉淀的爆款词」→ 输出当前模式可用的趋势关键词包（含动态命中条数 + 静态词 + 全局通用词 + 爆款图样本数）。出卡前（song_cao_prompt 读卡后）先调，把词注入提示词包 §8 参考节 + 卡片 trend_ref.keywords。',
    parameters: {
      dynasty_mode: {
        type: 'string',
        required: false,
        description: 'song_minimal | tang_festive | ming_commuting；省略则合并全模式',
      },
    },
    output: jsonRender(),
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
        // 按模式筛（不传 mode 则全模式合并去重）
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

      // ② 动态查询层（dsh 记忆系统）—— 插件层不直连 MCP，
      // 改为把"待查词"标记输出，由 agent 在工具层调 mcp__ai-memory__memory_query。
      // 这里只声明查询意图 + 回写契约，不在插件内发 RPC。
      result.dynamic_query_hint = {
        tool: 'mcp__ai-memory__memory_query',
        query: mode
          ? `新中式 ${mode} 爆款 关键词 小红书 抖音`
          : '新中式 爆款 关键词 小红书 抖音',
        note: '命中条目 → 把摘要里的卖点词（如 减龄/叠穿/显瘦/松弛感/重工刺绣）追加进 selected_keywords 去重；0 命中则仅用静态词',
        writeback: '新增爆款样本 → 把卖点词回填 golden-dataset/trend/keywords.json 对应 mode 桶（人工策展，保持基准可审计）',
      }

      return result
    },
  })
}
