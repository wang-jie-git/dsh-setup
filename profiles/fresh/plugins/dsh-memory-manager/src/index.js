// dsh-memory-manager — AI Memory 管理页面（DSH 内嵌）
// 代理 /ai-memory 路由到 memory-viewer (port 8788)
// 自动启动 viewer 进程（sidecar 模式）

import { spawn, execSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { accessSync, readFileSync } from 'node:fs'

export const name = 'dsh-memory-manager'
export const inject = ['webServer']

const VIEWER_BASE = 'http://127.0.0.1:8788'
let viewerProcess = null

// 查找 AI-memory 项目根目录（向上查找 package.json with "ai-memory"）
function findProjectRoot() {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
      if (pkg.name === 'ai-memory' || dir.endsWith('AI-memory')) return dir
    } catch {}
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  // fallback
  return (process.env.HOME || '/Users/mac') + '/Desktop/AI-memory'
}

// 端口占用检测：macOS/Linux 用 lsof（mDNSResponder 等也会监听，但 8788 通常专用）
function isPortBusy(port) {
  try {
    execSync(`lsof -i :${port} -sTCP:LISTEN`, { stdio: 'ignore', timeout: 2000 })
    return true
  } catch { return false }
}

function startViewer() {
  if (viewerProcess) return // 已启动

  // 端口预检：8788 已有监听（如其他实例/手动启动）则跳过，避免 EADDRINUSE 无限重启
  if (isPortBusy(8788)) {
    console.log('[Memory Manager] 8788 已被占用，跳过自动启动（其他 viewer 实例在运行）')
    return
  }

  const root = findProjectRoot()
  const viewerPath = resolve(root, 'dist', 'ai-memory-viewer.mjs')
  // 数据目录与 ai-memory-mcp 保持一致（~/.local/share/ai-memory 是 MCP 写入的最新库；
  // Desktop/AI-memory/.codegraph 是旧库，两者不同步会导致 viewer 看不到新记忆）
  const codegraphDir = process.env.AI_MEMORY_CODEGRAPH_DIR || (process.env.HOME || '/Users/mac') + '/.local/share/ai-memory'

  try {
    accessSync(viewerPath)
  } catch {
    console.log('[Memory Manager] viewer 未构建，跳过自动启动')
    return
  }

  console.log(`[Memory Manager] 启动 viewer: ${viewerPath}`)
  viewerProcess = spawn('node', [viewerPath], {
    env: { ...process.env, AI_MEMORY_CODEGRAPH_DIR: codegraphDir, AI_MEMORY_VIEWER_PORT: '8788' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  viewerProcess.stdout.on('data', (d) => process.stdout.write(`[Viewer] ${d}`))
  viewerProcess.stderr.on('data', (d) => process.stderr.write(`[Viewer] ${d}`))
  viewerProcess.on('exit', (code) => {
    console.log(`[Memory Manager] viewer 退出 (code=${code})`)
    viewerProcess = null
    // 意外退出（非主动停止）时延迟 3s 自动重启，保证 /ai-memory 面板可用
    // stopViewer() 会把进程置 null 并设置 viewerStopping 标志，避免与自动重启竞争
    if (!viewerStopping) {
      setTimeout(startViewer, 3000)
    }
  })
  viewerProcess.on('error', (err) => {
    console.error(`[Memory Manager] viewer 启动失败:`, err.message)
    viewerProcess = null
    viewerStopping = false
  })
}

let viewerStopping = false

function stopViewer() {
  viewerStopping = true
  if (viewerProcess) {
    viewerProcess.kill('SIGTERM')
    setTimeout(() => { if (viewerProcess) viewerProcess.kill('SIGKILL') }, 3000)
    viewerProcess = null
  }
}

// 返回按钮脚本：注入到 /ai-memory 页面，× 关闭按钮（右上角）+ ESC 返回
const BACK_BTN_SCRIPT = `
<script>
;(function(){
  if (document.querySelector('[data-dsh-return-btn]')) return;
  var btn = document.createElement('button');
  btn.setAttribute('data-dsh-return-btn', '');
  btn.textContent = '×';
  btn.title = '返回工作台 (ESC)';
  btn.style.cssText = 'position:fixed;top:16px;right:16px;z-index:999999;' +
    'width:36px;height:36px;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(30,41,59,.7);border:1px solid rgba(148,163,184,.2);' +
    'color:#9ca3af;border-radius:8px;font-size:20px;font-weight:400;' +
    'font-family:system-ui,-apple-system,sans-serif;cursor:pointer;' +
    'transition:all .15s;';
  btn.onmouseenter = function(){ btn.style.background = 'rgba(51,65,85,.9)'; btn.style.color = '#e5e7eb'; };
  btn.onmouseleave = function(){ btn.style.background = 'rgba(30,41,59,.7)'; btn.style.color = '#9ca3af'; };
  btn.onclick = function(){ window.location.href = '/'; };
  document.body.appendChild(btn);
  document.addEventListener('keydown', function escBack(e){
    if (e.key === 'Escape') { window.location.href = '/'; }
  });
})();
</script>`

export function apply(ctx, cfg = {}) {
  const webServer = ctx.webServer
  if (!webServer) {
    ctx.logger?.warn?.('[Memory Manager] webServer 不可用，跳过')
    return
  }

  ctx.logger?.info?.('[Memory Manager] 注册 /ai-memory 路由 (代理到 viewer:8788)')

  // 启动 viewer 作为 sidecar
  startViewer()

  // DSH 关闭时停止 viewer
  ctx.on('dispose', () => stopViewer())

  // 注入"记忆系统"入口到 DSH 设置面板（VOzbGW_navList），克隆真实 navCell 保证样式一致
  // 设置面板是懒加载（点击齿轮才渲染 navList），用 MutationObserver 监听而非定时轮询
  webServer.tapIndex((html) => {
    const sidebarScript = `<script>
;(function(){
  function inject(){
    if (document.querySelector('[data-dsh-memory-entry]')) return;
    // 设置面板的导航列表（点击"设置"齿轮后才渲染，需每次面板打开时检查）
    var navList = document.querySelector('[class*="VOzbGW_navList"]');
    if (!navList) return;
    var template = navList.querySelector('[class*="VOzbGW_navCell"]');
    if (!template) return;
    var entry = template.cloneNode(true);
    entry.setAttribute('data-dsh-memory-entry', '');
    // 保留克隆的图标（第一个 navCell 是"通用设置"，自带齿轮图标），与菜单组样式统一
    // 改文字为"记忆系统"
    var label = entry.querySelector('[class*="navLabel"]');
    if (label) label.textContent = '记忆系统';
    entry.title = '记忆系统管理面板';
    entry.onclick = function(e){ e.preventDefault(); e.stopPropagation(); window.location.href = '/ai-memory'; };
    navList.appendChild(entry);
  }
  // 启动时先试一次 + MutationObserver 持续监控（面板懒加载也能捕获）
  inject();
  try {
    var obs = new MutationObserver(function(muts){
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1 && added[j].querySelector) {
            if (added[j].querySelector('[class*="VOzbGW_navList"]')) { inject(); return; }
            if ((added[j].className || '').toString().indexOf('navList') >= 0) { inject(); return; }
          }
        }
      }
    });
    var root = document.querySelector('#root') || document.body;
    obs.observe(root, { childList: true, subtree: true });
  } catch(e) {}
  // 定期兜底（React 重渲染可能重建 navList，确保重新注入）
  setInterval(inject, 2000);
})();
</script>`
    return html.replace('</body>', sidebarScript + '</body>')
  })

  // 注册 /ai-memory 路由（代理到 viewer:8788）
  webServer.register({
    path: '/ai-memory',
    handler: async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`)
      res.setHeader('Access-Control-Allow-Origin', '*')
      if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

      // 计算 viewer 路径：去掉 /ai-memory 前缀
      const viewerPath = url.pathname.replace(/^\/ai-memory/, '') || '/'
      const targetUrl = `${VIEWER_BASE}${viewerPath}${url.search}`

      try {
        const proxyRes = await fetch(targetUrl, {
          method: req.method,
          headers: req.method === 'POST' ? { 'Content-Type': 'application/json' } : {},
          body: req.method === 'POST' ? await new Promise((r) => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)) }) : undefined,
        })
        const body = await proxyRes.text()
        const contentType = proxyRes.headers.get('content-type') || 'application/json'
        res.writeHead(proxyRes.status, { 'Content-Type': contentType })
        // 替换页面中的 API 路径为 /ai-memory 代理路径
        if (contentType.includes('text/html')) {
          const proxied = body.replace(/\/api\//g, '/ai-memory/api/')
          res.end(proxied.replace('</body>', BACK_BTN_SCRIPT + '</body>'))
        } else {
          res.end(body)
        }
      } catch (e) {
        ctx.logger?.warn?.('[Memory Manager] 代理错误:', e.message)
        const isApi = url.pathname.includes('/api/')
        res.writeHead(502, { 'Content-Type': isApi ? 'application/json' : 'text/html; charset=utf-8' })
        if (isApi) {
          res.end(JSON.stringify({ error: 'Viewer unavailable' }))
        } else {
          res.end(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
          <title>AI Memory</title><style>
          body{font-family:sans-serif;background:#0f1117;color:#e1e4e8;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column}
          .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:32px;text-align:center;max-width:400px}
          h2{color:#58a6ff;margin-bottom:12px}
          p{color:#8b949e;font-size:.9em;margin-bottom:16px;line-height:1.6}
          .btn{display:inline-block;padding:8px 20px;background:#238636;color:#fff;border-radius:6px;text-decoration:none}
          .btn:hover{background:#2ea043}
          </style></head><body>
          <div class="card"><h2>🧠 AI Memory</h2>
          <p>管理页面服务未启动 (端口 8788)</p>
          <a class="btn" href="/ai-memory">重试</a></div>${BACK_BTN_SCRIPT}</body></html>`)
        }
      }
    },
  })
}