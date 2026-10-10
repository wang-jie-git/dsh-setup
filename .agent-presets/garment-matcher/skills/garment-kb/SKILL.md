# 商品属性建档规范（Garment Matcher KB）

> 商品属性智能体的知识底座。规范：受控词表 + 建档规则 + 质检 + 匹配评分。
> 单一事实源：NocoBase `garment_profiles`（MCP 读写）。本地 JSON 仅备份。

## 1. 受控维度词表（与顾客档案同轴，禁自由发挥）

| 维度 | NocoBase 字段 | 受控词表 |
|---|---|---|
| 服装线条 | `line` | 棱角直线 / 直线 / 柔和直线 / 直线柔和 / 柔和曲线 / 曲线 |
| 面料线重 | `line_weight` | 轻柔 / 中等 / 厚重 |
| 品类 | `category` | 外搭 / 上装 / 下装 / 连衣裙 / 套装 / 配饰 |
| 意境风格 | `vibe`（JSON 数组） | 清冷 / 禅意 / 文雅 / 飒爽 / 温婉 / 古典 |
| 颜色 | `color`（JSON） | `{main, hex[], season[], contrast}` |
| 功能诉求 | `functionality`（JSON） | 显瘦 / 遮胯 / 拉高腰线 / 修饰手臂线条 / 提亮肤色 |
| 适配体型 | `fits_body_types`（JSON） | 小个子 / 梨形 / H形 / X形 / O形 |
| 适用场合 | `best_scenes`（JSON） | 职场通勤 / 高端晚宴 / 日常休闲 / 户外摄影 / 节庆宴会 |

### 线条判据（AIS，参考 always-in-style skill）
- 棱角直线：明显尖/棱角（方形肩线、方正下摆），利落
- 直线：清晰直线轮廓，无明显收腰
- 柔和直线：直线为主但面料软或细节柔和（最常见）
- 直线柔和/柔和曲线：曲线为主带一点直线
- 曲线：明显圆润弯曲线条、收腰

### 面料线重判据
- 轻柔：雪纺/绉纱/平针织（垂坠，偏柔和线）
- 中等：法兰绒/绒面呢（适中）
- 厚重：亚麻/华达呢/粗花呢（挺括，偏直线）

## 2. 颜色 → 顾客色季/6型 对齐
- `color.season`：春/夏/秋/冬（顾客 color_season 安全区过滤）
- 需补 `color_system` 适配分区（深/浅/暖/冷/亮/浊），建档时尽可能判出主色区

## 3. 建档质检规则
| 检查 | 动作 |
|---|---|
| NocoBase products 有新款但无 garment_profiles | 补建档 |
| products 价格/季节/面料变更 | 更新 garment_profiles |
| inventories 库存=0 或下架 | status 置 soldout |
| line/vibe 用了词表外值 | 修正为受控词表 |

## 4. 匹配评分（正/反向同轴）
| 维度 | 权重 | 判据（顾客↔商品） |
|---|---|---|
| 线条契合 | 0.25 | body_line ↔ line |
| 版型×体型 | 0.20 | body_type ↔ fits_body_types |
| 色系×6型 | 0.25 | color_season/color_system ↔ color |
| 气质×风格 | 0.15 | style_type ↔ vibe |
| 场景 | 0.15 | best_scenes ↔ best_scenes |

过滤红线：尺码无货 / 反季节 / 超预算 / 库存 0 → 先剔除。

输出：满分 2×5=2 分制（或归一化 0-1），Top3 作为推荐集 + 每套一句落到顾客的审美理由。