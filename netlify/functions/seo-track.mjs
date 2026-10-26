// netlify/functions/seo-track.mjs
// Scheduled function: daily keyword check, done in small chunks.
//
// Why chunks: scheduled functions are stopped after 30 seconds. The old version
// tried to check all ~360 keywords in one go, so it was cut off every morning and
// never saved a summary. Now it runs every 5 minutes from 6:00 to 8:55 UTC, each
// run checks the next ~15 keywords and remembers where it stopped. The last run
// saves the summary + history point, exactly like "Run now" → finish.

import { getStore } from '@netlify/blobs'
import { STORE, KEYWORDS, slugFor, readAllKeywordResults, saveSummary, checkKeyword, tryParse } from '../lib/seo-core.mjs'

const CURSOR_KEY   = 'daily-run'
const CONCURRENCY  = 6
const START_BUDGET = 9000   // ms: don't start a new batch after this
const CALL_TIMEOUT = 9000   // ms per ValueSERP request (two at most per keyword)
const LOCATION     = 'Las Vegas, Nevada, United States'

export default async () => {
  const t0 = Date.now()
  const API_KEY = Netlify.env.get('VALUESERP_API') || ''
  if (!API_KEY) { console.error('[seo-track] VALUESERP_API not set'); return }

  const store = getStore(STORE)
  const today = new Date().toISOString().slice(0, 10)
  let cur = tryParse(await store.get(CURSOR_KEY).catch(() => null))
  if (!cur || cur.date !== today) cur = { date: today, next: 0, done: false, startedAt: new Date().toISOString() }
  if (cur.done) return

  try {
    while (cur.next < KEYWORDS.length && Date.now() - t0 < START_BUDGET) {
      const batch = KEYWORDS.slice(cur.next, cur.next + CONCURRENCY)
      const results = await Promise.all(batch.map((kw) => checkKeyword(kw, API_KEY, { location: LOCATION, timeoutMs: CALL_TIMEOUT })))
      await Promise.all(results.map((r) => store.set(`kw:${slugFor(r.keyword)}`, JSON.stringify(r)).catch(() => {})))
      cur.next += batch.length
      await store.set(CURSOR_KEY, JSON.stringify(cur))
    }

    if (cur.next >= KEYWORDS.length) {
      const perKw = await readAllKeywordResults(store)
      const results = perKw.map((r, i) => r || { keyword: KEYWORDS[i], error: 'no data', our_pages: [], in_aio: false, site_cited: false })
      await saveSummary(store, results)
      cur.done = true
      await store.set(CURSOR_KEY, JSON.stringify(cur))
      console.log(`[seo-track] Daily check complete: ${KEYWORDS.length} keywords`)
    } else {
      console.log(`[seo-track] Progress ${cur.next}/${KEYWORDS.length}`)
    }
  } catch (err) {
    console.error('[seo-track] Failed:', err.message)
  }
}

export const config = { schedule: '*/5 6-8 * * *' }
