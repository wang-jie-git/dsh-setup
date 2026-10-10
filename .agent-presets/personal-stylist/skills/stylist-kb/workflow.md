# 形象管理顾问工作流（Stylist SOP）

> 三条主流程 + 一条闭环。所有步骤遵守 SKILL.md 条款；本文件只讲"顺序与接口"。

## SOP-A 服装建档（复用 CAO，Stylist 只读）

```
触发：CAO 产出/更新服装档案
1. CAO 视觉提取物理属性（领型/袖型/颜色/材质）→ 生成 garment JSON
2. 写入共享库：/Users/mac/Desktop/宋式美学智能体/golden-dataset/garments/<item_id>.json
     （必带 spec_version=1.0, meta.source_agent=cao, meta.status）
3. memory_write 登记：type=memory_entry, tag=[garment, <item_id>], summary=款名+主色+vibe
4. Stylist 侧无需动作：stylist_garments_list 直接扫共享库即见
验收：stylist_garments_list 能列出，stylist_garment_get <id> 能取全文
```

## SOP-B 顾客建档（Stylist 主流程）

```
触发：新顾客进店/线上咨询
1. 问卷收集：体型（可选照片，须 photo_consent=true）/ 职业 / 场景（含时间占比）/ 偏好 / 预算
2. stylist_customer_new 取空模板 → 按字段填写（v1.3：含 body_line/skeleton/color_system/style_type/wardrobe）
3. 身体线条快判（SKILL.md §10.2 三问：轮廓/骨架/脸型辅助）→ body.body_line + skeleton
4. 审美快测（SKILL.md §10.3 五问 + 风格快问 + 衣橱三色问 + 禁忌一句）→ style 各偏好 + style_type + wardrobe.three_colors
5. 照片（有 consent）→ 视觉分析身体线条/体型/肤色色季，填入 body + skin_tone（M3 SOP-E）
     （photo_consent=false：体感描述由顾客自报，禁止解读照片）
6. 色彩确认（SKILL.md §9.4）：A 色季问卷 → color_season；B 6型叙述自选 → primary_type
7. 落盘 data/customers/<customer_id>.json → 校验必填（body/style/life/privacy）
8. memory 建档：user_id=<customer_id>, tag=[customer, profile]，写首次画像摘要
验收：stylist_customer_get <id> 能取全文；记忆可捞到该顾客
```

## SOP-C 匹配发单（核心调用路径）

```
触发："给这位顾客推荐 <场景> 穿搭"
1. 定位 customer_id：问顾客名字/手机后四位 → 查 data/customers/ + memory
     （没有档案？→ 先走 SOP-B，不许瞎推荐）
2. 读档案：stylist_customer_get <id>
3. 取候选池：stylist_garments_list（可按 scene/vibe 过滤）→ 需要时 stylist_garment_get 取全文
4. 记忆增强：mcp__ai-memory__memory_query(user_id=顾客ID) 捞穿衣史/偏好
5. LLM 按 SKILL.md §匹配推理链 组 3 套方案（硬过滤 → 软打分 → 组套）
6. stylist_plans_save 落盘 data/plans/PLAN-*.json → 输出报告：
     每套 = 顾客特征理由 + 色彩逻辑 + 场景得体性 + 话术（品牌语境，按 aesthetic_preference；默认宋韵）
7. 交付话术给店主/顾客；引导反馈（买/不买/原因）
验收：方案 JSON 通过 outfit-plan.schema.json；3 套理由均含 ≥2 个顾客特征
```

## SOP-D 反馈闭环（Stylist → CAO 反向定制）

```
触发：顾客成交 / 退货 / "这件不合适"
1. stylist_feedback_save item_id=<id> signal=<sold|return|mismatch> note=<原因>
2. 落盘 data/feedback/<item_id>.feedback.json（同款多次追加，含时间/顾客体型）
3. memory_write：tag=[feedback, <item_id>], type=insight, 注明体型维度
4. （P2）CAO 侧读取 feedback/ 聚合：某版型在梨形顾客中退货率高 → 减少同类设计
验收：feedback 文件含 ≥2 条结构化记录；CAO 能读出"反向定制信号"
```

## SOP-E 视觉建档（M3：照片 → 档案自动回填）

