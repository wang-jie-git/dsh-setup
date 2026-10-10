---
name: cutia-add-audio
description: >
  给 Cutia 视频剪辑工作台（dsh-timeline，127.0.0.1:4455）时间轴添加音频（音效/BGM/配音）的完整操作。
  当用户说"加音效、加背景音乐、配BGM、加配音、加一段雨声/风声/转场音、在工作台里放音频、把这首歌放到时间轴"，
  或需要把音频素材放进 Cutia 时间轴时触发。核心边界：Cutia agent 没有音效搜索工具，Freesound 英文音效
  只能走面板 UI 手动搜索；音频必须先进入项目媒体库，AI 才能用 add_audio_to_timeline 放上时间轴。
  本 skill 覆盖三条真实路径（已有音频→媒体库→AI 放置 / Freesound 面板手动 / TTS 配音），
  并给出 DSH 对话桥（postMessage dsh-command）指挥工作台 AI 的调用协议。
---

# Cutia 加音效 / BGM / 配音

给 Cutia 剪辑工作台时间轴添加音频的统一操作流程。2026-08-30 实测验证（Freesound 已配置成功）。

## 何时使用

- 用户要往视频里加**音效**（雨声/风声/转场/弹幕音）
- 用户要配 **BGM/背景音乐**（把某首曲子放到时间轴）
- 用户要加**配音/旁白**（TTS 或已有录音）
- 用户在 Cutia 工作台里操作，或让 DSH 指挥工作台完成

## 核心边界（先记住，避免无效路径）

1. **Cutia agent 工具里没有音效搜索工具**。Freesound 的英文音效搜索是**面板 UI 手动操作**（耳机图标 → Sound effects tab），AI 无法直接搜。
2. **`add_audio_to_timeline(mediaId, startTime?, duration?)` 只能放媒体库里已有的音频**。音频必须先进入项目媒体库（素材面板上传/导入），AI 才能把它放到时间轴。
3. **Songs 库是空壳**：Cutia 的 `type=songs` 后端返回 501 "Songs are not available yet"，永远没有歌。BGM 走"下载→导入→放置"路径，别期待 Songs。
4. **「加载更多」按钮无效**：是旧版构建残留的废 UI。音效列表是滚动触发的无限加载，**滚到底自动加载下一页**，别让用户点按钮。
5. Freesound 是**英文音效库**（无中文歌），名字是英文（rain/thunder/click）。用户看不懂没关系，AI 能理解英文标签。

## Workflow

### 路径 A：已有音频文件 → 媒体库 → AI 放置（推荐，用于 BGM/DSH 下载的音频）

```
1. 准备音频文件（mp3/wav）：
   - BGM：DSH 用 fetch-bgm 从 Freesound 下载无版权音乐（2026-08-30 实测可用）
         → fetch-bgm "ambient piano" 项目目录/bgm bgm.mp3   # 自动只挑 CC0/CC BY，绝不下侵权曲
   - 已有录音/素材：直接用
2. 进入 Cutia 媒体库：素材面板（文件夹图标）→ 上传文件或拖拽 mp3/wav 导入
   → 音频进入媒体库（MediaType 原生支持 audio）
3. 指挥工作台 AI 放上时间轴：
   - 用户在 DSH 对话里说"把 xxx 音频放到时间轴第 n 秒"
   - 或通过桥直接指挥（见下）
```

**DSH → 工作台 AI 调用协议（postMessage 桥）**：

```js
// 1. 获取 Cutia iframe
var frame = document.querySelector('iframe[title="Cutia 视频剪辑"]');
// 2. 发指令（text 用自然语言描述目标）
frame.contentWindow.postMessage(
  { type: "dsh-command", text: "把媒体库里的 rain.mp3 放到时间轴 3 秒处", requestId: String(Date.now()) },
  "*"
);
// 3. 响应
//    { type: "cutia-agent-state", payload: { status: "thinking"|"executing"|"idle", currentToolCall } }
//    { type: "cutia-command-result", ok: true|false, error? }
```

工作台 AI 内部会依次调：
- `list_media_assets` → 找到音频的 `mediaId`
- `add_audio_to_timeline({ mediaId, startTime, duration? })` → 放上时间轴

### 路径 B：Freesound 英文音效（面板手动，AI 无法代劳搜索）

```
1. 点左侧素材区【耳机图标】→ Sound effects tab
2. 输入英文关键词（rain / thunder / whoosh / transition / pop...）
3. 点音效右侧「+」→ 直接加入时间轴当前播放位置
4. 滚到底部自动加载更多（别点"加载更多"按钮，那是废 UI）
```

> 用户看不懂英文时：AI 帮翻译成英文关键词，或直接告诉用户"搜 rain 就是雨声"。

### 路径 C：TTS 配音（工作台 AI 直接生成）

```
用户要配音/旁白 → 让工作台 AI 用 generate_speech(text) 生成语音并放时间轴。
（DSH 侧更完整的链路是 edge-tts + SRT 一步生成，需要字幕走 DSH 侧）
```

## Rules

- **先入媒体库，才能 AI 放置**：`add_audio_to_timeline` 找不到 mediaId 会报 "Media asset not found"，先 `list_media_assets` 确认。
- 不要向用户推荐 Songs tab（空壳）或"加载更多"按钮（废 UI）。
- BGM 正解是 fetch-bgm（Freesound API，CC0/CC BY，实测可用）；yt-dlp 已被 YouTube bot 拦截、Pixabay 403，勿再走这两条（且 YouTube 曲目大概率侵权，商用视频禁止）。Freesound 只作音效补充。
- Freesound 音效商用：默认过滤已开（Show only commercially licensed），别关。
- 操作前先确认工作台已打开（DSH「剪辑」Tab，127.0.0.1:4455 有响应）。

## Verification

- [ ] 音频在媒体库（素材面板能看到该文件，类型 audio）
- [ ] 时间轴上出现音频块，能试听（点击播放有声音）
- [ ] 位置正确（startTime 生效）、时长正确（duration 或原始时长）
- [ ] 若指挥 AI 失败：检查桥的 `cutia-command-result.error`，拆成更小步骤重试
