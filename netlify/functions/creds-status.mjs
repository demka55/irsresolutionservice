// netlify/functions/creds-status.mjs
// Checks which IRS env vars are configured — returns status without exposing values

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });

  const ADMIN_PASSWORD = Netlify.env.get('ADMIN_PASSWORD') || '';

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  if (body.adminPassword !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  // Check each variable — only report present/missing, never expose values
  const vars = {
    IRS_API_CLIENT_ID:      Netlify.env.get('IRS_API_CLIENT_ID'),
    IRS_ESERVICES_USERNAME: Netlify.env.get('IRS_ESERVICES_USERNAME'),
    IRS_CAF_NUMBER:         Netlify.env.get('IRS_CAF_NUMBER'),
    IRS_JWK_KID:            Netlify.env.get('IRS_JWK_KID'),
    IRS_PRIVATE_KEY_PEM:    Netlify.env.get('IRS_PRIVATE_KEY_PEM'),
  };

  const status = {};
  const missing = [];
  const configured = [];

  for (const [key, value] of Object.entries(vars)) {
    if (value && value.trim().length > 0) {
      configured.push(key);
      // Show a safe preview — first 4 chars only
      status[key] = { set: true, preview: value.substring(0, 4) + '…' };
    } else {
      missing.push(key);
      status[key] = { set: false };
    }
  }

  return new Response(JSON.stringify({
    ok: missing.length === 0,
    configured,
    missing,
    status,
  }), { status: 200, headers });
};
