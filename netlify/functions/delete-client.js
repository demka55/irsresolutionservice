// netlify/functions/delete-client.js

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

  const { adminPassword, email } = body;
  const isValid = (ADMIN_PASSWORD && adminPassword === ADMIN_PASSWORD) ||
                  (ADMIN_PASSWORD_ROMEO && adminPassword === ADMIN_PASSWORD_ROMEO);

  if (!isValid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  if (!email)   return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing email' }) };

  try {
    // Use fetch to call Netlify Blobs REST API directly
    const siteId = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_ACCESS_TOKEN;
    const key    = email.toLowerCase();

    if (!siteId || !token) {
      return { statusCode: 503, headers, body: JSON.stringify({ error: 'NETLIFY_SITE_ID or NETLIFY_ACCESS_TOKEN not configured' }) };
    }

    const baseUrl = `https://api.netlify.com/api/v1/blobs/${siteId}/client-status`;

    // Delete the client record
    const delRes = await fetch(`${baseUrl}/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!delRes.ok && delRes.status !== 404) {
      return { statusCode: delRes.status, headers, body: JSON.stringify({ error: `Blobs delete failed: ${delRes.status}` }) };
    }

    // Update the index — remove this email
    const idxRes = await fetch(`${baseUrl}/__index__`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (idxRes.ok) {
      const idxText = await idxRes.text();
      let index = [];
      try { index = JSON.parse(idxText); } catch {}
      index = index.filter(e => e !== key);
      await fetch(`${baseUrl}/__index__`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(index),
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
