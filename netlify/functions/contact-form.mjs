// netlify/functions/contact-form.mjs
// Receives contact form submissions, saves to Blobs, and emails Romeo

import { getStore } from '@netlify/blobs';

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://irsresolutionservice.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }

  const resendKey = Netlify.env.get('RESEND_API_KEY');
  const { formType, name, phone, email, address, referral } = body;

  if (!name || !email) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
  }

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
      business:   body.business   || '',
      situation:  body.situation  || '',
      why:        body.why        || '',
      preparer:   body.preparer   || '',
      unusual:    body.unusual    || '',
      // IRS form fields
      issue:      body.issue      || '',
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
      <table style="border-collapse:collapse;width:100%;max-width:600px;font-family:sans-serif;font-size:14px">
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600;width:200px">Name</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${name}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${phone}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${email}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Address</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${address || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Referral Source</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${referral || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Business Info</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8;white-space:pre-wrap">${body.business || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Tax Situation</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8;white-space:pre-wrap">${body.situation || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Why New Accountant</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8;white-space:pre-wrap">${body.why || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Prior Preparer</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${body.preparer || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Unusual Events</td><td style="padding:8px 12px;white-space:pre-wrap">${body.unusual || '—'}</td></tr>
      </table>
      <p style="margin-top:20px;color:#7a6e60;font-size:13px">Submitted via irsresolutionservice.com — respond within 3 business days.</p>
    `;
  } else {
    subject = `New IRS Remediation Inquiry — ${name}`;
    html = `
      <h2>New IRS Remediation Inquiry</h2>
      <p>A potential client has submitted the IRS Remediation Form.</p>
      <table style="border-collapse:collapse;width:100%;max-width:600px;font-family:sans-serif;font-size:14px">
        <tr><td style="padding:8px 12px;background:#fdf0f0;font-weight:600;width:200px">Name</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${name}</td></tr>
        <tr><td style="padding:8px 12px;background:#fdf0f0;font-weight:600">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${phone}</td></tr>
        <tr><td style="padding:8px 12px;background:#fdf0f0;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${email}</td></tr>
        <tr><td style="padding:8px 12px;background:#fdf0f0;font-weight:600">Address</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${address || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#fdf0f0;font-weight:600">Referral Source</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${referral || '—'}</td></tr>
        <tr><td style="padding:8px 12px;background:#fdf0f0;font-weight:600">IRS Issue Details</td><td style="padding:8px 12px;white-space:pre-wrap">${body.issue || '—'}</td></tr>
      </table>
      <p style="margin-top:20px;color:#7a6e60;font-size:13px">Submitted via irsresolutionservice.com — review and respond promptly.</p>
    `;
  }

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
      <h2>Hi ${name.split(' ')[0]},</h2>
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

