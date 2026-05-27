// netlify/functions/delete-client.js
// Uses Netlify Blobs via REST API to delete a client record and update index

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
  const siteId  = process.env.NETLIFY_SITE_ID;
  const token   = process.env.NETLIFY_ACCESS_TOKEN;

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { adminPassword, email } = body;
  const isValid = (ADMIN_PASSWORD && adminPassword === ADMIN_PASSWORD) ||
                  (ADMIN_PASSWORD_ROMEO && adminPassword === ADMIN_PASSWORD_ROMEO);

  if (!isValid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  if (!email)   return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing email' }) };
  if (!siteId || !token) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Missing NETLIFY_SITE_ID or NETLIFY_ACCESS_TOKEN' }) };

  const key = email.toLowerCase().trim();
  const blobBase = `https://api.netlify.com/api/v1/blobs/${siteId}/client-status`;
  const authHeader = { 'Authorization': `Bearer ${token}` };

  try {
    // Step 1: Delete the client record
    const delRes = await fetch(`${blobBase}/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: authHeader,
    });
    console.log('[delete-client] delete status:', delRes.status);

    // Step 2: Fetch current index
    const idxRes = await fetch(`${blobBase}/__index__`, { headers: authHeader });
    console.log('[delete-client] index fetch status:', idxRes.status);

    if (idxRes.ok) {
      const idxText = await idxRes.text();
      console.log('[delete-client] index raw:', idxText);
      let index = [];
      try { index = JSON.parse(idxText); } catch(e) { console.warn('index parse failed:', e.message); }

      // Remove the deleted email
      const newIndex = index.filter(e => e !== key);
      console.log('[delete-client] new index:', newIndex);

      // Step 3: Save updated index
      const putRes = await fetch(`${blobBase}/__index__`, {
        method: 'PUT',
        headers: { ...authHeader, 'Content-Type': 'application/octet-stream' },
        body: JSON.stringify(newIndex),
      });
      console.log('[delete-client] index put status:', putRes.status);

      if (!putRes.ok) {
        const putErr = await putRes.text();
        console.error('[delete-client] index put failed:', putErr);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Deleted client but failed to update index: ' + putErr }) };
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, deleted: key }) };

  } catch(err) {
    console.error('[delete-client] error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
