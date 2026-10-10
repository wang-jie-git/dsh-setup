/**
 * dsh-nexus-browser-guide — nexus-browser 使用引导 skill adapter for DSH
 *
 * nexus-browser 通过 dsh-mcp-client 暴露 17 个 MCP 工具（mcp__nexus_browser__*）。
 * 这些工具分两个阵营：
 *   1. 确定性路由（web_task / opencli 风格）— 零 LLM 成本，中国站点直出结构化数据
 *   2. 浏览器交互（navigate/click/fill/scroll/next_page/evaluate）— 灵活但慢、贵
 * 模型经常把两者混用：该用 web_task 时开了浏览器，或者该保持页面时用了 navigate_page。
 * 本 skill 提供 1 个 load 工具，把"何时用哪个工具"的决策树注入模型上下文。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'

export const inject = ['tools']
export const name = 'dsh-nexus-browser-guide'
export const version = '0.1.0'

/** 完整使用引导 —— 模型执行任何浏览器任务前应先读一遍 */
const GUIDE = `# nexus-browser 使用引导（17 个 MCP 工具）

## 架构一句话
nexus-browser = REST 服务器（FastAPI + Playwright）+ MCP 桥接层。
两类能力：**确定性路由**（151+ 站点适配器，零 LLM 成本）和 **浏览器交互**（CDP 控制，灵活但慢）。

## 工具选择决策树（按此顺序判断）

### A. 中国站点 / 结构化数据 → 用 web_task（首选，零成本）
适用：知乎热搜、B 站搜索、小红书笔记、微博、抖音、微信文章、GitHub、Reddit、Google、Wikipedia、YouTube。
✅ "看看知乎今天的热搜" → web_task(task="看看知乎热搜")
✅ "搜B站 AI 视频" → web_task(task="搜索B站AI视频")
✅ "读一下这篇 Reddit 帖子" → web_task(task="打开红迪链接 xxx")
❌ 不要为了这些任务开浏览器。web_task 走站点适配器，0.1 秒返回，不消耗浏览器资源。

### B. 需要连续交互（翻页/填表/点击/滚动）→ 用 browser_navigate + 交互链
适用：登录、搜索并翻页、填表单、点击按钮后读结果。
✅ "登录后看账单" → browser_navigate(登录页) → browser_fill(#user) → browser_fill(#pass) → browser_click(#submit) → browser_get_content()
✅ "翻到第3页" → browser_navigate(列表页) → browser_click(".next") 或 browser_next_page() → browser_get_content()
✅ "滚动加载更多" → browser_navigate(页面) → browser_scroll("down") → browser_get_content()
关键：browser_navigate **保持页面打开**，后续必须用 browser_get_content 读内容。

### C. 一次获取，之后不管 → 用 navigate_page（一次性，省资源）
✅ "打开 https://example.com 看看有什么" → navigate_page
⚠️ 页面用完即关。若之后还要操作，用 B 的 browser_navigate。

### D. 桌面应用 / Electron（Cursor、Notion、One 等）→ 用 attach_browser
✅ "附着到 Cursor 看看" → attach_browser(port=9222) → list_pages()
补充：attach_browser 也用于附着已经用 --remote-debugging-port 启动的 Chrome。

### E. 万能兜底 → browser_evaluate
✅ 页面内容拿不到 / 需要自定义提取 → browser_navigate → browser_evaluate("document.body.innerText")
❌ 不要滥用 evaluate，能用 B/C 就优先。

## 工具职责速查（mcp__nexus_browser__* 前缀）

| 工具 | 谁说 | 何时用 |
|---|---|---|
| web_task | 路由中枢 | 任何"看看/搜搜/读读"的自然语言任务，A 类 |
| get_server_status | 状态 | 不确定服务器是否活着 |
| execute_skill | 执行技能 | 服务器有自定义技能时 |
| attach_browser | 桌面/附着 | D 类 |
| list_pages | 标签页 | 附着后查看当前页 |
| navigate_page | 一次性导航 | C 类 |
| browser_navigate | 保持打开 | B 类第一动作 |
| browser_get_content | 读内容 | B 类任意步骤后 |
| browser_click | 点击 | 翻页/提交/选择 |
| browser_type | 输入 | 模拟键盘（搜索框） |
| browser_fill | 填表 | 表单字段（清空+填入） |
| browser_select | 下拉 | <select> 选项 |
| browser_scroll | 滚动 | 加载更多/看长页 |
| browser_next_page | 翻页 | 有分页器时 |
| browser_evaluate | JS | 高级提取/兜底 |
| browser_wait | 等待 | 新内容/新元素加载 |
| browser_screenshot | 截图 | 需要图像证据 |

## 反模式（红线）
1. ❌ 中国站点用 browser 流程做：知乎/小红书/B 站都有适配器，web_task 更快更省
2. ❌ navigate_page 后继续操作：页面已关闭，会报 browser closed。要操作就用 browser_navigate
3. ❌ 忘记 get_content：browser_navigate 不返回正文，必须显式调用
4. ❌ 无脑 evaluate：能用点击/滚动解决的交互不要用 JS
5. ❌ 一次导航翻多页：翻页用 click 分页器或 next_page，不要重新 navigate 整个 URL（除非是查询参数分页）

## 调用约定
- 所有工具参数都传字符串/简单 JSON
- CSS 选择器语法（支持 :has-text("下一页")）
- 交互链最后一步通常是 browser_get_content 或 browser_screenshot 收尾`

/** 注册单个 load 工具：把使用引导注入模型上下文 */
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'nexus_browser_guide',
    description: '读取 nexus-browser 使用引导（17 个 MCP 工具选择决策树）。执行任何 web_task/browser_* 任务前，如果对选哪个工具不确定，先调用本工具。会返回完整决策树 + 工具职责速查 + 反模式红线。',
    parameters: {
      input: {
        type: 'object',
        additionalProperties: false,
        properties: {
          focus: {
            type: 'string',
            description: '可选。只返回决策树某一段（web_task / interaction / navigate_page / attach / evaluate），返回更短。',
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { guide: { type: 'string', required: true } },
      },
      render: (args, value) => [{ type: 'text', text: value.guide }],
    },
    async execute(args) {
      const focus = args?.input?.focus
      if (!focus) return { guide: GUIDE }
      // 按关注点截取：找到对应段落首行，返回从该段到文件结束的子串
      const headers = ['# nexus-browser 使用引导', '### A.', '### B.', '### C.', '### D.', '### E.', '## 工具职责速查', '## 反模式']
      const anchor = headers.find((h) => h.toLowerCase().includes(focus.toLowerCase()))
      const idx = anchor ? GUIDE.indexOf(anchor) : -1
      if (idx === -1) return { guide: `未找到与 "${focus}" 匹配的段落。可用焦点：web_task / interaction / navigate_page / attach / evaluate / tools / redline` }
      return { guide: `（聚焦: ${focus}）\n\n${GUIDE.slice(idx)}` }
    },
  }))
  ctx.logger?.info?.(`${name}: 已注册 nexus_browser_guide 工具`)
}

