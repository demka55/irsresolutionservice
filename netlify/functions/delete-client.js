// netlify/functions/delete-client.js
// Removes a client from Netlify Blobs and the index

const { getStore } = require('@netlify/blobs');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { adminPassword, email } = body;

  if (adminPassword !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing email' }) };
  }

  try {
    const store = getStore('client-status');
    const key = email.toLowerCase();

    // Delete client record
    await store.delete(key);

    // Remove from index
    try {
      const rawIndex = await store.get('__index__');
      if (rawIndex) {
        let index = typeof rawIndex === 'string' ? JSON.parse(rawIndex) : rawIndex;
        index = index.filter(e => e !== key);
        await store.set('__index__', JSON.stringify(index));
      }
    } catch(indexErr) {
      console.warn('[delete-client] index update failed:', indexErr.message);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
