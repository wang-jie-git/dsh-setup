---
name: video-editor
description: 视频剪辑统一编排 skill。整合本机全部视频能力（FFmpeg 简单剪辑/转码/滤镜/音频、Kdenlive + cli-anything-kdenlive 专业多轨剪辑、capcut-cli/cutcli 剪映草稿生成、edge-tts 配音、video_analyze/video_probe/video_ask 视频理解、**Cutia 剪辑工作台（dsh-timeline，可视化时间轴编排 + AI 剪辑助手 + Freesound 音效）**）为一条可执行的成片工作流。用户说"剪视频、剪辑、做短视频、配音、加字幕、配乐、调整色、拼接素材、裁剪片段、做封面、导出成片、**在工作台里剪、打开剪辑工作台、用时间轴编辑、加音效、配BGM、加背景音乐、加配音、加一段雨声/风声/转场音**"或交付任何视频剪辑任务时触发。先做[GATE-0]分类：识别任务类型 → 查记忆（memory_query）→ 查笔记（Obsidian 视频剪辑功能清单）→ 选工具链 → 再输出。
---

# 视频剪辑统一编排 Skill（video-editor）

整合本机全部视频能力为一套决策清晰、可执行的成片工作流。目标是：**接到需求 → 选对工具链 → 产出可交付成片（或可继续编辑的工程文件）**，不重复造轮子，不临时拼命令。

## 核心原则

1. **策划先行，批准后剪**：收到素材后先全量理解内容（probe + analyze 每个素材），再策划主题、制定剪辑方案，**呈现给用户请求修改/批准，批准后才执行剪辑**。见 `references/planning.md`。不盲剪。
2. **先分析后动手**：开工前必须用 `video_probe`/`video_analyze` 了解素材（时长、分辨率、编码、内容结构），不要盲目处理。
3. **按复杂度选工具链**：简单剪辑用 FFmpeg，专业多轨用 Kdenlive，需要用户继续手编用剪映草稿（capcut-cli），配音用 edge-tts，已有音频反向出字幕用 whisper（ASR），**无素材纯文案出片走 text-to-video 流水线**。绝不硬上重型工具。
4. **不可逆操作前先备份**：原始素材只读不改，所有中间产物放 `build/`，最终成片放 `output/`，按版本命名。
5. **出片前必过质检**：分辨率/时长/音频/字幕四项检查，见 `references/qc-checklist.md`。
6. **每轮工作后同步记忆**：把关键成品路径、使用参数、踩坑记录写入 memory（视频剪辑相关 tag），下次直接复用。
7. **画面编排优先派工作台**：需要"看到画面操作"的任务（时间轴排布、文字叠加、字幕生成、TTS、AI 生成素材、帧检查）→ 派给 Cutia 剪辑工作台 AI 助手；管线类任务（下载、转码、调色、ASR、GIF）→ DSH 自己用 FFmpeg/工具直接干。分工见「剪辑工作台执行层」。

## 强制阅读顺序（接到剪辑需求后按序加载）

### Step 0 — 必读 → [planning.md](references/planning.md)
**策划流程（P0-P4）**：先理解素材 → 策划主题 → 出剪辑方案 → 用户批准 → 才执行。计划型任务（收到素材做一条成片）必须先走完 P0-P3 拿到批准，不得直接开剪。

### ⭐ Step 0.5 — 先匹配【固定剪辑模式】→ [modes.md](references/modes.md)
**收到剪辑需求后，先看 `references/modes.md` 模式速查表（M1-M6）**：
| 模式 | 场景 |
|---|---|
| M1 图文成片 | 图片合集配乐 |
| M2 口播成片 | 文案直接出片 |
| M3 旅行/风光 Vlog | 手机素材拼接+调色（HDR 重灾区，含黑屏防护） |
| M4 营销短视频 | 产品图/卖点文案 → 营销片 |
| M5 快速加字幕 | 给视频烧录字幕 |
| M6 快速调色 | 滤镜风格化 |
**规则**：用户明说场景 → 直接匹配模式按已验证配方执行（禁止自由探索参数）；不确定 → 列出 M1-M6 让用户选。

