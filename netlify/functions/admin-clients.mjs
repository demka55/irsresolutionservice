import { getStore } from '@netlify/blobs';


export default async (req) => {
  const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || '';
  const headers = {
    'Access-Control-Allow-Origin': 'https://irsresolutionservice.com',
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

    // Read the index — a simple list of emails we maintain separately
    // This avoids the slow/unreliable store.list() call
    let emailIndex = [];
    try {
      const raw = await store.get('__index__');
      if (raw) emailIndex = JSON.parse(raw);
    } catch {
      emailIndex = [];
    }

    if (!emailIndex.length) {
      // Index is empty — try rebuilding from store.list() as fallback
      try {
        const { blobs } = await store.list();
        emailIndex = blobs
          .map(b => b.key)
          .filter(k => k !== '__index__' && k.includes('@'));
        if (emailIndex.length) {
          // Save the rebuilt index for next time
          await store.set('__index__', JSON.stringify(emailIndex));
        }
      } catch {
        // list() failed too — return empty
        return new Response(JSON.stringify({ clients: [], note: 'No clients yet — index empty and list() failed' }), { status: 200, headers });
      }
    }

    if (!emailIndex.length) {
      return new Response(JSON.stringify({ clients: [], note: 'No clients yet' }), { status: 200, headers });
    }

    // Fetch each client record individually with a timeout
    const clients = await Promise.all(
      emailIndex.map(async (email) => {
        try {
          const raw = await Promise.race([
            store.get(email),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
          ]);
          if (!raw) return null;
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          return null;
        }
      })
    );

    const validClients = clients
      .filter(Boolean)
      .sort((a, b) => new Date(b.paidAt || b.updatedAt || 0) - new Date(a.paidAt || a.updatedAt || 0));

    return new Response(JSON.stringify({ clients: validClients }), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ clients: [], error: err.message }), { status: 200, headers });
  }
};

