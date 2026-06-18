// netlify/functions/client-files.mjs
// Admin-only document storage per client, backed by Netlify Blobs.
// Files are stored as base64 strings inside JSON records — never web-public,
// every read/write requires the admin password (checked server-side here).
//
// PERFORMANCE NOTE: metadata is stored separately from the heavy base64 payload
// (in a lightweight "__meta__:{email}" array of metadata objects) so that listing
// a client's files never has to fetch every file's full content from Blobs —
// only the single file being downloaded does.

import { getStore } from '@netlify/blobs';

// Netlify Functions have a hard 6MB request/response payload limit (buffered synchronous
// functions). Base64 encoding inflates raw file size by ~37%. To stay safely under 6MB
// including JSON wrapper overhead, cap the RAW file at 4MB (→ ~5.5MB encoded).
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function checkAdmin(password) {
  const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || '';
  const ADMIN_PASSWORD_ROMEO = Netlify.env.get('ADMIN_PASSWORD_ROMEO') || '';
  return (ADMIN_PASSWORD && password === ADMIN_PASSWORD) || (ADMIN_PASSWORD_ROMEO && password === ADMIN_PASSWORD_ROMEO);
}

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });

  const store = getStore('client-files');
  const url = new URL(req.url);

  // ── GET: list files for a client (cheap, metadata-only), or fetch one file's full content ──
  if (req.method === 'GET') {
    const password = url.searchParams.get('password');
    if (!checkAdmin(password)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

    const email = (url.searchParams.get('email') || '').toLowerCase();
    const fileId = url.searchParams.get('fileId');
    if (!email) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400, headers });

    if (fileId) {
      // Fetch single file's full content (for download) — the only place we read the heavy payload
      try {
        const raw = await store.get(`${email}:${fileId}`);
        if (!raw) return new Response(JSON.stringify({ error: 'File not found' }), { status: 404, headers });
        const file = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return new Response(JSON.stringify(file), { status: 200, headers });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
      }
    }

    // List all files for this client — reads ONLY the lightweight metadata index,
    // never the full base64 content of every file.
    try {
      const rawIdx = await store.get(`__meta__:${email}`);
      const metaIndex = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : [];
      const files = metaIndex.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      return new Response(JSON.stringify({ files }), { status: 200, headers });
    } catch (err) {
      return new Response(JSON.stringify({ files: [], error: err.message }), { status: 200, headers });
    }
  }

  // ── POST: upload a new file ──
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
    }

    const { email, adminPassword, filename, contentType, base64Data, uploadedBy, source } = body;

    // Allow either admin upload OR internal system calls (e.g. submit-2848 auto-saving the signed form)
    const isAdmin = checkAdmin(adminPassword);
    const expectedInternalKey = Netlify.env.get('INTERNAL_FUNCTION_KEY');
    const isInternal = !!expectedInternalKey && !!body.internalKey && body.internalKey === expectedInternalKey;
    if (!isAdmin && !isInternal) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });

    if (!email || !filename || !base64Data) {
      return new Response(JSON.stringify({ error: 'Missing required fields (email, filename, base64Data)' }), { status: 400, headers });
    }

    const approxBytes = Math.ceil(base64Data.length * 0.75);
    if (approxBytes > MAX_FILE_BYTES) {
      return new Response(JSON.stringify({ error: `File too large. Max size is ${MAX_FILE_BYTES / 1024 / 1024}MB.` }), { status: 400, headers });
    }

    const key = email.toLowerCase();
    const fileId = `f${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const fileRecord = {
      fileId,
      filename,
      contentType: contentType || 'application/octet-stream',
      size: approxBytes,
      base64Data,
      uploadedAt: new Date().toISOString(),
      uploadedBy: uploadedBy || (isInternal ? 'System' : 'Admin'),
      source: source || (isInternal ? 'auto' : 'admin'),
    };

    const metaRecord = {
      fileId,
      filename: fileRecord.filename,
      contentType: fileRecord.contentType,
      size: fileRecord.size,
      uploadedAt: fileRecord.uploadedAt,
      uploadedBy: fileRecord.uploadedBy,
      source: fileRecord.source,
    };

    try {
      // Write the full record (with base64 payload)
      await store.set(`${key}:${fileId}`, JSON.stringify(fileRecord));

      // Update the lightweight metadata-only index used for fast listing
      let metaIndex = [];
      try {
        const rawMeta = await store.get(`__meta__:${key}`);
        if (rawMeta) metaIndex = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta;
      } catch {}
      metaIndex.push(metaRecord);
      await store.set(`__meta__:${key}`, JSON.stringify(metaIndex));

      return new Response(JSON.stringify({ ok: true, fileId, filename, uploadedAt: fileRecord.uploadedAt }), { status: 200, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  // ── DELETE: remove a file ──
  if (req.method === 'DELETE') {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
    }
    const { email, fileId, adminPassword } = body;
    if (!checkAdmin(adminPassword)) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
    if (!email || !fileId) return new Response(JSON.stringify({ error: 'Missing email or fileId' }), { status: 400, headers });

    const key = email.toLowerCase();
    try {
      await store.delete(`${key}:${fileId}`);

      let metaIndex = [];
      try {
        const rawMeta = await store.get(`__meta__:${key}`);
        if (rawMeta) metaIndex = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta;
      } catch {}
      metaIndex = metaIndex.filter(f => f.fileId !== fileId);
      await store.set(`__meta__:${key}`, JSON.stringify(metaIndex));

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
};
