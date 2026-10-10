# 建档 / 匹配工作流 SOP

> 用 MCP `mcp__nocobase__resource_*` 工具操作 NocoBase。工具参数：
> - `resource_create` / `resource_update`: 写数据用 **`values`**（不用 `data`）
> - `resource_list`: `resource` + `filter` + `pageSize` + `appends`
> - `resource_destroy`: `resource` + `filterByTk`
> 鉴权 token 由环境变量 NOCOBASE_MCP_TOKEN 提供（已注入 header）。

## 建档 SOP

```
① 拉商品    resource_list（resource=products, fields=id,name,style_no,season,status）
            → 遍历款；同时 resource_list 拉 inventories 聚合库存
② 查已有     resource_list（resource=garment_profiles, filter={productId}) → 判断建档/更新
③ 视觉判读  （有图款）read_image 看商品图 → 判 line/line_weight/vibe/category/color
④ 规则初判  （无图款）由款名+品类+面料+季节 → 预填，confidence<0.6, source_agent=rule
⑤ 写回      resource_create（resource=garment_profiles, values={
                item_id, name, category, line, line_weight, color{vibe},
                functionality, fits_body_types, best_scenes,
                source_agent, status, confidence, product: <id>})
⑥ 质检      比对后补齐/更新/置 soldout
```

## 建档判断维度（从 NocoBase 商品字段）

| products 字段 | → garment 字段 | 判读方式 |
|---|---|---|
| name / style_no | item_id / name | 直取 |
| images(attachment) | color.main/hex + line | 视觉判读 |
| product_skus.color/size | color + sizes | 配色/尺码 |
| product_skus.sale_price | price_range | 预算过滤 |
| products.fabric/origin | line_weight | 面料线重 |
| products.season | color.season[] | 季节 |
| inventories.quantity | meta.stock | 库存/售罄 |
| products.category/brand | category/brand | 品类层 |

## 正向匹配（顾客→商品）

```
① 读顾客档案   resource_list(customer_image_profiles, filter={customer_key, customer})
② 读商品库      resource_list(garment_profiles, pageSize=大)
③ 过滤         尺码无货/反季节/超预算/库存0 → 剔除
④ 打分         线条0.25 版型0.2 色系0.25 风格0.15 场景0.15（各0-2）
⑤ 输出 Top3 套 + 每套一句落到顾客的审美理由 + 话术
```

## 反向匹配（商品→顾客）

```
① 读目标商品      resource_get(garment_profiles, filterByTk)
② 读顾客         resource_list(customer_image_profiles, pageSize=大)
③ 同轴打分       （复用正向打分函数，锚定商品）
④ 输出 TopN 顾客清单 → 适合推新品的会员
```

## 质检巡检（周期）

```
全量列表 garment_profiles + products → 比对 status/confidence/缺失
  输出：缺失清单 → 补建档；soldout 清单 → 置 status；词表外值 → 修正
```

## 验证清单
- [ ] MCP 工具可调（mcp__nocobase__resource_list 返回商品）
- [ ] 建档写 garment_profiles 成功（values 参数）
- [ ] 读回可看到新档案 + product 关联
- [ ] 反向匹配能返回顾客候选
- [ ] 测试数据清理（不污染生产）