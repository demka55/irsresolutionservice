// netlify/functions/seo-api.mjs
// GET /api/seo-track?action=keywords            — list all 19 keywords (public)
// GET /api/seo-track?action=results             — stored results (public)
// GET /api/seo-track?action=check&kw=X&password — check ONE keyword, store + return
// GET /api/seo-track?action=finish&password     — assemble final summary from kw: blobs
// Browser calls check() for each keyword sequentially — no server-side loop needed

import { getStore } from '@netlify/blobs'

const STORE       = 'seo-tracking'
const RESULTS_KEY = 'latest-results'
const HISTORY_KEY = 'history'
const SITE        = 'irsresolutionservice.com'

const KEYWORDS = [
  // IRS Installment Agreement / Payment Plan
  "IRS got client on payment plan $440000",
  "IRS expense table Bentley example",
  "IRS expense tables Bentley car payment",
  // Offer in Compromise
  "offer in compromise 2 year rule",
  "offer in compromise 2 year deemed accepted rule",
  "IRS OIC deemed accepted",

  "when does irs start garnishing wages",
  "when does irs garnish wages",
  "can irs garnish wages",
  "irs garnish paycheck",
  "notice of intent to levy",
  "irs notice of intent to levy",
  "non-collectible status",
  "irc section 7122(f) offer in compromise automatic acceptance",
  "irs penalty abatement request letter",
  "irc section 6331 levy",
  "irs csed expiration date",
  "what is csed irs",
  "irs collection statute expiration",
  "irs installment agreement default",
  "irs cp523 reinstatement",
  "irs tax lien subordination",
  "irs lien discharge",
  "how to release irs bank levy",
  "irs revenue officer first visit",
  "irs diff score how returns get selected for audit",
  "irs officer compensation s corp audit",
  "vehicle deduction irs audit trigger",
  "irs worker reclassification audit 1099 vs w2",
  "tigta complaint against irs agent",
  "how to write irs audit rebuttal",
  "irs audit appeals overturned",
  "irs examination vs collections division",
  "irs power of attorney rights audit",
  "s corp salary irs audit",
  "90 of irs letters are nothing",
  "how long does irs audit take",
  "remove irs tax lien",
  "how to get a tax lien removed from credit report",
  "can you have two installment agreements with the irs",
  "irs revenue officer at my business",
  "how to prepare for irs audit",
  "irc section 7122 f offer in compromise automatic acceptance 24 months",
  "irs wage garnishment exempt amount",
  "how much does irs garnish from social security",
  "irs federal payment levy program",
  "cp504 vs lt11 difference",
  "irs accounts receivable levy",
  "irs lien on credit report 2026",
  "cdp hearing form 12153",
  "irs levy social security benefits",
  "IRS offer in compromise deemed accepted 2 years",
  // Collection Statute (CSED)
  "do nothing IRS collection statute expiring",
  "do nothing IRS CSED expiring strategy",
  "how long does IRS have to collect tax debt",
  // Audit & Appeals
  "IRS hasn't replied to appeal 45 days",
  "tax court petition before appeals strategy",
  "IRS appeal officer 45 days review financials themselves",
  // CP523
  "cp523 installment agreement terminated",
  "cp523 installment agreement terminated what happens",
  // Unfiled Taxes / Compliance
  "haven't filed taxes in 5 years what happens",
  "IRS compliance last 6 years",
  "IRS compliance last 6 years not 10",
  // Budget Cuts
  "IRS revenue officers Las Vegas budget cuts",
  // CP2000
  "cp2000 IRS wrong how to dispute",
  // Office Audit
  "how to prepare for IRS office audit",
  // Wage Garnishment
  "IRS wage garnishment how to stop",
  "stop IRS wage garnishment payment plan",
  "irs wage garnishment",
  "can the irs garnish your wages",
  "irs wage garnishment hardship",
  "how much can the irs garnish from your wages",
  // IRS Notices
  "cp14 IRS notice what to do",
  "cp504 IRS final notice levy",
  "LT11 IRS notice intent to levy",
  "cp59 IRS unfiled tax return notice",
  // Other pages
  "missed IRS tax deadline what happens",
  "one big beautiful act tax changes 2025",
  "IRS tips and overtime tax exempt 2025",
  "2026 tax brackets income thresholds",
  // NEW PAGES
  "IRS first time penalty abatement",
  "IRS penalty abatement reasonable cause",
  "remove IRS penalties first time abatement",
  "irs penalty abatement",
  "irs first time abatement",
  "IRS currently not collectible status",
  "IRS hardship status can't pay",
  "currently not collectible IRS qualification",
  "irs currently not collectible",
  "irs hardship program",
  "IRS revenue officer assigned to my case",
  "IRS revenue officer showed up at my door",
  "irs revenue officer",
  "what does an irs revenue officer do",
  "irs revenue officer visit",
  "IRS bank levy how to release",
  "IRS bank account frozen 21 days",
  "IRS bank levy release funds",
  "irs bank levy",
  "irs levy bank account",
  "how to stop irs bank levy",
  "irs bank levy exempt funds",
  "IRS federal tax lien withdrawal",
  "IRS tax lien how to remove",
  "federal tax lien selling home",
  "irs tax lien",
  "federal tax lien",
  "irs tax lien on property",
  "how to get irs lien removed",
  // NEW: Automatic Penalty Relief (AEP) — IR-2026-83
  "IRS automatic penalty relief",
  "automatic exemption from penalty",
  "IRS AEP program",
  "AEP vs first time abatement",
  "IRS replacing first time penalty abatement",
  "first time penalty abatement going away",
  "IRS first time abate phased out 2026",
  "IR-2026-83",
  "when does IRS AEP start",
  "IRS automatic penalty relief eligibility",
  "does AEP cover estimated tax penalty",
  "IRS AEP eligible forms",
  "AEP 12 consecutive quarters quarterly returns",
  "IRS penalty notice 2025 return AEP transition",
  "do I still need to request first time abatement",
  "IRS automatic penalty abatement 2027",
  "AEP failure to file failure to pay failure to deposit",
  "IRS penalty relief without requesting",
]

