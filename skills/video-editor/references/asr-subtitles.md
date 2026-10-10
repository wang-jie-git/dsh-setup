# ASR 反向字幕配方（whisper）

适用：**已有音频/视频，需要生成字幕**的任务（反向字幕）。与 `tts-subtitles.md` 的 edge-tts 互补——edge-tts 是「文本→语音」，本配方是「语音→文本」，两者形成完整字幕闭环。

## 一、环境事实（2026-08-29 实测）

| 项 | 值 |
|---|---|
| 安装位置 | `/usr/local/bin/whisper`（Homebrew `openai-whisper`）|
| 已缓存模型 | `~/.cache/whisper/` → **tiny.pt / base.pt / small.pt** |
| 运行环境 | CPU FP32（无 GPU，FP16 会自动回退并警告）|
| **速度基准** | **small 模型：10.9s 音频 → 45.8s 处理 ≈ 4.2× 音频时长（冷启动含模型加载）；60.7s 音频 → 50.7s 处理 ≈ 0.83×（热运行）** |
| 中文准确率 | **small 实测 0 错字**（仅标点为英文逗号，需后处理）|

> ⏱️ 时间预估：60s 视频 ≈ 250s，5min 视频 ≈ 18min，10min 视频 ≈ 37min。长视频建议先分段或用 tiny/base 快速出稿。

## 二、模型选择

| 模型 | 大小 | 速度 | 中文准确率 | 建议场景 |
|---|---|---|---|---|
| `tiny` | 39MB | ~2× | 中等 | 快速出稿、草稿、嘈杂音频 |
| `base` | 139MB | ~3× | 中上 | 通用默认 |
| `small` | 244MB | ~4.2× | **高（实测 0 错字）** | **中文正式字幕首选** |
| `medium`/`large` | 需联网下载 | 更慢 | 最高 | 极难音频、多口音 |

**推荐默认**：`--model small`（中文准确率与速度平衡最佳，已缓存）

## 三、三种标准用法

### 场景 A：已有音频 → SRT 字幕

```bash
mkdir -p build/edit
whisper input.mp3 \
  --model small --language zh \
  --output_format srt \
  --output_dir build/edit \
  --temperature 0 \
  --initial_prompt "这是一段中文旁白。"
# → build/edit/input.srt
```

### 场景 B：视频 → SRT 字幕（先提音频）

```bash
# 1. 提取音频
ffmpeg -y -hide_banner -loglevel error -i input.mp4 -vn -ac 1 -ar 16000 -c:a pcm_s16le build/edit/audio.wav
# 2. ASR
whisper build/edit/audio.wav --model small --language zh --output_format srt --output_dir build/edit --temperature 0
# 3. 烧录字幕（Pillow PNG 方案，见 ffmpeg-recipes.md §8，中文更稳）
```

### 场景 C：与 edge-tts 互补（完整字幕闭环）

```
【生成方向】文案 → edge-tts → 语音 + SRT（已知文案，直接生成）
【识别方向】语音 → whisper → SRT（未知文案/已有录音，反向识别）
```

## 四、后处理（必需）

whisper 输出有三个已知问题，交付前必须处理：

### 1. 英文逗号 → 中文标点

```python
# fix_punctuation.py — ⚠️ 必须跳过时间戳行，否则 SRT 时间轴会失效
import re, sys
path = sys.argv[1]
lines = open(path, encoding='utf-8').read().splitlines()
out = []
for line in lines:
    # 时间戳行（00:00:00,000 --> 00:00:02,000）和序号行保持原样
    if re.match(r'^\s*\d{2}:\d{2}:\d{2},\d{3}', line):
        out.append(line); continue
    if re.match(r'^\s*\d+\s*$', line):
        out.append(line); continue
    # 只有文本行做标点替换
    line = line.replace(',', '，').replace('.', '。').replace('!', '！').replace('?', '？')
    line = re.sub(r'\s+([。！？])', r'\1', line)
    out.append(line)
open(path, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
```

### 2. 分句过粗（短句被合并）

实测：edge-tts 5 句连续配音，whisper 把前两句合并成一段（`你是我最重要的人,每一步都走向你。`）

修复策略：
- **能拆则拆**：合并句里若有明显停顿，按顿号/分号重新分段
- **不能拆则调参**：加 `--word_timestamps --max_line_width 30 --max_line_count 2` 限制单段长度（⚠️ `--max_line_width` 必须配合 `--word_timestamps`，否则 whisper 报参数错误）
- **终极方案**：`--word_timestamps` + 按能量谷底手动分段（`ffmpeg silencedetect`）

### 3. 时间戳精度

whisper 的分段是秒级近似，若需精确到帧：
```bash
whisper ... --word_timestamps
# 输出 tsv 含词级时间戳，可精确重建 SRT
```

## 五、质检清单（复用 qc-checklist.md）

- [ ] 文字准确率：逐句人工核对（0 错字为交付标准）
- [ ] 标点：已修正为中文标点
- [ ] 分句：每段 ≤ 15 字，无超长合并句
- [ ] 时间轴：字幕与语音基本对齐（误差 ≤ 0.5s）
- [ ] 时长：SRT 总时长 ≤ 音频时长

## 六、任务路由判断

| 场景 | 用什么 |
|---|---|
| 我有文案，要出配音和字幕 | `tts-subtitles.md`（edge-tts 一步出 mp3 + SRT）|
| 我有录音/视频，要出字幕 | **本配方（whisper）** |
| 我要改已有 SRT 的文字 | 直接编辑 SRT + 重新烧录 |
| 我要语音转文字做文稿 | whisper `--output_format txt` |
| 视频已有字幕流要提取 | `ffmpeg_extract --what subtitle`（不用 whisper）|

## 七、已知限制

- **CPU 运行**：冷启动约 4.2× 音频时长，热运行约 0.83×，长视频注意时间预算（60s 视频≈1-4 分钟）
- **标点为英文**，需后处理
- **分句可能过粗**，短句会被合并
- **无声视频会报错**，先确认有音轨
- 不支持 GPU 加速（本机无 CUDA），medium/large 模型不建议

## 八、性能优化建议

```bash
# 并行处理多段（长视频分段后并行跑）
split_video.sh video.mp4 600  # 每 10min 一段
for f in part_*.mp4; do whisper "$f" ... & done; wait

# 降低精度换速度（草稿场景）
whisper ... --model base --temperature 0 --best_of 1 --beam_size 1

# 利用条件文本提升准确率（已知领域词汇）
whisper ... --initial_prompt "这是婚礼相关的中文旁白，包含：新郎、新娘、父亲、余生。"
```