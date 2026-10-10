/**
 * adapters.test.mjs — dsh-web-search-wigolo 适配器测试（node:test）。
 *
 * 验收标准（来自 doublecheck spec）：
 *  1) 用 wigolo 0.2.1 真实输出的 search JSON 跑 adaptSearchResult，
 *     结果数组非空且每项 snippet 非空；
 *  2) 用真实 fetch JSON 跑 adaptFetchResult，返回 statusCode 200 且
 *     body.content 为页面 markdown；kind 为 text。
 *
 * 两种运行模式（同一套断言）：
 *  - 默认：导入 src/index.js 的修复后适配器 → 应全部通过（GREEN）
 *  - OLD=1：导入 fixtures/old-adapters.mjs 的修复前逻辑 → 应失败（RED）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const useOld = process.env.OLD === '1'

const adapters = useOld
  ? await import('./fixtures/old-adapters.mjs')
  : await import('../src/index.js')

const searchJson = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'search-real.json'), 'utf8')
)
const fetchJson = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'fetch-real.json'), 'utf8')
)

test(`[${useOld ? 'RED:old-mapping' : 'GREEN:fixed'}] search adapter yields non-empty snippets`, () => {
  const { sources, truncated } = adapters.adaptSearchResult(searchJson)
  assert.equal(truncated, false)
  assert.ok(sources.length > 0, 'sources should not be empty')
  for (const s of sources) {
    assert.ok(s.url, 'source url missing')
    assert.ok(s.title, 'source title missing')
    assert.ok(s.snippet && s.snippet.length > 0, `source snippet empty: ${s.url}`)
  }
})

test(`[${useOld ? 'RED:old-mapping' : 'GREEN:fixed'}] fetch adapter yields 200 + markdown body`, () => {
  const { statusCode, body } = adapters.adaptFetchResult(fetchJson, fetchJson.url)
  assert.equal(statusCode, 200)
  assert.ok(body.content && body.content.length > 0, 'fetch body content empty')
  assert.ok(body.content.includes('This domain is for use'), 'markdown body mismatch')
  assert.equal(body.kind, 'text')
})