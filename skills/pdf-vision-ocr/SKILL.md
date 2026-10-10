# PDF Vision OCR — PDF→图片→AI视觉识别（含色彩分析）

## 触发词
PDF、PDF识别、PDF OCR、PDF转图片、扫描件识别、色彩识别、色彩属性、PDF色彩分析

## 功能
将 PDF 每页转为高清 PNG，用 AI 视觉模型（agnes-2.5-flash）逐页识别：
1. **文字 OCR** — 原样抄录所有可见文字
2. **色彩分析** — 识别主色调、辅助色，输出 hex 值 + HSL 属性 + 色彩占比
3. **内嵌图片** — 用 `pdfimages` 提取 PDF 内嵌的图片，单独识别
4. **结构化输出** — 汇总成 markdown 报告

## 用法

```bash
# 完整识别（文字 + 色彩 + 内嵌图片）
bash ~/.dsh/skills/pdf-vision-ocr/scripts/pdf_vision_ocr.sh "文件.pdf"

# 指定页范围
bash ~/.dsh/skills/pdf-vision-ocr/scripts/pdf_vision_ocr.sh "文件.pdf" --pages 1-10

# 仅文字 OCR（跳过色彩分析，更快）
bash ~/.dsh/skills/pdf-vision-ocr/scripts/pdf_vision_ocr.sh "文件.pdf" --text-only

# 指定 DPI（默认 200，扫描件建议 300）
bash ~/.dsh/skills/pdf-vision-ocr/scripts/pdf_vision_ocr.sh "文件.pdf" --dpi 300
```

## 输出
- 临时图片：`/tmp/pdf-vision-ocr/<文件名>/page-NNN.png`
- 识别报告：`/tmp/pdf-vision-ocr/<文件名>/report.md`
- 内嵌图片：`/tmp/pdf-vision-ocr/<文件名>/embedded/`

## 依赖
- `pdftoppm`（poppler-utils）— PDF 转图片
- `pdfimages`（poppler-utils）— 提取内嵌图片
- `python3 + Pillow` — 图片预处理
- `agnes-2.5-flash` API — AI 视觉模型（通过 free-vision 插件或直接 API 调用）

## 色彩识别 prompt 设计
识别以下色彩属性：
- 主色调 + hex 值
- HSL 属性（色相 H、饱和度 S、明度 L）
- 色彩占比（百分比）
- 传统色名映射（如：天青、月白、茶白、水绿、黛青、缃黄、朱砂、墨色）
- 饱和度评估（低饱和 / 中等 / 高饱和）