### Step 1 — 必读 → [project-layout.md](references/project-layout.md)
项目目录结构（raw/converted/scripts/build/output），命名规范，版本管理。所有剪辑任务先建好目录骨架。

### Step 2 — 按任务类型选读一个配方文件
| 任务类型 | 读 |
|---|---|
| 简单剪辑：裁剪/拼接/转码/调色/滤镜/水印/GIF | [ffmpeg-recipes.md](references/ffmpeg-recipes.md) |
| 专业剪辑：多轨/转场/关键帧/复杂时间轴 | [kdenlive-recipes.md](references/kdenlive-recipes.md) |
| 生成剪映草稿：用户要在剪映里继续编辑 | [capcut-recipes.md](references/capcut-recipes.md) |
| 配音/旁白/字幕/配乐 | [tts-subtitles.md](references/tts-subtitles.md) |
| **已有音频/视频反向出字幕（ASR，whisper）** | [asr-subtitles.md](references/asr-subtitles.md) |
| **无素材/仅文案直接成片（文案→配音→文字卡→拼接→出片）** | [text-to-video.md](references/text-to-video.md) |
| 视频内容理解/找关键帧/时间定位 | 先看 `references/analysis.md`（引用 video_analyze/video_ask/video_probe） |

### Step 3 — 出片前必读 → [qc-checklist.md](references/qc-checklist.md)
交付检查清单：分辨率、码率、时长、音画同步、字幕、封面。

---

## 路由：先分类，再选工具链

接到剪辑需求，先做[GATE-0]分类声明（内部完成）：

1. **任务类型**：简单剪辑 / 专业剪辑 / 剪映草稿 / 配音字幕 / 视频分析 / 封面物料 / **文案直接成片（无素材）** / **ASR 反向字幕（已有音频→字幕）**
2. **查记忆**：`memory_query "视频剪辑"` 看有无历史成品与踩坑记录
3. **查笔记**：grep Obsidian `/Users/mac/Documents/ObsidianVault/2.项目/1.视频剪辑/1.视频剪辑功能清单.md`
4. **选工具链**：
   - 裁剪、拼接、转码、调色、滤镜、GIF、加水印 → FFmpeg（工具：`ffmpeg_cut`/`ffmpeg_concat`/`ffmpeg_encode`/`ffmpeg_gif`/`ffmpeg_subtitle`/`ffmpeg_extract` + bash 滤镜命令）
   - 多轨、转场、精细时间轴 → `cli-anything-kdenlive`（有状态 JSON 项目 → MLT XML → 渲染）
   - 用户要"在剪映里继续改" → capcut-cli / cutcli 生成草稿
   - 配音/旁白 → `edge-tts`（含 SRT 字幕一步生成）
   - **已有音频/视频要出字幕（ASR 反向）→ `whisper`**（本机已装，tiny/base/small 已缓存；中文小模型实测 0 错字，速度约 4.2× 音频时长；见 `references/asr-subtitles.md`）
   - **无拍摄素材、仅文案 → 文案直接成片流水线**：edge-tts 配音+SRT → Pillow 逐句文字卡 → ffmpeg 切片 → xfade 拼接 → BGM（见 `references/text-to-video.md`）
   - 理解视频内容 → `video_probe` → `video_analyze` → `video_ask`

## 剪辑工作台执行层（Cutia / dsh-timeline，2026-08-29 验证）

DSH 拥有一个**可视化剪辑工作台**（Cutia 编辑器内嵌于 DSH「剪辑」Tab）。它是 DSH 的"执行之手"：
工作台内的 **AI 剪辑助手** 暴露 20 个剪辑工具，通过 postMessage 桥接收 DSH 指令。

### 如何进入

- DSH 侧边栏「剪辑」Tab → 自动拉起 Cutia（`http://127.0.0.1:4455`）→ 打开/新建项目
- 项目打开后，右侧对话窗自动切换到绑定的 DSH 会话（用户可点「💬 绑定对话」选择会话）

### 分工路由表（核心决策）

