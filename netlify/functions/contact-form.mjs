// netlify/functions/contact-form.mjs
// Receives contact form submissions, saves to Blobs, and emails Romeo
// v2: also stores and emails WHERE the lead came from and WHAT they entered before submitting
//     (sent by /attribution.js), and HTML-escapes every value that goes into an email.

import { getStore } from '@netlify/blobs';

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clip = (v, n) => String(v ?? '').slice(0, n);

// Whitelist + length-limit everything the browser sends us in `attribution`
function cleanTouch(t) {
  if (!t || typeof t !== 'object') return null;
  const click = t.clickIds && typeof t.clickIds === 'object' ? t.clickIds : {};
  return {
    ts: clip(t.ts, 40), url: clip(t.url, 500), path: clip(t.path, 200),
    referrer: clip(t.referrer, 500), referrerHost: clip(t.referrerHost, 120),
    source: clip(t.source, 80), medium: clip(t.medium, 80), campaign: clip(t.campaign, 120),
    term: clip(t.term, 120), content: clip(t.content, 120), channel: clip(t.channel, 40),
    clickIds: {
      gclid: clip(click.gclid, 200), msclkid: clip(click.msclkid, 200),
      fbclid: clip(click.fbclid, 200), rdt_cid: clip(click.rdt_cid, 200),
    },
  };
}
function cleanAttribution(a) {
  if (!a || typeof a !== 'object') return null;
  const tools = {};
  if (a.tools && typeof a.tools === 'object') {
    for (const name of Object.keys(a.tools).slice(0, 10)) {
      const t = a.tools[name] || {};
      const values = {};
      if (t.values && typeof t.values === 'object') {
        for (const k of Object.keys(t.values).slice(0, 12)) {
          const v = t.values[k];
          values[clip(k, 30)] = (typeof v === 'number' || typeof v === 'boolean') ? v : clip(v, 120);
        }
      }
      tools[clip(name, 40)] = { page: clip(t.page, 200), ts: clip(t.ts, 40), values };
    }
  }
  return {
    first: cleanTouch(a.first), last: cleanTouch(a.last),
    sessions: Number(a.sessions) || 0,
    trail: Array.isArray(a.trail) ? a.trail.slice(0, 15).map((p) => clip(p, 200)) : [],
    tools,
    chatMessage: clip(a.chatMessage, 500),
    submittedFrom: clip(a.submittedFrom, 500),
    device: a.device && typeof a.device === 'object'
      ? { w: Number(a.device.w) || 0, lang: clip(a.device.lang, 20), tz: clip(a.device.tz, 60) } : {},
  };
}

function touchLine(t) {
  if (!t) return '—';
  const bits = [];
  bits.push(`<b>${esc(t.channel || 'unknown')}</b>`);
  const utm = [t.source, t.medium, t.campaign].filter(Boolean).join(' / ');
  if (utm) bits.push(`UTM: ${esc(utm)}`);
  if (t.term) bits.push(`term: ${esc(t.term)}`);
  if (t.referrerHost) bits.push(`referrer: ${esc(t.referrer || t.referrerHost)}`);
  else bits.push('referrer: none');
  if (t.clickIds && (t.clickIds.gclid || t.clickIds.msclkid || t.clickIds.fbclid || t.clickIds.rdt_cid)) {
    bits.push('ad click ID present');
  }
  bits.push(`landed on: ${esc(t.url || t.path)}`);
  if (t.ts) bits.push(`at ${esc(t.ts)}`);
  return bits.join('<br>');
}

