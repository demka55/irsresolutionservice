// netlify/functions/update-lead.mjs
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

  const { adminPassword, lead } = body;
  const isValid = (ADMIN_PASSWORD && adminPassword === ADMIN_PASSWORD) ||
                  (ADMIN_PASSWORD_ROMEO && adminPassword === ADMIN_PASSWORD_ROMEO);

  if (!isValid) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  if (!lead?.id) return new Response(JSON.stringify({ error: 'Missing lead.id' }), { status: 400, headers });

  try {
    const store = getStore('leads');
    await store.set(lead.id, JSON.stringify({ ...lead, updatedAt: new Date().toISOString() }));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};
