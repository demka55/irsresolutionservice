// netlify/functions/update-lead.js
// Updates a lead record (notes, status) in Netlify Blobs

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

  const ADMIN_PASSWORD       = process.env.ADMIN_PASSWORD || '';
  const ADMIN_PASSWORD_ROMEO = process.env.ADMIN_PASSWORD_ROMEO || '';

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { adminPassword, lead } = body;
  const isValid = (ADMIN_PASSWORD && adminPassword === ADMIN_PASSWORD) ||
                  (ADMIN_PASSWORD_ROMEO && adminPassword === ADMIN_PASSWORD_ROMEO);

  if (!isValid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  if (!lead?.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing lead.id' }) };

  try {
    const store = getStore('leads');
    await store.set(lead.id, JSON.stringify({ ...lead, updatedAt: new Date().toISOString() }));
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
