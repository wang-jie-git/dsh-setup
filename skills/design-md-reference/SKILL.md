---
name: design-md-reference
description: "Reference library of 74 DESIGN.md design-system documents extracted from real brands (Linear, Stripe, Apple, Spotify, Vercel, Airbnb, Nike, etc). Each DESIGN.md contains the brand's color tokens, typography scale, spacing, radii, and composition rules that AI coding agents can follow to generate visually consistent UI. Use when the user asks to build a page/UI in a specific brand's style ('make it look like Linear/Stripe/Notion'), when doing UI design work that needs a concrete design-token reference, or when the user wants a design based on a popular product's design language. Triggers: 品牌风格、像 Linear/Stripe/Notion 那样、设计令牌、design token、make it look like."
---

# DESIGN.md Reference Library

本技能提供本地安装的 **awesome-design-md** 设计系统文档库（74 个品牌的 DESIGN.md，源自 VoltAgent/awesome-design-md 仓库）。

## 库位置

```
~/.dsh/design-md/<brand>/DESIGN.md
```

每个品牌目录下有 `DESIGN.md`（设计令牌 + 规则）和 `README.md`（品牌分析简述）。

## 使用方式

1. **查库**：用 `ls ~/.dsh/design-md/` 查看可用品牌列表。
2. **读设计**：用 `read_file` 读取目标品牌的 `DESIGN.md`，提取其 `colors:`、`typography:`、`spacing:`、`radii:`、`composition rules` 等令牌。
3. **应用**：按用户要求生成 UI，严格遵循该品牌的色板、字体分层、间距节奏和圆角规则，保持视觉一致性。

## 品牌索引（84 个）

**AI 与 LLM 平台**：claude, cohere, elevenlabs, minimax, mistral, ollama, opencode, replicate, runway, together, voltagent, xai

**开发者工具 / IDE**：cursor, expo, lovable, raycast, superhuman, vercel, warp

**后端 / 数据库 / DevOps**：clickhouse, composio, hashicorp, mongodb, posthog, sanity, sentry, supabase

**生产力 / SaaS**：cal, intercom, jobright, linear.app, mercury, mintlify, notion, resend, zapier

**设计与创意工具**：airtable, clay, figma, framer, miro, webflow

**金融科技 / 加密**：binance, coinbase, kraken, mastercard, mydealz, revolut, stripe, wise

**电商 / 零售**：airbnb, meta, nike, shopify, starbucks

**媒体 / 消费电子**：aljazeera, apple, hp, ibm, nvidia, pinterest, playstation, sap, spacex, spotify

**汽车（其他）**：bmw, bmw-m, bugatti, dell-1996, ferrari, lamborghini

**硬件 / 物联网 / 企业**：1win, dji, nerdwallet, oracle, oura

## 常见请求的快速映射

- 深色极简 + 紫色点缀 → `linear.app`（近黑画布 #010102 + lavender #5e6ad2）
- 深色代码优先 → `vercel` / `warp` / `replicate`
- 彩色渐变任天堂风 → `stripe` / `figma` / `lovable`
- 摄影优先电商 → `nike` / `apple` / `airbnb` / `starbucks`
- 文档阅读优化 → `mintlify` / `clickhouse` / `hashicorp`

## 与 finesse-ui 配合

finesse-ui 负责"怎么做才不 cheap"（防 slop 黑名单、craft floor、动效引擎）；
本库负责"像哪个品牌"（设计令牌精确复刻）。两者叠加 = 高端且对味。
