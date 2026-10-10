# FFmpeg 配方集（简单剪辑 / 转码 / 滤镜 / 音频）

适用于简单剪辑任务。优先使用 DSH 内置工具（`ffmpeg_cut`/`ffmpeg_concat`/`ffmpeg_encode`/`ffmpeg_gif`/`ffmpeg_subtitle`/`ffmpeg_extract`），复杂滤镜用 bash 直接调 ffmpeg。

## 快速工具映射

| 需求 | 工具/命令 |
|---|---|
| 探测信息 | `ffmpeg_probe` 或 `ffprobe` |
| 裁剪片段 | `ffmpeg_cut`（流拷贝秒级；`reencode=true` 精确到帧） |
| 拼接 | `ffmpeg_concat`（编码一致流拷贝；否则 reencode） |
| 转码 | `ffmpeg_encode`（bilibili-1080p / bilibili-4k / vertical-1080p / web-720p） |
| 抽帧/抽音轨/抽字幕 | `ffmpeg_extract` |
| 转 GIF | `ffmpeg_gif` |
| 烧录字幕 | `ffmpeg_subtitle` |

---

## 1. 裁剪 / 剪辑片段

```bash
# 精确到帧（重编码）
ffmpeg -y -ss 00:00:12.5 -i raw/clip.mov -t 2.5 -c:v libx264 -preset veryfast -crf 18 -c:a aac build/edit/segments/001.mp4

# 流拷贝（快，关键帧对齐）
ffmpeg -y -ss 00:01:00 -to 00:02:00 -i raw/clip.mov -c copy build/edit/segments/002.mp4
```

## 2. 拼接（编码必须一致，否则先统一重编码）

```bash
# concat.txt:  file 'segments/001.mp4'  file 'segments/002.mp4'
ffmpeg -y -f concat -safe 0 -i build/edit/concat.txt \
  -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
  -map 0:v:0 -map 1:a:0 \
  -vf "fps=30,format=yuv420p" -c:v libx264 -preset medium -crf 18 \
  -c:a aac -b:a 128k -shortest output/final_v1.mp4
```

> B-frame/DTS 问题：手机 H.265 素材直接 `-c copy` 拼接会时长异常/音画不同步。稳妥做法：每个片段先重编码成统一参数，最终 concat 后再强制 `fps=30,format=yuv420p`。

> **🔥 HDR 色域红线（2026-08-30 沂河夜景黑屏事故实测）**：
> iPhone 拍摄素材多为 **HEVC + 10bit + bt2020nc（HDR）**。直接 `libx264 -pix_fmt yuv420p` 转码会产生**黑屏/过暗**，因为编码转了但色域标签没转（color_space 还是 bt2020nc → 播放器按 HDR 显示 8bit 内容 = 全黑）。
> **必须先探测再决定**：`ffprobe -v error -select_streams v:0 -show_entries stream=color_space -of default=noprint_wrappers=1 input.MOV`
> - 如果输出含 `bt2020` → **走 HDR→SDR 管线**（本机无 zscale/libzimg，用 tonemap 方案）：
> ```bash
> ffmpeg -y -i input.MOV \
>   -vf "tonemap=hable,colorspace=bt709:iall=bt2020:fast=0" \
>   -c:v libx264 -crf 23 -pix_fmt yuv420p \
>   -color_primaries bt709 -color_trc bt709 -colorspace bt709 output.mp4
> ```
> - 如果输出是 `bt709` → 普通拼接/调色即可。
> **禁止**：未经色域转换直接把 bt2020 素材压成 8bit。

## 3. 竖屏适配（9:16，1080×1920）

### 裁切填满（主体居中时）
```bash
ffmpeg -y -i raw/clip.mov \
  -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p" \
  -c:v libx264 -preset veryfast -crf 18 -an build/edit/segments/001.mp4
```

### 背景模糊 + 前景居中（教程/保留完整画面）
```bash
ffmpeg -y -i raw/clip.mov -filter_complex \
  "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=35[bg];\
   [0:v]scale=1000:1800:force_original_aspect_ratio=decrease[fg];\
   [bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p" \
  -c:v libx264 -preset veryfast -crf 18 -an build/edit/segments/001.mp4
```

### 旋转元数据
手机竖拍可能存横向尺寸 + `rotate=90`。probe 时读 `tags.rotate`，|90/270| 时交换显示宽高再适配。

## 4. 调色（画面处理）

| 效果 | 滤镜 |
|---|---|
| 对比度/亮度/饱和度/伽马 | `eq=contrast=1.1:brightness=0.02:saturation=1.2` |
| 色温（暖/冷） | `colortemperature=temperature=6500` |
| 阴影/中间调/高光 | `colorbalance=rs=0.1:bm=0.1:gh=0.05` |
| 曲线调色 | `curves=vintage` 或自定义 `curves=green='0/0 0.5/0.6 1/1'` |
| 风格化 LUT | `lut3d=file=style.cube` |

```bash
# 单命令：调色 + 淡入淡出
ffmpeg -y -i raw/clip.mov \
  -vf "eq=contrast=1.1:saturation=1.2,fade=t=in:st=0:d=0.5,fade=t=out:st=9.5:d=0.5" \
  -c:v libx264 -crf 18 output/final_v1.mp4
```

## 5. 滤镜特效

