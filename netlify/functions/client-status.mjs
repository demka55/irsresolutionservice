import { getStore } from '@netlify/blobs';

const ADMIN_PASSWORD = 'gdhERcgvJfqk3WhiPExi';

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });

  const store = getStore('client-status');

  // GET — fetch status for a specific client
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const email = url.searchParams.get('email');
    if (!email) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400, headers });

    try {
      const raw = await store.get(email.toLowerCase());
      const data = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { status: 'paid', steps: {} };
      return new Response(JSON.stringify(data), { status: 200, headers });
    } catch {
      return new Response(JSON.stringify({ status: 'paid', steps: {} }), { status: 200, headers });
    }
  }

  // POST — update status
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }

    const { email, update, adminPassword } = body;

    if (update.adminAction && adminPassword !== ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }

    if (!email) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400, headers });

    const key = email.toLowerCase();

    try {
      // Get existing
      let existing = {};
      try {
        const raw = await store.get(key);
        if (raw) existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {}

      // Merge
      const updated = {
        ...existing,
        email: key,
        updatedAt: new Date().toISOString(),
        steps: { ...(existing.steps || {}), ...(update.steps || {}) },
        status: update.status || existing.status || 'paid',
        name: update.name !== undefined ? update.name : (existing.name || ''),
        company: update.company !== undefined ? update.company : (existing.company || ''),
        phone: update.phone !== undefined ? update.phone : (existing.phone || ''),
        paidAt: existing.paidAt || update.paidAt || new Date().toISOString(),
        sessionId: update.sessionId !== undefined ? update.sessionId : (existing.sessionId || ''),
        notes: update.notes !== undefined ? update.notes : (existing.notes || ''),
      };

      // Save client record
      await store.set(key, JSON.stringify(updated));

      // Update the email index
      try {
        let index = [];
        const rawIndex = await store.get('__index__');
        if (rawIndex) index = typeof rawIndex === 'string' ? JSON.parse(rawIndex) : rawIndex;
        if (!index.includes(key)) {
          index.push(key);
          await store.set('__index__', JSON.stringify(index));
        }
      } catch (indexErr) {
        console.warn('[client-status] index update failed:', indexErr.message);
      }

      return new Response(JSON.stringify({ ok: true, data: updated }), { status: 200, headers });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
};

export const config = { path: '/api/client-status' };
