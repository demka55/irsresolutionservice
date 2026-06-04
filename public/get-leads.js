// netlify/functions/get-leads.js
// Returns all contact form submissions for admin dashboard

const { getStore } = require('@netlify/blobs');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const ADMIN_PASSWORD       = process.env.ADMIN_PASSWORD || '';
  const ADMIN_PASSWORD_ROMEO = process.env.ADMIN_PASSWORD_ROMEO || '';

  const url = new URL(event.rawUrl || `https://x.com${event.path}`);
  const password = url.searchParams.get('password');
  const isValid = (ADMIN_PASSWORD && password === ADMIN_PASSWORD) ||
                  (ADMIN_PASSWORD_ROMEO && password === ADMIN_PASSWORD_ROMEO);

  if (!isValid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  try {
    const store = getStore('leads');

    let index = [];
    try {
      const raw = await store.get('__index__');
      if (raw) index = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {}

    if (!index.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ leads: [] }) };
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ leads: leads.filter(Boolean) })
    };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
