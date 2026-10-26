// netlify/functions/seo-api.mjs
// GET /api/seo-track?action=keywords            — list all keywords (public)
// GET /api/seo-track?action=results             — stored results (public)
// GET /api/seo-track?action=check&kw=X&password — check ONE keyword, store + return
// GET /api/seo-track?action=finish&password     — assemble final summary from kw: blobs
// Browser calls check() for each keyword sequentially — no server-side loop needed

import { getStore } from '@netlify/blobs'
import {
  STORE, RESULTS_KEY, HISTORY_KEY, KEYWORDS,
  tryParse, slugFor, readAllKeywordResults, summarize, saveSummary, checkKeyword,
} from '../lib/seo-core.mjs'

const H = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}
const ok   = (d)    => new Response(JSON.stringify(d), { status: 200, headers: H })
const fail = (m, s) => new Response(JSON.stringify({ error: m }), { status: s || 500, headers: H })

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: H })

  const url    = new URL(req.url)
  const action = url.searchParams.get('action') || 'results'
  const pw     = url.searchParams.get('password') || ''

  const ADMIN_PW = Netlify.env.get('ADMIN_PASSWORD') || ''
  const API_KEY  = Netlify.env.get('VALUESERP_API')  || ''

  // ── Public endpoints ──────────────────────────────────────────────────────
  if (action === 'keywords') return ok({ keywords: KEYWORDS })

  if (action === 'results') {
    try {
      const store = getStore(STORE)
      const [raw, histRaw, perKw] = await Promise.all([
        store.get(RESULTS_KEY).catch(() => null),
        store.get(HISTORY_KEY).catch(() => null),
        readAllKeywordResults(store), // parallel now — this was the 504
      ])
      const stored     = tryParse(raw)
      const kwResults  = perKw.filter(Boolean)

      // If individual results are newer than the summary (partial or fresh run), return them merged
      let results = stored
      if (kwResults.length > 0) {
        const summaryDate = stored?.checkedAt || '2000-01-01'
        const latestKw = kwResults.reduce((l, r) => ((r.checkedAt || '') > l ? (r.checkedAt || '') : l), '')
        if (!stored || latestKw > summaryDate || kwResults.length === KEYWORDS.length) {
          results = {
            checkedAt: latestKw,
            partial: kwResults.length < KEYWORDS.length,
            summary: { ...summarize(kwResults), total: KEYWORDS.length },
            keywords: kwResults,
          }
        }
      }
      return ok({ results, history: tryParse(histRaw) || [] })
    } catch (e) {
      return ok({ results: null, history: [], error: e.message })
    }
  }

  // ── Auth required ─────────────────────────────────────────────────────────
  if (!pw || pw !== ADMIN_PW) return fail('Unauthorized', 401)

  // ── Finish: assemble summary from stored kw: blobs ────────────────────────
  if (action === 'finish') {
    try {
      const store   = getStore(STORE)
      const perKw   = await readAllKeywordResults(store)
      const results = perKw.map((r, i) => r || { keyword: KEYWORDS[i], error: 'no data', our_pages: [], in_aio: false, site_cited: false })
      const data    = await saveSummary(store, results)
      return ok({ ok: true, summary: data.summary })
    } catch (e) { return fail(e.message) }
  }

  if (!API_KEY) return fail('VALUESERP_API not configured in Netlify env vars', 500)

  // ── Check ONE keyword ─────────────────────────────────────────────────────
  if (action === 'check') {
    const kw = url.searchParams.get('kw') || ''
    if (!kw) return fail('Missing kw param', 400)
    const result = await checkKeyword(kw, API_KEY)
    await getStore(STORE).set(`kw:${slugFor(kw)}`, JSON.stringify(result)).catch(() => {})
    return ok(result)
  }

  return fail('Unknown action', 400)
}

export const config = { path: '/api/seo-track', method: ['GET', 'OPTIONS'] }
