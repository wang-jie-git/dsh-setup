// stylist-core — AI 个人形象管理顾问（Stylist Agent）预设的核心插件
//
// 贡献（本地 JS，零外部依赖；只注册工具、不发布服务）：
//   L2 数据层：
//     stylist_garments_list  —— 服装档案索引（扫描共享 CAO 库，省 token 的精简索引）
//     stylist_garment_get    —— 单件服装档案全文
//     stylist_customer_get   —— 顾客档案全文
//     stylist_customer_new   —— 空建档模板（起步用）
//     stylist_plans_save     —— 匹配方案落盘 data/plans/
//     stylist_feedback_save  —— 成交/退货信号落盘 data/feedback/（供 CAO 反向定制）
//   M3 视觉分析层：
//     stylist_photo_register —— 照片入库（photo_consent 门禁 → data/customers/<id>/photos/）
//     stylist_photo_metrics  —— 客观皮肤色度量（python/PIL → LAB/底色/色季初判/质量告警）
//     stylist_profile_apply  —— 视觉判读结果回填档案（置信度标注 + analysis 审计块）
//
// 数据契约（单一事实源）：
//   服装档案：/Users/mac/Desktop/宋式美学智能体/golden-dataset/garments/<item_id>.json（CAO 写，Stylist 读）
//   顾客档案：/Users/mac/Desktop/个人形象管理/data/customers/<customer_id>.json
//   匹配方案：/Users/mac/Desktop/个人形象管理/data/plans/PLAN-*.json
//   反馈闭环：/Users/mac/Desktop/个人形象管理/data/feedback/<item_id>.feedback.json
// 服装库读取优先级：共享 CAO 目录存在则读共享（单事实源）；不存在回退本地 data/garments/（MVP 测试用）。

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export const name = 'stylist-core'
export const inject = ['tools']

const execFileP = promisify(execFile)

const WORKSPACE = '/Users/mac/Desktop/个人形象管理'
const VENV_PYTHON = `${WORKSPACE}/.venv/bin/python`
const PHOTO_METRICS_PY = `${WORKSPACE}/analysis/photo_metrics.py`
const SHARED_GARMENTS = '/Users/mac/Desktop/宋式美学智能体/golden-dataset/garments'
const DATA = `${WORKSPACE}/data`
const CUSTOMERS = `${DATA}/customers`
const PLANS = `${DATA}/plans`
const FEEDBACK = `${DATA}/feedback`
const DIAGNOSIS = `${DATA}/diagnosis`

function garmentsRoot() {
  return existsSync(SHARED_GARMENTS) ? SHARED_GARMENTS : `${DATA}/garments`
}

