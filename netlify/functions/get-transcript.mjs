// netlify/functions/get-transcript.mjs
// Retrieves stored IRS transcript HTML for a specific client + txKey
// GET /api/get-transcript?email=xxx&txKey=yyy&password=zzz

import { getStore } from '@netlify/blobs'

const ADMIN_PASSWORD       = Netlify.env.get('ADMIN_PASSWORD') || ''
const ADMIN_PASSWORD_ROMEO = Netlify.env.get('ADMIN_PASSWORD_ROMEO') || ''

const headers = {
  'Access-Control-Allow-Origin': 'https://irsresolutionservice.com',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers })
  if (req.method !== 'GET')    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers })

  const url   = new URL(req.url)
  const pw    = url.searchParams.get('password') || ''
  const email = url.searchParams.get('email') || ''
  const txKey = url.searchParams.get('txKey') || ''

  const isValid = (ADMIN_PASSWORD && pw === ADMIN_PASSWORD) ||
                  (ADMIN_PASSWORD_ROMEO && pw === ADMIN_PASSWORD_ROMEO)
  if (!isValid) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers })
  if (!email || !txKey) return new Response(JSON.stringify({ error: 'Missing email or txKey' }), { status: 400, headers })

  try {
    const store = getStore('transcripts')
    const blobKey = `${email.toLowerCase().trim()}:${txKey}`
    const html = await store.get(blobKey)

    if (!html) return new Response(JSON.stringify({ error: 'Transcript not found' }), { status: 404, headers })

    return new Response(JSON.stringify({ ok: true, html }), { status: 200, headers })
  } catch (err) {
    console.error('[get-transcript]', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
  }
}

export const config = { path: '/api/get-transcript', method: ['GET', 'OPTIONS'] }
