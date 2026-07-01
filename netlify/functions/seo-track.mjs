// netlify/functions/seo-track.mjs
// Scheduled function ONLY — runs daily at 6am UTC
// NO path — calls the same checkKeyword logic inline (no cross-import)

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

export default async () => {
  const API_KEY = Netlify.env.get('VALUESERP_API') || ''
  try {
    await runChecks(API_KEY)
    console.log('[seo-track] Daily check complete')
  } catch (err) {
    console.error('[seo-track] Failed:', err.message)
  }
}

export const config = { schedule: '0 6 * * *' }

async function runChecks(apiKey) {
  const store     = getStore(STORE)
  const checkedAt = new Date().toISOString()
  const results   = []
  const BATCH = 5
  for (let i = 0; i < KEYWORDS.length; i += BATCH) {
    const batch = KEYWORDS.slice(i, i + BATCH)
    const batchResults = await Promise.all(batch.map(kw => checkKeyword(kw, apiKey)))
    results.push(...batchResults)
    await Promise.all(batchResults.map(async (r) => {
      const slug = r.keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
      try { await store.set(`kw:${slug}`, JSON.stringify(r)) } catch {}
    }))
  }
  const inAio = results.filter(r => r.in_aio).length
  const cited = results.filter(r => r.site_cited).length
  const ranked = results.filter(r => r.our_pages && r.our_pages.length > 0).length
  const data = { checkedAt, summary: { total: results.length, in_aio: inAio, site_cited: cited, ranked }, keywords: results }
  await store.set(RESULTS_KEY, JSON.stringify(data))
  let history = []
  try { const raw = await store.get(HISTORY_KEY); if (raw) history = JSON.parse(raw) } catch {}
  history.unshift({ date: checkedAt.slice(0, 10), in_aio: inAio, site_cited: cited, total: results.length })
  if (history.length > 30) history = history.slice(0, 30)
  await store.set(HISTORY_KEY, JSON.stringify(history))
  return data
}

async function checkKeyword(keyword, apiKey) {
  const result = { keyword, in_aio: false, site_cited: false, aio_text: null, aio_sources: [], our_pages: [], organic_rank: null, error: null, checkedAt: new Date().toISOString() }
  try {
    const params = new URLSearchParams({ api_key: apiKey, q: keyword, location: 'Las Vegas, Nevada, United States', gl: 'us', hl: 'en', google_domain: 'google.com', num: '10' })
    const res = await fetch(`https://api.valueserp.com/search?${params}`, { signal: AbortSignal.timeout(25000) })
    if (!res.ok) { let e = `HTTP ${res.status}`; try { const t = await res.text(); if (t) e += ': ' + t.slice(0,200) } catch {} result.error = e; return result }
    let data
    try { const text = await res.text(); if (!text?.trim()) { result.error = 'Empty response'; return result }; data = JSON.parse(text) } catch (e) { result.error = 'Parse error: ' + e.message; return result }
    const aio = data.ai_overview
    if (aio) {
      result.in_aio = true
      const textParts = []
      if (aio.text_blocks) { for (const b of aio.text_blocks) { if (b.snippet) textParts.push(b.snippet); if (b.list) for (const i of b.list) if (i.snippet) textParts.push('• ' + i.snippet) } }
      if (!textParts.length && aio.snippet) textParts.push(aio.snippet)
      result.aio_text = textParts.join('\n\n').slice(0, 3000) || null
      const sources = [...(aio.ai_overview_sources||[]), ...(aio.sources||[]), ...(aio.references||[])]
      result.aio_sources = sources.map(s => ({ title: s.title||s.name||'', link: s.link||s.url||'' })).filter(s => s.link).slice(0, 10)
      result.site_cited = result.aio_sources.some(s => s.link.includes(SITE)) || JSON.stringify(aio).toLowerCase().includes(SITE)
      if (result.site_cited) {
        const ourAio = result.aio_sources.filter(s => s.link.includes(SITE))
        ourAio.forEach(p => result.our_pages.push({ where: 'AIO source', link: p.link, title: p.title }))
        if (!ourAio.length) result.our_pages.push({ where: 'AIO text mention', link: '', title: '' })
      }
    }
    ;(data.organic_results||[]).forEach((r, idx) => {
      if (r.link?.includes(SITE)) {
        const pos = r.position || (idx + 1)
        if (!result.organic_rank || pos < result.organic_rank) result.organic_rank = pos
        result.our_pages.push({ where: `Organic #${pos}`, link: r.link, title: r.title||'' })
      }
    })
    if (!result.our_pages.length && JSON.stringify(data).toLowerCase().includes(SITE)) {
      result.our_pages.push({ where: 'Appears in response', link: '', title: 'Found in SERP data' })
    }
  } catch (err) { result.error = err.message }
  return result
}
