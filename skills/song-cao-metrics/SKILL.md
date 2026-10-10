---
name: song-cao-metrics
description: 宋代美学 CAO 的量化校验工具。输入图片路径，输出亮度/对比度/色彩丰富度/饱和度/色相数等计算美学特征，并与金标数据集宋韵分布基线比对，判定是否偏离宋韵量化阈值。四场景基线（ancient/consumer/material-life/dark_structure）+ --media 媒介映射（garment-flatlay 防浅底高对比误伤）。当用户要求对图片做宋韵量化分析、审美评分校验、构图/色彩工程校验时使用。
---

# Song-Cao Metrics（宋韵量化校验）

## Language

Match the user's language（默认中文）。

## 用途

CAO 智能体的**工程校验层**：用计算美学指标（亮度/对比度/色彩丰富度/饱和度/色相数）量化"宋韵程度"，与金标分布基线比对，弥补纯 LLM 规则的客观性不足。

## 环境

- 计算美学（venv）：`/Users/mac/Desktop/宋式美学智能体/.venv/`
- AI 美学评分（venv-v25）：`/Users/mac/Desktop/宋式美学智能体/.venv-v25/`（numpy 1.x + torch，唯一能跑 v2-5 的环境）
- 工具脚本：`/Users/mac/Desktop/宋式美学智能体/analysis/`
- 金标基线：`/Users/mac/Desktop/宋式美学智能体/golden-dataset/song-yun-baseline.json`

## 用法

```bash
# 单张图片量化分析（计算美学：亮度/对比度/色彩丰富度/饱和度/色相数）
/Users/mac/Desktop/宋式美学智能体/.venv/bin/python3 \
  /Users/mac/Desktop/宋式美学智能体/analysis/aesthetic_metrics.py <图片路径> --json

# 批量分析（输出基线对比分布）
/Users/mac/Desktop/宋式美学智能体/.venv/bin/python3 \
  /Users/mac/Desktop/宋式美学智能体/analysis/batch_metrics.py <images_dir> --json-out <out.json>

# AI 美学评分（v2.5 SigLIP，1-10 分，5.5+ 优秀；首次运行下载权重）
/Users/mac/Desktop/宋式美学智能体/.venv-v25/bin/python3 \
  /Users/mac/Desktop/宋式美学智能体/analysis/aesthetic_score.py <图片路径>
```

## 宋韵量化基线（31 张金标图，2026-09-13）

| 指标 | min | max | mean | 判定提示 |
|---|---|---|---|---|
| 亮度 | 70.8 | 209.2 | 131.1 | 显著 >210 可能过亮 |
| 对比度 | 61 | 198 | 142.0 | <60 层次弱 / >200 可能刺目 |
| 色彩丰富度 | 8.2 | 50.2 | 25.5 | >50 可能偏现代堆砌 |
| 平均饱和度 | 8.5 | 145.7 | 70.7 | >145 显著偏离宋韵低饱和 |
| 色相数 | 4 | 23 | 20.3 | 色相数太少(<4)或过多(>23)都需注意 |

## 判定规则

- **轻度偏离**：单项指标超出 [min, max] 区间但不超过 mean ± 2×极差
- **显著偏离**：饱和度 >145 或 色彩丰富度 >50 或 亮度 >210 → 触发纠偏
- **双轨确认**：量化指标 + LLM 规则 同时偏离才下"需纠偏"结论，任一单轨偏离仅提示

## 场景基线（四场景，2026-10-07 --media 接入后）

查表器按场景切换阈值（tags.json 的 `deviation_to_fix` 是 `{ancient, consumer, material-life, dark_structure}` 四基线）：

```bash
# 古画（默认）
.../analysis/song-yun-deviate.py <img>
# 消费摄影级产品图（亮度/对比度阈值更宽）
.../analysis/song-yun-deviate.py <img> --scene consumer
# 宋代物质生活器物（故宫 30 件 031-060，全样本 max 口径）
.../analysis/song-yun-deviate.py <img> --scene material-life
# 深色结构款（夜间/暗底）
.../analysis/song-yun-deviate.py <img> --scene dark_structure
```

- **媒介自动映射（推荐 cao-eval.sh --media）**：painting→ancient / garment-flatlay→consumer / object→material-life / space→dark_structure。**服装平铺/棚拍图必须走 garment-flatlay（consumer）**，否则浅底高对比（188-229）触发 ancient F5（max 198，为古画设置）属系统性误伤（experiments/19 + 05 库「服装平铺图判定校准」）
- 古画 31 张（ancient）与消费 6 张（consumer）实测分布不同：消费图更亮、更高对比
- "宋韵度"判断（饱和度/丰富度/色相/点缀色 ΔE）全场景通用；亮度/对比度/丰富度阈值按场景取
- 金标 v2 索引：`guofeng-cao/song-yun-baseline-v2.json`（ancient 31 + consumer 6 + material-life 30）
- 验证：ancient 31/31 pass、consumer 6/6 pass、material-life 30/30 pass（060 长沙窑窑变褐彩单列例外）
- **量化误伤自查（2026-10-07 回炉实测沉淀）**：HSV S 通道均值对"渐变+暖背景"系统性偏高（XF03-v2 报 54.26，实为 top 色块 0-20% 低饱和）。量化触发先查色块构成再判；**C 轨（LLM 视觉判定）为主判，量化仅提示**（05 库权重校准：转译完成度 > AI 评分 > 量化参数）

## 偏离自动查表（图 → 标签 → 修正指令，Fasium 结构语义模式）

量化偏离不只是"标注"，要反推成可执行的 prompt 修正信号（评测结论变生产力）。

```bash
# 一条命令：量化特征 + 色彩token ΔE + 查 song-yun-tags.json 偏离表 → 命中修正项 + 一键prompt修正包
/Users/mac/Desktop/宋式美学智能体/.venv/bin/python3 \
  /Users/mac/Desktop/宋式美学智能体/analysis/song-yun-deviate.py <图片路径>
# JSON 输出：--json
# 指定 tags 路径：--tags /Users/mac/Desktop/guofeng-cao/song-yun-tags.json
```

- 数据源：`guofeng-cao/song-yun-tags.json`（7 标签 L1-L7 + 7 条偏离规则 F1-F7 + prompt 修正包模板）
- 输出：`verdict`（pass/partial/fail）+ 命中的偏离修正项（signal/measured/fix_prompt/target_tags）+ 一键 prompt 修正包 + 七标签矩阵
- 人工补判：L2 留白 / L7 偏角 无直接量化字段（v0 用代理），矩阵里标"合规/待人工确认"，需 CAO 视觉层复核

## 输出格式（评价时）

1. 量化特征表（5 指标 + 与基线对比）
2. 偏离项标注（超出区间哪些项）
3. 方向性建议（如"降低饱和度至 70 区间"）
4. 修正指令（跑 `song-yun-deviate.py` 自动查表生成，喂生成器重生成 → 复测闭环）