| 任务类型 | 谁执行 | 为什么 |
|---|---|---|
| 时间轴编排（排布/移动/切点） | **工作台** | 可视化时间轴，DSH 无法"看到"画面 |
| 文字标题/叠加文字 | **工作台** `add_text_to_timeline` | 实时可视化位置/样式 |
| 自动字幕（从音频生成） | **工作台** `generate_captions` | 在工作台内直接落字幕轨 |
| TTS 配音（文本→语音） | **工作台** `generate_speech` | 生成后直接放时间轴 |
| AI 生成素材（图/视频/角色） | **工作台** `generate_image`/`generate_video` | 素材直接进项目管理 |
| 帧检查/视觉问答 | **工作台** `inspect_frame` | 直接看工作台画面 |
| 画布设置/项目信息 | **工作台** `get_project_info`/`update_project_settings` | 项目状态在那边 |
| 下载素材（抖音等） | DSH（douyin-video-download） | 工作台无下载能力 |
| 转码/裁剪/拼接/调色/滤镜/GIF | DSH（FFmpeg） | 工作台无 ffmpeg 命令行能力，DSH 更快 |
| ASR 反向字幕（已有音频→SRT） | DSH（whisper） | 工作台 `generate_captions` 只处理时间轴内音频 |
| 配音/旁白（edge-tts 全链路） | DSH（edge-tts） | 带 SRT 一步生成，工作台 TTS 只是单句 |
| 专业多轨剪辑 | DSH（cli-anything-kdenlive） | 深入参数级控制 |
| 成片渲染导出 | DSH（FFmpeg / kdenlive render） | 工作台无高性能导出管线 |

### 调用协议（DSH → 工作台 AI 助手）

```js
// 1. 获取 iframe（DSH「剪辑」Tab 内）
var frame = document.querySelector('iframe[title="Cutia 视频剪辑"]');

// 2. 发指令给工作台 AI 助手
frame.contentWindow.postMessage(
  { type: "dsh-command", text: "把第一段视频裁短并加上字幕", requestId: String(Date.now()) },
  "*"
);
// 3. 工作台响应（window message）：
//    { type: "cutia-agent-state", payload: { status: "thinking"|"executing"|"idle", currentToolCall } }
//    { type: "cutia-command-result", ok: true|false, error? }
```

**注意**：工作台 AI 助手能力受模型配置限制（目前在 DSH 侧配置 agnes-2.5-flash 等）。复杂指令可分解为多个 `dsh-command` 逐步执行。

### 工作台 20 工具速查

| 类 | 工具 |
|---|---|
| 项目 | `get_project_info` `update_project_settings` `list_media_assets` |
| 时间轴 | `get_timeline_state` `add_video_to_timeline` `add_audio_to_timeline` `add_text_to_timeline` `update_element` `move_element` `delete_element` |
| 字幕/语音 | `generate_captions` `generate_speech` |
| AI 生成 | `generate_image` `generate_video` `list_characters` `get_character_details` `update_character_style` `analyze_character_appearance` |
| 检查 | `inspect_frame` `switch_expert_role` |

### AI 加音效 / BGM / 配音（2026-08-30 验证，Freesound 已配置）

**核心边界（先记住，避免无效路径）**：
1. **Cutia agent 工具没有音效搜索工具**。Freesound 英文音效搜索是**面板 UI 手动操作**（耳机图标 → Sound effects tab），AI 无法直接搜。
2. **`add_audio_to_timeline(mediaId, startTime?, duration?)` 只能放媒体库里已有的音频**。音频必须先进入项目媒体库（素材面板上传/导入），AI 才能放上时间轴。
3. **Songs 库是空壳**：Cutia `type=songs` 返回 501 "Songs are not available yet"，永远没歌。BGM 走"下载→导入→放置"路径，别期待 Songs。
4. **「加载更多」按钮是旧版废 UI**：音效列表是**滚动触发**的无限加载，滚到底自动加载下一页，别让用户点按钮。
5. Freesound 是**英文音效库**（rain/thunder/whoosh/transition/pop…），无中文歌。用户看不懂英文没关系，AI 能理解英文标签，帮翻译成英文关键词即可。

