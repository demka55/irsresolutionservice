// netlify/functions/admin-users.js
// Fetches all Identity users using the IDENTITY_TOKEN env var (set in Netlify dashboard)
// Environment variable needed: NETLIFY_IDENTITY_TOKEN (your site's Identity JWT secret)

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Simple password check — matches admin.html gate
  const pw = event.queryStringParameters?.pw || event.headers['x-admin-pw'];
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'irsadmin2026romeo';
  if (pw !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Use Netlify's built-in Identity context
  // The NETLIFY_IDENTITY_TOKEN is automatically available in function context
  const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'https://irsresolutionservice.com';

  try {
    // Netlify Identity admin endpoint
    const res = await fetch(`${siteUrl}/.netlify/identity/admin/users?per_page=500`, {
      headers: {
        'Authorization': `Bearer ${process.env.NETLIFY_IDENTITY_TOKEN || ''}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const err = await res.text();
      return { statusCode: res.status, headers, body: JSON.stringify({ error: 'Identity API error: ' + err }) };
    }

    const data = await res.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch(e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
