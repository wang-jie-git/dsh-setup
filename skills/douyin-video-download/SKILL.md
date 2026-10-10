---
name: douyin-video-download
description: 抖音（Douyin）视频下载的标准操作流程。当用户要求下载抖音视频、处理抖音分享口令/短链接（如 "长按复制打开抖音，即可查看文章"，v.douyin.com 短链，TiZg1uZz399 格式的视频 ID），或遇到"链接中的视频找不到/下载失败/解析不出地址"时使用。本技能解决的核心痛点：抖音使用 JS 混淆（JSSVM）+ 动态跳转 + 反爬签名，直接 curl/裸 API 全部失败；必须用带登录态的浏览器打开短链 → 提取真实 aweme_id → 从页面/接口拿视频地址 → 再下载。The authoritative SOP for downloading Douyin videos via the authenticated browser session — share links, short codes, and "missing video" failures trigger this skill.
license: MIT
metadata:
  author: One-Prime
  version: "1.0.0"
---

# 抖音视频下载 SOP

## 何时使用
- 用户给出抖音分享文本/口令（含 `https://v.douyin.com/xxxx/` 短链或 `TiZg1uZz399` 格式的分享码）
- 用户说「下载这条抖音视频」「解析视频地址」「链接里的视频找不到」
- 前一次尝试失败（下载到的是 HTML、502、找不到视频）

## 核心原则（先记住，再动手）
1. **不要**用 `curl`/`video_url_analyze`/`video_download` 直接处理抖音分享链接——那是 HTML 跳转页，不是媒体流，100% 失败。
2. **必须**用 `mcp__nexus_browser__browser_navigate`（已附着登录态的真实浏览器）打开链接，让 JS 跳转完成。
3. 抖音页面有 **JSSVM 混淆**（页面 JS 反爬），从 HTML 里正则找视频地址不可靠；**优先走 aweme_id + 接口**。
4. 所有网络操作都在带登录态的浏览器上下文里做，避免风控。

## 标准流程（四步）

### 第一步：从分享文本提取视频 ID
- 短链格式：`https://v.douyin.com/iTiZg1uZz399/` → 分享码 = `iTiZg1uZz399`
- 视频页格式：`https://www.douyin.com/video/TiZg1uZz399` → ID = `TiZg1uZz399`
- 数字格式：长串数字（如 `7396826161830587950`）= 已经是 aweme_id，直接用

### 第二步：用真实浏览器打开短链，解析跳转
调用 `mcp__nexus_browser__browser_navigate`：
```
url: "https://v.douyin.com/<分享码>/"
```
浏览器会自动跳转到真实视频页。跳转后 URL 形如：
- `https://www.douyin.com/video/<aweme_id>` （新版）
- `https://www.iesdouyin.com/share/video/<aweme_id>` （分享页）
- `?modal_id=<aweme_id>` （直播间/带参形式）

从跳转后的最终 URL 里提取 **aweme_id**（19 位数字或 TiZg 格式均可直接作为 ID 使用）。

### 第三步：获取真实视频地址（两条路径，优先路径 A）
**路径 A（推荐）：浏览器内取接口**
用 `mcp__nexus_browser__browser_evaluate` 在已打开的抖音页面里执行 JS：
```js
// 从 window 全局或页面数据找视频地址
(() => {
  const urls = [];
  // 尝试 RENDER_DATA（旧分享页）
  const rd = document.getElementById('RENDER_DATA');
  if (rd) { /* JSON 里找 play_addr / playApi / uri 字段 */ }
  // 尝试 window._ROUTER_DATA（新版）
  const r = window._ROUTER_DATA;
  if (r) { /* 遍历找 video.play_addr.url_list */ }
  // 尝试 video 标签
  document.querySelectorAll('video').forEach(v => v.src && urls.push(v.src));
  return urls;
})()
```

**路径 B：aweme detail 接口（需要浏览器 cookie，用 browser_evaluate fetch 发起）**
在登录态页面的浏览器上下文里执行：
```js
await fetch('https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=<ID>', {
  headers: { 'User-Agent': navigator.userAgent }
}).then(r => r.json())
  .then(d => d.aweme_detail.video.play_addr.url_list)
```
> 必须带页面的 cookie 和浏览器 UA；`a_bogus` 签名参数**不要自己拼**——用页面内 fetch 让浏览器自动带签名，或用 eval 读 RENDER_DATA。

### 第四步：用 video_download 下载真实媒体地址
拿到真实媒体 URL（通常形如 `https://www.douyin.com/aweme/v1/play/?video_id=xxx&ratio=720p` 或 CDN `https://...bytegecko.com/...`）后：
```
video_download
  url: <真实媒体地址>
  headers: { "Referer": "https://www.douyin.com/", "User-Agent": "Mozilla/5.0 ... Chrome/151..." }
```
> 默认输出路径已设为 Obsidian 作品仓库（`/Users/mac/Documents/ObsidianVault/2.项目/dsh 项目/6.自媒体工作台插件/作品/`），无需传 `outPath`。如需指定文件名，传 `outPath` 参数覆盖。Referer 必须填抖音域名，否则 CDN 拒连。

## 反面清单（这些操作不要做，浪费轮次）
- ❌ 对 `v.douyin.com` 短链直接 `video_download` / `curl` —— 下到的是 HTML
- ❌ 裸调 `api.amemv.com`、`douyin.wiki`、`iesdouyin.com/web/api` 等第三方 API —— 已被反爬墙
- ❌ 用搜索引擎搜分享码（`web_search "TiZg1uZz399"`）—— 搜不到，浪费
- ❌ 反复 `video_url_analyze` —— 它只是 URL 分类器，不解析视频
- ❌ 在无登录态的 headless 浏览器里开抖音 —— 会被滑块验证拦截

## 成功判定
- 下载产物 `file` 命令输出为 `MP4`/`WebM` 视频格式（不是 text/html）
- 文件大小 > 1MB（抖音视频正常 1-50MB）
- 用户能在本地播放

## 完成后的产出
保存在作品仓库：`/Users/mac/Documents/ObsidianVault/2.项目/dsh 项目/6.自媒体工作台插件/作品/<日期>-<视频标题>.mp4`