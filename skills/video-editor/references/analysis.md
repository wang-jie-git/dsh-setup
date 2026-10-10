# 视频分析配方（video_analyze / video_probe / video_ask）

适用于剪辑前理解素材内容、找关键帧、时间定位、ASR 转写等任务。

## 工具用途

| 工具 | 用途 | 什么时候用 |
|---|---|---|
| `video_probe` | 元数据：时长/分辨率/帧率/编码/音轨/字幕流 | 任何视频任务的第一步 |
| `video_analyze` | 内容理解：场景变化、抽帧、ASR 转写、屏幕文字、高光时刻 | 想知道视频里发生了什么 |
| `video_ask` | 时间锚定问答：定位"第几分钟说了什么/出现了什么" | 需要具体时间点证据 |

## 用法

```bash
# 1. 先探测（了解基本盘）
video_probe path/to/video.mp4

# 2. 内容分析（可带聚焦问题）
video_analyze path/to/video.mp4 --question "这段视频讲了什么？有哪些关键场景？"

# 3. 时间锚定问答
video_ask path/to/video.mp4 "第 2 分钟他说了什么？"
video_ask path/to/video.mp4 "关于价格的内容出现在什么时间？"
```

## 在剪辑工作流中的位置

```
video_probe（元数据）→ video_analyze（内容结构/ASR/场景）→ video_ask（定位具体镜头）
        ↓
根据分析结果制定镜头表（scripts/shot-plan.json）
        ↓
执行编辑（FFmpeg / Kdenlive / capcut）
```

## 典型应用

1. **素材盘点**：多个素材逐个 `video_probe`，确定哪些值得剪
2. **内容结构**：`video_analyze` 获取场景列表 + ASR 转写，写镜头表
3. **高光时刻**：`video_ask "哪个镜头最精彩"` 定位后精确裁剪
4. **字幕准备**：`video_analyze` 的 ASR 转写可作为 SRT 基础（再人工校对）
5. **找封面**：`video_ask "哪个画面适合做封面"` 定位后抽帧

## 注意

- 长视频分析较慢，先 probe 确认时长再决定分析策略
- ASR 转写可能有误，重要字幕需校对
- 分析结果只作参考，最终剪辑判断以用户需求为准