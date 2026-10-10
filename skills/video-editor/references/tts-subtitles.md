# TTS 配音 + 字幕配方（edge-tts）

适用于配音、旁白、字幕生成任务。edge-tts 是微软免费神经网络语音，**一步生成配音音频 + SRT 字幕**，无需 API key、无需联网配置。

## 快速上手（已验证 2026-08-28）

```bash
# 生成配音 + 字幕（一步到位）
edge-tts --voice zh-CN-XiaoxiaoNeural \
  --text "欢迎使用我们的新品。" \
  --write-media build/edit/voice.mp3 \
  --write-subtitles build/edit/voice.srt
```

输出：`voice.mp3`（配音）+ `voice.srt`（带时间戳的字幕）。

## 中文音色选择

| 音色 | 风格 | 适用 |
|---|---|---|
| `zh-CN-XiaoxiaoNeural` | 女声·温柔 | 旁白、教程、产品讲解 |
| `zh-CN-XiaoyiNeural` | 女声·活泼 | 少儿、短视频、广告 |
| `zh-CN-YunxiNeural` | 男声·沉稳 | 纪录片、新闻播报 |
| `zh-CN-YunyangNeural` | 男声·浑厚 | 预告片、史诗感 |
| `zh-CN-YunjianNeural` | 男声·磁性 | 情感、故事讲述 |

## 参数调节

```bash
# 语速（0.9 慢，1.1 快）
edge-tts --voice zh-CN-XiaoxiaoNeural --rate="+10%" ...

# 音调（-10Hz 低沉）
edge-tts --voice zh-CN-XiaoxiaoNeural --pitch="-10Hz" ...

# 音量（+50% 更响）
edge-tts --voice zh-CN-XiaoxiaoNeural --volume="+50%" ...

# 长文本自动分段（edge-tts 超长文本会截断；按句号分段多次调用后按序拼接）
```

## 合并配音到视频（工作流）

```bash
# 1. 生成配音 + 字幕
edge-tts --voice zh-CN-XiaoxiaoNeural --text "$(cat scripts/voice-script.txt)" \
  --write-media build/edit/voice.mp3 --write-subtitles build/edit/voice.srt

# 2. 合并视频 + 配音（保留原画面，替换声音；-shortest 对齐）
ffmpeg -y -i output/video_only.mp4 -i build/edit/voice.mp3 \
  -c:v copy -c:a aac -shortest -map 0:v -map 1:a output/final_v1.mp4

# 3. 烧录硬字幕（SRT → 画面）
ffmpeg -y -i output/final_v1.mp4 -vf "subtitles=build/edit/voice.srt:force_style='FontName=PingFang SC,FontSize=22'" \
  -c:v libx264 -crf 18 -c:a copy output/final_captioned.mp4
```

> ⚠️ macOS ffmpeg 的 subtitles 滤镜路径需转义 `:` → 用 `subtitles=filename='...'` 或改用 Pillow PNG overlay 方案（见 ffmpeg-recipes.md 第 8 节）。

## 完整"配音 + 字幕成片"模板

```bash
# 视频 30s，文案已备好，温柔女声
# 1. 配音
edge-tts --voice zh-CN-XiaoxiaoNeural \
  --text "$(cat scripts/voice-script.txt)" \
  --rate="+5%" \
  --write-media build/edit/voice.mp3 \
  --write-subtitles build/edit/voice.srt

# 2. 原视频压低音量 + 叠加配音
ffmpeg -y -i raw/clip.mov -i build/edit/voice.mp3 -filter_complex \
  "[0:a]volume=0.3[orig];[orig][1:a]amix=inputs=2:duration=first" \
  -c:v libx264 -crf 18 -c:a aac -shortest output/final_v1.mp4

# 3. 字幕渲染为 PNG 层叠加（更稳的中文方案，参见 ffmpeg-recipes.md §8）
#    或直接烧录 SRT
ffmpeg -y -i output/final_v1.mp4 -vf "subtitles=build/edit/voice.srt" \
  -c:v libx264 -crf 18 -c:a copy output/final_captioned.mp4
```

## 配音质量检查

- [ ] 音频时长 ≈ 视频时长（`ffprobe` 检查，`-shortest` 截断）
- [ ] 配音音色选对了（先给用户 2-3 个候选试听再定稿）
- [ ] SRT 时间戳与语音对齐
- [ ] 原声/配音/BGM 三路音量平衡（旁白最清晰）

## 备选 TTS（本地离线）

| 方案 | 特点 | 命令 |
|---|---|---|
| macOS `say` | 本地离线，音质一般 | `say -v Tingting -o out.m4a "文本"` |
| MOSS-TTS-Nano | 0.1B 开源模型，支持音色克隆，CPU 可跑 | `python infer.py --prompt-audio-path ref.wav --text "文本"`（未安装，需要时再装） |

优先用 edge-tts；需要**克隆特定人声**或**完全离线/隐私**时再考虑 MOSS-TTS-Nano。