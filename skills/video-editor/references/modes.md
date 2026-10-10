# 固定剪辑模式库（modes）— DSH 视频剪辑一键成片

> 2026-08-30 建立。参考剪映/Seedream「热门工具」模式设计 + 本机实测验证的能力。
> **核心思想**：告别"每次从零猜参数"，用户说一个场景 → 直接匹配固定模式 → 按已验证的配方执行。
> 每个模式都经过实测（✅ 标记），禁止在模式外自由探索 ffmpeg 参数（除非模式明确允许）。

---

## 模式速查表

| # | 模式名 | 触发词（用户说） | 输入 | 输出 |
|---|---|---|---|---|
| M1 | **图文成片** | 图文成片、图片做成视频、照片合集配乐 | 多张图片 + 可选文案 | 1080×1920 竖屏 MP4 |
| M2 | **口播成片** | 口播、文案成片、文字转视频、一键成片 | 一段文案（txt） | 1080×1920 竖屏 MP4 |
| M3 | **旅行/风光 Vlog** | 旅行、风景、夜景、vlog、素材拼接 | 手机 MOV/MP4 素材集 | 1920×1080 横屏 MP4 |
| M4 | **营销短视频** | 营销、推广、带货、产品宣传 | 产品图/素材 + 卖点文案 | 1080×1920 竖屏 MP4 |
| M5 | **快速加字幕** | 加字幕、字幕、文案字幕 | 视频 + 字幕文本/SRT | 原视频 + 烧录字幕 |
| M6 | **快速调色** | 调色、调滤镜、电影感、风格化 | 任意视频 | 调色后视频 |

---

## M1 图文成片（照片合集配乐）

**触发**：用户给一批图片 +（可选）文案，要求"做成视频/配乐/图文成片"。
**风格**：每张图 3-5 秒，Ken Burns（缓慢推拉）动效 + 交叉淡化转场 + BGM。

```bash
# 0) 统一图片规格 1920×1080（或竖屏 1080×1920）
for f in img/*.jpg; do
  ffmpeg -y -i "$f" -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1" "build/img/$(basename "$f")" 2>/dev/null
done

# 1) 每张图生成 4 秒片段（缓慢放大 Ken Burns）
for i in $(seq 1 N); do
  ffmpeg -y -loop 1 -i "build/img/img$i.jpg" -t 4 -r 30 \
    -vf "zoompan=z='min(zoom+0.0008,1.15)':d=120:s=1920x1080:fps=30" \
    -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p "build/seg/img$i.mp4"
done

# 2) 拼接 + 交叉淡化（xfade）
# concat 用 xfade 链，转场 0.5s；参见 ffmpeg-recipes.md 拼接章

# 3) BGM：fetch-bgm（强制 CC0/CC BY）
fetch-bgm "ambient cinematic" build/audio bgm.mp3

# 4) 混音 + 导出
ffmpeg -y -i "build/final_noaudio.mp4" -i "build/audio/bgm.mp3" \
  -filter_complex "[1:a]volume=0.3,afade=t=in:st=0:d=2,aformat=channel_layouts=stereo[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k out.mp4
```

**✅ 实测能力**：Ken Burns(zoompan)、xfade、fetch-bgm 均已验证。

---

## M2 口播成片（文案直接出片）

**触发**：用户给一段文案（无拍摄素材）→ "做成视频/一键成片"。
**注意**：**已有完整配方** `references/text-to-video.md`，本模式是其速查入口。
**流程**：文案分段 → edge-tts 配音+SRT → Pillow 文字卡 → ffmpeg 按句切片 → xfade 拼接 → BGM → 导出。

```bash
# 速查（细节见 text-to-video.md）
edge-tts --voice zh-CN-XiaoxiaoNeural --text "$(cat scripts/voice-script.txt)" \
  --write-media build/edit/voice.mp3 --write-subtitles build/edit/voice.srt
# → Pillow 逐句文字卡 → ffmpeg 切片 → xfade → fetch-bgm → 成片
```

**✅ 实测能力**：edge-tts 已装可用（`/usr/local/bin/edge-tts`）。

---

## M3 旅行/风光 Vlog（手机素材拼接 + 调色）⭐ 核心模式

**触发**：用户给一批手机 MOV/MP4（旅行/夜景/风景）→ "素材拼接/成片/vlog"。
**⚠️ 本模式是黑屏事故重灾区，必须严格按步骤**：