function jsonRender(describe = {}) {
  return {
    schema: { type: 'object', ...describe },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch (e) {
    return null
  }
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

  const SOURCE_CN = { quiz: '问卷', photo_metrics: '照片度量', vision_judgment: '视觉判读', quick_test: '快测', self_report: '自述', wardrobe_observation: '衣橱观察' }
  function buildReportMd(report) {
    const L = []
    L.push('# 形象鉴定报告')
    L.push('')
    L.push(`**顾客**：${report.customer_id}（${report.customer_id}） · **报告编号**：${report.diagnosis_id} · **日期**：${(report.issued_at || '').slice(0, 10)}`)
    L.push('')
    L.push(`**品牌美学层**：${report.brand_layer?.aesthetic_preference || '无特定'} — ${report.brand_layer?.palette_guidance || ''}`)
    L.push('')
    L.push('## 一、五大维度鉴定')
    L.push('')
    report.findings.forEach((f, i) => {
      const badge = f.confirmed ? '' : ' ⚠️ 待确认'
      L.push(`### ${i + 1}. ${f.dimension_label || f.dimension}：${f.conclusion}${badge}`)
      L.push('')
      L.push('| 项 | 内容 |')
      L.push('|---|---|')
      L.push(`| 判定方法 | ${(f.evidence || []).map((e) => SOURCE_CN[e.source] || e.source).join(' / ') || '档案记录'} |`)
      L.push(`| 证据 | ${(f.evidence || []).map((e) => `${e.detail}${e.weight === 'weak' ? '（弱）' : ''}`).join('；')} |`)
      L.push(`| 应用建议 | ${(f.application || []).filter(Boolean).join('；') || '待补全'} |`)
      L.push(`| 置信度 | ${f.confidence}${f.confirmed ? ' · 已确认' : ' · 待定案（以问卷/实测为准）'} |`)
      if (f.note) L.push(`| 备注 | ${f.note} |`)
      L.push('')
    })
    L.push('## 二、综合鉴定')
    L.push('')
    L.push(`> ${report.verdict}`)
    L.push('')
    L.push('## 三、下一步行动')
    L.push('')
    ;(report.next_steps || []).forEach((s, i) => L.push(`${i + 1}. ${s}`))
    L.push('')
    L.push('---')
    L.push('本报告由 AI 个人形象管理顾问生成。标注"待确认"的维度以问卷/实测为准，照片初判仅供参考；品牌语境按 aesthetic_preference（默认宋韵）。')
    return L.join('\n')
  }

export function apply(ctx) {
  const fs = ctx.get('fs')

  // ── 服装档案索引 ────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'stylist_garments_list',
    description:
      '服装档案索引：扫描服装库（共享 CAO 库优先），返回精简单 {item_id, name, category, vibe, best_scenes, song_style_score, sizes, stock}。匹配前先调本工具建候选池；可用 scene/vibe 过滤。',
    parameters: {
      scene: { type: 'string', description: '按场景过滤：职场通勤/高端晚宴/日常休闲/户外摄影/节庆宴会（可选）' },
      vibe: { type: 'string', description: '按意境过滤：清冷/禅意/文雅/飒爽/温婉/古典（可选）' },
    },
    output: jsonRender(),
    async execute(args = {}) {
      const root = garmentsRoot()
      if (!existsSync(root)) {
        return { ok: false, error: `服装库不存在：${root}。请先由 CAO 建档写入共享库，或放入 data/garments/ 测试。` }
      }
      const files = readdirSync(root).filter((f) => f.endsWith('.json'))
      const items = []
      for (const f of files) {
        const doc = readJson(join(root, f))
        if (!doc || !doc.item_id) continue
        if (args.scene && !(doc.matching?.best_scenes || []).includes(args.scene)) continue
        if (args.vibe && !(doc.aesthetic?.vibe || []).includes(args.vibe)) continue
        items.push({
          item_id: doc.item_id,
          name: doc.name,
          category: doc.category || null,
          vibe: doc.aesthetic?.vibe || [],
          best_scenes: doc.matching?.best_scenes || [],
          song_style_score: doc.aesthetic?.song_style_score ?? null,
          sizes: doc.meta?.sizes || [],
          stock: doc.meta?.stock ?? null,
        })
      }
      return { ok: true, root, count: items.length, items }
    },
  })

  // ── 单件服装档案全文 ────────────────────────────────────────────────
  ctx.tools.register({
    name: 'stylist_garment_get',
    description:
      '单件服装档案全文：按 item_id 读取完整 JSON（物理/审美/匹配三级标签）。选中候选后调用，供推理细节用。',
    parameters: {
      item_id: { type: 'string', required: true, description: '服装 SKU，例：SY-2026-001' },
    },
    output: jsonRender(),
    async execute(args) {
      const file = join(garmentsRoot(), `${args.item_id}.json`)
      const doc = readJson(file)
      if (!doc) return { ok: false, error: `未找到 ${args.item_id}（已查 ${file}）——库中没有该档案或 JSON 非法。` }
      return { ok: true, ...doc }
    },
  })

  // ── 顾客档案全文 ────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'stylist_customer_get',
    description:
      '顾客档案全文：按 customer_id 读取顾客 JSON（体型/肤色色季/气质/场景/偏好/历史）。匹配前必调。',
    parameters: {
      customer_id: { type: 'string', required: true, description: '顾客 ID，例：C-0001' },
    },
    output: jsonRender(),
    async execute(args) {
      const file = join(CUSTOMERS, `${args.customer_id}.json`)
      const doc = readJson(file)
      if (!doc) return { ok: false, error: `未找到 ${args.customer_id}（已查 ${file}）。没有顾客档案时先走建档流程（stylist_customer_new），不许瞎推荐。` }
      return { ok: true, ...doc }
    },
  })

  // ── 空建档模板 ──────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'stylist_customer_new',
    description:
      '顾客建档起步：返回空模板 + 必填清单。新顾客一律先调本工具取模板，问卷/照片分析后填写，再落盘 data/customers/。',
    parameters: {},
    output: jsonRender(),
    async execute() {
      const template = {
        spec_version: '1.4',
        customer_id: 'C-NNNN',
        nickname: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        basic_info: { age_range: '', occupation: '', lifestyle_keywords: [] },
        body: { height_cm: null, height_weight_ratio: '', body_type: '', body_line: '', skeleton: '', face_shape: '', shoulder: '', proportions_note: '', slim_goal: '' },
        skin_tone: { undertone: '', tone: '', color_season: '', color_system: { primary_type: '', secondary_type: '', neutrals: [] } },
        style: { vibes: [], style_keywords: [], style_system: '', aesthetic_preference: '无特定', style_type: { primary: '', secondary: '' }, color_preference: [], fit_preference: '', comfort_priority: '', dressing_goals: [], taboo: [], budget: {} },
        life: { profession: '', scenes: [], time_ratio: {} },
        wardrobe: { three_colors: [], neutral_colors: [], has: [], gap: [], updated_at: '' },
        history: { orders: [], feedback_tags: [], preferences_learned: [], measurements_changes: [] },
        privacy: { photo_consent: false, data_grade: 'local-only' },
      }
      return {
        ok: true,
        template,
        required_fields: ['customer_id', 'body.body_type', 'body.body_line', 'body.face_shape', 'skin_tone.color_season', 'style.vibes', 'life.scenes', 'privacy.photo_consent'],
        hint: 'body_type: 梨形/H形/X形/O形（苹果型=O形，沙漏型=X形）/小个子/匀称；body_line: 棱角直线型/直线型/柔和直线型/混合型/柔和曲线型/曲线型（版型第一坐标，拿不准看脸型，SKILL.md §一）；skeleton: 大/普通/小骨架；color_season: 4色季（须问卷校正）；color_system.primary_type: 深/浅/亮/浊/暖/冷（AIS 6型，经叙述自选确认，§三）；style_type: 夸张/优雅/自然/浪漫（因地制宜，§四）；aesthetic_preference: 宋韵/极简/法式/通勤实用/复古/混搭/无特定（品牌美学层，决定话术语境，默认宋韵实例）；wardrobe: 3色衣橱法 + 检查表（§十一，工具 stylist_wardrobe_plan）。偏好类字段走"审美快测"对话提取（§十）。',
      }
    },
  })

  // ── 方案落盘 ────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'stylist_plans_save',
    description:
      '匹配方案落盘：将 outfit-plan JSON 写入 data/plans/PLAN-<日期>-<序号>.json，返回路径回执。方案必须含 plan_id/customer_id/goal_scene/plans[]。',
    parameters: {
      plan: { type: 'object', required: true, description: '完整方案 JSON（outfit-plan 契约）' },
    },
    output: jsonRender(),
    async execute(args) {
      const plan = args.plan || {}
      if (!plan.customer_id || !plan.goal_scene || !Array.isArray(plan.plans) || plan.plans.length === 0) {
        return { ok: false, error: '方案缺必填字段（customer_id / goal_scene / plans[]）。' }
      }
      ensureDir(PLANS)
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
      const id = plan.plan_id || `PLAN-${stamp}-001`
      const file = join(PLANS, `${id}.json`)
      writeFileSync(file, JSON.stringify(plan, null, 2), 'utf-8')
      return { ok: true, path: file }
    },
  })

  // ── 反馈闭环 ────────────────────────────────────────────────────────
  ctx.tools.register({
    name: 'stylist_feedback_save',
    description:
      '反馈闭环信号：记录顾客对某件的成交/退货/不适配结果（含体型维度），写入 data/feedback/<item_id>.feedback.json。同款多次追加。供 CAO 反向定制（某版型在某体型中退货率高 → 减少同类设计）。',
    parameters: {
      item_id: { type: 'string', required: true, description: '服装 SKU' },
      signal: { type: 'string', required: true, enum: ['sold', 'return', 'mismatch'], description: 'sold=成交 return=退货 mismatch=穿不合适未成交' },
      customer_body_type: { type: 'string', description: '顾客体型（梨形/H形/…），便于聚合分析' },
      note: { type: 'string', description: '一句话原因' },
    },
    output: jsonRender(),
    async execute(args) {
      ensureDir(FEEDBACK)
      const file = join(FEEDBACK, `${args.item_id}.feedback.json`)
      const existing = readJson(file)
      const record = {
        item_id: args.item_id,
        signal: args.signal,
        customer_body_type: args.customer_body_type || null,
        note: args.note || '',
        created_at: new Date().toISOString(),
      }
      const arr = Array.isArray(existing?.records) ? [...existing.records, record] : [record]
      writeFileSync(file, JSON.stringify({ item_id: args.item_id, records: arr }, null, 2), 'utf-8')
      return { ok: true, path: file, records: arr.length }
    },
  })

  // ── M3 照片登记（consent 门禁）──────────────────────────────────────
  ctx.tools.register({
    name: 'stylist_photo_register',
    description:
      '顾客照片入库：复制照片到 data/customers/<id>/photos/。硬门禁：privacy.photo_consent 必须为 true，data_grade=cloud 拒绝存照。返回存储路径。',
    parameters: {
      customer_id: { type: 'string', required: true },
      photo_path: { type: 'string', required: true, description: '照片绝对路径' },
    },
    output: jsonRender(),
    async execute(args) {
      const customer = readJson(join(CUSTOMERS, `${args.customer_id}.json`))
      if (!customer) return { ok: false, error: `顾客 ${args.customer_id} 不存在，请先建档。` }
      if (customer.privacy?.photo_consent !== true) {
        return { ok: false, error: 'photo_consent 未开启：禁止存储顾客照片。需顾客同意后更新档案再试。' }
      }
      if (customer.privacy?.data_grade === 'cloud') {
        return { ok: false, error: 'data_grade=cloud：按契约禁止本地存照（隐私分级）。' }
      }
      if (!existsSync(args.photo_path)) return { ok: false, error: `照片不存在：${args.photo_path}` }
      const dir = join(CUSTOMERS, args.customer_id, 'photos')
      ensureDir(dir)
      const stamp = Date.now()
      const dest = join(dir, `${stamp}-${basename(args.photo_path)}`)
      copyFileSync(args.photo_path, dest)
      const photos = Array.isArray(customer.photos) ? [...customer.photos, dest] : [dest]
      customer.photos = photos
      customer.updated_at = new Date().toISOString()
      writeFileSync(join(CUSTOMERS, `${args.customer_id}.json`), JSON.stringify(customer, null, 2), 'utf-8')
      return { ok: true, path: dest, photos }
    },
  })

  // ── M3 客观皮肤色度量（python/PIL）──────────────────────────────────
  ctx.tools.register({
    name: 'stylist_photo_metrics',
    description:
      '顾客照片客观度量：采样皮肤像素 → CIELAB → 底色/肤色深浅/色季初判候选 + AIS 6型主要色彩初判（ais_type_candidates）+ 照片质量告警。输出为"初判"——color_season 必须再走问卷校正（§9.4A）、primary_type 必须走叙述自选确认（§9.4B）后才可写入档案（SKILL.md §九）。',
    parameters: {
      photo_path: { type: 'string', required: true, description: '照片绝对路径（已入库路径最佳）' },
      region: { type: 'string', description: '采样区分数坐标 x,y,w,h，默认 0.3,0.05,0.4,0.35（脸部/胸口区）' },
      locale: { type: 'string', description: '肤色标定：cn=中国校准（L*/b* 经验值，默认）/ us=欧美标定（原书阈值）。中国顾客用默认 cn；欧美背景顾客或对比研究用 us' },
    },
    output: jsonRender(),
    async execute(args) {
      try {
        const pyArgs = [PHOTO_METRICS_PY, args.photo_path, '--json']
        if (args.region) pyArgs.push('--region', args.region)
        pyArgs.push('--locale', args.locale || 'cn')
        pyArgs.push('--record')  // 自动落库到 data/skin-calibration/live/ 供 L1 阈值精修回路
        const { stdout } = await execFileP(VENV_PYTHON, pyArgs, { timeout: 60000 })
        return JSON.parse(stdout)
      } catch (e) {
        return { ok: false, error: `photo_metrics 执行失败：${e.message || e}` }
      }
    },
  })

  // ── M3 视觉判读回填 ─────────────────────────────────────────────────
  ctx.tools.register({
    name: 'stylist_profile_apply',
    description:
      '视觉判读回填：将视觉分析结果（体型/身体线条/脸型/肤色/气质）合并进顾客档案。硬门禁：photo_consent 必须为 true。只合并视觉相关组，绝不覆盖 history；写 analysis 审计块（source/confidence/quiz）。返回更新后的档案。',
    parameters: {
      customer_id: { type: 'string', required: true },
      updates: {
        type: 'object',
        required: true,
        description: '视觉判读结果：{ body: {body_type, body_line, skeleton, face_shape, proportions_note, slim_goal}, skin_tone: {undertone, tone, color_season, color_system: {primary_type, secondary_type, neutrals}}, style: {vibes} }，只传有把握的字段',
      },
      confidence: {
        type: 'object',
        description: '逐字段置信度 0-1：{ body_type: 0.9, body_line: 0.85, face_shape: 0.7, color_season: 0.6 }。≥0.8 自动回填；0.6-0.8 回填并标"建议确认"；<0.6 忽略（走确认流程）。color_season 需问卷校正后才可传；primary_type 需叙述自选确认（§9.4B）后可传。',
      },
      quiz: { type: 'object', description: '色彩确认结果：{ test: "silver/gold"|"season_quiz", answer: "silver", confirmed_season: "夏季型", confirmed_primary_type: "浅色" }（color_season 必带 confirmed_season；primary_type 可带 confirmed_primary_type）' },
      photo_path: { type: 'string', description: '来源照片路径（audit 用）' },
    },
    output: jsonRender(),
    async execute(args) {
      const file = join(CUSTOMERS, `${args.customer_id}.json`)
      const customer = readJson(file)
      if (!customer) return { ok: false, error: `顾客 ${args.customer_id} 不存在。` }
      if (customer.privacy?.photo_consent !== true) {
        return { ok: false, error: 'photo_consent 未开启：禁止写入视觉分析结果。' }
      }
      const conf = args.confidence || {}
      const applied = []
      const pending = []

      const setPath = (obj, path, value) => {
        const parts = path.split('.')
        let cur = obj
        for (let i = 0; i < parts.length - 1; i++) {
          if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}
          cur = cur[parts[i]]
        }
        cur[parts[parts.length - 1]] = value
      }

      const setField = (group, key, value) => {
        if (value === undefined || value === null || value === '') return
        const c = conf[key]
        if (c !== undefined && c < 0.6) {
          pending.push({ key, value, confidence: c, action: '需人工确认' })
          return
        }
        if (!customer[group]) customer[group] = {}
        setPath(customer[group], key, value)
        applied.push({ key, value, confidence: c ?? null, flag: c !== undefined && c < 0.8 ? '建议确认' : null })
      }

      const u = args.updates || {}
      // color_season 走问卷门禁：仅当 quiz.confirmed_season 与提交值一致时才允许写入
      const quizSeason = args.quiz?.confirmed_season
      const hasQuizSeason = !!quizSeason && quizSeason === u.skin_tone?.color_season
      // primary_type 走叙述自选门禁：仅当 quiz.confirmed_primary_type 与提交值一致时才允许写入（§9.4B）
      const quizPrimary = args.quiz?.confirmed_primary_type
      for (const [k, v] of Object.entries(u.body || {})) setField('body', k, v)
      for (const [k, v] of Object.entries(u.skin_tone || {})) {
        if (k === 'color_season') {
          if (hasQuizSeason) setField('skin_tone', k, v)
          else pending.push({ key: 'color_season', value: v, action: '色季必须经问卷校正' })
          continue
        }
        if (k === 'color_system' && v && typeof v === 'object') {
          const ptype = v.primary_type
          if (ptype) {
            if (quizPrimary && quizPrimary === ptype) setField('skin_tone', 'color_system.primary_type', ptype)
            else pending.push({ key: 'color_system.primary_type', value: ptype, action: '6型主要色彩需经叙述自选确认（§9.4B）' })
          }
          for (const sub of ['secondary_type', 'neutrals']) {
            if (v[sub] !== undefined && v[sub] !== null && v[sub] !== '') setField('skin_tone', `color_system.${sub}`, v[sub])
          }
          continue
        }
        setField('skin_tone', k, v)
      }
      for (const [k, v] of Object.entries(u.style || {})) setField('style', k, v)

      const analysis = {
        source: 'vision',
        applied_at: new Date().toISOString(),
        confidence: Object.fromEntries(applied.map((a) => [a.key, a.confidence])),
        quiz: args.quiz || null,
        photo: args.photo_path || null,
        pending,
      }
      customer.analysis = analysis
      customer.updated_at = new Date().toISOString()
      writeFileSync(file, JSON.stringify(customer, null, 2), 'utf-8')
      return { ok: true, applied, pending, analysis, path: file }
    },
  })

  ctx.tools.register({
    name: 'stylist_wardrobe_plan',
    description:
      '衣橱规划工作表（AIS 3 色衣橱法，SKILL.md §十一）：读顾客档案 + 已有单品（history.orders）→ 返回 3 色基础盘槽位 + 基本衣橱检查表 + 时间分配对照模板。LLM 按 §11.1-11.3 规则填 three_colors（安全区 2 主色 + 1 个性色）/ neutral_colors / gap（对照检查表与已有单品的缺口），落盘顾客档案 wardrobe 字段，向顾客输出 3 色盘 + 采购清单。',
    parameters: {
      customer_id: { type: 'string', required: true },
    },
    output: jsonRender(),
    async execute(args) {
      const file = join(CUSTOMERS, `${args.customer_id}.json`)
      const customer = readJson(file)
      if (!customer) return { ok: false, error: `顾客 ${args.customer_id} 不存在，先建档（stylist_customer_new）。` }

      // 已有单品：history.orders + 共享库取款名
      const owned = []
      for (const o of customer.history?.orders || []) {
        const g = readJson(join(SHARED_GARMENTS, `${o.item_id}.json`)) || readJson(join(DATA, 'garments', `${o.item_id}.json`))
        owned.push({ item_id: o.item_id, name: g?.name || o.item_id, note: o.feedback || '' })
      }

      const checklist = [
        { category: '短外套', need: '中性单色 · 适合身体线条 · 天然/高级混纺', owned: 0 },
        { category: '衬衫×3', need: '①白/象牙白/牡蛎白（必备）②单色/印花/条纹 ③华丽款', owned: 0 },
        { category: '裤子', need: '中性单色 · 剪裁适体', owned: 0 },
        { category: '裙子', need: '中性单色 · 适合身体线条', owned: 0 },
        { category: '毛衣×2', need: '基本色 · 开襟可当短外套 · 圆领/V领/高翻领', owned: 0 },
        { category: '裙装×2', need: '单色/两件套 · 日间夜间皆可', owned: 0 },
        { category: '大衣', need: '中性色 · 高档剪裁 · 适合所有天气', owned: 0 },
        { category: '晚礼服', need: '只在需要时购买 · 两件式变化多', owned: 0 },
      ]
      const knownCats = ['短外套', '衬衫', '裤子', '裙子', '毛衣', '裙装', '大衣', '礼服']
      for (const o of owned) {
        const hit = knownCats.find((c) => (o.name || '').includes(c))
        if (hit) {
          const row = checklist.find((r) => r.category.startsWith(hit) || (hit === '衬衫' && r.category.startsWith('衬衫')) || (hit === '裙子' && r.category === '裙子'))
          if (row) row.owned += 1
        }
      }

      const existing = customer.wardrobe || {}
      return {
        ok: true,
        customer_id: args.customer_id,
        palette_input: {
          color_system: customer.skin_tone?.color_system || null,
          color_season: customer.skin_tone?.color_season || '',
          color_preference: customer.style?.color_preference || [],
        },
        time_ratio: customer.life?.time_ratio || null,
        scenes: customer.life?.scenes || [],
        owned_items: owned,
        three_colors_slots: existing.three_colors || [],
        neutral_color_slots: existing.neutral_colors || [],
        checklist,
        existing_gap: existing.gap || [],
        rule_hint: 'three_colors: 从 color_system 安全色区取 2 主色 + 1 个性色（3 个能互相搭配）；neutral_colors: AIS 中性色表；gap: 对照 checklist 与 owned_items 的缺口，即采购清单（SKILL.md §11.1-11.3）。',
      }
    },
  })

  // ── 形象诊断与色彩鉴定（核心产品：诊断 → 匹配/衣橱为下游）────────────────
  // 诊断报告人读版 Markdown 渲染（JSON 是机器契约，MD 是给人看/编辑的）
  ctx.tools.register({
    name: 'stylist_diagnosis_report',
    description:
      '形象鉴定报告（核心产出，SKILL.md §十二）：读顾客档案已确认字段 + analysis 审计证据 → 生成五大鉴定（色季/6型色彩/身体线条/骨架/风格四类型）报告，落盘 data/diagnosis/。LLM 侧职责：按 §十二 补全 application（安全色区/版型/场合映射）、verdict（综合一句话）、next_steps。诚实原则：confirmed=false 的维度必须在报告标注"待确认"，照片初判≠定案。',
    parameters: {
      customer_id: { type: 'string', required: true },
      verdict: { type: 'string', description: '综合鉴定一句话（面向顾客，LLM 按 §十二 撰写；缺省则生成初稿占位）' },
      applications: {
        type: 'object',
        description: '逐维度应用建议覆盖：{ color_season: ["安全色区…"], body_line: ["推荐版型…"] }；缺省时由报告按 SKILL 映射自动填充基础版',
      },
      next_steps: { type: 'array', items: { type: 'string' }, description: '下一步行动清单（缺省给通用模板）' },
      save: { type: 'boolean', description: '是否落盘（默认 true）；先调用不落盘拿骨架 → LLM 补全后再落盘终稿' },
    },
    output: jsonRender(),
    async execute(args) {
      const file = join(CUSTOMERS, `${args.customer_id}.json`)
      const customer = readJson(file)
      if (!customer) return { ok: false, error: `顾客 ${args.customer_id} 不存在，先建档（stylist_customer_new）。` }

      const skin = customer.skin_tone || {}
      const style = customer.style || {}
      const body = customer.body || {}
      const quiz = customer.analysis?.quiz || {}

      // 证据链：从档案 + analysis 审计块汇总（证据为空时兜底弱自述条目，保契约 minItems 1）
      const mkEvidence = (items) => items.map((i) => ({ source: i.source, detail: i.detail, weight: i.weight || 'medium' }))
      const ensureEvidence = (items) =>
        items.length ? items : [{ source: 'self_report', detail: '档案已录（证据待补充：问卷/照片确认后回填）', weight: 'weak' }]
      const findings = []
      if (skin.color_season) {
        findings.push({
          dimension: 'color_season',
          dimension_label: '色季',
          conclusion: skin.color_season,
          confidence: 0.9,
          confirmed: !!quiz.confirmed_season,
          evidence: ensureEvidence(
            mkEvidence([
              ...(quiz.confirmed_season ? [{ source: 'quiz', detail: `色季问卷确认：${quiz.test || '银/金/血管/黑白'} → ${quiz.answer || ''}，定案 ${quiz.confirmed_season}`, weight: 'strong' }] : []),
              ...(skin.undertone ? [{ source: 'quiz', detail: `底色判定：${skin.undertone}`, weight: 'medium' }] : []),
            ])
          ),
          application: ['安全色区按 SKILL.md §3.4 映射', skin.color_season === '夏季型' ? '冷柔安全色：天青/灰蓝/紫灰/淡粉/牙白；回避纯黑大色块' : ''],
          note: quiz.confirmed_season ? '' : '照片/快测为初判，待问卷定案（§9.4A）',
        })
      }
      if (skin.color_system?.primary_type) {
        findings.push({
          dimension: 'color_system',
          dimension_label: '6型色彩',
          conclusion: `${skin.color_system.primary_type}${skin.color_system.secondary_type ? ' × ' + skin.color_system.secondary_type : ''}（主 × 次）`,
          confidence: 0.85,
          confirmed: !!quiz.confirmed_primary_type,
          evidence: ensureEvidence(
            mkEvidence([
              ...(quiz.confirmed_primary_type ? [{ source: 'quiz', detail: `叙述自选确认主型：${quiz.confirmed_primary_type}`, weight: 'strong' }] : []),
              ...(customer.analysis?.photo ? [{ source: 'photo_metrics', detail: `照片度量：${customer.analysis.photo}`, weight: 'medium' }] : []),
              ...(skin.color_system.neutrals?.length ? [{ source: 'wardrobe_observation', detail: `档案中性色记录：${skin.color_system.neutrals.join('/')}`, weight: 'weak' }] : []),
            ])
          ),
          application: ['6型安全色区按 SKILL.md §3.2 映射', skin.color_system.neutrals?.length ? `适配中性色：${skin.color_system.neutrals.join('/')}` : ''],
          note: quiz.confirmed_primary_type ? '' : '待叙述自选确认（§9.4B）',
        })
      }
      if (body.body_line) {
        findings.push({
          dimension: 'body_line',
          dimension_label: '身体线条',
          conclusion: body.body_line,
          confidence: body.face_shape ? 0.8 : 0.7,
          confirmed: true,
          evidence: mkEvidence([
            { source: body.face_shape ? 'vision_judgment' : 'self_report', detail: body.face_shape ? `脸型 ${body.face_shape} 辅助判线` : '顾客自述轮廓', weight: body.face_shape ? 'medium' : 'medium' },
            ...(body.proportions_note ? [{ source: 'self_report', detail: body.proportions_note, weight: 'weak' }] : []),
          ]),
          application: ['服装线条取同档或近档（SKILL.md §1.2）', body.skeleton ? `骨架 ${body.skeleton} 参考 §1.3 配饰/布料` : ''],
          note: '',
        })
      }
      if (body.skeleton) {
        findings.push({
          dimension: 'skeleton',
          dimension_label: '骨架',
          conclusion: body.skeleton,
          confidence: 0.8,
          confirmed: true,
          evidence: mkEvidence([{ source: 'self_report', detail: `身高参考：${body.height_cm ? body.height_cm + 'cm' : '未录'}`, weight: 'medium' }]),
          application: ['布料线重与配饰体量按 §1.3/§1.6 匹配'],
          note: '',
        })
      }
      if (style.style_type?.primary) {
        findings.push({
          dimension: 'style_type',
          dimension_label: '风格四类型',
          conclusion: `${style.style_type.primary}${style.style_type.secondary ? ' × ' + style.style_type.secondary : ''}（主 × 次）`,
          confidence: 0.8,
          confirmed: true,
          evidence: mkEvidence([{ source: 'quick_test', detail: `风格快问：主${style.style_type.primary} 次${style.style_type.secondary || '—'}`, weight: 'medium' }]),
          application: ['场合策略按 SKILL.md §4.1 映射', style.life?.scenes?.length ? `常驻场合：${style.life.scenes.join('/')}` : ''],
          note: '',
        })
      }

      // 品牌层
      const brand_layer = {
        aesthetic_preference: style.aesthetic_preference || '无特定',
        palette_guidance:
          style.aesthetic_preference === '宋韵' ? '优先宋代色谱：天青/牙白/黛青/水绿/茶白/灰蓝/朱砂'
            : style.aesthetic_preference === '无特定' ? '以通用安全色区为据（§3.2/3.3）' : `按${style.aesthetic_preference}品牌语境引导`,
      }

      // 合并 LLM 补充
      const apps = args.applications || {}
      for (const f of findings) if (apps[f.dimension]) f.application = apps[f.dimension]

      const date = new Date()
      const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
      const dir = join(DIAGNOSIS, args.customer_id)
      mkdirSync(dir, { recursive: true })
      const existing = existsSync(dir) ? readdirSync(dir).filter((x) => x.startsWith(`DX-${stamp}-`)).length : 0
      const diagnosis_id = `DX-${stamp}-${String(existing + 1).padStart(3, '0')}`

      const report = {
        diagnosis_id,
        customer_id: args.customer_id,
        issued_at: date.toISOString(),
        assessor: 'AI 形象管理顾问',
        basis: {
          photo_analysis: !!(customer.analysis?.photo) && customer.privacy?.photo_consent === true,
          quiz_records: quiz.confirmed_season ? [{ dimension: 'color_season', question: quiz.test || '', answer: quiz.answer || quiz.confirmed_season }] : [],
          quick_test_notes: `轮廓/骨架/风格/三色快问要点：vibes=${(style.vibes || []).join('/')}；色彩偏好=${(style.color_preference || []).join('/')}`,
        },
        findings,
        verdict:
          args.verdict ||
          `综合鉴定：${skin.color_season || '色季待定'} + ${skin.color_system?.primary_type || '6型待定'}主型 + ${body.body_line || '线条待定'} + ${style.style_type?.primary || '风格待定'}风格 → 建议与 ${brand_layer.palette_guidance} 衔接（待 LLM 按 §十二 补全应用与话术）`,
        brand_layer,
        next_steps:
          args.next_steps || ['按安全色区定 3 色盘（stylist_wardrobe_plan）', '预约试穿验证身体线条', '对照基本衣橱检查表补缺口', '每半年复查（时间分配变化）'],
      }

      if (args.save !== false) {
        const jsonPath = join(dir, `${diagnosis_id}.json`)
        writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8')
        // 人读版 Markdown：与 JSON 同目录 + 复制到桌面（WORKSPACE 上级），便于用户直接查看/编辑
        const md = buildReportMd(report)
        const mdPath = join(dir, `${diagnosis_id}.md`)
        writeFileSync(mdPath, md, 'utf-8')
        let desktop_path = null
        try {
          desktop_path = join(WORKSPACE, '..', `形象鉴定报告-${args.customer_id}-${stamp}.md`)
          writeFileSync(desktop_path, md, 'utf-8')
        } catch {
          desktop_path = null
        }
        return { ok: true, ...report, saved_path: jsonPath, md_path: mdPath, desktop_path }
      }
      return { ok: true, ...report, saved_path: null, md_path: null, desktop_path: null }
    },
  })
}

// 导出渲染函数（单源：任何场景生成人读版报告都走这里，与工具落盘逻辑一致）
export const renderDiagnosisMd = buildReportMd