function attributionRows(a, labelBg) {
  if (!a) {
    return `<tr><td style="padding:8px 12px;background:${labelBg};font-weight:600">Where they came from</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">Not captured (form submitted without attribution script)</td></tr>`;
  }
  const td1 = `padding:8px 12px;background:${labelBg};font-weight:600;vertical-align:top`;
  const td2 = 'padding:8px 12px;border-bottom:1px solid #d9cdb8';
  const tools = Object.entries(a.tools || {}).map(([name, t]) => {
    const vals = Object.entries(t.values || {}).map(([k, v]) => `${esc(k)}=${esc(v)}`).join(', ');
    return `<b>${esc(name)}</b> (${esc(t.page)}): ${vals || '—'}`;
  }).join('<br>') || '—';
  const same = a.first && a.last && a.first.ts === a.last.ts;
  return `
    <tr><td style="${td1}">First visit (how they found us)</td><td style="${td2}">${touchLine(a.first)}</td></tr>
    ${same ? '' : `<tr><td style="${td1}">Most recent visit</td><td style="${td2}">${touchLine(a.last)}</td></tr>`}
    <tr><td style="${td1}">Visits (sessions)</td><td style="${td2}">${esc(a.sessions || 1)}</td></tr>
    <tr><td style="${td1}">Pages viewed this visit</td><td style="${td2}">${(a.trail || []).map(esc).join(' &rarr; ') || '—'}</td></tr>
    <tr><td style="${td1}">What they entered in our tools</td><td style="${td2}">${tools}</td></tr>
    <tr><td style="${td1}">Typed in the chat box</td><td style="${td2};white-space:pre-wrap">${esc(a.chatMessage) || '—'}</td></tr>
    <tr><td style="${td1}">Submitted from</td><td style="${td2}">${esc(a.submittedFrom) || '—'}</td></tr>
    <tr><td style="${td1}">Device</td><td style="${td2}">${esc(a.device?.w || '')}px wide, ${esc(a.device?.lang || '')}, ${esc(a.device?.tz || '')}</td></tr>`;
}

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://irsresolutionservice.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  let body;
  try {
    const raw = await req.text();
    if (raw.length > 30000) return new Response(JSON.stringify({ error: 'Too large' }), { status: 413, headers });
    body = JSON.parse(raw);
  } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }

  const resendKey = Netlify.env.get('RESEND_API_KEY');
  let { formType, name, phone, email, address, referral } = body;

  if (!name || !email) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
  }
  // Honeypot: real forms never fill a field called "website". Bots do.
  if (body.website) return new Response(JSON.stringify({ ok: true }), { status: 200, headers });

  name = clip(name, 120).replace(/[\r\n]+/g, ' '); email = clip(email, 200); phone = clip(phone, 40);
  address = clip(address, 300); referral = clip(referral, 300);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400, headers });
  }

  const attribution = cleanAttribution(body.attribution);
  const pageUrl = clip(body.pageUrl, 300);

  // Save lead to Blobs
  try {
    const store = getStore('leads');
    const leadId = `${Date.now()}-${email.toLowerCase().replace(/[^a-z0-9]/g,'-')}`;
    const lead = {
      id: leadId,
      formType: formType || 'general',
      name, phone, email, address, referral,
      submittedAt: new Date().toISOString(),
      status: 'new',
      notes: '',
      // General form fields
      business:   clip(body.business, 3000),
      situation:  clip(body.situation, 3000),
      why:        clip(body.why, 3000),
      preparer:   clip(body.preparer, 300),
      unusual:    clip(body.unusual, 3000),
      // IRS form fields
      issue:      clip(body.issue, 4000),
      // Attribution (new)
      pageUrl,
      conversionId: clip(body.conversionId, 80),
      redditClickId: clip(body.redditClickId, 200),
      attribution,
      channel: attribution?.first?.channel || '',
    };
    await store.set(leadId, JSON.stringify(lead));

    // Update leads index
    let index = [];
    try {
      const raw = await store.get('__index__');
      if (raw) index = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {}
    index.unshift(leadId); // newest first
    await store.set('__index__', JSON.stringify(index));
  } catch(err) {
    console.error('[contact-form] Blobs save failed:', err.message);
  }

  let subject, html;

  if (formType === 'general') {
    subject = `New General Tax Client Inquiry — ${name}`;
    html = `
      <h2>New General Tax Services Inquiry</h2>
      <p>A potential client has submitted the 2026 Potential Client Form.</p>
      <table style="border-collapse:collapse;width:100%;max-width:640px;font-family:sans-serif;font-size:14px">
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600;width:200px">Name</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${esc(name)}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${esc(phone)}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${esc(email)}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Address</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${esc(address) || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Referral Source</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${esc(referral) || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Business Info</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8;white-space:pre-wrap">${esc(body.business) || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Tax Situation</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8;white-space:pre-wrap">${esc(body.situation) || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Why New Accountant</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8;white-space:pre-wrap">${esc(body.why) || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Prior Preparer</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${esc(body.preparer) || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Unusual Events</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8;white-space:pre-wrap">${esc(body.unusual) || '—'}</td></tr>
        ${attributionRows(attribution, '#f5f0e8')}
      </table>
      <p style="margin-top:20px;color:#7a6e60;font-size:13px">Submitted via irsresolutionservice.com — respond within 3 business days.</p>
    `;
  } else {
    subject = `New IRS Remediation Inquiry — ${name}`;
    html = `
      <h2>New IRS Remediation Inquiry</h2>
      <p>A potential client has submitted the IRS Remediation Form.</p>
      <table style="border-collapse:collapse;width:100%;max-width:640px;font-family:sans-serif;font-size:14px">
        <tr><td style="padding:8px 12px;background:#fdf0f0;font-weight:600;width:200px">Name</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${esc(name)}</td></tr>
        <tr><td style="padding:8px 12px;background:#fdf0f0;font-weight:600">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${esc(phone)}</td></tr>
        <tr><td style="padding:8px 12px;background:#fdf0f0;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${esc(email)}</td></tr>
        <tr><td style="padding:8px 12px;background:#fdf0f0;font-weight:600">Address</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${esc(address) || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#fdf0f0;font-weight:600">Referral Source</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${esc(referral) || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#fdf0f0;font-weight:600">IRS Issue Details</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8;white-space:pre-wrap">${esc(body.issue) || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#fdf0f0;font-weight:600">Form page</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${esc(pageUrl) || '—'}</td></tr>
        ${attributionRows(attribution, '#fdf0f0')}
      </table>
      <p style="margin-top:20px;color:#7a6e60;font-size:13px">Submitted via irsresolutionservice.com — review and respond promptly.</p>
    `;
  }

  // Put the channel in the subject so the inbox shows where leads come from at a glance
  const tag = attribution?.first?.channel ? ` [${attribution.first.channel}]` : '';
  subject = subject + tag;

  // Send to Romeo
  await sendEmail(resendKey, {
    from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
    to: 'romeo@taxedright.com',
    subject, html,
  });

  // Send to Dmitry
  await sendEmail(resendKey, {
    from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
    to: 'dmitry.dragilev@hey.com',
    subject, html,
  });

  // Confirmation to client
  await sendEmail(resendKey, {
    from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
    to: email,
    subject: 'We received your form — Romeo will be in touch',
    html: `
      <h2>Hi ${esc(name.split(' ')[0])},</h2>
      <p>Thank you for reaching out. Romeo has received your form and will contact you ${formType === 'general' ? 'within three business days' : 'after reviewing your situation'}.</p>
      <p>In the meantime, feel free to use our free IRS notice decoder at <a href="https://irsresolutionservice.com/#tool">irsresolutionservice.com</a>.</p>
      <p>Questions? Reply to this email or reach Romeo directly at <a href="mailto:romeo@taxedright.com">romeo@taxedright.com</a>.</p>
      <p style="color:#7a6e60;font-size:13px;margin-top:24px">IRS Resolution Service — irsresolutionservice.com</p>
    `,
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
};

async function sendEmail(apiKey, { from, to, subject, html }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    });
    const data = await res.json();
    if (!res.ok) console.error('[Resend] Error to', to, JSON.stringify(data));
    else console.log('[Resend] Sent to', to);
  } catch(e) {
    console.error('[Resend] Failed:', e.message);
  }
}
