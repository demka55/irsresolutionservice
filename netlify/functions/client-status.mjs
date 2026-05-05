import { getStore } from '@netlify/blobs';

const ADMIN_PASSWORD = 'gdhERcgvJfqk3WhiPExi';

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });

  const store = getStore('client-status');

  // GET — fetch status for a specific client (used by resolve.html)
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const email = url.searchParams.get('email');
    if (!email) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400, headers });

    try {
      const data = await store.get(email.toLowerCase(), { type: 'json' });
      return new Response(JSON.stringify(data || { status: 'paid', steps: {} }), {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    } catch {
      return new Response(JSON.stringify({ status: 'paid', steps: {} }), {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }
  }

  // POST — update status (used by admin and resolve.html)
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }

    const { email, update, adminPassword } = body;

    // Admin updates require password
    if (update.adminAction && adminPassword !== ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    }

    if (!email) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400, headers });

    try {
      // Get existing data
      let existing = {};
      try { existing = await store.get(email.toLowerCase(), { type: 'json' }) || {}; } catch {}

      // Merge update
      const updated = {
        ...existing,
        email: email.toLowerCase(),
        updatedAt: new Date().toISOString(),
        steps: { ...(existing.steps || {}), ...(update.steps || {}) },
        status: update.status || existing.status || 'paid',
        name: update.name || existing.name || '',
        paidAt: existing.paidAt || update.paidAt || new Date().toISOString(),
        notes: update.notes !== undefined ? update.notes : (existing.notes || ''),
      };

      await store.set(email.toLowerCase(), JSON.stringify(updated));

      return new Response(JSON.stringify({ ok: true, data: updated }), {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
};

export const config = { path: '/api/client-status' };
