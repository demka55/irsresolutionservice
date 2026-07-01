// netlify/functions/irs-transcript.mjs
// Pulls IRS tax transcripts via TDS API using A2A OAuth flow.
// Uses Node native 'node:crypto' (not crypto.subtle) for RS256 JWT signing —
// avoids the Web Crypto API globalThis.crypto.subtle availability issue on
// older Netlify runtimes (crypto.subtle requires Node 19+; node:crypto works everywhere).

import { createSign, createPrivateKey, randomUUID } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const IRS_TOKEN_URL = 'https://api.www4.irs.gov/auth/oauth/v2/token';
const IRS_TDS_URL   = 'https://api.www4.irs.gov/esrv/api/tds/request/caf';
const IRS_SOR_URL   = 'https://api.www4.irs.gov/esrv/api/sor/messages';

// ── Helpers ──────────────────────────────────────────────────────────────────

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlEncodeBuffer(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Normalizes a PEM private key regardless of how it was pasted into the env var —
// handles real newlines, a single line with no breaks, literal "\n" escape sequences,
// or any mix of these. Always produces a correctly formatted, parseable PEM.
function normalizePem(raw) {
  let cleaned = String(raw || '').trim();
  // Convert literal backslash-n (2 chars: \ and n) into real newlines, in case the
  // env var was pasted with escaped newlines instead of actual line breaks
  cleaned = cleaned.replace(/\\n/g, '\n');
  // Strip the header/footer markers and ALL remaining whitespace from the body
  cleaned = cleaned
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  // Re-wrap the base64 body at the standard PEM line width (64 chars)
  const lines = cleaned.match(/.{1,64}/g) || [];
  return '-----BEGIN PRIVATE KEY-----\n' + lines.join('\n') + '\n-----END PRIVATE KEY-----\n';
}

function buildJwt(privateKey, claims, kid) {
  const header         = { alg: 'RS256', kid };
  const encodedHeader  = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const signingInput   = `${encodedHeader}.${encodedPayload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const sig = sign.sign(privateKey);
  return `${signingInput}.${base64UrlEncodeBuffer(sig)}`;
}

async function getAccessToken({ clientId, privateKey, eservicesUser, jwkKid }) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (15 * 60);

  // Parse the PEM key once — normalizePem ensures correct formatting regardless of
  // how the env var was pasted (single line, escaped \n, real newlines, etc.)
  const privKey = createPrivateKey(normalizePem(privateKey));

  const clientClaims = { iss: clientId, sub: clientId, aud: IRS_TOKEN_URL, iat: now, exp, jti: randomUUID() };
  const userClaims   = { iss: clientId, sub: eservicesUser, aud: IRS_TOKEN_URL, iat: now, exp, jti: randomUUID() };

  // Client JWT: both iss and sub = clientId
  const clientJwt = buildJwt(privKey, clientClaims, jwkKid);

  // User JWT: iss = clientId, sub = eServices user ID (from A2A letter)
  const userJwt = buildJwt(privKey, userClaims, jwkKid);

  const params = new URLSearchParams({
    grant_type:             'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion:              userJwt,          // User JWT
    client_assertion_type:  'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion:       clientJwt,        // Client JWT
  });

  const tokenRes = await fetch(IRS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    // Include the exact decoded JWT claims that were sent (no secrets — just claims + header)
    // so failures can be diagnosed precisely instead of guessing.
    const debugInfo = {
      clientJwtHeader: { alg: 'RS256', kid: jwkKid },
      clientJwtClaims: clientClaims,
      userJwtHeader: { alg: 'RS256', kid: jwkKid },
      userJwtClaims: userClaims,
      tokenUrl: IRS_TOKEN_URL,
    };
    const e = new Error(`IRS auth failed ${tokenRes.status}: ${JSON.stringify(err)}`);
    e.debugInfo = debugInfo;
    throw e;
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST')    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  const ADMIN_PASSWORD       = Netlify.env.get('ADMIN_PASSWORD')       || '';
  const ADMIN_PASSWORD_ROMEO = Netlify.env.get('ADMIN_PASSWORD_ROMEO') || '';
  const clientId             = Netlify.env.get('IRS_API_CLIENT_ID');
  const privateKey           = Netlify.env.get('IRS_PRIVATE_KEY_PEM');
  const cafNumber            = Netlify.env.get('IRS_CAF_NUMBER');
  const eservicesUser        = Netlify.env.get('IRS_ESERVICES_USERNAME');
  const jwkKid               = Netlify.env.get('IRS_JWK_KID');

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }

  const { adminPassword, clientEmail, action, transcriptRequest } = body;

  if (!ADMIN_PASSWORD || (adminPassword !== ADMIN_PASSWORD && adminPassword !== ADMIN_PASSWORD_ROMEO)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  if (!clientId || !privateKey || !cafNumber || !eservicesUser) {
    const missing = [
      !clientId      ? 'IRS_API_CLIENT_ID'      : null,
      !privateKey    ? 'IRS_PRIVATE_KEY_PEM'     : null,
      !cafNumber     ? 'IRS_CAF_NUMBER'          : null,
      !eservicesUser ? 'IRS_ESERVICES_USERNAME'  : null,
    ].filter(Boolean);
    return new Response(JSON.stringify({ error: 'IRS credentials not configured', missing }), { status: 503, headers });
  }

  try {
    // ── Diagnostic check — safely reveals what's actually configured, no secrets exposed ──
    if (action === 'diagnose') {
      const normalized = normalizePem(privateKey);
      const diag = {
        clientId_value: clientId,
        clientId_length: clientId.length,
        eservicesUser_value: eservicesUser,
        eservicesUser_length: eservicesUser.length,
        jwkKid_value: jwkKid,
        cafNumber_length: cafNumber.length,
        privateKey_raw_length: privateKey.length,
        privateKey_raw_has_real_newlines: privateKey.includes('\n'),
        privateKey_raw_newline_count: (privateKey.match(/\n/g) || []).length,
        privateKey_normalized_parses: false,
        privateKey_normalized_parse_error: null,
      };

      try {
        createPrivateKey(normalized);
        diag.privateKey_normalized_parses = true;
      } catch (parseErr) {
        diag.privateKey_normalized_parse_error = parseErr.message;
      }

      return new Response(JSON.stringify({ ok: true, diagnostic: diag }), { status: 200, headers });
    }

    // ── Token test ────────────────────────────────────────────────────────
    if (action === 'get_token') {
      const token = await getAccessToken({ clientId, privateKey, eservicesUser, jwkKid });
      return new Response(JSON.stringify({ ok: true, token_preview: token.substring(0, 20) + '...' }), { status: 200, headers });
    }

    // ── Pull transcript ───────────────────────────────────────────────────
    if (action === 'pull_transcript') {
      if (!transcriptRequest || !clientEmail) {
        return new Response(JSON.stringify({ error: 'Missing transcriptRequest or clientEmail' }), { status: 400, headers });
      }

      const accessToken = await getAccessToken({ clientId, privateKey, eservicesUser, jwkKid });
      const {
        tin: tinRaw, taxpayerType, firstName, lastName,
        businessName, formNumber, productType, taxYear, taxPeriod
      } = transcriptRequest;

      // IRS expects TIN as digits only — strip dashes, spaces, or any other formatting
      const tin = String(tinRaw || '').replace(/[^0-9]/g, '');
      if (tin.length !== 9) {
        return new Response(JSON.stringify({ error: `Invalid TIN: expected 9 digits, got ${tin.length} (after stripping non-digits from "${tinRaw}")` }), { status: 400, headers });
      }

      const cafPayload = {
        cafNumber,
        tin,
        taxPayerType: taxpayerType || 'Individual',
        formNumber:   formNumber   || '1040',
        productType:  productType  || 'ACTR',
        purposeType:  'Federal Tax',
        taxYear:      String(taxYear || (new Date().getFullYear() - 2)),
        taxPeriod:    taxPeriod    || 12,
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
        return new Response(JSON.stringify({
          error: `TDS API error ${tdsRes.status}`,
          details: errData,
          debugInfo: {
            url: IRS_TDS_URL,
            method: 'POST',
            headersSent: { 'Authorization': `Bearer ${accessToken.substring(0, 12)}...(truncated)`, 'Content-Type': 'application/json' },
            payloadSent: cafPayload,
            rawTinReceived: tinRaw,
            tinAfterStripping: tin,
            tinLength: tin.length,
            cafNumberUsed: cafNumber,
            cafNumberLength: cafNumber.length,
            environment: IRS_TDS_URL.includes('alt.') ? 'TEST (alt)' : 'PRODUCTION',
          },
        }), { status: tdsRes.status, headers });
      }

      const transcriptHtml = await tdsRes.text();

      // Store HTML to blob so it persists across sessions
      // Key: email:formNumber_productType_taxYear  in 'transcripts' store
      try {
        const txStore = getStore('transcripts');
        const txKey = `${clientEmail.toLowerCase().trim()}:${formNumber}_${productType}_${taxYear}`;
        await txStore.set(txKey, transcriptHtml);
      } catch (storeErr) {
        console.warn('[IRS Transcript] blob store failed (non-fatal):', storeErr.message);
      }

      return new Response(JSON.stringify({ ok: true, transcript: transcriptHtml }), { status: 200, headers });
    }

    // ── Check SOR mailbox ────────────────────────────────────────────────
    if (action === 'check_sor') {
      const accessToken = await getAccessToken({ clientId, privateKey, eservicesUser, jwkKid });
      const sorRes = await fetch(IRS_SOR_URL, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (!sorRes.ok) {
        const err = await sorRes.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: `SOR error ${sorRes.status}`, details: err }), { status: sorRes.status, headers });
      }
      const sorData = await sorRes.json();
      return new Response(JSON.stringify({ ok: true, mailbox: sorData }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers });

  } catch (err) {
    console.error('[IRS Transcript]', err.message);
    return new Response(JSON.stringify({ error: err.message, debugInfo: err.debugInfo || null }), { status: 500, headers });
  }
};

export const config = { path: '/api/irs-transcript', method: ['POST', 'OPTIONS'] };
