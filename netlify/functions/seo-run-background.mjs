// netlify/functions/seo-run-background.mjs
// Background function (up to 15 minutes): runs the rank checks.
// POST /api/seo-run            → full run over every page AI assistants fetched in the last 30 days
// POST /api/seo-run {"path":…} → just that page (used after editing its keywords)
// The caller gets 202 right away; progress is in GET /api/seo?action=status.
import { runChecks } from '../lib/seo-core.mjs'
import { isAuthorized } from '../lib/http.mjs'

export default async (req) => {
  if (!isAuthorized(req)) { console.log('[seo-run] unauthorized'); return }
  let only = null
  try { only = (await req.json())?.path || null } catch {}
  try {
    const s = await runChecks({ only })
    console.log(`[seo-run] ${s.state}: ${s.pagesDone}/${s.pages} pages, ${s.keywords} keywords, ${s.errors} errors`)
  } catch (e) {
    // swallow so Netlify doesn't auto-retry (and re-bill) the whole run
    console.error('[seo-run] failed:', e.message)
  }
}

export const config = { path: '/api/seo-run', background: true }
