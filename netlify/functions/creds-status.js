// netlify/functions/creds-status.js
// Checks which IRS env vars are configured

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  if (body.adminPassword !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const vars = {
    IRS_API_CLIENT_ID:      process.env.IRS_API_CLIENT_ID,
    IRS_ESERVICES_USERNAME: process.env.IRS_ESERVICES_USERNAME,
    IRS_CAF_NUMBER:         process.env.IRS_CAF_NUMBER,
    IRS_JWK_KID:            process.env.IRS_JWK_KID,
    IRS_PRIVATE_KEY_PEM:    process.env.IRS_PRIVATE_KEY_PEM,
  };

  const status = {};
  const missing = [];
  const configured = [];

  for (const [key, value] of Object.entries(vars)) {
    if (value && value.trim().length > 0) {
      configured.push(key);
      status[key] = { set: true, preview: value.substring(0, 4) + '…' };
    } else {
      missing.push(key);
      status[key] = { set: false };
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: missing.length === 0, configured, missing, status }),
  };
};
