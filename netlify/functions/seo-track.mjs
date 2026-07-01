// netlify/functions/seo-track.mjs
// Checks each keyword against ValueSERP for AI Overview presence
// Stores results in Netlify blobs.
//
// GET /api/seo-track?action=results           — public, returns stored data
// GET /api/seo-track?action=run&password=xxx  — protected, triggers fresh check
// Scheduled daily at 6am UTC automatically

import { getStore } from '@netlify/blobs'

const STORE       = 'seo-tracking'
const RESULTS_KEY = 'latest-results'
const HISTORY_KEY = 'history'
const SITE_DOMAIN = 'irsresolutionservice.com'

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

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers })

  const url    = new URL(req.url)
  const action = url.searchParams.get('action') || 'results'
  const pw     = url.searchParams.get('password') || ''

  // ── Public: read stored results ───────────────────────────────────────
  if (action === 'results') {
    try {
      const store   = getStore(STORE)
      const [raw, histRaw] = await Promise.all([
        store.get(RESULTS_KEY).catch(() => null),
        store.get(HISTORY_KEY).catch(() => null),
      ])
      return new Response(JSON.stringify({
        results:  raw     ? JSON.parse(raw)     : null,
        history:  histRaw ? JSON.parse(histRaw) : [],
      }), { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } })
    } catch (err) {
      return new Response(JSON.stringify({ results: null, history: [], error: err.message }),
        { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } })
    }
  }

  // ── Protected: trigger a fresh run ────────────────────────────────────
  const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || ''
  if (pw !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
  }

  try {
    const data = await runChecks()
    return new Response(
      JSON.stringify({ ok: true, checkedAt: data.checkedAt, summary: data.summary }),
      { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('[seo-track] run error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
  }
}

// Netlify v2 config — schedule goes inside config
export const config = {
  path: '/api/seo-track',
  method: ['GET', 'OPTIONS'],
  schedule: '0 6 * * *',  // 6am UTC daily
}

// ── Core: check all keywords ──────────────────────────────────────────────────
async function runChecks() {
  const API_KEY = Netlify.env.get('VALUESERP_API') || ''
  if (!API_KEY) throw new Error('VALUESERP_API environment variable not set')

  const store      = getStore(STORE)
  const checkedAt  = new Date().toISOString()
  const results    = []

  for (const keyword of KEYWORDS) {
    const result = await checkKeyword(keyword, API_KEY)
    results.push(result)
    // 300ms gap between calls — keeps us under ValueSERP rate limits
    await new Promise(r => setTimeout(r, 300))
  }

  const inAio   = results.filter(r => r.in_aio).length
  const cited   = results.filter(r => r.site_cited).length
  const ranked  = results.filter(r => r.organic_rank).length

  const data = {
    checkedAt,
    summary: { total: results.length, in_aio: inAio, site_cited: cited, ranked },
    keywords: results,
  }

  // Save latest + append to 30-day history
  await store.set(RESULTS_KEY, JSON.stringify(data))

  let history = []
  try {
    const raw = await store.get(HISTORY_KEY)
    if (raw) history = JSON.parse(raw)
  } catch (e) {}

  history.unshift({ date: checkedAt.slice(0, 10), in_aio: inAio, site_cited: cited, total: results.length })
  if (history.length > 30) history = history.slice(0, 30)
  await store.set(HISTORY_KEY, JSON.stringify(history))

  return data
}

async function checkKeyword(keyword, apiKey) {
  const result = {
    keyword,
    in_aio:       false,
    site_cited:   false,
    aio_sources:  [],
    organic_rank: null,
    error:        null,
    checkedAt:    new Date().toISOString(),
  }

  try {
    const params = new URLSearchParams({
      api_key:             apiKey,
      q:                   keyword,
      engine:              'google',
      google_domain:       'google.com',
      gl:                  'us',
      hl:                  'en',
      device:              'desktop',
      include_ai_overview: 'true',
      num:                 '10',
    })

    const res = await fetch(`https://api.valueserp.com/search?${params}`, {
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      result.error = `ValueSERP HTTP ${res.status}`
      return result
    }

    const data = await res.json()

    // ── AI Overview ──────────────────────────────────────────────────────
    const aio = data.ai_overview
    if (aio) {
      result.in_aio = true

      const sources = [
        ...(aio.ai_overview_sources || []),
        ...(aio.sources             || []),
        ...(aio.references          || []),
      ]
      result.aio_sources = sources
        .map(s => ({ title: s.title || s.name || '', link: s.link || s.url || '' }))
        .filter(s => s.link)

      result.site_cited = result.aio_sources.some(s => s.link.includes(SITE_DOMAIN))

      // Also check AIO text body for our domain
      if (!result.site_cited) {
        const body = JSON.stringify(aio).toLowerCase()
        if (body.includes(SITE_DOMAIN)) result.site_cited = true
      }
    }

    // ── Organic rank ─────────────────────────────────────────────────────
    const organic = data.organic_results || []
    const ours = organic.find(r => r.link && r.link.includes(SITE_DOMAIN))
    if (ours) result.organic_rank = ours.position

  } catch (err) {
    result.error = err.message
  }

  return result
}
