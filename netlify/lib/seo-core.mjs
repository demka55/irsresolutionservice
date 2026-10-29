// netlify/lib/seo-core.mjs
// The rank tracker behind the /seo "SEO" tab.
//
// Process:
//   1. Read the last 30 days of bot visits (logged by the ai-bot-tracker edge function).
//   2. Focus = pages that an AI assistant (ChatGPT, Claude, DuckDuckGo, Perplexity, Gemini) fetched.
//   3. For each focus page's keywords, check Google (ValueSERP, incl. AI Overview) and Bing (SerpApi).
//   4. Save one record per page, keeping the previous position so the dashboard can show movement.
import { getStore } from '@netlify/blobs'
import { BRANDS, BRAND_OF, normPath } from './bots.js'
import { listEvents } from './bot-events.mjs'
import { DEFAULT_KEYWORDS } from './seo-keywords.mjs'

export const STORE       = 'seo-tracking'
export const SITE        = 'irsresolutionservice.com'
export const FOCUS_DAYS  = 30
const KWMAP_KEY   = 'v2:keyword-map'
const STATUS_KEY  = 'v2:run-status'
const HISTORY_KEY = 'v2:history'
export const pageKey = (path) => `v2:page:${path}`

const CALL_TIMEOUT  = 60000          // ValueSERP's AI Overview can take up to ~60s
const PAGE_WORKERS  = 4              // pages checked at the same time
const TIME_BUDGET   = 13 * 60 * 1000 // stop starting new pages before the 15-min background limit

export const tryParse = (r) => { try { return r ? JSON.parse(r) : null } catch { return null } }
const AI_BRANDS = new Set(BRANDS.filter((b) => b.ai).map((b) => b.id))

// ── Keywords per page ────────────────────────────────────────────────────────
export async function getKeywordMap(store = getStore(STORE)) {
  const saved = tryParse(await store.get(KWMAP_KEY).catch(() => null)) || {}
  return { ...DEFAULT_KEYWORDS, ...saved }
}
export async function setPageKeywords(path, list, store = getStore(STORE)) {
  const saved = tryParse(await store.get(KWMAP_KEY).catch(() => null)) || {}
  const clean = [...new Set((list || []).map((k) => String(k).trim()).filter(Boolean))].slice(0, 10)
  saved[normPath(path)] = clean
  await store.set(KWMAP_KEY, JSON.stringify(saved))
  return clean
}

// ── Bot visits per page ──────────────────────────────────────────────────────
// Fake bots (IP not on the company's published list) are left out.
export function pageStats(events) {
  const stats = new Map()
  for (const e of events) {
    if (e.verified === 'n') continue
    const brand = BRAND_OF[e.who]
    if (!brand) continue
    let s = stats.get(e.path)
    if (!s) stats.set(e.path, (s = { brands: {}, ai: 0, total: 0, lastAI: 0, last: 0 }))
    s.brands[brand] = (s.brands[brand] || 0) + 1
    s.total++
    if (e.ts > s.last) s.last = e.ts
    if (AI_BRANDS.has(brand)) { s.ai++; if (e.ts > s.lastAI) s.lastAI = e.ts }
  }
  return stats
}
export function focusPaths(stats) {
  return [...stats.entries()].filter(([, s]) => s.ai > 0)
    .sort((a, b) => b[1].ai - a[1].ai || b[1].total - a[1].total).map(([p]) => p)
}

// ── Result parsing helpers ───────────────────────────────────────────────────
function ours(link) {
  try { const h = new URL(link).hostname.toLowerCase(); return h === SITE || h.endsWith('.' + SITE) } catch { return false }
}
function samePage(link, path) {
  try { return ours(link) && normPath(new URL(link).pathname) === path } catch { return false }
}
// From an organic list [{position, link}] → our best position and this page's position (top 10 only).
function rankFrom(list, path) {
  const out = { pos: null, url: null, pagePos: null }
  ;(list || []).forEach((r, i) => {
    const link = String(r.link || r.url || '')
    if (!ours(link)) return
    const pos = Number(r.position) || i + 1
    if (out.pos === null || pos < out.pos) { out.pos = pos; out.url = link }
    if (samePage(link, path) && (out.pagePos === null || pos < out.pagePos)) out.pagePos = pos
  })
  return out
}

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(CALL_TIMEOUT) })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg += ': ' + (JSON.parse(text).error || JSON.parse(text).message || text.slice(0, 150)) } catch { msg += text ? ': ' + text.slice(0, 150) : '' }
    const err = new Error(msg); err.retry = res.status >= 500 || res.status === 429; throw err
  }
  if (!text.trim()) { const e = new Error('Empty response'); e.retry = true; throw e }
  return JSON.parse(text)
}

// One retry for timeouts, 5xx and rate limits.
async function withRetry(fn) {
  try { return await fn() } catch (e) {
    const retry = e.retry || /timeout|aborted|fetch failed|ECONN|socket/i.test(e.message || '')
    if (!retry) throw e
    await new Promise((r) => setTimeout(r, 3000))
    return fn()
  }
}

