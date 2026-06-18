// netlify/functions/client-notes.mjs
// Admin-only case notes per client. Each note records who wrote it and when.

import { getStore } from '@netlify/blobs';

function checkAdmin(password) {
  const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || '';
  const ADMIN_PASSWORD_ROMEO = Netlify.env.get('ADMIN_PASSWORD_ROMEO') || '';
  if (ADMIN_PASSWORD && password === ADMIN_PASSWORD) return 'Admin';
  if (ADMIN_PASSWORD_ROMEO && password === ADMIN_PASSWORD_ROMEO) return 'Romeo';
  return null;
}

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });

  const store = getStore('client-notes');
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const password = url.searchParams.get('password');
    const author = checkAdmin(password);
    if (!author) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

    const email = (url.searchParams.get('email') || '').toLowerCase();
    if (!email) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400, headers });

    try {
      const raw = await store.get(email);
      const notes = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
      return new Response(JSON.stringify({ notes: notes.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)) }), { status: 200, headers });
    } catch (err) {
      return new Response(JSON.stringify({ notes: [], error: err.message }), { status: 200, headers });
    }
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
    }
    const { email, text, adminPassword } = body;
    const author = checkAdmin(adminPassword);
    if (!author) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    if (!email || !text || !text.trim()) return new Response(JSON.stringify({ error: 'Missing email or note text' }), { status: 400, headers });

    const key = email.toLowerCase();
    const note = {
      id: `n${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      text: text.trim(),
      author,
      createdAt: new Date().toISOString(),
    };

    try {
      let notes = [];
      const raw = await store.get(key);
      if (raw) notes = typeof raw === 'string' ? JSON.parse(raw) : raw;
      notes.push(note);
      await store.set(key, JSON.stringify(notes));
      return new Response(JSON.stringify({ ok: true, note }), { status: 200, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  if (req.method === 'DELETE') {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
    }
    const { email, noteId, adminPassword } = body;
    const author = checkAdmin(adminPassword);
    if (!author) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    if (!email || !noteId) return new Response(JSON.stringify({ error: 'Missing email or noteId' }), { status: 400, headers });

    const key = email.toLowerCase();
    try {
      let notes = [];
      const raw = await store.get(key);
      if (raw) notes = typeof raw === 'string' ? JSON.parse(raw) : raw;
      notes = notes.filter(n => n.id !== noteId);
      await store.set(key, JSON.stringify(notes));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
};