```
触发：顾客同意拍照建档（photo_consent=true）
1. 采集照片（按 SKILL.md §9.1 规范；不达标先让顾客重拍）
2. stylist_photo_register customer_id=<id> photo_path=<照片>   ← consent 门禁 + 复制入库
3. stylist_photo_metrics photo_path=<入库路径>                 ← 客观层：LAB/底色/色季初判/6型初判/质量告警
     warnings 非空 → 提示重拍，不继续下结论
4. read_image 看照片 → 按 §9.3 rubric 判读身体线条/体型/脸型，自评置信度
5. 色彩确认（强制两道）：
     A. 色季问卷（银/金、血管、黑白）→ confirmed_season（§9.4A）
     B. 6型叙述自选（6 段描述让顾客选）→ confirmed_primary_type（§9.4B）
6. stylist_profile_apply customer_id=<id> updates={body,skin_tone,style}
     confidence={逐字段} quiz={...} photo_path=<入库路径>
7. 低置信字段（<0.6）→ 向顾客/店员确认后补档（再调 profile_apply）
8. memory_write：user_id=<customer_id>, tag=[customer, profile],
     summary="视觉建档完成，柔和曲线型/梨形/圆脸/夏季型/冷色主型，待确认项:xxx"
验收：档案含 body(含 body_line)/skin_tone(含 color_system)/style + analysis 审计块；
      历史未被覆盖；color_season 有 quiz.confirmed_season、primary_type 有 quiz.confirmed_primary_type 记录
```

## SOP-F 衣橱规划（差异化服务，SKILL.md §十一）

```
触发：顾客问"没有衣服穿 / 该买什么 / 整理衣橱"
1. stylist_customer_get <id> → 读 color_system / scenes / time_ratio / history.orders
2. stylist_wardrobe_plan <id> → 工作表（已有单品 + 检查表 + 3 色槽位 + 时间分配）
3. LLM 按 §11.1-11.3 规则填：three_colors（安全区 2 主色 + 1 个性色）→ neutral_colors → gap（对照检查表缺口）
4. 输出衣橱规划话术：3 色盘说明（"明亮色只上小单品"）+ 采购清单按优先级 + 时间分配诊断 + 购物黄金准则
5. 回写 customer.wardrobe（增量更新，勿全量重写）；实际采购/淘汰后更新 gap
验收：输出含 3 色盘 + 缺口清单 + 时间对照；wardrobe.three_colors ≥2 个落在 color_system 安全区
```

## SOP-G 形象诊断（核心产品，SKILL.md §十二 · v1.4 采集纪律重排）

```
触发：顾客咨询"我适合什么颜色/什么风格/帮我鉴定"——诊断是本系统的一级入口
硬纪律：先采集后鉴定。问卷与照片是鉴定的【输入】，不是善后。
        未完成采集前禁止出具报告（禁止把半成品"待确认"报告交付给顾客）。

阶段1 采集（引导式对话，一次一题，SKILL §12.5）：
  a. 色季问卷（§9.4A）：银/金 → 血管 → 黑白，每题即时反馈倾向（"银饰更衬 → 冷调 → 夏季型方向"）
  b. 6型叙述自选（§9.4B）：让顾客从六段描述里选最像自己的
  c. 风格快问（§10.3）+ 身体线条快判（§10.2 轮廓3问）+ 骨架问 + 品牌偏好问（aesthetic_preference）
  d. 请求照片：说明用途 + 隐私承诺 → photo_consent 确认；顾客拒绝则对应维度标"自述仅凭"，不勉强
阶段2 判读（有照片且 consent=true）：photo_register → photo_metrics 客观层 → read_image 视觉判读（§9.2-9.3）
阶段3 交叉确认（边采边写）：
  a. 每完成一组即向顾客复述确认（"目前确定：冷调、夏季型倾向、柔和曲线；还差风格快问和一张照片"）
  b. 问卷 vs 照片初判：一致 → profile_apply 写入（quiz.confirmed_season / confirmed_primary_type 随档案落）
  c. 冲突 → 请顾客裁决，不擅自定案；裁决结果如实记录
阶段4 出具报告（仅当全部维度 confirmed 或明确信息缺口）：
  a. stylist_diagnosis_report <id> save=false 当【进度检查】→ 看哪些维度还 false → 回阶段1/3 补采集
  b. 全部确认（或已向顾客明说"缺 X"）→ LLM 补全 application/verdict/next_steps（§12.3）
  c. 落盘 DX-*.json + .md → 复制桌面（~/Desktop/形象鉴定报告-*.md）→ 交付话术（结论→证据→应用→行动，直接呈现 MD 内容）
  d. 引导下游：匹配试穿（SOP-C）/ 衣橱规划（SOP-F）——诊断是入口，成交是自然结果
验收：报告只在采集完成后出具（confirmed 全绿或明示缺口）；每维度 evidence ≥2 条；
      verdict 面向顾客可读；basis 登记了问卷/照片来源；对话中顾客曾逐题确认
```

## M2 验收清单（本期目标）

- [ ] preset 装到 ~/.dsh/.agent-presets/personal-stylist/ 并在 Web 选择器可见
- [ ] 新会话首问 stylist_garments_list → 列出 ≥3 件样衣
- [ ] 喂入 C-0001 顾客档案 → 产出 3 套方案，每套理由落到顾客特征
- [ ] 不足 3 套时如实说明（meta.model_note），不硬凑
- [ ] 话术含品牌美学语境（按 aesthetic_preference；宋韵实例=克制/留白/冷调表达）