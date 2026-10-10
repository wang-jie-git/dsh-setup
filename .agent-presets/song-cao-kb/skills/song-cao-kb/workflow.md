# 宋式美学 CAO 三轨纠偏工作流（SOP）

> 何时读：评估图片、审核产出、对创作提建议之前，先按此 SOP 走一遍。
> 工具来源：🔵 量化层与 🟢 AI 评分层由 `song_cao_quant` / `song_cao_ai_score` 工具（或 cao-eval.sh 脚本）提供；🔴 规则层依据 SKILL.md 逐条执行。

## 触发场景

1. 用户提供图片要求"宋韵评估 / 打分 / 审图"
2. 用户提供创作方案（海报/服装/插画）要求"纠偏 / 建议"
3. 批量打标金标数据集
4. 用户要求"生成某款（西装/风衣/卫衣/工装裤/阔腿裤/衬衫/连衣裙/针织衫）的图片提示词"
   → 走下方「生成款图流程」，先问/判 `design_mode`（standard 合规进打样 / differentiation 商业张力）
5. 用户给**简短描述词**（如"宋式 职业 裙 禅意""唐式 汉服 庆典"）且说"帮我写提示词/我不知道怎么描述"
   → 走下方「自由核心词生成流程」（提示词增强器，SKILL.md §14.10）

## 自由核心词生成流程（提示词增强器）

1. 调 `song_cao_enhance_prompt keywords="<用户原词>"`（空格分隔，支持朝代/品类/气质/场景词）
2. 引擎自动：命中 8 款 → 复用款数据 + 气质词修饰；未命中 → lexicon 自由翻译 4 段式
3. 把返回的 `prompt` 交给生图（`generate_cmd`），出图后跑 `check_cmd` 校验
4. fail → 按修正指令改词重生成；pass → 记录可复用（可建议把新气质词回填 lexicon）
5. 用户只有 1-2 个词且很模糊 → **先反问补齐**（想要什么品类/什么气质/什么场景），再增强

## 参考图学习流程（song_cao_image2prompt，SKILL.md §14.11）

1. 用户丢一张"一眼不一样"的图 → 调 `song_cao_image2prompt imgpath=<路径>`
2. 拿到 4 维设计逻辑（结构/比例/色彩/留白）+ 4 段式可复用模板 + 词库回填建议
3. 模板翻译/改写为 CA0 风格后，可直接喂 `song_cao_enhance_prompt` 或生图
4. 判断 `lexicon_suggestion` 是否值得回填：新意象 → `abstraction-filter.json`；新气质词 → `aesthetic-lexicon.json`（人工确认后写，保持可审计）
5. 大图自动降采样 256px（脚本内置）；仍超时则人工描述

## 生成款图流程（design_mode 三模式，SKILL.md §十四）

1. **选模式**（先确认意图，避免默认走错）：
   - 用户说"打样 / 生产 / 电商主图 / 合规" → `design_mode=standard`
   - 用户说"营销图 / 概念设计 / 首秀 / 差异化 / 抓眼球" → `design_mode=differentiation`
   - 用户说"高级感 / 品牌调性 / 概念款 / 抽象 / 写意 / 神似" → `design_mode=abstract`（再问意象源：残山剩水/寒江独钓/水图）
   - 用户没明说 → **必须问一句**，不要替用户默认（合规口径不同，误判代价高）
2. **取提示词包**：调 `song_cao_style_prompt style=<款名> design_mode=<模式> scene=<consumer|dark_structure> [imagery=<意象id>]`
   - 返回：正向/负向提示词 + agnes 生图命令 + 四维校验命令 + 降饱和命令 + 差异化/意象审查建议 + 该款已有 validation/doubao_validation
   - 深色结构款（工装裤等）用 `scene=dark_structure`；浅色款用 `consumer`
   - abstract 模式：先 `song_cao_style_prompt style=<款> design_mode=abstract` 拿意象列表，再带 `imagery` 重调
3. **生图**：用返回的 `generate_cmd`（或把 prompt 交给用户手动复制到豆包 App）
4. **校验**：用返回的 `check_cmd`（`song-yun-deviate.py --scene <scene> --structure --pattern <款名>`；abstract 模式 `--vision` 无 `--structure`，用意象命中软提示）
5. **色彩超标（豆包图常见）**：用返回的 `desat_cmd` 二次降饱和，再复跑校验
6. **回填**：双绿后把结果写回 `pattern-translation.json` 该款 `validation` / `doubao_validation`，并同步矩阵 `style-translation-matrix.md`
7. **合规后增值**（standard pass 后）：提示可切 `differentiation` 做商业升级，或 `abstract` 做高级感概念款，报告填第 5b 节
8. **abstract 红线**：意象源首选水墨系（残山剩水），禁青绿山水搬用色彩；禁传统元素词汇（花鸟/刺绣/盘扣…）；量化轨仍须 pass

## 标准流程（图片评估）

1. **范式判定**（SKILL.md §二）：先判北宋全景 or 南宋边角，再定校验口径
2. **🔵 量化层**：调 `song_cao_quant <图片路径>`
   - 比对金标基线（SKILL.md §一量化参照表）
   - 越界特征 → 记入"偏离金标分布"项
3. **🟢 AI 评分层**：调 `song_cao_ai_score <图片路径>`
   - 1–10 分；< 5.0 → 画面整体质量存疑，重点检查
   - 注意：这是通用美学分，非宋韵专属；仅作参照，不单独裁定
4. **🔴 规则层**：逐项对照 SKILL.md §一~§三·五（色彩/构图/元素/装裱/形制）
5. **意境层**：综合气韵/文人气/虚实相生（SKILL.md §七）
6. **输出**：按 SKILL.md §八 评分标尺给 0–100 分，标注偏差级别（§十），输出格式：
   - 范式判定
   - 逐项结果（✅ 合规 / ⚠️ 偏差，引用条款）
   - 偏差说明（一句话）
   - 修改建议（参数级）
   - 宋韵评分（0–100）

## 一键版

`bash /Users/mac/Desktop/宋式美学智能体/cao-eval.sh <图片路径>`
（三轨全跑，含 headless 规则层；输出为原始报告，仍需按上方输出格式整理）

## 批量打标

- 每张图片：范式 + 色彩 + 构图 + 元素 标签（见 golden-dataset/labels 模板）
- 量化层：analysis/batch_metrics.py；评分层：analysis/batch_score.py

## 语言风格要求

优雅、含蓄、专业，像艺术策展人一样对话。举例：
"此款领口设计若改为'圆领对襟'，是否更能体现宋式那种温润内敛的文人气质？"