// ── Google (ValueSERP) ───────────────────────────────────────────────────────
export async function checkGoogle(keyword, path, apiKey) {
  const out = { pos: null, url: null, pagePos: null, inAio: false, cited: false, citedUrl: null, error: null, checkedAt: new Date().toISOString() }
  if (!apiKey) { out.error = 'VALUESERP_API not set'; return out }
  try {
    const params = new URLSearchParams({
      api_key: apiKey, q: keyword, google_domain: 'google.com', gl: 'us', hl: 'en',
      device: 'desktop', include_ai_overview: 'true', num: '10',
    })
    const data = await withRetry(() => getJSON(`https://api.valueserp.com/search?${params}`))
    // AI Overview sometimes arrives later via page_token
    const token = data.page_token || data.ai_overview?.page_token
    if (token && !data.ai_overview?.text_blocks?.length && !data.ai_overview?.snippet) {
      try {
        const t = await getJSON(`https://api.valueserp.com/search?api_key=${encodeURIComponent(apiKey)}&page_token=${encodeURIComponent(token)}`)
        if (t.ai_overview) data.ai_overview = t.ai_overview
      } catch {}
    }
    Object.assign(out, rankFrom(data.organic_results, path))
    const aio = data.ai_overview
    if (aio) {
      out.inAio = true
      const srcs = [...(aio.ai_overview_sources || []), ...(aio.sources || []), ...(aio.references || [])]
      const hit = srcs.map((s) => String(s.link || s.url || '')).find(ours)
      out.cited = !!hit || JSON.stringify(aio).toLowerCase().includes(SITE)
      out.citedUrl = hit || null
    }
  } catch (e) { out.error = e.name === 'TimeoutError' ? 'Google check timed out twice' : e.message }
  return out
}

// ── Bing (SerpApi) ───────────────────────────────────────────────────────────
export async function checkBing(keyword, path, apiKey) {
  const out = { pos: null, url: null, pagePos: null, error: null, checkedAt: new Date().toISOString() }
  if (!apiKey) { out.error = 'SERPAPI_KEY not set'; return out }
  try {
    const params = new URLSearchParams({ engine: 'bing', q: keyword, cc: 'US', mkt: 'en-US', device: 'desktop', api_key: apiKey })
    const data = await withRetry(() => getJSON(`https://serpapi.com/search.json?${params}`))
    if (data.error && !/hasn't returned any results/i.test(data.error)) throw new Error(data.error)
    Object.assign(out, rankFrom(data.organic_results, path))
  } catch (e) { out.error = e.name === 'TimeoutError' ? 'Bing check timed out twice' : e.message }
  return out
}

// ── One page: all its keywords, Google + Bing, in parallel ───────────────────
async function checkPage(store, path, keywords, keys) {
  const old = tryParse(await store.get(pageKey(path)).catch(() => null))
  const rec = { path, checkedAt: new Date().toISOString(), keywords: {} }
  await Promise.all(keywords.map(async (kw) => {
    const [google, bing] = await Promise.all([checkGoogle(kw, path, keys.google), checkBing(kw, path, keys.bing)])
    const prev = old?.keywords?.[kw]
    // keep yesterday's position for the movement arrow; on an error keep the last good result
    for (const [name, r] of [['google', google], ['bing', bing]]) {
      const p = prev?.[name]
      if (r.error && p && !p.error) { rec.keywords[kw] = rec.keywords[kw] || {}; rec.keywords[kw][name] = { ...p, staleError: r.error }; continue }
      if (p && !p.error) { r.prevPos = p.pos; r.prevAt = p.checkedAt }
      rec.keywords[kw] = rec.keywords[kw] || {}
      rec.keywords[kw][name] = r
    }
  }))
  await store.set(pageKey(path), JSON.stringify(rec))
  return rec
}

export async function readStatus(store = getStore(STORE)) {
  return tryParse(await store.get(STATUS_KEY).catch(() => null))
}
export async function readHistory(store = getStore(STORE)) {
  return tryParse(await store.get(HISTORY_KEY).catch(() => null)) || []
}

// ── Full run (or one page with { only: '/path' }) ────────────────────────────
export async function runChecks({ only = null } = {}) {
  const t0 = Date.now()
  const store = getStore(STORE)
  const keys = { google: Netlify.env.get('VALUESERP_API') || '', bing: Netlify.env.get('SERPAPI_KEY') || '' }

  const [events, map] = await Promise.all([listEvents(FOCUS_DAYS), getKeywordMap(store)])
  const stats = pageStats(events)
  const paths = only ? [normPath(only)] : focusPaths(stats)
  const queue = paths.filter((p) => (map[p] || []).length)

  const status = {
    state: 'running', only, startedAt: new Date().toISOString(),
    pages: queue.length, pagesDone: 0, keywords: queue.reduce((n, p) => n + map[p].length, 0), errors: 0,
  }
  await store.set(STATUS_KEY, JSON.stringify(status))

  const results = []
  let i = 0, stopped = false
  const worker = async () => {
    while (i < queue.length) {
      if (Date.now() - t0 > TIME_BUDGET) { stopped = true; return }
      const path = queue[i++]
      const rec = await checkPage(store, path, map[path], keys)
      results.push(rec)
      status.pagesDone++
      status.errors += Object.values(rec.keywords).reduce((n, k) => n + (k.google?.error || k.google?.staleError ? 1 : 0) + (k.bing?.error || k.bing?.staleError ? 1 : 0), 0)
      await store.set(STATUS_KEY, JSON.stringify(status)).catch(() => {})
    }
  }
  await Promise.all(Array.from({ length: PAGE_WORKERS }, worker))

  status.state = stopped ? 'partial' : 'done'
  status.finishedAt = new Date().toISOString()
  await store.set(STATUS_KEY, JSON.stringify(status))

  if (!only) {
    // one trend point per day
    const kws = results.flatMap((r) => Object.values(r.keywords))
    const point = {
      date: status.finishedAt.slice(0, 10),
      pages: queue.length,
      keywords: kws.length,
      googleTop10: kws.filter((k) => k.google?.pos).length,
      bingTop10: kws.filter((k) => k.bing?.pos).length,
      aioCited: kws.filter((k) => k.google?.cited).length,
    }
    let hist = (await readHistory(store)).filter((h) => h.date !== point.date)
    hist.unshift(point)
    await store.set(HISTORY_KEY, JSON.stringify(hist.slice(0, 90)))
  }
  return status
}
