// One-time migration: rebuilds the __index__ from store.list()
// Call once at: /api/rebuild-index?password=gdhERcgvJfqk3WhiPExi
// Then delete this file from your repo

import { getStore } from '@netlify/blobs';

const ADMIN_PASSWORD = 'gdhERcgvJfqk3WhiPExi';

export default async (req) => {
  const headers = { 'Content-Type': 'application/json' };
  const url = new URL(req.url);
  if (url.searchParams.get('password') !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  try {
    const store = getStore('client-status');
    const { blobs } = await store.list();
    const emails = blobs
      .map(b => b.key)
      .filter(k => k !== '__index__' && k.includes('@'));

    await store.set('__index__', JSON.stringify(emails));

    return new Response(JSON.stringify({ ok: true, indexed: emails }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

export const config = { path: '/api/rebuild-index' };
