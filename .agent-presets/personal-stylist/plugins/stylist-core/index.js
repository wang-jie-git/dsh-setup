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
//   管理/迁移层（v1.5）：
     // stylist_index_rebuild   —— 档案总览索引 + NocoBase 迁移清单（data/index.json）
     // stylist_customer_archive —— 顾客软删除/恢复/筛选（archived 标记 + filter）
     // stylist_card_manage     —— 决策卡 list/delete/preview（含桌面副本同步清理）
//
// 数据契约（单一事实源）：
//   服装档案：/Users/mac/Desktop/宋式美学智能体/golden-dataset/garments/<item_id>.json（CAO 写，Stylist 读）
//   顾客档案：/Users/mac/Desktop/个人形象管理/data/customers/<customer_id>.json
//   匹配方案：/Users/mac/Desktop/个人形象管理/data/plans/PLAN-*.json
//   反馈闭环：/Users/mac/Desktop/个人形象管理/data/feedback/<item_id>.feedback.json
// 服装库读取优先级：共享 CAO 目录存在则读共享（单事实源）；不存在回退本地 data/garments/（MVP 测试用）。

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, unlinkSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

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
const CARDS = `${DATA}/cards`
const INDEX = `${DATA}/index.json`

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

  // ── 口袋决策卡（v1.5 双轨制·北极星：诊断 confirmed 后的高频日常入口，SKILL.md §十三）──────
  // 产出规则（硬性）：数据源唯一（confirmed 诊断/档案）· 压缩投影不新判定 · 一客一卡版本递增
  // 卡面三块：①3 色衣橱配色盘 ②版型 2 红线 ③购物闸门 + 半年复查区
  ctx.tools.register({
    name: 'stylist_decision_card',
    description:
      '口袋决策卡（v1.5 北极星，SKILL.md §十三）：从 confirmed 诊断/档案派生"顾客早上出门 30 秒能用"的决策卡——' +
      '①3 色衣橱配色盘（主色+辅色+中性色，任意两件都是对的）②版型 2 红线（由身体线条/骨架/功能诉求生成）' +
      '③购物闸门（"除非你疯狂地爱它、极度需要它，否则不买" + 价格÷预期穿着次数）+ 半年复查区（时间分配对照）。' +
      '门禁：色季与 6型色彩必须已 confirmed，否则拒卡并列出缺口。落盘 data/cards/<cid>/CARD-*.md + 桌面副本。',
    parameters: {
      customer_id: { type: 'string', required: true },
      occasion_focus: { type: 'string', description: '可选：卡片场合侧重点（如"商务对接"），影响配色盘示例话术；缺省按档案常驻场合' },
      gate_rule: { type: 'string', description: '可选：覆盖购物闸门话术（默认原书黄金准则 + 穿着成本公式）' },
    },
    output: jsonRender(),
    async execute(args) {
      const customer = readJson(join(CUSTOMERS, `${args.customer_id}.json`))
      if (!customer) return { ok: false, error: `顾客 ${args.customer_id} 不存在，先建档（stylist_customer_new）。` }
      if (customer.archived === true) return { ok: false, rejected: true, reason: `顾客 ${args.customer_id} 已归档，不出卡。需先 stylist_customer_archive(action=restore) 恢复。`, next: '恢复档案后再出卡' }

      const skin = customer.skin_tone || {}
      const body = customer.body || {}
      const style = customer.style || {}
      const wardrobe = customer.wardrobe || {}
      const quiz = customer.analysis?.quiz || {}

      // ── 门禁：色季 + 6型色彩必须 confirmed（双轨制不变量：卡只从定案派生）──
      const gs = latestDiagnosis(args.customer_id)
      const colorSeasonOk = !!quiz.confirmed_season || !!(gs && (gs.findings || []).find((f) => f.dimension === 'color_season' && f.confirmed))
      const colorSystemOk = !!quiz.confirmed_primary_type || !!(gs && (gs.findings || []).find((f) => f.dimension === 'color_system' && f.confirmed))
      const missing = []
      if (!colorSeasonOk) missing.push('色季未 confirmed（补 §9.4A 色季问卷定案）')
      if (!colorSystemOk) missing.push('6型色彩未 confirmed（补 §9.4B 叙述自选定案）')
      if (missing.length) {
        return {
          ok: false,
          rejected: true,
          reason: '诊断未全绿 confirmed，禁止凭感觉出卡（§13.1）。缺口：' + missing.join('；') + '。',
          missing,
          next: '先补鉴定（stylist_diagnosis_report），全绿 confirmed 后再出卡；期间顾客"今天穿什么"按已 confirmed 维度口头给建议，不交付卡片。',
        }
      }

      // ── ① 3 色衣橱配色盘（ch05 三要素·颜色 + ch07 主+次+中性；色区按诊断 6型 × 品牌层适配）──
      const cs = skin.color_system || {}
      const season = gs ? (gs.findings || []).find((f) => f.dimension === 'color_season')?.conclusion : skin.color_season
      const palette = {
        main: season ? `${season || '诊断色季'}安全色区` : cs.primary_type ? `${cs.primary_type}色区` : '待定',
        secondary: cs.secondary_type ? `${cs.secondary_type}色区（添变化弹性）` : '与主型同频辅色',
        neutral: wardrobe.neutral_colors?.length ? wardrobe.neutral_colors.join(' / ') : '中性色表选 2-3（黑/灰/驼/海军蓝/可可）',
        accent: wardrobe.three_colors?.length ? `个性色 1：${(wardrobe.three_colors).slice(0, 1).join('、')}（高饱和点缀 ≤10%）` : '个性色 1（高饱和点缀 ≤10%，从 6 型安全色区选）',
      }

      // ── ② 版型 2 红线（ch02/03 同轴匹配 + 功能诉求）──
      const line = body.body_line || '未定'
      const redline = []
      if (line.includes('曲线') || line.includes('柔和')) redline.push(`买外套先看收腰与摆量：曲线系选收腰+微摆，避开 H 形直筒；垫肩做结构支撑`)
      else if (line.includes('直线')) redline.push(`买外套先看肩线与衣长：直线系选利落直筒/微A，${body.skeleton ? body.skeleton + '骨架适配量感' : '避开软塌垂坠'}；腰头不贴肚（腹部修饰）`)
      else redline.push('线条未定：先试直筒与收腰各一件，按上身效果定轴')
      redline.push(body.slim_goal ? `功能红线：${body.slim_goal}（选版型/长度时优先满足）` : '功能红线：无特别诉求，以场合策略为主')

      // ── ③ 购物闸门（ch05 p-010/p-158）──
      const gate = args.gate_rule || '除非你疯狂地爱它、极度需要它，否则就不要买它；成本 = 价格 ÷ 预期穿着次数（不是绝对价格）。'

      // ── 半年复查区（ch05 时间分配对照）──
      const review = [
        '每半年（或生活状态变化时）对照：一周时间分配 vs 衣橱单品比例，找失衡项',
        wardrobe.has?.length ? `已有 ${wardrobe.has.length} 件，缺口见 wardrobe_plan` : '缺口清单见 stylist_wardrobe_plan',
        '失衡先补缺口，不靠"再买一件"解决',
      ]

      // ── ④ 场景速配（v1.5 增强：按场合×风格策略压缩 2-3 条"该场合的最优单品+配饰"）──
      const seasonFull = (gs ? (gs.findings || []).find((f) => f.dimension === 'color_season')?.conclusion : skin.color_season) || ''
      const safeZone = seasonFull.includes('冬') ? '深冷+鲜明（纯黑/纯白/海军蓝/深梅子/正红点缀）'
        : seasonFull.includes('夏') ? '浅冷+清雅（天青/灰蓝/淡粉/灰白）'
        : seasonFull.includes('秋') ? '深暖+浊（可可/砖红/橄榄绿/驼/深梅子）'
        : seasonFull.includes('春') ? '浅暖+清爽（珊瑚/水绿/杏粉/浅黄）'
        : '中性色为主（黑/灰/驼/海军蓝）'
      const stylePrimary = style.style_type?.primary || '自然'
      const scenes = (style.life?.scenes || ['职场通勤', '日常休闲']).slice(0, 3)
      // 性别适配单品库（v1.5 增强：按 basic_info.sex 切换"该场合最优单品"取哪套库）
      const sex = customer.basic_info?.sex || '不区分'
      const sceneMap = {
        '职场通勤': sex === '男'
          ? `优雅策略：${stylePrimary === '优雅' ? '结构感肩线西装 + 直筒西裤，配饰克制' : '利落直筒西裤 + 收腰外套，配饰克制'}`
          : sex === '女'
          ? `优雅策略：${stylePrimary === '优雅' ? '结构感肩线西装 + 直筒高腰裤，配饰中等量感' : '利落直筒西裤 + 收腰外套，配饰克制'}`
          : `因地制宜：${stylePrimary}策略，配色限定 ${safeZone}`,
        '日常休闲': sex === '男'
          ? '自然策略：直筒裤 + 基础衬衫/针织，不费力；点缀色 ≤1 件'
          : sex === '女'
          ? '自然策略：垂感针织/直筒裤 + 基础衬衫，不费力；点缀色 ≤1 件'
          : `因地制宜：${stylePrimary}策略，配色限定 ${safeZone}`,
        '高端晚宴': sex === '男'
          ? '优雅：正式西裤 + 衬衫/缎面内搭 + 结构外套，配色盘内高饱和点缀（≤1 件）'
          : sex === '女'
          ? '浪漫/优雅：垂感裙/缎面单品 + 结构外套，配色盘内高饱和点缀'
          : '优雅：正式单品 + 点缀色，配色盘内高饱和（≤1 件）',
        '户外摄影': '自然策略：中性色打底 + 1 件品牌色单品做记忆点',
        '节庆宴会': sex === '男'
          ? '优雅：正式单品 + 点缀色（正红/宝蓝），避免全身高饱和'
          : sex === '女'
          ? '优雅：正式单品 + 点缀色（正红/宝蓝），避免全身高饱和'
          : '优雅：正式单品 + 点缀色，避免全身高饱和',
      }
      const quickScenes = scenes.map((s) => ({ scene: s, strategy: sceneMap[s] || `因地制宜：${stylePrimary}策略，配色限定 ${safeZone}` })).slice(0, 3)

      // ── 落盘：一客一卡，版本递增，历史不覆盖 ──
      const date = new Date()
      const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
      const dir = join(CARDS, args.customer_id)
      mkdirSync(dir, { recursive: true })
      const existing = existsSync(dir) ? readdirSync(dir).filter((x) => x.startsWith(`CARD-${stamp}-`)).length : 0
      const card_id = `CARD-${stamp}-${String(existing + 1).padStart(3, '0')}`

      const md = [
        `# 口袋决策卡 · ${args.customer_id}`,
        `> ${card_id} · ${date.toLocaleString('zh-CN')} · 品牌层：${style.aesthetic_preference || '无特定'}`,
        ``,
        `## ① 3 色衣橱配色盘（任意两件都是对的）`,
        `- 主色：${palette.main}`,
        `- 辅色：${palette.secondary}`,
        `- 中性色：${palette.neutral}`,
        `- 点缀色：${palette.accent}`,
        ``,
        `## ② 版型 2 红线`,
        ...redline.map((r, i) => `${i + 1}. ${r}`),
        ``,
        `## ③ 购物闸门`,
        `> ${gate}`,
        ``,
        `## ④ 场景速配（该场合怎么穿，30 秒对照）`,
        ...quickScenes.map((q) => `- **${q.scene}**：${q.strategy}`),
        `  · 配色一律限安全色区：${safeZone}`,
        ``,
        `## 半年复查区`,
        ...review.map((r) => `- ${r}`),
        ``,
        `---`,
        `出卡依据：诊断 ${(gs ? gs.diagnosis_id : '档案 confirmed')} · 色季 ${skin.color_season || '—'} · 6型 ${cs.primary_type || '—'}${cs.secondary_type ? '+' + cs.secondary_type : ''} · 线条 ${line} · 骨架 ${body.skeleton || '—'} · 风格 ${style.style_type?.primary || '—'}${args.occasion_focus ? ` · 场合侧重 ${args.occasion_focus}` : ''}`,
        `（决策卡 v1.5 · 数据源唯一：confirmed 诊断/档案 · 压缩投影不新判定 · 原书锚点 ch04 场合×风格 + ch05/ch07）`,
      ].join('\n')

      const mdPath = join(dir, `${card_id}.md`)
      writeFileSync(mdPath, md, 'utf-8')
      let desktop_path = null
      try {
        desktop_path = join(WORKSPACE, '..', `口袋决策卡-${args.customer_id}.md`)
        writeFileSync(desktop_path, md, 'utf-8')
      } catch {
        desktop_path = null
      }

      return {
        ok: true,
        card_id,
        customer_id: args.customer_id,
        gate: gate,
        redline,
        palette,
        quickScenes,
        based_on: gs ? gs.diagnosis_id : '档案 confirmed',
        md,
        saved_path: mdPath,
        desktop_path,
      }
    },
  })

  // ── 档案总览索引（管理可查询 + 将来 NocoBase 迁移清单）────────────────
  ctx.tools.register({
    name: 'stylist_index_rebuild',
    description:
      '重建 data/index.json（档案/诊断/决策卡/服装/方案/反馈 汇总索引 + 可迁移清单）。' +
      '管理用途：工作台/CLI 查询"所有冬季型顾客""所有全绿诊断"时读本索引，不必逐个扫 JSON。' +
      '迁移用途：index.json 含 migration_to_nocobase 块（目标集合 customer_image_profiles/garment_profiles + 待迁移 ID 清单），' +
      'NocoBase ERP 成熟后按此清单一键建集合+灌数据。调用即重建（读取 data/ 全目录，幂等）。',
    parameters: {},
    output: jsonRender(),
    async execute() {
      // 简单递归：按顶层目录分流，收集指定后缀文件
      const collect = (rootDir, ext) => {
        const out = []
        if (!existsSync(rootDir)) return out
        const walk = (p) => {
          for (const e of readdirSync(p, { withFileTypes: true })) {
            const full = join(p, e.name)
            if (e.isDirectory()) walk(full)
            else if (e.name.endsWith(ext) && !e.name.startsWith('_')) out.push(full)
          }
        }
        walk(rootDir)
        return out
      }
      const index = { spec_version: '1.0', generated_at: new Date().toISOString() }
      // 顾客（customers/*.json，排除照片目录）
      index.customers = collect(CUSTOMERS, '.json').map((f) => {
        const c = readJson(f) || {}
        const an = c.analysis || {}
        return {
          customer_id: c.customer_id, nickname: c.nickname,
          sex: c.basic_info?.sex, color_season: c.skin_tone?.color_season,
          confirmed_season: an.quiz?.confirmed_season, confirmed_primary: an.quiz?.confirmed_primary_type,
          photo_consent: c.privacy?.photo_consent,
          photo_reliability: an.photo_metrics?.reliable,
          archived: !!c.archived,
          file: f,
        }
      }).filter((c) => c.customer_id)
      // 诊断
      index.diagnoses = collect(DIAGNOSIS, '.json').map((f) => {
        const d = readJson(f) || {}
        const conf = (d.findings || []).filter((x) => x.confirmed).map((x) => x.dimension)
        return { diagnosis_id: d.diagnosis_id, customer_id: d.customer_id, issued_at: d.issued_at, all_confirmed: conf.length === 5, confirmed_dimensions: conf, verdict: (d.verdict || '').slice(0, 50), file: f }
      }).filter((d) => d.diagnosis_id)
      // 决策卡
      index.cards = collect(CARDS, '.md').map((f) => {
        const txt = readFileSync(f, 'utf-8')
        const cust = f.split('/').slice(-2, -1)[0]
        const head = txt.split('\n').filter((l) => l.startsWith('## '))
        return { card_id: f.split('/').pop().replace('.md', ''), customer_id: cust, file: f, desktop_copy: `~/Desktop/口袋决策卡-${cust}.md`, sections: head.map((h) => h.replace('## ', '')) }
      })
      // 服装
      index.garments = collect(garmentsRoot(), '.json').map((f) => {
        const g = readJson(f) || {}
        return { item_id: g.item_id, name: g.name, category: g.category, fits_body_types: g.matching?.fits_body_types, best_scenes: g.matching?.best_scenes, archived: !!g.archived, file: f }
      }).filter((g) => g.item_id)
      // 方案 + 反馈
      index.plans = collect(PLANS, '.json').map((f) => (readJson(f) || {}).plan_id || f.split('/').pop().replace('.json', ''))
      index.feedback_items = collect(FEEDBACK, '.json').map((f) => f.split('/').pop().replace('.feedback.json', '').replace('.json', '')).filter((x) => x && x !== '_summary')
      // 迁移清单（将来 NocoBase 一键建集合+灌数据用）
      index.migration_to_nocobase = {
        status: '未迁移（等 NocoBase ERP 成熟 + 商品属性智能体就绪）',
        target_collections: {
          customer_image_profiles: index.customers.map((c) => c.customer_id),
          garment_profiles: index.garments.map((g) => g.item_id),
          diagnosis_reports: index.diagnoses.map((d) => d.diagnosis_id),
          decision_cards: index.cards.map((c) => c.card_id),
        },
        fact_source_rule: '迁移后 NocoBase 为单一事实源，data/ 降级为缓存/备份（见 08.双智能体架构-接入NocoBase零售方案.md）',
      }
      writeFileSync(INDEX, JSON.stringify(index, null, 2), 'utf-8')
      return { ok: true, index: INDEX, counts: { customers: index.customers.length, diagnoses: index.diagnoses.length, cards: index.cards.length, garments: index.garments.length, plans: index.plans.length, feedback: index.feedback_items.length }, migration: index.migration_to_nocobase }
    }  })

  // ── 顾客档案 软删除/恢复/筛选（第 15 工具）──────────────────────────
  ctx.tools.register({
    name: 'stylist_customer_archive',
    description:
      '顾客档案筛选与软删除管理：action=archive（标记 archived=true，不再出现在筛选/匹配池，文件保留）/ ' +
      'action=restore（恢复）/ action=filter（按 sex、color_season、archived、search 过滤档案列表）。' +
      '软删除不物理删文件（迁移钩子需保留历史）；filter 用于工作台窗口 3 查询。',
    parameters: {
      action: { type: 'string', enum: ['archive', 'restore', 'filter'], required: true },
      customer_id: { type: 'string', description: 'archive/restore 必填' },
      sex: { type: 'string', enum: ['男', '女', '不区分'], description: 'filter 可选' },
      color_season: { type: 'string', description: 'filter 可选（如"冬季型"）' },
      archived: { type: 'boolean', description: 'filter 可选：true 只看已归档 / false 只看未归档 / 缺省=全部' },
      search: { type: 'string', description: 'filter 可选：模糊搜 customer_id / nickname' },
    },
    output: jsonRender(),
    async execute(args) {
      if (args.action === 'filter') {
        const results = []
        if (existsSync(CUSTOMERS)) {
          for (const f of readdirSync(CUSTOMERS)) {
            if (!f.endsWith('.json')) continue
            const c = readJson(join(CUSTOMERS, f))
            if (!c) continue
            if (args.sex && c.basic_info?.sex !== args.sex) continue
            if (args.color_season && c.skin_tone?.color_season !== args.color_season) continue
            if (typeof args.archived === 'boolean' && !!c.archived !== args.archived) continue
            if (args.search) {
              const q = args.search.toLowerCase()
              const hay = ((c.customer_id || '') + ' ' + (c.nickname || '')).toLowerCase()
              if (!hay.includes(q)) continue
            }
            results.push({
              customer_id: c.customer_id, nickname: c.nickname, sex: c.basic_info?.sex,
              color_season: c.skin_tone?.color_season, confirmed_season: c.analysis?.quiz?.confirmed_season,
              confirmed_primary: c.analysis?.quiz?.confirmed_primary_type,
              archived: !!c.archived, photo_consent: c.privacy?.photo_consent,
            })
          }
        }
        return { ok: true, action: 'filter', count: results.length, results }
      }
      // archive / restore
      const file = join(CUSTOMERS, `${args.customer_id}.json`)
      const customer = readJson(file)
      if (!customer) return { ok: false, error: `顾客 ${args.customer_id} 不存在` }
      customer.archived = args.action === 'archive'
      customer.updated_at = new Date().toISOString()
      writeFileSync(file, JSON.stringify(customer, null, 2), 'utf-8')
      return { ok: true, action: args.action, customer_id: args.customer_id, archived: customer.archived }
    },
  })

  // ── 决策卡 筛选/删除（第 16 工具）─────────────────────────────────────
  ctx.tools.register({
    name: 'stylist_card_manage',
    description:
      '决策卡管理：action=list（按顾客列出全部卡）/ action=delete（删除指定卡，同步清桌面副本）/ ' +
      'action=preview（返回卡面 MD 文本）。删除是真删除（.md 文件），历史卡版本可保留也可删。' +
      '配合 stylist_index_rebuild 重建索引。',
    parameters: {
      action: { type: 'string', enum: ['list', 'delete', 'preview'], required: true },
      customer_id: { type: 'string', description: 'list 可选（限定该顾客）；delete/preview 必填' },
      card_id: { type: 'string', description: 'delete/preview 必填（如 CARD-20261010-002）' },
    },
    output: jsonRender(),
    async execute(args) {
      const dir = args.customer_id ? join(CARDS, args.customer_id) : CARDS
      if (args.action === 'list') {
        const out = []
        const dirs = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []
        const scan = (p) => {
          for (const e of readdirSync(p, { withFileTypes: true })) {
            const full = join(p, e.name)
            if (e.isDirectory()) scan(full)
            else if (e.name.endsWith('.md')) {
              const cust = p.split('/').pop()
              const head = readFileSync(full, 'utf-8').split('\n').filter((l) => l.startsWith('## ')).map((h) => h.replace('## ', ''))
              out.push({ card_id: e.name.replace('.md', ''), customer_id: cust, file: full, sections: head })
            }
          }
        }
        if (existsSync(dir) && args.customer_id) scan(dir)
        else if (existsSync(CARDS)) scan(CARDS)
        return { ok: true, action: 'list', count: out.length, cards: out }
      }
      // delete / preview 都需 customer_id + card_id
      if (!args.customer_id || !args.card_id) return { ok: false, error: 'delete/preview 需 customer_id + card_id' }
      const file = join(CARDS, args.customer_id, `${args.card_id}.md`)
      if (args.action === 'preview') {
        if (!existsSync(file)) return { ok: false, error: `卡 ${args.card_id} 不存在（查 stylist_card_manage action=list）` }
        return { ok: true, action: 'preview', card_id: args.card_id, md: readFileSync(file, 'utf-8') }
      }
      // delete
      if (!existsSync(file)) return { ok: false, error: `卡 ${args.card_id} 不存在` }
      const del = []
      del.push(file)
      unlinkSync(file)
      // 同步清桌面副本（若该卡是该顾客最新卡）
      const desktop = join(`${WORKSPACE}`, `../../口袋决策卡-${args.customer_id}.md`)
      const desktopReal = join(homedir(), `Desktop/口袋决策卡-${args.customer_id}.md`)
      if (existsSync(desktopReal)) {
        unlinkSync(desktopReal)
        del.push(desktopReal)
      }
      return { ok: true, action: 'delete', card_id: args.card_id, customer_id: args.customer_id, deleted: del, hint: '已删，建议发"重建档案索引"刷新窗口3' }
    },
  })


  // 辅助：取该顾客最新一份诊断报告（按 diagnosis_id 排序）
  function latestDiagnosis(cid) {
    const d = join(DIAGNOSIS, cid)
    if (!existsSync(d)) return null
    const files = readdirSync(d)
      .filter((x) => x.endsWith('.json'))
      .sort()
      .reverse()
    for (const f of files) {
      const p = join(d, f)
      try {
        return JSON.parse(readFileSync(p, 'utf-8'))
      } catch {
        continue
      }
    }
    return null
  }

  // ── M4 反馈闭环：feedback/ 聚合 → 反向定制信号（供 CAO 创作侧读取）──────────────
  ctx.tools.register({
    name: 'stylist_feedback_summary',
    description:
      'M4 反馈闭环聚合（供 CAO 反向定制）：扫描 data/feedback/*.json，按 item_id 汇总信号分布（sold/returned/mismatch 计数）+ 顾客画像切片，' +
      '产出反向定制信号（正向单品可加库存/再设计；负向反哺 CAO 版型/色彩修正）。可落盘 data/feedback/_summary.json。',
    parameters: {
      top: { type: 'number', description: '正负信号各取 Top N（默认 5）' },
      save: { type: 'boolean', description: '是否落盘 _summary.json（默认 true）' },
    },
    output: jsonRender(),
    async execute(args) {
      const top = args.top || 5
      const save = args.save !== false
      const dir = FEEDBACK
      if (!existsSync(dir)) return { ok: false, error: `反馈目录 ${dir} 不存在（先有 feedback_save 数据）。` }
      const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'))

      const byItem = new Map()
      let totalRecords = 0
      for (const f of files) {
        let doc
        try {
          doc = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
        } catch {
          continue
        }
        const item = doc.item_id || f.replace(/\.feedback\.json$/, '').replace(/\.json$/, '')
        if (!byItem.has(item)) byItem.set(item, { signals: new Map(), customers: new Map(), notes: [] })
        const b = byItem.get(item)
        for (const rec of doc.records || []) {
          totalRecords++
          const sig = rec.signal || 'unknown'
          b.signals.set(sig, (b.signals.get(sig) || 0) + 1)
          const cust = rec.customer || {}
          const key = JSON.stringify([cust.customer_id, cust.body_type, cust.body_line, cust.color_season])
          if (!b.customers.has(key)) b.customers.set(key, cust)
          if (rec.note) b.notes.push(rec.note)
        }
      }

      const score = (b) => (b.signals.get('sold') || 0) - ((b.signals.get('returned') || 0) + (b.signals.get('mismatch') || 0))
      const ranked = [...byItem.entries()].map(([item, b]) => ({
        item_id: item,
        signals: Object.fromEntries(b.signals),
        net: score(b),
        customers: [...b.customers.values()].map((c) => ({ customer_id: c.customer_id, body_type: c.body_type, body_line: c.body_line, color_season: c.color_season })),
        notes: b.notes,
      }))
      const positives = ranked.filter((r) => r.net > 0).sort((a, b) => b.net - a.net).slice(0, top)
      const negatives = ranked.filter((r) => r.net < 0).sort((a, b) => a.net - b.net).slice(0, top)

      const insights = []
      for (const p of positives) {
        const c = p.customers[0] || {}
        insights.push(`✅ ${p.item_id} 净正向（sold ${p.signals.sold || 0}）：在 ${(c.color_season || c.body_line || c.body_type || '未知画像')} 顾客上成交 → 可加库存/同类再设计`)
      }
      for (const n of negatives) {
        insights.push(`⚠️ ${n.item_id} 净负向（退/不适配 ${((n.signals.returned || 0) + (n.signals.mismatch || 0))}）→ CAO 侧检查版型/色彩错配并修正设计`)
      }
      if (!insights.length) insights.push('当前反馈样本不足（净信号为 0 或 <2 条记录），暂不产定制信号，待积累。')

      const summary = {
        generated_at: new Date().toISOString(),
        total_items: ranked.length,
        total_records: totalRecords,
        positives,
        negatives,
        insights,
        rule: '正向=可加库存/再设计；负向=反哺 CAO 版型/色彩修正；CAO 侧定期读 _summary.json',
      }
      let saved_path = null
      if (save) {
        saved_path = join(dir, '_summary.json')
        writeFileSync(saved_path, JSON.stringify(summary, null, 2), 'utf-8')
      }
      return { ok: true, ...summary, saved_path }
    },
  })
}

// 导出渲染函数（单源：任何场景生成人读版报告都走这里，与工具落盘逻辑一致）
export const renderDiagnosisMd = buildReportMd