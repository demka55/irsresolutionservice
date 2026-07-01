// netlify/functions/seo-api.mjs
// GET /api/seo-track?action=results           — stored results (public)
// GET /api/seo-track?action=run&password=xxx  — trigger check (protected, returns immediately)
// GET /api/seo-track?action=status            — check if run is in progress
//
// Uses context.waitUntil() so the function returns 200 immediately
// while keyword checks run in the background (up to 15 min on free plan).

import { getStore } from '@netlify/blobs'

const STORE       = 'seo-tracking'
const RESULTS_KEY = 'latest-results'
const HISTORY_KEY = 'history'
const STATUS_KEY  = 'run-status'
const SITE        = 'irsresolutionservice.com'

const KEYWORDS = [
  "IRS hasn't replied to appeal 45 days",
  "offer in compromise 2 year rule",
  "IRS compliance last 6 years",
  "cp523 installment agreement terminated",
  "IRS expense table Bentley example",
  "haven't filed taxes in 5 years what happens",
  "IRS revenue officers Las Vegas budget cuts",
  "do nothing IRS collection statute expiring",
  "tax court petition before appeals strategy",
  "cp2000 IRS wrong how to dispute",
  "IRS got client on payment plan $440000",
  "IRS appeal officer 45 days review financials themselves",
  "IRS expense tables Bentley car payment",
  "cp523 installment agreement terminated what happens",
  "do nothing IRS CSED expiring strategy",
  "offer in compromise 2 year deemed accepted rule",
  "IRS compliance last 6 years not 10",
  "how to prepare for IRS office audit",
  "IRS OIC deemed accepted",
]

const H = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: H })

  const url    = new URL(req.url)
  const action = url.searchParams.get('action') || 'results'
  const pw     = url.searchParams.get('password') || ''

  // ── Public: return stored results ─────────────────────────────────────────
  if (action === 'results') {
    try {
      const store = getStore(STORE)
      const [raw, histRaw] = await Promise.all([
        store.get(RESULTS_KEY).catch(() => null),
        store.get(HISTORY_KEY).catch(() => null),
      ])
      return ok({
        results: raw     ? tryParse(raw)     : null,
        history: histRaw ? tryParse(histRaw) : [],
      })
    } catch (err) {
      return ok({ results: null, history: [], error: err.message })
    }
  }

  // ── Public: check run status ──────────────────────────────────────────────
  if (action === 'status') {
    try {
      const store = getStore(STORE)
      const raw = await store.get(STATUS_KEY).catch(() => null)
      const status = raw ? tryParse(raw) : { status: 'idle' }
      return ok(status)
    } catch (err) {
      return ok({ status: 'idle', error: err.message })
    }
  }

  // ── Protected: trigger run ────────────────────────────────────────────────
  const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || ''
  if (!pw || pw !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: H })
  }

  const API_KEY = Netlify.env.get('VALUESERP_API') || ''

  // Mark as running immediately
  const store = getStore(STORE)
  await store.set(STATUS_KEY, JSON.stringify({
    status: 'running',
    startedAt: new Date().toISOString(),
    total: KEYWORDS.length,
    done: 0,
  }))

  // Return 200 right away — background work continues via waitUntil
  context.waitUntil(runChecks(API_KEY, store))

  return ok({ ok: true, message: `Started — checking ${KEYWORDS.length} keywords in background. Poll action=status or action=results.` })
}

export const config = {
  path: '/api/seo-track',
  method: ['GET', 'OPTIONS'],
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: H })
const tryParse = (raw) => { try { return JSON.parse(raw) } catch { return null } }

