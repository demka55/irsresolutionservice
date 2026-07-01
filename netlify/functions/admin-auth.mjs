// netlify/functions/admin-auth.mjs
// Single-purpose: validates admin password against ADMIN_PASSWORD env var.
// Called by admin.html login screen — returns 200 OK or 401.
// No data returned — just confirms the password is correct.

const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || ''

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://irsresolutionservice.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers })

  if (!ADMIN_PASSWORD) {
    // Env var not configured — fail closed, never let anyone in
    return new Response(JSON.stringify({ error: 'ADMIN_PASSWORD environment variable is not set in Netlify.' }), { status: 503, headers })
  }

  let body
  try { body = await req.json() }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }) }

  if (body.password === ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers })
  }

  return new Response(JSON.stringify({ error: 'Incorrect password.' }), { status: 401, headers })
}

export const config = { path: '/api/admin-auth', method: 'POST' }