| 效果 | 滤镜 |
|---|---|
| 黑白 | `hue=s=0` |
| 复古/棕调 | `curves=vintage`、`colorchannelmixer=rr=0.5:gg=0.4:bb=0.3` |
| 暗角 | `vignette=angle=PI/4` |
| 模糊 | `boxblur=10:1` |
| 锐化 | `unsharp=5:5:1.0:5:5:0.0` |
| 反色 | `negate` |
| 绿幕抠像 | `chromakey=0x00FF00:0.1:0.2`（替换背景：叠加另一路视频） |

## 6. 文字 / 水印

```bash
# 标题（drawtext 需滤镜支持；macOS 用 PingFang 字体）
ffmpeg -y -i raw/clip.mov \
  -vf "drawtext=fontfile=/System/Library/Fonts/PingFang.ttc:text='标题文字':fontsize=64:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.1" \
  -c:v libx264 -crf 18 output/final_v1.mp4

# 时间控制（前 3 秒显示）
ffmpeg -y -i raw/clip.mov \
  -vf "drawtext=fontfile=/System/Library/Fonts/PingFang.ttc:text='标题':enable='between(t,0,3)':fontsize=64:fontcolor=white:x=(w-text_w)/2:y=h*0.1" \
  -c:v libx264 -crf 18 output/final_v1.mp4

# 水印（右下角，半透明）
# drawtext=...:alpha=0.5:x=w-tw-20:y=h-th-20
```

> ⚠️ 有些 FFmpeg 构建缺 drawtext/subtitles。**更稳的中文字幕方案**：Pillow 生成透明 PNG 字幕层 → ffmpeg overlay 叠加（见第 8 节）。

## 7. 音频处理

```bash
# 替换原声 + 新音乐（-shortest 自动截断到视频长度）
ffmpeg -y -i video.mp4 -i music.mp3 -c:v copy -c:a aac -shortest -map 0:v -map 1:a output/final_v1.mp4

# 原声 + 音乐混合（原声 40%，音乐 60%）
ffmpeg -y -i video.mp4 -i music.mp3 -filter_complex \
  "[0:a]volume=0.4[v1];[1:a]volume=0.6[m];[v1][m]amix=inputs=2" \
  -c:v copy -c:a aac output/final_v1.mp4

# 配乐压低（BGM 25%，突出旁白）
ffmpeg -y -i video.mp4 -i music.mp3 -filter_complex \
  "[1:a]volume=0.25[bg];[0:a][bg]amix=inputs=2" \
  -c:v copy -c:a aac output/final_v1.mp4

# 音乐淡入淡出（视频 30s：开头 1.5s 淡入，结尾 1s 淡出）
ffmpeg -y -i video.mp4 -i music.mp3 -filter_complex \
  "[1:a]afade=t=in:st=0:d=1.5,afade=t=out:st=29:d=1[m];[0:a][m]amix=inputs=2" \
  -c:v copy -c:a aac output/final_v1.mp4

# 降噪
ffmpeg -y -i video.mp4 -af "afftdn=nf=-25" -c:v copy output/final_v1.mp4
```

## 8. 中文字幕推荐方案（Pillow PNG + overlay）

```python
# make_subtitle_png.py —— 生成透明字幕层
from PIL import Image, ImageDraw, ImageFont
import sys

text = sys.argv[1]; out = sys.argv[2]
W, H = 1080, 1920
img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
font = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 56)
# 底部字幕，离底 120-180px 避开平台按钮
bbox = d.textbbox((0, 0), text, font=font)
tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
x, y = (W-tw)//2, H - 180 - th
# 半透明黑底 + 白字
d.rounded_rectangle([x-20, y-20, x+tw+20, y+th+20], radius=12, fill=(0,0,0,140))
d.text((x, y), text, font=font, fill=(255,255,255,255))
img.save(out)
```

```bash
# 生成字幕 PNG 后 overlay 叠加
python3 make_subtitle_png.py "字幕内容" build/edit/overlays/sub_01.png
ffmpeg -y -i segment.mp4 -loop 1 -i build/edit/overlays/sub_01.png \
  -filter_complex "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p" \
  -t 3 -an build/edit/captioned/seg_01.mp4
```

## 9. 实用检查命令

```bash
# 批量查看素材信息
for f in raw/*; do
  ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height:stream_tags=rotate:format=duration -of csv=p=0 "$f" 2>/dev/null | awk -v file="$f" -F, '{print file","$0}'
done

# 抽帧检查（含 30/900/1800/2700 帧拼图）
ffmpeg -y -hide_banner -loglevel error -i output/final_v1.mp4 \
  -vf "select='eq(n,30)+eq(n,900)+eq(n,1800)+eq(n,2700)',scale=270:480,tile=2x2" \
  -frames:v 1 build/edit/qc_frames/contact_sheet.jpg
```

## 常见坑速查

| 问题 | 原因 | 解决 |
|---|---|---|
| 竖拍压扁 | 未处理 rotate | probe 读 rotate，交换宽高 |
| 图片片段一闪而过 | 没用 `-loop 1 -t` | 图片转视频必加 |
| HEIC 画面发黑 | 读到辅助/深度流 | 先转 PNG 再剪 |
| 中文乱码 | 字体不支持 CJK | PingFang/Noto Sans CJK |
| concat 时长异常 | B-frame/DTS | 片段统一重编码 |
| 音画不同步 | 时间戳不统一 | 统一 fps、避免 copy 拼接 |
| 上传变糊 | 码率低 | 1080x1920，CRF 18-23，H.264 |