import { getUser } from '@netlify/identity'
import { getStore } from '@netlify/blobs'

const STORE = 'accounts'

function profileKey(userId) { return `profile/${userId}` }

function sanitizeSsn(last4) {
  if (!last4) return ''
  const digits = String(last4).replace(/\D/g, '').slice(-4)
  return digits.length === 4 ? digits : ''
}

function sanitizeYears(years) {
  if (!Array.isArray(years)) return []
  return years
    .map((y) => String(y).trim())
    .filter((y) => /^(19|20)\d{2}$/.test(y))
}

export default async (req) => {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const store = getStore(STORE)
  const key = profileKey(user.id)

  if (req.method === 'GET') {
    const profile = await store.get(key, { type: 'json' })
    return Response.json({ profile: profile || null })
  }

  if (req.method === 'POST') {
    let body
    try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }

    const name = String(body.name || '').trim().slice(0, 120)
    const ssnLast4 = sanitizeSsn(body.ssnLast4)
    const address = String(body.address || '').trim().slice(0, 240)
    const filingStatus = String(body.filingStatus || '').trim().slice(0, 20)
    const taxYears = sanitizeYears(body.taxYears)

    if (!name) return Response.json({ error: 'Name is required.' }, { status: 400 })
    if (!ssnLast4) return Response.json({ error: 'Enter exactly 4 digits for the SSN last-4.' }, { status: 400 })

    const existing = (await store.get(key, { type: 'json' })) || {}
    const profile = {
      ...existing,
      userId: user.id,
      email: user.email,
      name,
      ssnLast4,
      address,
      filingStatus,
      taxYears,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    await store.setJSON(key, profile)
    return Response.json({ profile })
  }

  return new Response('Method Not Allowed', { status: 405 })
}

export const config = {
  path: '/api/me/profile',
  method: ['GET', 'POST'],
}
