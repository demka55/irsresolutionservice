// netlify/functions/admin-clients.mjs
// Lists all admin clients from the 'clients' blob store.
// GET  /api/admin-clients?password=xxx  →  { clients: [...] }

import { getStore } from '@netlify/blobs'

const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || ''
const STORE = 'client-status'

const headers = {
  'Access-Control-Allow-Origin': 'https://irsresolutionservice.com',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers })

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers })
  }

  const url = new URL(req.url)
  const pw = url.searchParams.get('password') || ''

  if (!ADMIN_PASSWORD || pw !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
  }

  try {
    const store = getStore(STORE)
    const { blobs } = await store.list()

    const clients = await Promise.all(
      blobs.map(async (b) => {
        try {
          const raw = await store.get(b.key)
          const data = raw ? JSON.parse(raw) : {}
          return { email: b.key, ...data }
        } catch {
          return { email: b.key }
        }
      })
    )

    // Sort newest first
    clients.sort((a, b) => {
      const ta = a.paidAt || a.createdAt || ''
      const tb = b.paidAt || b.createdAt || ''
      return tb.localeCompare(ta)
    })

    return new Response(JSON.stringify({ clients }), { status: 200, headers })

  } catch (err) {
    console.error('[admin-clients]', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
  }
}

export const config = { path: '/api/admin-clients', method: ['GET', 'OPTIONS'] }
