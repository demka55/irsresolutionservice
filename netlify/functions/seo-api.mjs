// netlify/functions/seo-api.mjs
// HTTP endpoint: GET /api/seo-track
//   ?action=results           — returns stored data (public)
//   ?action=run&password=xxx  — triggers fresh check (protected)
//
// Self-contained — does NOT import from seo-track.mjs to avoid bundling issues.

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

const JSON_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: JSON_HEADERS })

  const url    = new URL(req.url)
  const action = url.searchParams.get('action') || 'results'
  const pw     = url.searchParams.get('password') || ''

  // ── Public: return stored results ────────────────────────────────────────
  if (action === 'results') {
    try {
      const store = getStore(STORE)
      const [raw, histRaw] = await Promise.all([
        store.get(RESULTS_KEY).catch(() => null),
        store.get(HISTORY_KEY).catch(() => null),
      ])
      return json({
        results: raw     ? safeParseJSON(raw)     : null,
        history: histRaw ? safeParseJSON(histRaw) : [],
      })
    } catch (err) {
      return json({ results: null, history: [], error: err.message })
    }
  }

  // ── Protected: trigger fresh run ────────────────────────────────────────
  const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || ''
  if (!pw || pw !== ADMIN_PASSWORD) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const API_KEY = Netlify.env.get('VALUESERP_API') || ''
  if (!API_KEY) {
    return json({ error: 'VALUESERP_API environment variable not configured in Netlify' }, 500)
  }

  try {
    const data = await runChecks(API_KEY)
    return json({ ok: true, checkedAt: data.checkedAt, summary: data.summary })
  } catch (err) {
    console.error('[seo-api] run error:', err.message)
    return json({ error: err.message }, 500)
  }
}

export const config = {
  path: '/api/seo-track',
  method: ['GET', 'OPTIONS'],
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS })
}

function safeParseJSON(raw) {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

// ── Run all 19 keywords ───────────────────────────────────────────────────────
// Run in batches of 5 concurrently to stay under Netlify's 26-second timeout
async function runChecks(apiKey) {
  const store     = getStore(STORE)
  const checkedAt = new Date().toISOString()
  const results   = []

  // Process in batches of 5 parallel
  const BATCH = 5
  for (let i = 0; i < KEYWORDS.length; i += BATCH) {
    const batch = KEYWORDS.slice(i, i + BATCH)
    const batchResults = await Promise.all(batch.map(kw => checkKeyword(kw, apiKey)))
    results.push(...batchResults)

    // Store each keyword result individually
    await Promise.all(batchResults.map(async (result) => {
      const slug = result.keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
      try { await store.set(`kw:${slug}`, JSON.stringify(result)) } catch {}
    }))
  }

  const inAio  = results.filter(r => r.in_aio).length
  const cited  = results.filter(r => r.site_cited).length
  const ranked = results.filter(r => r.our_pages && r.our_pages.length > 0).length

  const data = {
    checkedAt,
    summary: { total: results.length, in_aio: inAio, site_cited: cited, ranked },
    keywords: results,
  }

  await store.set(RESULTS_KEY, JSON.stringify(data))

  // Append to 30-day history
  let history = []
  try {
    const raw = await store.get(HISTORY_KEY)
    if (raw) history = safeParseJSON(raw) || []
  } catch {}
  history.unshift({ date: checkedAt.slice(0, 10), in_aio: inAio, site_cited: cited, total: results.length })
  if (history.length > 30) history = history.slice(0, 30)
  await store.set(HISTORY_KEY, JSON.stringify(history))

  return data
}

// ── Check one keyword — scan ENTIRE response for our domain ──────────────────
async function checkKeyword(keyword, apiKey) {
  const result = {
    keyword,
    in_aio:      false,
    site_cited:  false,   // we appear in AIO sources
    aio_text:    null,    // full AIO text
    aio_sources: [],      // all AIO sources [{title, link}]
    our_pages:   [],      // every place our domain appears in full response
    organic_rank: null,   // best organic position
    error:       null,
    checkedAt:   new Date().toISOString(),
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
      let errText = `ValueSERP HTTP ${res.status}`
      try { const t = await res.text(); if (t) errText += ': ' + t.slice(0, 200) } catch {}
      result.error = errText
      return result
    }

    let data
    try {
      const text = await res.text()
      if (!text || !text.trim()) { result.error = 'Empty response from ValueSERP'; return result }
      data = JSON.parse(text)
    } catch (e) {
      result.error = 'JSON parse error: ' + e.message
      return result
    }

    // ── 1. Scan AI Overview ───────────────────────────────────────────────
    const aio = data.ai_overview
    if (aio) {
      result.in_aio = true

      // Extract readable text
      const textParts = []
      if (aio.text_blocks) {
        for (const block of aio.text_blocks) {
          if (block.snippet) textParts.push(block.snippet)
          if (block.list) {
            for (const item of block.list) {
              if (item.snippet) textParts.push('• ' + item.snippet)
            }
          }
        }
      }
      if (!textParts.length && aio.snippet) textParts.push(aio.snippet)
      result.aio_text = textParts.join('\n\n').slice(0, 3000) || null

      // Extract all sources
      const sources = [
        ...(aio.ai_overview_sources || []),
        ...(aio.sources             || []),
        ...(aio.references          || []),
      ]
      result.aio_sources = sources
        .map(s => ({ title: s.title || s.name || '', link: s.link || s.url || '' }))
        .filter(s => s.link)
        .slice(0, 10)

      // Check if our domain appears anywhere in AIO
      const aioStr = JSON.stringify(aio).toLowerCase()
      result.site_cited =
        result.aio_sources.some(s => s.link.includes(SITE)) ||
        aioStr.includes(SITE)

      if (result.site_cited) {
        // Find which of our pages appears in AIO
        const ourAioPages = result.aio_sources.filter(s => s.link.includes(SITE))
        ourAioPages.forEach(p => {
          result.our_pages.push({ where: 'AIO source', link: p.link, title: p.title })
        })
        if (!ourAioPages.length) {
          result.our_pages.push({ where: 'AIO text mention', link: '', title: '' })
        }
      }
    }

    // ── 2. Scan organic results ──────────────────────────────────────────
    const organic = data.organic_results || []
    organic.forEach((r, idx) => {
      if (r.link && r.link.includes(SITE)) {
        const pos = r.position || (idx + 1)
        if (!result.organic_rank || pos < result.organic_rank) {
          result.organic_rank = pos
        }
        result.our_pages.push({
          where: `Organic #${pos}`,
          link: r.link,
          title: r.title || '',
        })
      }
    })

    // ── 3. Scan knowledge panel, local results, top stories, related ─────
    const extraSections = [
      ...(data.top_stories          || []),
      ...(data.local_results        || []),
      ...(data.related_searches     || []),
      ...(data.knowledge_graph?.links || []),
    ]
    extraSections.forEach(item => {
      const link = item.link || item.url || ''
      if (link.includes(SITE)) {
        result.our_pages.push({ where: 'Other result', link, title: item.title || '' })
      }
    })

    // Also scan the entire raw response as a final safety net
    if (!result.our_pages.length) {
      const fullStr = JSON.stringify(data).toLowerCase()
      if (fullStr.includes(SITE)) {
        result.our_pages.push({ where: 'Appears in response', link: '', title: 'Found in raw SERP data' })
      }
    }

  } catch (err) {
    result.error = err.message
  }

  return result
}
