// netlify/functions/seo-api.mjs — data for the /seo "SEO" tab (all actions need the admin password)
// GET  /api/seo?action=dashboard&days=30  → pages with AI-bot visits, keywords, Google + Bing ranks
// GET  /api/seo?action=status             → progress of the current/last rank run
// POST /api/seo?action=keywords  {path, keywords: [...]} → save a page's keyword list
import { getStore } from '@netlify/blobs'
import { BRANDS, normPath } from '../lib/bots.js'
import { listEvents } from '../lib/bot-events.mjs'
import { isAuthorized, sitemapPaths, json } from '../lib/http.mjs'
import {
  STORE, pageKey, tryParse, getKeywordMap, setPageKeywords, pageStats, readStatus, readHistory,
} from '../lib/seo-core.mjs'

export default async (req) => {
  if (!isAuthorized(req)) return json({ error: 'unauthorized' }, 401)
  const url = new URL(req.url)
  const action = url.searchParams.get('action') || 'dashboard'
  const store = getStore(STORE)

  if (action === 'status') return json({ status: await readStatus(store) })

  if (action === 'keywords' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    if (!body.path) return json({ error: 'path required' }, 400)
    const keywords = await setPageKeywords(body.path, body.keywords, store)
    return json({ ok: true, path: normPath(body.path), keywords })
  }

  if (action === 'dashboard') {
    const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10) || 30, 1), 90)
    const [events, sitemap, map, status, history] = await Promise.all([
      listEvents(days), sitemapPaths(url.origin), getKeywordMap(store), readStatus(store), readHistory(store),
    ])
    const stats = pageStats(events)
    const inMap = new Set(sitemap)
    const paths = [...new Set([...sitemap, ...stats.keys()])]
      .filter((p) => inMap.has(p) || (stats.get(p)?.ai || 0) > 0) // non-sitemap URLs only if AI fetched them
    const recs = await Promise.all(paths.map((p) => store.get(pageKey(p)).then(tryParse).catch(() => null)))

    const pages = paths.map((path, i) => {
      const s = stats.get(path) || { brands: {}, ai: 0, total: 0, lastAI: 0, last: 0 }
      const rec = recs[i]
      return {
        path, inSitemap: inMap.has(path), ...s, checkedAt: rec?.checkedAt || null,
        keywords: (map[path] || []).map((kw) => ({ kw, google: rec?.keywords?.[kw]?.google || null, bing: rec?.keywords?.[kw]?.bing || null })),
      }
    }).sort((a, b) => b.ai - a.ai || b.total - a.total || a.path.localeCompare(b.path))

    return json({
      generated: Date.now(), days, status, history,
      brands: BRANDS.map(({ id, label, ai }) => ({ id, label, ai })),
      keys: { google: !!Netlify.env.get('VALUESERP_API'), bing: !!Netlify.env.get('SERPAPI_KEY') },
      pages,
    })
  }
  return json({ error: 'unknown action' }, 400)
}

export const config = { path: '/api/seo' }
