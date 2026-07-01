// netlify/functions/get-leads.mjs
import { getStore } from '@netlify/blobs';

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });

  const ADMIN_PASSWORD       = Netlify.env.get('ADMIN_PASSWORD') || '';
  const ADMIN_PASSWORD_ROMEO = Netlify.env.get('ADMIN_PASSWORD_ROMEO') || '';

  const url = new URL(req.url);
  const password = url.searchParams.get('password');
  const isValid = (ADMIN_PASSWORD && password === ADMIN_PASSWORD) ||
                  (ADMIN_PASSWORD_ROMEO && password === ADMIN_PASSWORD_ROMEO);

  if (!isValid) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

  try {
    const store = getStore('leads');

    let index = [];
    try {
      const raw = await store.get('__index__');
      if (raw) index = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {}

    if (!index.length) {
      return new Response(JSON.stringify({ leads: [] }), { status: 200, headers });
    }

    const leads = await Promise.all(
      index.slice(0, 100).map(async (id) => {
        try {
          const raw = await Promise.race([
            store.get(id),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
          ]);
          if (!raw) return null;
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch { return null; }
      })
    );

    return new Response(JSON.stringify({ leads: leads.filter(Boolean) }), { status: 200, headers });

  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/get-leads', method: ['GET', 'OPTIONS'] };
