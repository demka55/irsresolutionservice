// netlify/functions/irs-transcript.mjs
// Pulls IRS tax transcripts via TDS API using A2A OAuth flow
// Docs: IRS e-Services API Authorization Guide (July 2024) + TDS API Guide (Feb 2025)

import { getStore } from '@netlify/blobs';

const ADMIN_PASSWORD = 'gdhERcgvJfqk3WhiPExi';

// IRS API endpoints
const IRS_TOKEN_URL = 'https://api.www4.irs.gov/auth/oauth/v2/token';
const IRS_TDS_URL   = 'https://api.www4.irs.gov/esrv/api/tds/request/caf';
const IRS_SOR_URL   = 'https://api.www4.irs.gov/esrv/api/sor/messages';

// Test endpoints (swap when testing)
// const IRS_TOKEN_URL = 'https://api.alt.www4.irs.gov/auth/oauth/v2/token';
// const IRS_TDS_URL   = 'https://api.alt.www4.irs.gov/esrv/api/tds/request/caf';
// const IRS_SOR_URL   = 'https://api.alt.www4.irs.gov/esrv/api/sor/messages';

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }

  const { adminPassword, clientEmail, action, transcriptRequest } = body;

  if (adminPassword !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  // Load IRS credentials from environment
  const clientId    = Netlify.env.get('IRS_API_CLIENT_ID');
  const privateKey  = Netlify.env.get('IRS_PRIVATE_KEY_PEM');  // PEM format private key
  const cafNumber   = Netlify.env.get('IRS_CAF_NUMBER');
  const eservicesUser = Netlify.env.get('IRS_ESERVICES_USERNAME');
  const jwkKid      = Netlify.env.get('IRS_JWK_KID'); // Key ID from your JWK

  if (!clientId || !privateKey || !cafNumber || !eservicesUser) {
    return new Response(JSON.stringify({
      error: 'IRS credentials not configured',
      missing: [
        !clientId       ? 'IRS_API_CLIENT_ID' : null,
        !privateKey     ? 'IRS_PRIVATE_KEY_PEM' : null,
        !cafNumber      ? 'IRS_CAF_NUMBER' : null,
        !eservicesUser  ? 'IRS_ESERVICES_USERNAME' : null,
      ].filter(Boolean)
    }), { status: 503, headers });
  }

  try {
    if (action === 'get_token') {
      // Step 1: Generate access token using A2A JWT Bearer flow
      const token = await getAccessToken({ clientId, privateKey, eservicesUser, jwkKid });
      return new Response(JSON.stringify({ ok: true, token_preview: token.substring(0, 20) + '...' }), {
        status: 200, headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    if (action === 'pull_transcript') {
      if (!transcriptRequest || !clientEmail) {
        return new Response(JSON.stringify({ error: 'Missing transcriptRequest or clientEmail' }), { status: 400, headers });
      }

      // Get access token
      const accessToken = await getAccessToken({ clientId, privateKey, eservicesUser, jwkKid });

      // Pull transcript from TDS
      const { tin, taxpayerType, firstName, lastName, businessName, formNumber, productType, taxYear, taxPeriod } = transcriptRequest;

      const cafPayload = {
        cafNumber,
        tin,
        taxPayerType: taxpayerType || 'Individual',
        firstName: taxpayerType === 'Business' ? undefined : (firstName || ''),
        lastName:  taxpayerType === 'Business' ? undefined : (lastName || ''),
        businessName: taxpayerType === 'Business' ? (businessName || '') : undefined,
        formNumber:  formNumber  || '1040',
        productType: productType || 'ACTR',
        purposeType: 'Federal Tax',
        taxYear:     String(taxYear  || (new Date().getFullYear() - 2)),
        taxPeriod:   taxPeriod || 12,
        custFileNum: clientEmail.replace(/[^0-9]/g, '').substring(0, 10).padStart(10, '0'),
      };

      // Remove undefined fields
      Object.keys(cafPayload).forEach(k => cafPayload[k] === undefined && delete cafPayload[k]);

      const tdsRes = await fetch(IRS_TDS_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cafPayload),
      });

      if (!tdsRes.ok) {
        const errData = await tdsRes.json().catch(() => ({}));
        return new Response(JSON.stringify({
          error: `TDS API error ${tdsRes.status}`,
          details: errData,
        }), { status: tdsRes.status, headers });
      }

      // Transcript comes back as HTML
      const transcriptHtml = await tdsRes.text();

      // Save transcript to Blobs
      const store = getStore('client-status');
      let existing = {};
      try { existing = await store.get(clientEmail.toLowerCase(), { type: 'json' }) || {}; } catch {}

      const transcriptKey = `${formNumber}_${productType}_${taxYear}`;
      const updated = {
        ...existing,
        status: 'transcripts_pulled',
        updatedAt: new Date().toISOString(),
        steps: {
          ...(existing.steps || {}),
          transcriptsPulled: new Date().toISOString(),
          [`transcript_${transcriptKey}`]: transcriptHtml,
        }
      };
      await store.set(clientEmail.toLowerCase(), JSON.stringify(updated));

      return new Response(JSON.stringify({
        ok: true,
        transcript: transcriptHtml,
        savedKey: transcriptKey,
      }), { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } });
    }

    if (action === 'check_sor') {
      // Check the Secure Object Repository mailbox for delivered transcripts
      const accessToken = await getAccessToken({ clientId, privateKey, eservicesUser, jwkKid });
      const sorRes = await fetch(IRS_SOR_URL, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!sorRes.ok) {
        const err = await sorRes.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: `SOR error ${sorRes.status}`, details: err }), { status: sorRes.status, headers });
      }
      const sorData = await sorRes.json();
      return new Response(JSON.stringify({ ok: true, mailbox: sorData }), {
        status: 200, headers: { ...headers, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers });

  } catch (err) {
    console.error('[IRS Transcript]', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

// ── A2A JWT Bearer Token Generation ─────────────────────────────────────────
// Per IRS e-Services API Authorization Guide Section 2.3
// Requires: Client JWT (sub=clientId) + User JWT (sub=eservicesUsername)
// Both signed with private key, exchanged for access token

async function getAccessToken({ clientId, privateKey, eservicesUser, jwkKid }) {
  const tokenEndpoint = IRS_TOKEN_URL;
  const audience = tokenEndpoint;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (15 * 60); // 15 min expiry per IRS spec

  // Import private key
  const keyData = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const keyBuffer = base64ToArrayBuffer(keyData);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Build Client JWT (sub = clientId)
  const clientJwt = await buildJwt(cryptoKey, {
    iss: clientId,
    sub: clientId,
    aud: audience,
    iat: now,
    exp,
    jti: crypto.randomUUID(),
  }, jwkKid || 'key1');

  // Build User JWT (sub = eServices username)
  const userJwt = await buildJwt(cryptoKey, {
    iss: clientId,
    sub: eservicesUser,
    aud: audience,
    iat: now,
    exp,
    jti: crypto.randomUUID(),
  }, jwkKid || 'key1');

  // Exchange JWTs for access token
  // grant_type: urn:ietf:params:oauth:grant-type:jwt-bearer
  // assertion: User JWT
  // client_assertion_type: urn:ietf:params:oauth:client-assertion-type:jwt-bearer
  // client_assertion: Client JWT
  const params = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: userJwt,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientJwt,
  });

  const tokenRes = await fetch(tokenEndpoint, {
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
    { name: 'RSASSA-PKCS1-v1_5' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sig = arrayBufferToBase64Url(sigBuffer);
  return `${signingInput}.${sig}`;
}

function base64UrlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
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
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export const config = { path: '/api/irs-transcript' };
