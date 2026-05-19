import { getStore } from '@netlify/blobs';

const ADMIN_PASSWORD = 'gdhERcgvJfqk3WhiPExi';

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });

  const url = new URL(req.url);
  const password = url.searchParams.get('password') || req.headers.get('X-Admin-Password');

  if (password !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  try {
    const store = getStore('client-status');

    let blobs = [];
    try {
      const result = await store.list();
      blobs = result?.blobs || [];
    } catch (listErr) {
      console.error('[admin-clients] list() failed:', listErr.message);
      return new Response(JSON.stringify({ clients: [], error: 'Could not list clients: ' + listErr.message }), { status: 200, headers });
    }

    if (!blobs.length) {
      return new Response(JSON.stringify({ clients: [] }), { status: 200, headers });
    }

    const clients = await Promise.all(
      blobs.map(async (blob) => {
        try {
          // Get as text first, then parse — more reliable than type:'json'
          const raw = await store.get(blob.key);
          if (!raw) return null;
          try {
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
          } catch {
            return null;
          }
        } catch (getErr) {
          console.warn('[admin-clients] get failed for', blob.key, getErr.message);
          return null;
        }
      })
    );

    const validClients = clients
      .filter(Boolean)
      .sort((a, b) => new Date(b.paidAt || b.updatedAt || 0) - new Date(a.paidAt || a.updatedAt || 0));

    return new Response(JSON.stringify({ clients: validClients }), { status: 200, headers });

  } catch (err) {
    console.error('[admin-clients] fatal:', err.message);
    return new Response(JSON.stringify({ clients: [], error: err.message }), { status: 200, headers });
  }
};

export const config = { path: '/api/admin-clients' };