// ── Run all keywords one at a time (safest for background) ───────────────────
async function runChecks(apiKey, store) {
  const checkedAt = new Date().toISOString()
  const results   = []

  for (let i = 0; i < KEYWORDS.length; i++) {
    const keyword = KEYWORDS[i]

    // Update progress
    await store.set(STATUS_KEY, JSON.stringify({
      status: 'running',
      startedAt: checkedAt,
      updatedAt: new Date().toISOString(),
      total: KEYWORDS.length,
      done: i,
      current: keyword,
    })).catch(() => {})

    const result = await checkKeyword(keyword, apiKey)
    results.push(result)

    // Store this keyword immediately so partial results are available
    const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
    await store.set(`kw:${slug}`, JSON.stringify(result)).catch(() => {})

    // Small gap between calls
    await sleep(200)
  }

  const inAio  = results.filter(r => r.in_aio).length
  const cited  = results.filter(r => r.site_cited).length
  const ranked = results.filter(r => r.our_pages && r.our_pages.length > 0).length

  const data = {
    checkedAt,
    summary: { total: results.length, in_aio: inAio, site_cited: cited, ranked },
    keywords: results,
  }

  await store.set(RESULTS_KEY, JSON.stringify(data)).catch(() => {})

  // Append to history
  let history = []
  try {
    const raw = await store.get(HISTORY_KEY)
    if (raw) history = tryParse(raw) || []
  } catch {}
  history.unshift({ date: checkedAt.slice(0, 10), in_aio: inAio, site_cited: cited, total: results.length })
  if (history.length > 30) history = history.slice(0, 30)
  await store.set(HISTORY_KEY, JSON.stringify(history)).catch(() => {})

  // Mark done
  await store.set(STATUS_KEY, JSON.stringify({
    status: 'done',
    checkedAt,
    total: results.length,
    done: results.length,
    in_aio: inAio,
    site_cited: cited,
    ranked,
  })).catch(() => {})
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── Check one keyword — scan full SERP response for our domain ────────────────
async function checkKeyword(keyword, apiKey) {
  const result = {
    keyword,
    in_aio:       false,
    site_cited:   false,
    aio_text:     null,
    aio_sources:  [],
    our_pages:    [],
    organic_rank: null,
    error:        null,
    checkedAt:    new Date().toISOString(),
  }

  try {
    const params = new URLSearchParams({
      api_key:      apiKey,
      q:            keyword,
      location:     'Las Vegas, Nevada, United States',
      gl:           'us',
      hl:           'en',
      google_domain:'google.com',
      num:          '10',
    })

    const fetchWithTimeout = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ValueSERP timeout after 7s')), 7000)
      fetch(`https://api.valueserp.com/search?${params}`)
        .then(r => { clearTimeout(timer); resolve(r) })
        .catch(e => { clearTimeout(timer); reject(e) })
    })
    const res = await fetchWithTimeout()

    if (!res.ok) {
      let e = `ValueSERP HTTP ${res.status}`
      try { const t = await res.text(); if (t) e += ': ' + t.slice(0, 200) } catch {}
      result.error = e
      return result
    }

    let data
    try {
      const text = await res.text()
      if (!text?.trim()) { result.error = 'Empty response from ValueSERP'; return result }
      data = JSON.parse(text)
    } catch (e) {
      result.error = 'JSON parse error: ' + e.message
      return result
    }

    // ── AI Overview ───────────────────────────────────────────────────────
    const aio = data.ai_overview
    if (aio) {
      result.in_aio = true

      // Extract text
      const textParts = []
      if (aio.text_blocks) {
        for (const b of aio.text_blocks) {
          if (b.snippet) textParts.push(b.snippet)
          if (b.list) for (const item of b.list) if (item.snippet) textParts.push('• ' + item.snippet)
        }
      }
      if (!textParts.length && aio.snippet) textParts.push(aio.snippet)
      result.aio_text = textParts.join('\n\n').slice(0, 3000) || null

      // All AIO sources
      const srcs = [...(aio.ai_overview_sources||[]), ...(aio.sources||[]), ...(aio.references||[])]
      result.aio_sources = srcs
        .map(s => ({ title: s.title || s.name || '', link: s.link || s.url || '' }))
        .filter(s => s.link)
        .slice(0, 10)

      // Check if we appear in AIO
      result.site_cited =
        result.aio_sources.some(s => s.link.includes(SITE)) ||
        JSON.stringify(aio).toLowerCase().includes(SITE)

      if (result.site_cited) {
        const ourAio = result.aio_sources.filter(s => s.link.includes(SITE))
        if (ourAio.length) {
          ourAio.forEach(p => result.our_pages.push({ where: 'AIO source', link: p.link, title: p.title }))
        } else {
          result.our_pages.push({ where: 'AIO mention', link: '', title: 'Domain mentioned in AIO text' })
        }
      }
    }

    // ── Organic results ───────────────────────────────────────────────────
    ;(data.organic_results || []).forEach((r, idx) => {
      if (r.link && r.link.includes(SITE)) {
        const pos = r.position || (idx + 1)
        if (!result.organic_rank || pos < result.organic_rank) result.organic_rank = pos
        result.our_pages.push({ where: `Organic #${pos}`, link: r.link, title: r.title || '' })
      }
    })

    // ── Everything else — top stories, local, knowledge graph ────────────
    const extras = [
      ...(data.top_stories || []),
      ...(data.local_results || []),
      ...((data.knowledge_graph && data.knowledge_graph.links) || []),
    ]
    extras.forEach(item => {
      const link = item.link || item.url || ''
      if (link.includes(SITE)) {
        result.our_pages.push({ where: 'Other result', link, title: item.title || '' })
      }
    })

    // ── Final catch-all: scan raw response ────────────────────────────────
    if (!result.our_pages.length && JSON.stringify(data).toLowerCase().includes(SITE)) {
      result.our_pages.push({ where: 'SERP mention', link: '', title: 'Found in raw response' })
    }

  } catch (err) {
    result.error = err.message
  }

  return result
}
