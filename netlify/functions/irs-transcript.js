// netlify/functions/irs-transcript.js
// Pulls IRS tax transcripts via TDS API using A2A OAuth flow

const IRS_TOKEN_URL = 'https://api.www4.irs.gov/auth/oauth/v2/token';
const IRS_TDS_URL   = 'https://api.www4.irs.gov/esrv/api/tds/request/caf';
const IRS_SOR_URL   = 'https://api.www4.irs.gov/esrv/api/sor/messages';

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD || '';
  const clientId        = process.env.IRS_API_CLIENT_ID;
  const privateKey      = process.env.IRS_PRIVATE_KEY_PEM;
  const cafNumber       = process.env.IRS_CAF_NUMBER;
  const eservicesUser   = process.env.IRS_ESERVICES_USERNAME;
  const jwkKid          = process.env.IRS_JWK_KID;

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { adminPassword, clientEmail, action, transcriptRequest } = body;

  if ((adminPassword !== ADMIN_PASSWORD && adminPassword !== ADMIN_PASSWORD_ROMEO)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!clientId || !privateKey || !cafNumber || !eservicesUser) {
    const missing = [
      !clientId      ? 'IRS_API_CLIENT_ID' : null,
      !privateKey    ? 'IRS_PRIVATE_KEY_PEM' : null,
      !cafNumber     ? 'IRS_CAF_NUMBER' : null,
      !eservicesUser ? 'IRS_ESERVICES_USERNAME' : null,
    ].filter(Boolean);
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'IRS credentials not configured', missing }) };
  }

  try {
    if (action === 'get_token') {
      const token = await getAccessToken({ clientId, privateKey, eservicesUser, jwkKid });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, token_preview: token.substring(0, 20) + '...' }) };
    }

    if (action === 'pull_transcript') {
      if (!transcriptRequest || !clientEmail) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing transcriptRequest or clientEmail' }) };
      }
      const accessToken = await getAccessToken({ clientId, privateKey, eservicesUser, jwkKid });
      const { tin, taxpayerType, firstName, lastName, businessName, formNumber, productType, taxYear, taxPeriod } = transcriptRequest;

      const cafPayload = {
        cafNumber,
        tin,
        taxPayerType: taxpayerType || 'Individual',
        formNumber:   formNumber  || '1040',
        productType:  productType || 'ACTR',
        purposeType:  'Federal Tax',
        taxYear:      String(taxYear || (new Date().getFullYear() - 2)),
        taxPeriod:    taxPeriod || 12,
        custFileNum:  clientEmail.replace(/[^0-9]/g, '').substring(0, 10).padStart(10, '0'),
      };
      if (taxpayerType === 'Business') {
        cafPayload.businessName = businessName || '';
      } else {
        cafPayload.firstName = firstName || '';
        cafPayload.lastName  = lastName  || '';
      }

      const tdsRes = await fetch(IRS_TDS_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cafPayload),
      });

      if (!tdsRes.ok) {
        const errData = await tdsRes.json().catch(() => ({}));
        return { statusCode: tdsRes.status, headers, body: JSON.stringify({ error: `TDS API error ${tdsRes.status}`, details: errData }) };
      }

      const transcriptHtml = await tdsRes.text();
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, transcript: transcriptHtml }) };
    }

    if (action === 'check_sor') {
      const accessToken = await getAccessToken({ clientId, privateKey, eservicesUser, jwkKid });
      const sorRes = await fetch(IRS_SOR_URL, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!sorRes.ok) {
        const err = await sorRes.json().catch(() => ({}));
        return { statusCode: sorRes.status, headers, body: JSON.stringify({ error: `SOR error ${sorRes.status}`, details: err }) };
      }
      const sorData = await sorRes.json();
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, mailbox: sorData }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('[IRS Transcript]', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

// ── A2A JWT Bearer Token Generation ─────────────────────────────────────────
async function getAccessToken({ clientId, privateKey, eservicesUser, jwkKid }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (15 * 60);

  const keyData = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const keyBuffer = base64ToArrayBuffer(keyData);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const clientJwt = await buildJwt(cryptoKey, {
    iss: clientId, sub: clientId, aud: IRS_TOKEN_URL,
    iat: now, exp, jti: crypto.randomUUID(),
  }, jwkKid);

  const userJwt = await buildJwt(cryptoKey, {
    iss: clientId, sub: eservicesUser, aud: IRS_TOKEN_URL,
    iat: now, exp, jti: crypto.randomUUID(),
  }, jwkKid);

  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: userJwt,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientJwt,
  });

  const tokenRes = await fetch(IRS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    throw new Error(`IRS auth failed ${tokenRes.status}: ${JSON.stringify(err)}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function buildJwt(cryptoKey, claims, kid) {
  const header = { alg: 'RS256', kid };
  const encodedHeader  = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const signingInput   = `${encodedHeader}.${encodedPayload}`;
  const sigBuffer = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' }, cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${arrayBufferToBase64Url(sigBuffer)}`;
}

function base64UrlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
