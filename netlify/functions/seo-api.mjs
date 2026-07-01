// netlify/functions/seo-api.mjs
// GET /api/seo-track?action=results              — stored results (public)
// GET /api/seo-track?action=check&kw=KEYWORD&password=xxx — check ONE keyword, store + return result
// GET /api/seo-track?action=status               — run status blob
// GET /api/seo-track?action=finish&password=xxx  — write final summary from stored kw: blobs

import { getStore } from '@netlify/blobs'

const STORE       = 'seo-tracking'
const RESULTS_KEY = 'latest-results'
const HISTORY_KEY = 'history'
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
const ok  = (d)    => new Response(JSON.stringify(d), { status: 200, headers: H })
const err = (m, s) => new Response(JSON.stringify({ error: m }), { status: s || 500, headers: H })
const tryParse = (r) => { try { return r ? JSON.parse(r) : null } catch { return null } }

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: H })

  const url    = new URL(req.url)
  const action = url.searchParams.get('action') || 'results'
  const pw     = url.searchParams.get('password') || ''

  const ADMIN_PW = Netlify.env.get('ADMIN_PASSWORD') || ''
  const API_KEY  = Netlify.env.get('VALUESERP_API')  || ''

  // ── Public: list of keywords ──────────────────────────────────────────────
  if (action === 'keywords') {
    return ok({ keywords: KEYWORDS })
  }

  // ── Public: stored results ────────────────────────────────────────────────
  if (action === 'results') {
    try {
      const store = getStore(STORE)
      const [raw, histRaw] = await Promise.all([
        store.get(RESULTS_KEY).catch(() => null),
        store.get(HISTORY_KEY).catch(() => null),
      ])
      return ok({ results: tryParse(raw), history: tryParse(histRaw) || [] })
    } catch (e) {
      return ok({ results: null, history: [], error: e.message })
    }
  }

  // ── Public: status ────────────────────────────────────────────────────────
  if (action === 'status') {
    try {
      const store = getStore(STORE)
      const raw = await store.get('run-status').catch(() => null)
      return ok(tryParse(raw) || { status: 'idle' })
    } catch (e) {
      return ok({ status: 'idle' })
    }
  }

  // ── Auth required from here ───────────────────────────────────────────────
  if (!pw || pw !== ADMIN_PW) return err('Unauthorized', 401)
  if (!API_KEY) return err('VALUESERP_API not configured in Netlify env vars', 500)

  // ── Check ONE keyword — called from browser loop ──────────────────────────
  if (action === 'check') {
    const kw = url.searchParams.get('kw') || ''
    if (!kw) return err('Missing kw param', 400)

    const result = await checkKeyword(kw, API_KEY)

    // Store individually
    const store = getStore(STORE)
    const slug  = kw.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
    await store.set(`kw:${slug}`, JSON.stringify(result)).catch(() => {})

    return ok(result)
  }

  // ── Finish: assemble final summary from stored kw: blobs ─────────────────
  if (action === 'finish') {
    try {
      const store     = getStore(STORE)
      const checkedAt = new Date().toISOString()
      const results   = []

      for (const kw of KEYWORDS) {
        const slug = kw.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
        const raw  = await store.get(`kw:${slug}`).catch(() => null)
        const r    = tryParse(raw)
        if (r) results.push(r)
        else   results.push({ keyword: kw, error: 'no data', our_pages: [], in_aio: false, site_cited: false })
      }

      const inAio  = results.filter(r => r.in_aio).length
      const cited  = results.filter(r => r.site_cited).length
      const ranked = results.filter(r => r.our_pages && r.our_pages.length > 0).length

      const data = { checkedAt, summary: { total: results.length, in_aio: inAio, site_cited: cited, ranked }, keywords: results }
      await store.set(RESULTS_KEY, JSON.stringify(data))

      let history = tryParse(await store.get(HISTORY_KEY).catch(() => null)) || []
      history.unshift({ date: checkedAt.slice(0, 10), in_aio: inAio, site_cited: cited, total: results.length })
      if (history.length > 30) history = history.slice(0, 30)
      await store.set(HISTORY_KEY, JSON.stringify(history))
      await store.set('run-status', JSON.stringify({ status: 'done', checkedAt, ranked, site_cited: cited, in_aio: inAio }))

      return ok({ ok: true, summary: data.summary })
    } catch (e) {
      return err(e.message)
    }
  }

  return err('Unknown action', 400)
}

export const config = { path: '/api/seo-track', method: ['GET', 'OPTIONS'] }

// ── Check one keyword ─────────────────────────────────────────────────────────
async function checkKeyword(keyword, apiKey) {
  const result = {
    keyword, in_aio: false, site_cited: false,
    aio_text: null, aio_sources: [], our_pages: [],
    organic_rank: null, error: null,
    checkedAt: new Date().toISOString(),
  }
  try {
    const params = new URLSearchParams({
      api_key: apiKey, q: keyword, engine: 'google',
      google_domain: 'google.com', gl: 'us', hl: 'en',
      device: 'desktop', include_ai_overview: 'true', num: '10',
    })
    const res = await fetch(`https://api.valueserp.com/search?${params}`)

    if (!res.ok) {
      let e = `ValueSERP HTTP ${res.status}`
      try { const t = await res.text(); if (t) { try { e += ': ' + (JSON.parse(t).message || t.slice(0,150)) } catch { e += ': ' + t.slice(0,150) } } } catch {}
      result.error = e; return result
    }

    let data
    try {
      const text = await res.text()
      if (!text?.trim()) { result.error = 'Empty response'; return result }
      data = JSON.parse(text)
    } catch (e) { result.error = 'Parse error: ' + e.message; return result }

    const aio = data.ai_overview
    if (aio) {
      result.in_aio = true
      const parts = []
      if (aio.text_blocks) for (const b of aio.text_blocks) {
        if (b.snippet) parts.push(b.snippet)
        if (b.list) for (const i of b.list) if (i.snippet) parts.push('• ' + i.snippet)
      }
      if (!parts.length && aio.snippet) parts.push(aio.snippet)
      result.aio_text = parts.join('\n\n').slice(0, 3000) || null

      const srcs = [...(aio.ai_overview_sources||[]), ...(aio.sources||[]), ...(aio.references||[])]
      result.aio_sources = srcs.map(s => ({ title: s.title||s.name||'', link: s.link||s.url||'' })).filter(s => s.link).slice(0, 10)
      result.site_cited  = result.aio_sources.some(s => s.link.includes(SITE)) || JSON.stringify(aio).toLowerCase().includes(SITE)

      if (result.site_cited) {
        const ours = result.aio_sources.filter(s => s.link.includes(SITE))
        ours.length
          ? ours.forEach(p => result.our_pages.push({ where: 'AIO source', link: p.link, title: p.title }))
          : result.our_pages.push({ where: 'AIO mention', link: '', title: 'Domain in AIO text' })
      }
    }

    ;(data.organic_results || []).forEach((r, i) => {
      if (r.link?.includes(SITE)) {
        const pos = r.position || i + 1
        if (!result.organic_rank || pos < result.organic_rank) result.organic_rank = pos
        result.our_pages.push({ where: `Organic #${pos}`, link: r.link, title: r.title||'' })
      }
    })

    if (!result.our_pages.length && JSON.stringify(data).toLowerCase().includes(SITE))
      result.our_pages.push({ where: 'SERP mention', link: '', title: 'Found in raw response' })

  } catch (e) { result.error = e.message }
  return result
}
