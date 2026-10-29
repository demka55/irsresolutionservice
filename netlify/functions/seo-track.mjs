// netlify/functions/seo-track.mjs
// Scheduled daily at 6am UTC. It only starts the background run (which has
// 15 minutes instead of the 30 seconds scheduled functions get).
import { siteOrigin } from '../lib/http.mjs'

export default async () => {
  const res = await fetch(`${siteOrigin()}/api/seo-run`, {
    method: 'POST',
    headers: { 'x-seo-key': Netlify.env.get('ADMIN_PASSWORD') || '', 'content-type': 'application/json' },
    body: '{}',
  }).catch((e) => ({ status: 0, statusText: e.message }))
  console.log(`[seo-track] started daily rank run: HTTP ${res.status} ${res.statusText || ''}`)
}

export const config = { schedule: '0 6 * * *' }
