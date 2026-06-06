import { getStore } from '@netlify/blobs';

// Password read from env var — never hardcoded

// Fields clients are allowed to update on their own record
const CLIENT_ALLOWED_FIELDS = ['steps', 'notes'];

// Fields only admins can update
const ADMIN_ONLY_FIELDS = ['status', 'name', 'company', 'phone', 'sessionId', 'paidAt', 'amount'];

export default async (req) => {
  const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || '';
  const ADMIN_PASSWORD_ROMEO = Netlify.env.get('ADMIN_PASSWORD_ROMEO') || '';
  const headers = {
    'Access-Control-Allow-Origin': 'https://irsresolutionservice.com',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });

  const store = getStore('client-status');

  // GET — fetch status for a specific client
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const email = url.searchParams.get('email');
    if (!email) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400, headers });
    try {
      const raw = await store.get(email.toLowerCase());
      const data = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { status: 'paid', steps: {} };
      return new Response(JSON.stringify(data), { status: 200, headers });
    } catch {
      return new Response(JSON.stringify({ status: 'paid', steps: {} }), { status: 200, headers });
    }
  }

  // POST — update status
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
    }

    const { email, update, adminPassword } = body;
    if (!email) return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400, headers });

    const isAdmin = ADMIN_PASSWORD && adminPassword === ADMIN_PASSWORD;

    // Check if update contains admin-only fields
    const hasAdminFields = ADMIN_ONLY_FIELDS.some(f => update[f] !== undefined) || update.adminAction;

    if (hasAdminFields && !isAdmin) {
      return new Response(JSON.stringify({ error: 'Unauthorized — admin required for this update' }), { status: 401, headers });
    }

    // Non-admin updates: only allow specific step keys (form2848Signed, planApproved)
    if (!isAdmin && update.steps) {
      const allowedStepKeys = ['form2848Signed', 'form2848Data', 'planApproved'];
      const attemptedKeys = Object.keys(update.steps);
      const disallowedKeys = attemptedKeys.filter(k => !allowedStepKeys.includes(k));
      if (disallowedKeys.length) {
        return new Response(JSON.stringify({ error: 'Unauthorized step keys: ' + disallowedKeys.join(', ') }), { status: 401, headers });
      }
    }

    const key = email.toLowerCase();

    try {
      let existing = {};
      try {
        const raw = await store.get(key);
        if (raw) existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch {}

      const updated = {
        ...existing,
        email: key,
        updatedAt: new Date().toISOString(),
        steps: { ...(existing.steps || {}), ...(update.steps || {}) },
        ...(isAdmin ? {
          status:    update.status    !== undefined ? update.status    : existing.status    || 'paid',
          name:      update.name      !== undefined ? update.name      : existing.name      || '',
          company:   update.company   !== undefined ? update.company   : existing.company   || '',
          phone:     update.phone     !== undefined ? update.phone     : existing.phone     || '',
          sessionId: update.sessionId !== undefined ? update.sessionId : existing.sessionId || '',
          notes:     update.notes     !== undefined ? update.notes     : existing.notes     || '',
          paidAt:    existing.paidAt  || update.paidAt || new Date().toISOString(),
        } : {
          status:  existing.status  || 'paid',
          name:    existing.name    || '',
          company: existing.company || '',
          phone:   existing.phone   || '',
          paidAt:  existing.paidAt  || new Date().toISOString(),
          notes:   update.notes !== undefined ? update.notes : existing.notes || '',
        }),
      };

      await store.set(key, JSON.stringify(updated));

      // Update email index
      try {
        let index = [];
        const rawIndex = await store.get('__index__');
        if (rawIndex) index = typeof rawIndex === 'string' ? JSON.parse(rawIndex) : rawIndex;
        if (!index.includes(key)) {
          index.push(key);
          await store.set('__index__', JSON.stringify(index));
        }
      } catch (indexErr) {
        console.warn('[client-status] index update failed:', indexErr.message);
      }

      return new Response(JSON.stringify({ ok: true, data: updated }), { status: 200, headers });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
};

