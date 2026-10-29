// Read logged bot events back out of Netlify Blobs (keys carry the data; see bots.js).
import { getStore } from '@netlify/blobs'
import { STORE_NAME, parseEventKey } from './bots.js'

async function listDay(store, day) {
  const out = []
  for await (const page of store.list({ prefix: `${day}/`, paginate: true })) {
    for (const b of page.blobs) { const e = parseEventKey(b.key); if (e) out.push(e) }
  }
  return out
}

// Events from the last `days` days, newest first: [{ ts, who, verified, status, path }]
export async function listEvents(days = 30) {
  const store = getStore(STORE_NAME)
  const dayKeys = []
  for (let i = 0; i < days; i++) dayKeys.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10))
  const perDay = await Promise.all(dayKeys.map((d) => listDay(store, d)))
  return perDay.flat().sort((a, b) => b.ts - a.ts)
}
