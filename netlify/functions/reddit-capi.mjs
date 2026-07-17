// reddit-capi.mjs — server-side Reddit Conversions API (CAPI) helper (ESM)
// Place next to your contact-form function. Requires Node 18+ (native fetch).
//
// SETUP (Netlify dashboard → Site settings → Environment variables):
//   REDDIT_CAPI_TOKEN = <your conversions access token from Events Manager>
//   REDDIT_PIXEL_ID   = a2_jbjzdvxwri9f
//
// NEVER hardcode the token in this file or anywhere in the repo.

import { createHash } from 'node:crypto';

const sha256 = (v) =>
  createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');

/**
 * Send a Lead conversion to Reddit CAPI.
 * Call this from your contact-form handler AFTER the lead is successfully
 * saved/emailed. Never let a CAPI failure fail the form submission itself.
 *
 * @param {object} p
 * @param {string} p.conversionId    - UUID from the page (dedup key vs the client pixel)
 * @param {string} [p.redditClickId] - rdt_cid captured on the landing page
 * @param {string} [p.email]         - lead's email (hashed before sending)
 * @param {string} [p.ip]            - client IP
 * @param {string} [p.userAgent]     - request user-agent header
 * @param {string} [p.pageUrl]       - landing page URL without query string
 */
export async function sendRedditLead(p) {
  const token = process.env.REDDIT_CAPI_TOKEN;
  const pixelId = process.env.REDDIT_PIXEL_ID;
  if (!token || !pixelId) {
    console.warn('Reddit CAPI env vars missing; skipping conversion send');
    return;
  }

  const user = {};
  if (p.email) user.email = sha256(p.email);
  if (p.ip) user.ip_address = sha256(p.ip);
  if (p.userAgent) user.user_agent = p.userAgent;

  const event = {
    event_at: new Date().toISOString(),
    event_type: { tracking_type: 'Lead' },
    ...(p.redditClickId ? { click_id: p.redditClickId } : {}),
    user,
    event_metadata: {
      conversion_id: p.conversionId,
    },
  };

  try {
    const res = await fetch(
      `https://ads-api.reddit.com/api/v2.0/conversions/events/${pixelId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ events: [event] }),
      }
    );
    if (!res.ok) {
      console.error('Reddit CAPI error', res.status, await res.text());
    }
  } catch (err) {
    console.error('Reddit CAPI request failed', err.message);
  }
}

/* ─────────────────────────────────────────────────────────────────
   INTEGRATION into your existing contact-form function (ESM style —
   works as-is if your function is contact-form.mjs):

   import { sendRedditLead } from './reddit-capi.mjs';

   export const handler = async (event) => {
     const body = JSON.parse(event.body);

     // ... your existing lead handling (save / email Romeo) ...

     if (body.formType === 'irs' && body.conversionId) {
       await sendRedditLead({
         conversionId: body.conversionId,
         redditClickId: body.redditClickId,
         email: body.email,
         ip: event.headers['x-nf-client-connection-ip'],
         userAgent: event.headers['user-agent'],
         pageUrl: body.pageUrl,
       });
     }

     return { statusCode: 200, body: JSON.stringify({ ok: true }) };
   };
   ───────────────────────────────────────────────────────────────── */
