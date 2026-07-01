// netlify/functions/seo-api.mjs
// HTTP endpoint for the SEO tracker dashboard
// GET /api/seo-track?action=results           — public, returns stored data
// GET /api/seo-track?action=run&password=xxx  — protected, triggers fresh check

import { runChecks, getResults } from './seo-track.mjs'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers })

  const url    = new URL(req.url)
  const action = url.searchParams.get('action') || 'results'
  const pw     = url.searchParams.get('password') || ''

  // Public: return stored results
  if (action === 'results') {
    try {
      const data = await getResults()
      return new Response(JSON.stringify(data), { status: 200, headers })
    } catch (err) {
      return new Response(JSON.stringify({ results: null, history: [], error: err.message }), { status: 200, headers })
    }
  }

  // Protected: trigger fresh run
  const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || ''
  if (pw !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
  }

  try {
    const data = await runChecks()
    return new Response(
      JSON.stringify({ ok: true, checkedAt: data.checkedAt, summary: data.summary }),
      { status: 200, headers }
    )
  } catch (err) {
    console.error('[seo-api] run error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
  }
}

export const config = { path: '/api/seo-track', method: ['GET', 'OPTIONS'] }
