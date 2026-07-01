// netlify/functions/delete-client.mjs
import { getStore } from '@netlify/blobs';

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  const ADMIN_PASSWORD       = Netlify.env.get('ADMIN_PASSWORD') || '';
  const ADMIN_PASSWORD_ROMEO = Netlify.env.get('ADMIN_PASSWORD_ROMEO') || '';

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }

  const { adminPassword, email } = body;
  const isValid = (ADMIN_PASSWORD && adminPassword === ADMIN_PASSWORD) ||
                  (ADMIN_PASSWORD_ROMEO && adminPassword === ADMIN_PASSWORD_ROMEO);

  if (!isValid) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  if (!email)   return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400, headers });

  const key = email.toLowerCase().trim();

  try {
    const store = getStore('client-status');

    // Delete client record
    await store.delete(key);
    console.log('[delete-client] deleted:', key);

    // Update index
    let index = [];
    try {
      const raw = await store.get('__index__');
      if (raw) index = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch(e) { console.warn('[delete-client] index read failed:', e.message); }

    const newIndex = index.filter(e => e !== key);
    await store.set('__index__', JSON.stringify(newIndex));
    console.log('[delete-client] index updated:', newIndex);

    return new Response(JSON.stringify({ ok: true, deleted: key }), { status: 200, headers });

  } catch(err) {
    console.error('[delete-client] error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/delete-client', method: ['POST', 'OPTIONS'] };