```bash
# 0) 【强制】先探测所有素材 color_space
for f in raw/*.MOV raw/*.mp4; do
  echo "$f: $(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt,color_space -of csv=p=0 "$f")"
done
# 含 bt2020* → 素材是 HDR，按 HDR→SDR 管线处理（见 ffmpeg-recipes.md HDR 段）
# 全 bt709 → 普通管线

# 1) 统一重编码每个片段（禁止 -c copy！不同源必错）
# HDR 素材:
ffmpeg -y -i raw/IMG_00XX.MOV -vf "tonemap=hable,colorspace=bt709:iall=bt2020:fast=0,fps=30,format=yuv420p" \
  -c:v libx264 -preset medium -crf 18 build/seg/001.mp4
# SDR 素材:
ffmpeg -y -i raw/IMG_00XX.MOV -vf "fps=30,format=yuv420p" -c:v libx264 -preset medium -crf 18 build/seg/001.mp4

# 2) concat 拼接（编码已统一，可流拷贝或轻 reencode）
ffmpeg -y -f concat -safe 0 -i build/concat.txt \
  -vf "fps=30,format=yuv420p" -c:v libx264 -preset medium -crf 18 \
  -c:a aac -b:a 128k build/edit/full.mp4

# 3) 调色（温和参数，避免黑屏）
ffmpeg -y -i build/edit/full.mp4 \
  -vf "eq=contrast=1.15:brightness=0.03:saturation=1.25" \
  -c:v libx264 -preset ultrafast -crf 22 -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 build/edit/colorgraded.mp4

# 4) BGM + 混音 → 成片
# 5) 质检：抽 10s/60s/180s 三帧确认非黑屏（ffmpeg 截帧 + image 检查）
```

**✅ 实测能力**：HDR→SDR tonemap 管线、拼接、调色均验证；黑屏事故根因已写入 ffmpeg-recipes.md。

---

## M4 营销短视频

**触发**：产品推广/带货/宣传 → 营销视频。
**流程**：
1. 素材：产品图（M1 图文流程）或产品视频（M3 流程）
2. 文案：卖点提炼（3 点）→ 屏幕大字卡（Pillow）
3. 节奏：每卖点 2-3 秒快切 + 场景大字
4. BGM：fetch-bgm "upbeat corporate"（注意：**会自动拒绝 BY-NC**，换词到 CC0/CC BY）
5. 字幕：快速加字幕（M5）

**注意**：营销 BGM 用 upbeat 类关键词大概率全 BY-NC → 自动拒绝 → 换 `tech upbeat` / `corporate ambient` 等再试。

---

## M5 快速加字幕

**触发**：给视频加字幕（已有文本 或 需要语音转写）。
两种入口：
1. **有字幕文本/SRT**：
```bash
ffmpeg -y -i input.mp4 -vf "subtitles=sub.srt:force_style='FontName=PingFang SC,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=1'" \
  -c:a copy out_sub.mp4
```
2. **无文本（音视频转写）**：走 `references/asr-subtitles.md`（whisper/faster-whisper 转写 → 校对 → 烧录）。

**✅ 实测能力**：ffmpeg subtitles 滤镜已装；ASR 链路见 asr-subtitles.md。

---

## M6 快速调色（风格滤镜）

**触发**：调色/电影感/风格化 → 快速套用。
**本机已验证可用滤镜**（来自 ffmpeg-recipes.md，勿猜错名）：

| 风格 | 命令片段 |
|---|---|
| 电影感（青橙） | `colortemperature=temperature=5600,eq=saturation=1.15:contrast=1.2` |
| 暖阳 | `colortemperature=temperature=6800,eq=contrast=1.1` |
| 冷调 | `colortemperature=temperature=4500,eq=saturation=0.9` |
| 清新 | `eq=contrast=1.1:saturation=1.3:brightness=0.03` |
| 黑白 | `hue=s=0,eq=contrast=1.2` |
| 复古 | `curves=vintage` |

```bash
ffmpeg -y -i input.mp4 -vf "colortemperature=temperature=5600,eq=saturation=1.15" \
  -c:v libx264 -crf 20 -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 out.mp4
```

**⚠️ 色域提醒**：如果 input 是 HDR(bt2020*)，先走 M3 步骤 1 转 SDR 再调色；禁止在 bt2020 上直接压 8bit。

---

## 使用规则

1. **用户明说场景 → 直接匹配模式**，输出模式名 + 计划，不再自由探索。
2. **每个模式参数已实测（✅）**，若非必要不要改；改参数必须先说理由。
3. **HDR 检测是所有视频模式的第 0 步**（ffprobe color_space），bt2020 → 转 SDR 先行。
4. **BGM 一律 fetch-bgm**（CC0/CC BY），禁止 yt-dlp/网易云/抖音扒歌。
5. **不确定匹配哪个模式 → 列出 M1-M6 让用户选**，不要编新模式。