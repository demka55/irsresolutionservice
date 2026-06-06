// netlify/functions/submit-2848.mjs
import { getStore } from '@netlify/blobs';

export default async (req) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  const resendKey = Netlify.env.get('RESEND_API_KEY');

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }

  const { email, name, formData } = body;
  if (!email || !name || !formData) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
  }

  const key = email.toLowerCase();

  // Update client status to 2848_signed in Blobs
  try {
    const store = getStore('client-status');
    let existing = {};
    try {
      const raw = await store.get(key);
      if (raw) existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {}

    const updated = {
      ...existing,
      email: key,
      name: existing.name || name,
      status: '2848_signed',
      updatedAt: new Date().toISOString(),
      paidAt: existing.paidAt || new Date().toISOString(),
      steps: {
        ...(existing.steps || {}),
        form2848Signed: new Date().toISOString(),
        form2848Data: formData,
      }
    };

    await store.set(key, JSON.stringify(updated));
    console.log('[submit-2848] saved:', key);

    // Update index
    try {
      const rawIdx = await store.get('__index__');
      let index = rawIdx ? (typeof rawIdx === 'string' ? JSON.parse(rawIdx) : rawIdx) : [];
      if (!index.includes(key)) {
        index.push(key);
        await store.set('__index__', JSON.stringify(index));
      }
    } catch(idxErr) {
      console.warn('[submit-2848] index update failed:', idxErr.message);
    }

  } catch(err) {
    console.error('[submit-2848] Blob update failed:', err.message);
    return new Response(JSON.stringify({ error: 'Failed to save: ' + err.message }), { status: 500, headers });
  }

  // Send emails
  if (resendKey) {
    const formHtml = `
      <h2>Form 2848 Signed — ${name}</h2>
      <table style="border-collapse:collapse;width:100%;max-width:600px;font-family:sans-serif;font-size:14px">
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600;width:200px">Client Name</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.taxpayerName}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">SSN (last 4)</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">***-**-${formData.ssnLast4}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Address</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.address}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Tax Years</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.taxYears}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${email}</td></tr>
        <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Signed at</td><td style="padding:8px 12px">${new Date().toLocaleString()}</td></tr>
      </table>
      <p style="margin-top:16px;font-size:13px;color:#7a6e60">
        Next: Submit to IRS, then mark "IRS Approved 8821" in <a href="https://irsresolutionservice.com/admin">admin</a>.
      </p>`;

    try {
      for (const to of ['romeo@taxedright.com', 'dmitry.dragilev@hey.com']) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'IRS Resolution Service <noreply@irsresolutionservice.com>', to, subject: `Form 2848 signed — ${name}`, html: formHtml }),
        });
      }
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
          to: email,
          subject: 'Form 2848 received — next steps',
          html: `<div style="font-family:sans-serif;max-width:540px;margin:0 auto"><h2 style="font-family:Georgia,serif">Hi ${name},</h2><p style="font-size:15px;line-height:1.75;color:#4a3f32">We've received your signed Form 2848. Romeo's team will submit it to the IRS within 1 business day.</p><p style="font-size:15px;line-height:1.75;color:#4a3f32">Once the IRS processes it (2–5 business days), Romeo will begin pulling your transcripts and you'll see your status update in your dashboard.</p><p style="margin:24px 0;text-align:center"><a href="https://irsresolutionservice.com/resolve" style="background:#c9a84c;color:#1a1410;padding:13px 28px;border-radius:2px;text-decoration:none;font-weight:700;font-size:15px">View your dashboard →</a></p><p style="font-size:13px;color:#7a6e60">IRS Resolution Service LLC</p></div>`,
        }),
      });
    } catch(err) {
      console.error('[submit-2848] Email failed:', err.message);
    }
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