**路径 A：已有音频文件 → 媒体库 → AI 放置（推荐，BGM / DSH 下载的音频）**
```
1. 准备音频文件（mp3/wav）：
   - BGM：DSH 用 fetch-bgm 从 Freesound 下载无版权音乐（2026-08-30 实测可用，替代已失效的 yt-dlp/Pixabay）
         → fetch-bgm "ambient piano" 项目目录/bgm bgm.mp3   # CC0/CC BY，自动挑许可
         → 或用 FFmpeg 从源视频提取环境音（见 text-to-video.md 的 BGM 段）
   - 已有录音/素材：直接用
2. 进入 Cutia 媒体库：素材面板（文件夹图标）→ 上传/拖拽 mp3/wav 导入 → 音频进入媒体库（MediaType 原生支持 audio）
3. 指挥工作台 AI 放上时间轴（postMessage 桥，协议见上节）：
   frame.contentWindow.postMessage(
     { type: "dsh-command", text: "把媒体库里的 rain.mp3 放到时间轴 3 秒处", requestId: String(Date.now()) },
     "*"
   );
   工作台 AI 内部自动调：list_media_assets 找 mediaId → add_audio_to_timeline({ mediaId, startTime, duration? })
```

**路径 B：Freesound 英文音效（面板手动，AI 无法代劳搜索）**
```
1. 点左侧素材区【耳机图标】→ Sound effects tab
2. 输入英文关键词（rain / thunder / whoosh / transition / pop...）
3. 点音效右侧「+」→ 直接加入时间轴当前播放位置
4. 滚到底部自动加载更多（别点"加载更多"按钮，那是废 UI）
```

**路径 C：TTS 配音**：让工作台 AI 用 `generate_speech(text)` 生成语音放时间轴（DSH 侧更完整链路是 edge-tts + SRT 一步生成，需字幕走 DSH 侧）。

**加音效 Rules**：先入媒体库才能 AI 放置（`add_audio_to_timeline` 找不到 mediaId 报 "Media asset not found"，先 `list_media_assets` 确认）；不推荐 Songs tab 与"加载更多"按钮；Freesound 只作音效补充，BGM 用 fetch-bgm（Freesound API，CC0/CC BY，实测可用；yt-dlp 已被 YouTube bot 拦截、Pixabay 403，勿再走这两条）；Freesound 商用过滤（Show only commercially licensed）默认开着别关；操作前确认工作台已打开（DSH「剪辑」Tab / 127.0.0.1:4455 有响应）。

### 分工时机（GATE-0 时判断）

- 用户在**工作台内**操作（已在「剪辑」Tab）→ 优先派工作台
- 用户给素材+文字要求 → 混合：DSH 先下载/转码 → 工作台排布 → DSH 渲染
- 纯管线任务 → DSH 直接干，不打扰工作台
- 不确定时：先 `get_project_info`/`get_timeline_state` 看工作台现状再决策

## AI 专家角色编排层（借鉴 Cutia Expert Roles，2026-08-29 集成）

在 GATE-0 分类后，按任务阶段切换"专家角色"——每个角色有专属视角与检查清单；多阶段成片任务由导演(Director)自动编排。**复用同一套工具链**（ffmpeg/Kdenlive/whisper/edge-tts），不新增工具，只换思考与汇报方式。

### 角色定义

| 角色 | 专注 | 触发场景 |
|---|---|---|
| storytelling 叙事导演 | 主题、钩子、叙事线、情感弧线 | 无文案、需策划整片 |
| editing 剪辑顾问 | 节奏、转场、镜头衔接、时间线结构 | 多素材组装、成片结构 |
| audio 音频顾问 | 混音、字幕、配音、BGM、音画同步 | 配音/字幕/配乐/音效 |
| design 设计顾问 | 视觉构图、色调、文字卡、封面 | 调色/封面/标题排版 |
| general 通用助手 | 兜底，按需调用 | 简单明确指令 |

### Director 标准编排（7 阶段，仅复杂成片任务走全流程）

1. Pre-production（storytelling 出主题/钩子/叙事线）
2. Setup（design 定画面基调）
3. 素材理解（general：video_probe + video_analyze 全量理解）
4. 时间线组装（editing：切点/顺序/转场/节奏）
5. 文字与标题（design：字幕/文字卡/封面）
6. 音频（audio：配音/BGM/音画同步）
7. 终检（editing：qc-checklist 逐项过）

### 应用规则

