// netlify/functions/seo-track.mjs
// Scheduled function ONLY — runs daily at 6am UTC
// NO path — calls the same checkKeyword logic inline (no cross-import)

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
  // NEW: Trump Accounts (July 2026) + Form 5500-EZ penalty
  "Trump accounts $1000 newborn",
  "how to open a Trump account",
  "Form 4547 instructions",
  "Trump account eligibility",
  "Trump account vs 529",
  "Trump account contribution limit",
  "Trump account taxes at 18",
  "trumpaccounts.gov how to apply",
  "Trump account SSN requirement",
  "Trump account employer contribution 2500",
  "is the 1000 Trump account automatic",
  "Trump account for kids not born 2025",
  "Section 530A account",
  "Trump account excess contribution",
  "Form 4547 line 6 line 7",
  "Form 5500-EZ late filing penalty",
  "solo 401k 5500-EZ deadline July 31",
  "5500-EZ penalty relief Rev Proc 2015-32",
  "Form 14704 late 5500-EZ",
  "CP 283 penalty notice 5500",
  "5500-EZ $250 per day penalty",
  "solo 401k over 250000 filing requirement",
  "5500-EZ final return plan termination",
  "missed form 5500-EZ what to do",
  "5500-EZ reasonable cause abatement",
  "how to get irs lien removed",
  // NEW: Automatic Penalty Relief (AEP) — IR-2026-83 — 43 comprehensive keywords for announcement
  "IRS automatic penalty relief 2026",
  "automatic exemption from penalty AEP",
  "IR-2026-83",
  "IRS news July 8 2026",
  "first time penalty abatement replaced",
  "first time abate vs AEP",
  "AEP replacing FTA",
  "IRS phasing out first time penalty abatement",
  "when FTA ends 2027",
  "IRS automatic penalty relief what is",
  "automatic penalty relief IRS explained",
  "AEP automatic exemption penalty",
  "IRS systemic penalty relief",
  "no request penalty relief IRS",
  "AEP eligibility three year history",
  "automatic penalty relief qualifications",
  "who qualifies for AEP",
  "12 consecutive quarters AEP",
  "clean filing history penalty relief",
  "failure to file automatic relief",
  "failure to pay automatic relief",
  "failure to deposit automatic relief",
  "IRS automatic failure penalties 2026",
  "estimated tax penalty AEP",
  "Form 706 709 AEP eligible",
  "information returns AEP",
  "AEP eligible return forms",
  "AEP 1040 1065 1120 941",
  "summer 2026 AEP phase in",
  "January 1 2027 AEP full effective",
  "when does automatic penalty relief start",
  "AEP implementation date",
  "penalty notice 2025 returns AEP transition",
  "still get penalty notice 2026 AEP",
  "call IRS request first time abate 2026",
  "what if I get penalty AEP qualified",
  "how much penalty relief AEP",
  "penalty savings automatic abatement",
  "IRS penalty waived clean record",
  "should I request reasonable cause or AEP",
  "preserve AEP reasonable cause",
  "business penalty relief IRS 2026",
  "individual penalty relief IRS 2026",
  // RESCUED: these were stuck in a broken fallback array and never actually tracked — moved here
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

  // NEW: CP504 long-tail (from live SERP related searches + PAA)
  "what comes after cp504",
  "is cp504 the final notice",
  "cp504 example",
  "cp504 reddit",
  "cp504 notice meaning",
  "irs notice cp504 phone number",
  "cp504 payment plan",
  "how long does it take to respond to cp504",
  "how serious is a cp504",
  "cp504 passport",
  "cp504 state tax refund levy",
  "cp504 vs cp503",

  // NEW: CP2000 long-tail (from live SERP related searches + PAA)
  "cp2000 letter",
  "cp2000 penalty",
  "irs cp2000 response form pdf",
  "is cp2000 an audit",
  "irs cp2000 response letter sample",
  "fake cp2000 notice",
  "cp2000 pdf",
  "how do i check the status of my cp2000",
  "what is a cp2000 notice from the irs",
  "does a cp2000 trigger an audit",
  "what should i do if i get a cp2000",
  "what happens if i don't respond to cp2000",
  "cp2000 reconsideration",
  "cp2501 vs cp2000",
  "irs document upload tool cp2000",

  // NEW: CP14 long-tail (from live SERP related searches + PAA)
  "irs cp14 pay online",
  "cp14 notice",
  "irs cp14 phone number",
  "irs gov cp14 login",
  "cp14 notice but already paid",
  "is cp14 a civil penalty",
  "cp14 notice example",
  "irs notice cp14 payment stub",
  "what does cp14 mean from the irs",
  "what if i received cp14 but already paid",
  "what comes after a cp14 notice",
  "how do i pay my irs notice cp14 online",
  "cp14 10 day deadline",
  "cp14 100000 balance",

  // NEW: CP523 long-tail (from live SERP related searches + PAA)
  "cp523 notice phone number",
  "how to pay cp523 online",
  "what comes after a cp523 notice",
  "cp523 certified mail",
  "cp523 notice reddit",
  "cp523 irs",
  "cp523 pdf",
  "cp523d",
  "what is a cp523 notice from the irs",
  "what comes after irs notice cp523",
  "how to fix cp523 notice",
  "how do i call the irs about cp523",
  "cp523 reinstatement fee",
  "cp523h notice",

  // NEW: CP59 long-tail (from live SERP related searches + PAA)
  "irs cp59 phone number",
  "cp59 reddit",
  "irs notice cp59 in error",
  "irs notice cp59 sample",
  "irs notice cp59 2024",
  "cp59 letter",
  "irs form 15103 where to mail",
  "irs gov f15103 form",
  "what is a cp59 notice",
  "how to respond to irs notice cp59",
  "how long do i have to respond to a cp59 notice",
  "what does cp stand for in irs notices",
  "cp59 8 week rule",
  "cp59sn notice",
  "false cp59 notices",

  // NEW: CP3219A long-tail
  "cp3219a notice of deficiency",
  "notice of deficiency response",
  "statutory notice of deficiency",
  "tax court petition fee",
  "notice of deficiency vs cp2000",
  "90 day letter tax court",
  "form 5564 notice of deficiency",
  "tax court filing fee waiver",
  "equitable tolling tax court deadline",

  // NEW: LT11 long-tail
  "lt11 vs letter 1058",
  "irs letter 1058",
  "notice of intent to levy and your right to a hearing",
  "lt11 notice irs",
  "final notice of intent to levy 30 days",
  "lt11 last known address",
  "form 12153 cdp hearing",
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
      result.site_cited = result.aio_sources.some(s => String(s.link||"").includes(SITE)) || JSON.stringify(aio).toLowerCase().includes(SITE)
      if (result.site_cited) {
        const ourAio = result.aio_sources.filter(s => String(s.link||"").includes(SITE))
        ourAio.forEach(p => result.our_pages.push({ where: 'AIO source', link: p.link, title: p.title }))
        if (!ourAio.length) result.our_pages.push({ where: 'AIO text mention', link: '', title: '' })
      }
    }
    ;(data.organic_results||[]).forEach((r, idx) => {
      if (r.link && String(r.link).includes(SITE)) {
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
