/**
 * old-adapters.mjs — 修复前的适配逻辑（作为 RED 对照）。
 * 与 src/index.js 修复前完全一致：读 content/published/statusCode/contentType，
 * 而 wigolo 0.2.1 实际返回 snippet/published_date/markdown/http_status。
 * 仅测试夹具用，不参与运行时。
 */
export function adaptSearchResult(wigoloJson) {
  const sources = (wigoloJson.results ?? []).map((r) => ({
    url: r.url ?? '',
    title: r.title ?? '',
    snippet: (r.content ?? '').slice(0, 500),
    publishedAt: r.published ?? undefined,
  }))
  return { sources, truncated: false }
}

export function adaptFetchResult(wigoloJson, requestUrl) {
  const statusCode = wigoloJson.statusCode ?? 200
  const content = wigoloJson.content ?? ''
  const isHtml = (wigoloJson.contentType ?? '').includes('html') || content.includes('<html')
  return {
    url: wigoloJson.url ?? requestUrl,
    statusCode,
    body: { kind: isHtml ? 'html' : 'text', content },
    truncated: false,
  }
}