const H = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}
const ok       = (d)    => new Response(JSON.stringify(d), { status: 200, headers: H })
const fail     = (m, s) => new Response(JSON.stringify({ error: m }), { status: s||500, headers: H })
const tryParse = (r)    => { try { return r ? JSON.parse(r) : null } catch { return null } }

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
      const [raw, histRaw] = await Promise.all([
        store.get(RESULTS_KEY).catch(() => null),
        store.get(HISTORY_KEY).catch(() => null),
      ])
      const stored = tryParse(raw)
      
      // Also read all individual kw: blobs to find any newer results
      const kwResults = []
      for (const kw of KEYWORDS) {
        const slug = kw.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
        const kwRaw = await store.get(`kw:${slug}`).catch(() => null)
        const kwData = tryParse(kwRaw)
        if (kwData) kwResults.push(kwData)
      }
      
      // If we have individual results newer than the summary, return them merged
      let results = stored
      if (kwResults.length > 0) {
        const summaryDate = stored?.checkedAt || '2000-01-01'
        const latestKw = kwResults.reduce((latest, r) => 
          (r.checkedAt || '') > latest ? (r.checkedAt || '') : latest, '')
        
        // Individual blobs are newer — use them (partial or complete run)
        if (!stored || latestKw > summaryDate || kwResults.length === KEYWORDS.length) {
          const inAio  = kwResults.filter(r => r.in_aio).length
          const cited  = kwResults.filter(r => r.site_cited).length
          const ranked = kwResults.filter(r => r.our_pages && r.our_pages.length > 0).length
          results = {
            checkedAt: latestKw,
            partial: kwResults.length < KEYWORDS.length,
            summary: { total: kwResults.length, in_aio: inAio, site_cited: cited, ranked },
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
  if (!API_KEY) return fail('VALUESERP_API not configured in Netlify env vars', 500)

  // ── Check ONE keyword ─────────────────────────────────────────────────────
  if (action === 'check') {
    const kw = url.searchParams.get('kw') || ''
    if (!kw) return fail('Missing kw param', 400)
    const result = await checkKeyword(kw, API_KEY)
    const store  = getStore(STORE)
    const slug   = kw.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
    await store.set(`kw:${slug}`, JSON.stringify(result)).catch(() => {})
    return ok(result)
  }

  // ── Finish: assemble summary from stored kw: blobs ────────────────────────
  if (action === 'finish') {
    try {
      const store     = getStore(STORE)
      const checkedAt = new Date().toISOString()
      const results   = []
      for (const kw of KEYWORDS) {
        const slug = kw.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
        const r    = tryParse(await store.get(`kw:${slug}`).catch(() => null))
        results.push(r || { keyword: kw, error: 'no data', our_pages: [], in_aio: false, site_cited: false })
      }
      const inAio  = results.filter(r => r.in_aio).length
      const cited  = results.filter(r => r.site_cited).length
      const ranked = results.filter(r => r.our_pages && r.our_pages.length > 0).length
      const data   = { checkedAt, summary: { total: results.length, in_aio: inAio, site_cited: cited, ranked }, keywords: results }
      await store.set(RESULTS_KEY, JSON.stringify(data))
      let history = tryParse(await store.get(HISTORY_KEY).catch(() => null)) || []
      history.unshift({ date: checkedAt.slice(0, 10), in_aio: inAio, site_cited: cited, total: results.length })
      if (history.length > 30) history = history.slice(0, 30)
      await store.set(HISTORY_KEY, JSON.stringify(history))
      return ok({ ok: true, summary: data.summary })
    } catch (e) { return fail(e.message) }
  }

  return fail('Unknown action', 400)
}

export const config = { path: '/api/seo-track', method: ['GET', 'OPTIONS'] }

// ── Check one keyword — handles page_token for deferred AIO ──────────────────
// No client-side timeout — let ValueSERP take up to 60s per Google's recommendation
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
      try {
        const t = await res.text()
        if (t) { try { e += ': ' + (JSON.parse(t).message || t.slice(0, 150)) } catch { e += ': ' + t.slice(0, 150) } }
      } catch {}
      result.error = e
      return result
    }

    let data
    try {
      const text = await res.text()
      if (!text?.trim()) { result.error = 'Empty response'; return result }
      data = JSON.parse(text)
    } catch (e) { result.error = 'Parse error: ' + e.message; return result }

    // ── page_token: AIO was deferred — follow up immediately ─────────────
    const pageToken = data.page_token || data.ai_overview?.page_token
    if (pageToken && !(data.ai_overview?.text_blocks?.length) && !(data.ai_overview?.snippet)) {
      try {
        const tRes = await fetch(`https://api.valueserp.com/search?api_key=${encodeURIComponent(apiKey)}&page_token=${encodeURIComponent(pageToken)}`)
        if (tRes.ok) {
          const tText = await tRes.text()
          if (tText?.trim()) {
            const tData = JSON.parse(tText)
            if (tData.ai_overview) data.ai_overview = tData.ai_overview
          }
        }
      } catch (e) {
        console.warn('[seo-api] page_token follow-up failed:', e.message)
      }
    }

    // ── Parse AI Overview ─────────────────────────────────────────────────
    const aio = data.ai_overview
    if (aio) {
      result.in_aio = true
      const parts = []
      if (aio.text_blocks) {
        for (const b of aio.text_blocks) {
          if (b.snippet) parts.push(b.snippet)
          if (b.list) for (const item of b.list) if (item.snippet) parts.push('• ' + item.snippet)
        }
      }
      if (!parts.length && aio.snippet) parts.push(aio.snippet)
      result.aio_text = parts.join('\n\n').slice(0, 3000) || null

      const srcs = [...(aio.ai_overview_sources||[]), ...(aio.sources||[]), ...(aio.references||[])]
      result.aio_sources = srcs
        .map(s => ({ title: s.title||s.name||'', link: s.link||s.url||'' }))
        .filter(s => s.link).slice(0, 10)
      result.site_cited = result.aio_sources.some(s => String(s.link||"").includes(SITE)) ||
                          JSON.stringify(aio).toLowerCase().includes(SITE)

      if (result.site_cited) {
        const ours = result.aio_sources.filter(s => String(s.link||"").includes(SITE))
        ours.length
          ? ours.forEach(p => result.our_pages.push({ where: 'AIO source', link: p.link, title: p.title }))
          : result.our_pages.push({ where: 'AIO mention', link: '', title: 'Domain mentioned in AIO text' })
      }
    }

    // ── Organic results ───────────────────────────────────────────────────
    ;(data.organic_results || []).forEach((r, i) => {
      if (r.link && String(r.link).includes(SITE)) {
        const pos = r.position || i + 1
        if (!result.organic_rank || pos < result.organic_rank) result.organic_rank = pos
        result.our_pages.push({ where: `Organic #${pos}`, link: r.link, title: r.title || '' })
      }
    })

    // ── Everything else: top stories, local, knowledge graph ─────────────
    const extras = [
      ...(data.top_stories || []),
      ...(data.local_results || []),
      ...((data.knowledge_graph?.links) || []),
    
  "social security benefits for children under 18",
  "social security dependent benefit calculator",
  "can my child get social security if I retire at 62",
  "social security child in care benefits",
  "social security family maximum calculator",
  "should I claim social security early with young children",
  "social security spousal benefit child in care",
  "how much social security does a child get from a parent",
  "social security dependent benefit family maximum",
  "claiming social security early for kids benefits",
  "social security benefits for children",
  "how much social security will my child get",
  "social security claiming strategy",
  "are social security dependent benefits taxable",
  "social security 1099 child benefit",
  "social security family maximum 2026",
  "kiddie tax social security benefits",
  "social security child benefit application",
]
    extras.forEach(item => {
      const link = item.link || item.url || ''
      if (String(link||"").includes(SITE)) result.our_pages.push({ where: 'Other result', link: String(link||""), title: item.title || '' })
    })

    // ── Final catch-all ───────────────────────────────────────────────────
    if (!result.our_pages.length && JSON.stringify(data).toLowerCase().includes(SITE))
      result.our_pages.push({ where: 'SERP mention', link: '', title: 'Found in raw response' })

  } catch (e) { result.error = e.message }
  return result
}
