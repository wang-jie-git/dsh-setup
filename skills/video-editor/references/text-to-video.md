# 「文案→直接成片」自动化配方（text-to-video）

适用：**没有拍摄素材**（或素材不足）时，输入一段文案，自动产出可交付短视频。
借鉴来源：千雪AI「Codex 全自动剪辑」拆解（2026-08-29 学习笔记），取其"文案→配音→字幕→自动导出"流水线思路，落成本机可执行命令。

> 核心原则：**文案驱动**。每一句口播 = 一个画面卡 = 一段音频 = 一条字幕，全链路自动对齐，不需要人工对轨。

---

## 一、输入与输出

- **输入**：`scripts/voice-script.txt`（按句分段，每行一句，空行分章）
- **输出**：`output/final_v1.mp4`（默认 1080×1920 竖屏 9:16，可改横屏）
- **依赖**：edge-tts（配音+SRT）、ffmpeg、Pillow（文字卡）、可选 BGM

## 二、标准流水线（5 步）

```
文案 → ① 配音+字幕(edge-tts) → ② 逐句文字卡(Pillow) → ③ 按句时长切片(ffmpeg)
     → ④ 拼接+转场(xfade) → ⑤ BGM/调色/质检 → 成片
```

### ① 生成配音 + SRT 字幕

```bash
edge-tts --voice zh-CN-XiaoxiaoNeural --rate="+5%" \
  --text "$(cat scripts/voice-script.txt)" \
  --write-media build/edit/voice.mp3 \
  --write-subtitles build/edit/voice.srt
```

> 长文案：edge-tts 单次超长会截断。脚本按句分段后**逐句调用**再按序 concat，或保持 `--write-subtitles` 分段对齐。

### ② 生成逐句文字卡（Pillow PNG，竖屏 1080×1920）

```python
# make_text_cards.py —— 每句一个画面：背景渐变 + 大字 + 标题感
from PIL import Image, ImageDraw, ImageFont
import sys, os

W, H = 1080, 1920
script = open("scripts/voice-script.txt", encoding="utf-8").read().strip().splitlines()
lines = [l.strip() for l in script if l.strip()]
os.makedirs("build/edit/cards", exist_ok=True)
font = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 88)  # 大字
for i, text in enumerate(lines):
    img = Image.new("RGB", (W, H))   # 深色底
    # 简易渐变（顶暗底亮）
    for y in range(H):
        v = int(24 + 40 * y / H)
        for x in range(0, W, 4):
            img.paste((v, v+6, v+18), (x, y, x+4, y+1))
    d = ImageDraw.Draw(img)
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
    # 长句自动换行（每 10 字折行）
    if tw > W - 160:
        mid = len(text) // 2
        lines2 = [text[:mid], text[mid:]]
        y = H//2 - th
        for ln in lines2:
            bb = d.textbbox((0,0), ln, font=font); tw2 = bb[2]-bb[0]
            d.text(((W-tw2)//2, y), ln, font=font, fill=(255,255,255))
            y += th + 40
    else:
        d.text(((W-tw)//2, (H-th)//2), text, font=font, fill=(255,255,255))
    img.save(f"build/edit/cards/card_{i:03d}.png")
```

### ③ 按句时长切片（SRT 时间戳 → 每句视频片段）

```python
# parse_srt.py —— 从 voice.srt 提取每句 (start, end, text)，输出段落表
import re
srt = open("build/edit/voice.srt", encoding="utf-8").read()
blocks = re.split(r"\n\s*\n", srt.strip())
segs = []
for b in blocks:
    lines = b.strip().splitlines()
    if len(lines) < 3: continue
    m = re.match(r"(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)", lines[1])
    s = int(m.group(1))*3600 + int(m.group(2))*60 + int(m.group(3)) + int(m.group(4))/1000
    e = int(m.group(5))*3600 + int(m.group(6))*60 + int(m.group(7)) + int(m.group(8))/1000
    text = " ".join(lines[2:])
    segs.append((s, e-s, text))
# 输出 segments.tsv: start\tdur\ttext
with open("build/edit/segments.tsv", "w") as f:
    for s, d, t in segs:
        f.write(f"{s:.2f}\t{d:.2f}\t{t}\n")
```

逐片段生成（`-loop 1` 图片 → 视频，时长 = SRT 句长 + 0.4s 呼吸空间）：

```bash
while IFS=$'\t' read -r start dur text; do
  i=$((i+1))
  ffmpeg -y -hide_banner -loglevel error -loop 1 -i "build/edit/cards/card_$(printf %03d $((i-1))).png" \
    -t "$(echo "$dur + 0.4" | bc)" \
    -vf "fps=30,format=yuv420p" -c:v libx264 -preset medium -crf 18 \
    -an "build/edit/slices/slice_$(printf %03d $i).mp4"
done < build/edit/segments.tsv
```

### ④ 拼接 + 转场（xfade 淡入淡出链）

```python
# 生成 xfade 链（关键：offset 基于前段实际合并时长，每次 -DUR）
# 参见 ffmpeg-recipes.md / v3 成片脚本 /tmp/concat_v3.py 的同款逻辑
# 15 段实测：xfade duration=0.6，逐段 offset=prev_total-DUR
```

### ⑤ BGM / 调色 / 质检

- BGM：`bgm.wav` 循环到成片时长，`volume=0.25`，首尾 `afade` 2s（参考 tts-subtitles.md）
- 成片规格：1080×1920 / 30fps / H.264 CRF18 / AAC **48kHz**（防采样率静音坑）
- QC：时长≈配音时长±0.5s；字幕与语音对齐；音频非静音（volumedetect）

## 三、画面风格增强（按需）

| 档次 | 做法 | 成本 |
|---|---|---|
| 基础 | 深色渐变底 + 白字（上面代码）| 0 |
| 中档 | 背景用**免费 B-roll 图库**（Pixabay/Pexels 下载，loop 成背景 + 文字卡 overlay）| 下载时间 |
| 高档 | 文案对应**配图/示意图**（Pillow 组合图标+文字）| 制作时间 |
| 数字人 | HeyGen / 本地 SadTalker（未接入，需评估）| API 费/部署 |

## 四、任务路由判断

- **有拍摄素材** → 走主流程 planning.md（P0-P4 策划批准制）
- **无素材 / 只有文案** → 本配方（text-to-video）
- **文案 + 少量素材** → 混合：核心口播走本配方，间插素材 B-roll

## 五、质检清单（复用 qc-checklist.md）

- [ ] 视频时长 ≈ SRT 最后一句结束时间 ±0.5s
- [ ] 每句口播都能听见（volumedetect 分段非静音）
- [ ] 字幕文字与口播一致、无截断
- [ ] BGM 不盖过配音（配音 ≥ BGM +6dB）
- [ ] 导出格式：H.264 + AAC 48kHz、1080×1920