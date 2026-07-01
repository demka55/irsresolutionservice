// netlify/functions/seo-track.mjs
// Checks each keyword against ValueSERP for AI Overview presence
// and stores results in Netlify blobs.
// Called by:
//   - Netlify scheduled cron (daily at 6am UTC)
//   - GET /api/seo-track?action=run&password=xxx  (manual trigger)
//   - GET /api/seo-track?action=results           (read stored results, public)

import { getStore } from '@netlify/blobs'

const STORE        = 'seo-tracking'
const RESULTS_KEY  = 'latest-results'
const HISTORY_KEY  = 'history'
const SITE_DOMAIN  = 'irsresolutionservice.com'

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

// ── Main handler ─────────────────────────────────────────────────────────────
export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers })

  const url    = new URL(req.url)
  const action = url.searchParams.get('action') || 'results'
  const pw     = url.searchParams.get('password') || ''

  // Public: read stored results
  if (action === 'results') {
    try {
      const store   = getStore(STORE)
      const raw     = await store.get(RESULTS_KEY)
      const history = await store.get(HISTORY_KEY).catch(() => null)
      if (!raw) return new Response(JSON.stringify({ results: null, history: [] }), { status: 200, headers })
      return new Response(JSON.stringify({
        results: JSON.parse(raw),
        history: history ? JSON.parse(history) : []
      }), { status: 200, headers })
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
    }
  }

  // Protected: trigger a fresh run
  const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || ''
  if (action === 'run' && pw !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
  }

  // Run the checks
  try {
    const results = await runChecks()
    return new Response(JSON.stringify({ ok: true, checkedAt: results.checkedAt, summary: results.summary }), { status: 200, headers })
  } catch (err) {
    console.error('[seo-track]', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
  }
}

// ── Scheduled trigger (daily cron) ───────────────────────────────────────────
export const schedule = '0 6 * * *'  // 6am UTC daily

export const config = { path: '/api/seo-track', method: ['GET', 'OPTIONS'] }

// ── Core logic ───────────────────────────────────────────────────────────────
async function runChecks() {
  const API_KEY = Netlify.env.get('VALUESERP_API') || ''
  if (!API_KEY) throw new Error('VALUESERP_API not configured')

  const store = getStore(STORE)
  const checkedAt = new Date().toISOString()
  const keyword_results = []

  for (const keyword of KEYWORDS) {
    const result = await checkKeyword(keyword, API_KEY)
    keyword_results.push(result)
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500))
  }

  const inAIO  = keyword_results.filter(r => r.in_aio).length
  const cited  = keyword_results.filter(r => r.site_cited).length
  const total  = keyword_results.length

  const data = {
    checkedAt,
    summary: { total, in_aio: inAIO, site_cited: cited },
    keywords: keyword_results,
  }

  // Save latest results
  await store.set(RESULTS_KEY, JSON.stringify(data))

  // Append to history (keep last 30 days)
  let history = []
  try {
    const raw = await store.get(HISTORY_KEY)
    if (raw) history = JSON.parse(raw)
  } catch (e) {}

  history.unshift({ date: checkedAt.split('T')[0], in_aio: inAIO, site_cited: cited, total })
  if (history.length > 30) history = history.slice(0, 30)
  await store.set(HISTORY_KEY, JSON.stringify(history))

  return data
}

async function checkKeyword(keyword, apiKey) {
  const result = {
    keyword,
    in_aio: false,
    site_cited: false,
    aio_sources: [],
    organic_rank: null,
    checkedAt: new Date().toISOString(),
    error: null,
  }

  try {
    const params = new URLSearchParams({
      api_key:           apiKey,
      q:                 keyword,
      engine:            'google',
      google_domain:     'google.com',
      gl:                'us',
      hl:                'en',
      device:            'desktop',
      include_ai_overview: 'true',
      num:               '10',
    })

    const res = await fetch(`https://api.valueserp.com/search?${params}`)
    if (!res.ok) throw new Error(`ValueSERP ${res.status}`)
    const data = await res.json()

    // ── AI Overview ───────────────────────────────────────────────────────
    const aio = data.ai_overview
    if (aio) {
      result.in_aio = true

      // Sources cited in AIO
      const sources = [
        ...(aio.ai_overview_sources || []),
        ...(aio.sources || []),
        ...(aio.references || []),
      ]
      result.aio_sources = sources.map(s => ({
        title: s.title || s.name || '',
        link:  s.link  || s.url  || '',
      })).filter(s => s.link)

      // Check if our site is cited
      result.site_cited = result.aio_sources.some(s =>
        s.link && s.link.includes(SITE_DOMAIN)
      )

      // Also check AIO text content for our domain
      const aioText = JSON.stringify(aio).toLowerCase()
      if (!result.site_cited && aioText.includes(SITE_DOMAIN)) {
        result.site_cited = true
      }
    }

    // ── Organic rank ──────────────────────────────────────────────────────
    const organic = data.organic_results || []
    const ourResult = organic.find(r => r.link && r.link.includes(SITE_DOMAIN))
    if (ourResult) result.organic_rank = ourResult.position

  } catch (err) {
    result.error = err.message
  }

  return result
}
