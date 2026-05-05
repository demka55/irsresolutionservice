import { getStore } from '@netlify/blobs';

const ADMIN_PASSWORD = 'gdhERcgvJfqk3WhiPExi';

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });

  // Check admin password
  const url = new URL(req.url);
  const password = url.searchParams.get('password') || req.headers.get('X-Admin-Password');

  if (password !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  try {
    const store = getStore('client-status');
    const { blobs } = await store.list();

    const clients = await Promise.all(
      blobs.map(async (blob) => {
        try {
          const data = await store.get(blob.key, { type: 'json' });
          return data;
        } catch {
          return null;
        }
      })
    );

    const validClients = clients
      .filter(Boolean)
      .sort((a, b) => new Date(b.paidAt || 0) - new Date(a.paidAt || 0));

    return new Response(JSON.stringify({ clients: validClients }), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/admin-clients' };
