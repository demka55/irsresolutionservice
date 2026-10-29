// Small helpers shared by the /seo functions.
import { normPath } from './bots.js'

// Same admin password as the /seo login (ADMIN_PASSWORD env var), sent in the "x-seo-key" header.
export function isAuthorized(req) {
  const expected = Netlify.env.get('ADMIN_PASSWORD')
  if (!expected) return false
  const given = req.headers.get('x-seo-key') || ''
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

export const siteOrigin = () => Netlify.env.get('URL') || 'https://irsresolutionservice.com'

export async function sitemapPaths(origin = siteOrigin()) {
  try {
    const r = await fetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return []
    const xml = await r.text()
    return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => {
      try { return normPath(new URL(m[1]).pathname) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

export const json = (data, status = 200) =>
  Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } })
