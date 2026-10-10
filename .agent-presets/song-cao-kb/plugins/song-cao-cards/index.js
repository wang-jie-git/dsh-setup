// song-cao-cards — 场景卡管理面板（preset song-cao-kb 的 client UI 扩展）
//
// 在对话区输入框上方渲染一个紧凑条（composer.slot.top 优先，fallback 链）：
//   - 下拉选卡（cards/*.json）
//   - 「出包」→ 预填"读卡出 H3 提示词包"指令进输入框
//   - 「浏览」→ 展开 details 区，列卡清单 + 提示编辑路径
//
// 数据走包内 host.call('listCards')（host 段读 prompt-factory/）；纯 JS，无 JSX。

export const name = 'song-cao-cards'
export const inject = ['slots']

const CARDS_DIR = '/Users/mac/Desktop/宋式美学智能体/prompt-factory/cards'
const SLOT_CANDIDATES = [
  'composer.slot.top',
  'composer.above',
  'chat.composer.top',
  'chat.top',
  'shell.overlay',
]

export function apply(ctx) {
  // 优先注入 composer 上方；逐个 fallback 到 shell.overlay
  for (const slot of SLOT_CANDIDATES) {
    try {
      ctx.slots.register(slot, {
        id: 'song-cao-cards-dock',
        label: '场景卡',
        component: makeComponent(ctx),
      })
      ctx.console.log('[song-cao-cards] 注册到', slot)
      return
    } catch (e) {
      ctx.console.log('[song-cao-cards] slot 不存在:', slot, e && e.message)
    }
  }
  ctx.console.error('[song-cao-cards] 所有候选 slot 注册失败')
}

function makeComponent(ctx) {
  const React = ctx.get('React')
  const host = ctx.get('host')
  const styles = ctx.get('styles')

  // 包内样式（随 run 清理）
  ctx.effect(() => {
    if (styles) {
      return styles.insert(`
        .sc-cards-dock{display:flex;align-items:center;gap:10px;padding:6px 12px;font-size:12px;border-bottom:1px solid var(--dsh-border,#e5e5e5);background:var(--dsh-surface-2,#fafafa);width:100%;box-sizing:border-box;}
        .sc-cards-dock .sc-title{font-weight:600;color:var(--dsh-text-2,#555);}
        .sc-cards-dock select{flex:1;min-width:140px;font-size:12px;padding:2px 6px;border-radius:4px;border:1px solid var(--dsh-border,#ccc);background:var(--dsh-surface,#fff);}
        .sc-cards-dock button{font-size:12px;padding:3px 10px;border-radius:4px;border:1px solid var(--dsh-accent,#444);background:transparent;color:var(--dsh-text-1,#222);cursor:pointer;}
        .sc-cards-dock button.sc-primary{background:var(--dsh-accent,#444);color:#fff;}
        .sc-cards-detail{padding:8px 12px;border-top:1px solid var(--dsh-border,#e5e5e5);background:var(--dsh-surface-1,#fff);font-size:12px;line-height:1.7;}
        .sc-cards-detail .sc-hint{font-size:11px;color:var(--dsh-text-3,#888);margin-bottom:6px;}
        .sc-cards-detail ul{margin:0;padding-left:16px;}
        .sc-cards-detail li{opacity:0.7;}
        .sc-cards-detail li.sc-selected{opacity:1;font-weight:600;}
      `)
    }
  }, 'styles')

  function CardsDock() {
    const [cards, setCards] = React.useState([])
    const [selected, setSelected] = React.useState('')
    const [expanded, setExpanded] = React.useState(false)
    const [loading, setLoading] = React.useState(true)
    const [preFilled, setPreFilled] = React.useState(false)

    React.useEffect(() => {
      let disposed = false
      async function load() {
        try {
          const res = await host.call('listCards')
          if (!disposed && res && Array.isArray(res.cards)) {
            setCards(res.cards)
            setSelected((s) => s || (res.cards[0] && res.cards[0].name) || '')
          }
        } catch (e) {
          ctx.console.log('[song-cao-cards] host.call 失败，用静态清单:', e && e.message)
        } finally {
          if (!disposed) setLoading(false)
        }
      }
      load()
      return () => { disposed = true }
    }, [])

    function doPreFill() {
      if (!selected) return
      const directive = '先调 song_cao_trend 取当前模式趋势关键词（市场层），再用 song_cao_prompt 读卡 ' + selected + '，按 §11.6 九节模板出 MiniMax H3 提示词包（完整 9 节 + 一句话粘贴版；§8 参考节注入 song_cao_trend 返回的趋势词）'
      const input = document.querySelector('[contenteditable="true"], textarea.input, .composer-input')
      if (input) {
        if (input.tagName === 'TEXTAREA') input.value = directive
        else input.textContent = directive
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.focus()
      } else {
        ctx.console.log('[song-cao-cards] 未找到输入框，请手动粘贴:', directive)
      }
      setPreFilled(true)
      const cleanup = ctx.get('timer')
      if (cleanup && cleanup.timeout) cleanup.timeout(() => setPreFilled(false), 3000)
      else setTimeout(() => setPreFilled(false), 3000)
    }

    const dock = React.createElement('div', { 'data-song-cao-cards': 'dock', className: 'sc-cards-dock' }, [
      React.createElement('span', { key: 't', className: 'sc-title' }, '场景卡'),
      React.createElement('select', {
        key: 's',
        value: selected,
        disabled: loading,
        onChange: (e) => setSelected(e.target.value),
      }, loading
        ? [React.createElement('option', { key: 'l' }, '加载中…')]
        : cards.map((c) => React.createElement('option', { key: c.name, value: c.name }, c.name))),
      React.createElement('button', {
        key: 'g',
        className: preFilled ? 'sc-primary' : '',
        disabled: !selected,
        onClick: doPreFill,
      }, preFilled ? '已预填 ✓' : '出包'),
      React.createElement('button', {
        key: 'd',
        onClick: () => setExpanded((v) => !v),
      }, expanded ? '收起' : '浏览'),
    ])

    const detail = expanded
      ? React.createElement('div', { className: 'sc-cards-detail' }, [
          React.createElement('div', { key: 'h', className: 'sc-hint' },
            '编辑卡：/Users/mac/Desktop/宋式美学智能体/prompt-factory/cards/ 下对应 .json；出图：投 MiniMax H3'),
          React.createElement('ul', { key: 'u' },
            cards.map((c) => React.createElement('li', {
              key: c.name,
              className: c.name === selected ? 'sc-selected' : '',
            }, c.name))),
        ])
      : null

    return React.createElement('div', { 'data-song-cao-cards': 'wrap' }, [dock, detail])
  }

  return CardsDock
}

// ── host 段：包内 JSON RPC（client→host）─────────────────────────────
export function host(ctx) {
  // listCards：读 CARDS_DIR 下所有 .json 卡，返回文件名 + title
  const fs = ctx.get('fs')
  ctx.harness.handle('listCards', async () => {
    const cards = []
    try {
      const dir = await fs.resolve(CARDS_DIR)
      const entries = await fs.readdir(dir)
      for (const name of entries.filter((f) => f.endsWith('.json'))) {
        try {
          const text = await fs.readText(await fs.resolve(CARDS_DIR + '/' + name))
          const parsed = JSON.parse(text)
          cards.push({
            name,
            title: (parsed.card && parsed.card.title) || name,
          })
        } catch (e) {
          cards.push({ name, title: name, error: String(e.message || e) })
        }
      }
    } catch (e) {
      return { cards, error: '目录读取失败：' + String(e.message || e) }
    }
    return { cards }
  })
}