- 阶段切换 = 输出 `[角色: xxx]` 声明 + 该角色专属检查项；**不改变**现有 GATE-0/策划/批准/执行流程
- 单一指令（如"剪 0:10-0:20 加乐"）无需切角色，general 直接执行
- 复杂成片任务按 7 阶段自动编排，每阶段向用户汇报一次进度
- **工作台无需 DSH 指挥切角色**：Cutia 工作台 AI 助手运行于 Director(auto) 模式，会在任务执行中自动 switch_expert_role（故事导演→编辑→音频→设计，基于实际时间轴状态判断阶段）。DSH 侧的角色切换只是对话视角；**不要**再手动向工作台下发 switch_expert_role 指令，避免重复指挥。

---

## 标准工作流（高层视图）

```
[GATE-0] 分类 + 查记忆 + 查笔记
   ↓
P0 素材全量理解（video_probe + video_analyze 每个素材，产出 media-manifest.md）
   ↓
P1 内容盘点与主题策划（提炼主题/钩子/叙事线，产出 brief.md）
   ↓
P2 制定详细剪辑方案（镜头表 shot-plan.json + 章节 + 配音/字幕/BGM 计划，产出 edit-plan.md）
   ↓
P3 呈现方案给用户 → 请求修改 → 批准（硬性门禁，未批准不执行）
   ↓
P4 批准后执行：
   1. 建目录骨架（project-layout.md）
   2. 按任务类型选配方（ffmpeg / kdenlive / capcut / edge-tts / whisper-ASR）
   3. 生成片段 → 拼接 → 配音字幕 → 调色 → 导出
   4. 质检（qc-checklist.md 逐项检查）
   5. 交付（输出路径 + 参数 + 结果）
   6. 写记忆（成品路径、方案、踩坑 → memory_write，tags 含"视频剪辑"）
```

> 明确单一指令（如"剪 0:10-0:20 加乐"）可跳过 P1-P2 直接从 P0 后执行；计划型成片任务必须走 P0-P3 批准流程。详见 references/planning.md。
> **无素材纯文案出片**：文案驱动，走 `references/text-to-video.md`（edge-tts 配音+SRT → Pillow 逐句文字卡 → ffmpeg 切片 → xfade 拼接 → BGM → 成片），口播文案本身即方案，无需 P0-P3 素材策划，但配音音色/风格仍需用户确认。

---

## 环境事实（2026-08-29 验证）

| 能力 | 状态 | 入口 |
|---|---|---|
| FFmpeg | ✅ 已装 | 工具 `ffmpeg_*` + bash |
| Kdenlive | ✅ 已装 | `/Applications/kdenlive.app/Contents/MacOS/kdenlive` |
| cli-anything-kdenlive | ✅ 已装 | `/Users/mac/.local/bin/cli-anything-kdenlive` |
| edge-tts | ✅ 已装 | `/usr/local/bin/edge-tts` |
| **fetch-bgm（Freesound BGM 下载）** | ✅ 已装可运行 | `/usr/local/bin/fetch-bgm`（Freesound API，CC0/CC BY，替代失效的 yt-dlp/Pixabay） |
| **Cutia 剪辑工作台** | ✅ dsh-timeline 插件 | DSH「剪辑」Tab / `http://127.0.0.1:4455`；AI 助手 20 工具走 postMessage 桥 |
| capcut-cli | ⚠️ 未装 | `npm install -g capcut-cli`（node v24 已就绪） |
| cutcli | ⚠️ 未装 | `curl -s https://cutcli.com/cli \| bash` |

**capcut-cli / cutcli 未安装时**：如任务需要剪映草稿，先安装；如用户当前剪辑不需要剪映草稿，走 FFmpeg/Kdenlive 即可，不要为了装而装。

---

# 输出要求

- 每个任务交付时报告：**产物路径、使用的命令/参数、质检结果、下一步建议**
- 若需要用户确认方向（如配音音色、字幕风格、色调），先给 2-3 个候选再执行
- 产物一律放 `output/`，命名 `final_v1.mp4`、`final_v2.mp4` 等，不覆盖旧版本
- 涉及用户文件时先 probe 再动，绝不盲目覆盖原始素材