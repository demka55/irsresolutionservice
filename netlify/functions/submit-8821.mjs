import { getStore } from '@netlify/blobs';

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

  const { email, name, formData, signatureDataUrl } = body;

  if (!email || !name || !formData) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers });
  }

  const resendKey = Netlify.env.get('RESEND_API_KEY');

  // Update client status to 8821_signed
  try {
    const store = getStore('client-status');
    let existing = {};
    try { existing = await store.get(email.toLowerCase(), { type: 'json' }) || {}; } catch {}

    const updated = {
      ...existing,
      email: email.toLowerCase(),
      name,
      status: '8821_signed',
      updatedAt: new Date().toISOString(),
      paidAt: existing.paidAt || new Date().toISOString(),
      steps: {
        ...(existing.steps || {}),
        form8821Signed: new Date().toISOString(),
        form8821Data: formData,
      }
    };

    await store.set(email.toLowerCase(), JSON.stringify(updated));
  } catch (err) {
    console.error('Blob update failed:', err.message);
  }

  // Email Romeo with form data
  const formHtml = `
    <h2>Form 8821 Signed — ${name}</h2>
    <p>A client has signed their Form 8821 and is ready for transcript access.</p>
    <table style="border-collapse:collapse;width:100%;max-width:600px;font-family:sans-serif;font-size:14px">
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600;width:200px">Client Name</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.taxpayerName}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">SSN (last 4)</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">***-**-${formData.ssnLast4}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Address</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.address}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Tax Years</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.taxYears}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${email}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Signed at</td><td style="padding:8px 12px">${new Date().toLocaleString()}</td></tr>
    </table>
    <p style="margin-top:20px;color:#7a6e60;font-size:13px">
      Next step: Submit Form 8821 to IRS CAF, then mark CAF active in the 
      <a href="https://irsresolutionservice.com/admin">admin dashboard</a>.
    </p>
    ${signatureDataUrl ? `<p style="margin-top:16px"><strong>Client signature:</strong><br><img src="${signatureDataUrl}" style="border:1px solid #d9cdb8;padding:8px;max-width:300px;margin-top:8px"></p>` : ''}
  `;

  try {
    // Email Romeo
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
        to: 'romeo@taxedright.com',
        subject: `Form 8821 signed — ${name}`,
        html: formHtml,
      })
    });

    // Email Dmitry
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
        to: 'dmitry.dragilev@hey.com',
        subject: `Form 8821 signed — ${name}`,
        html: formHtml,
      })
    });

    // Confirm to client
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
        to: email,
        subject: 'Form 8821 received — next steps',
        html: `
          <h2>Hi ${name},</h2>
          <p>We've received your signed Form 8821. Romeo's team will now submit it to the IRS Centralized Authorization File (CAF).</p>
          <p>Once the IRS processes it (typically 2–5 business days), Romeo will have authorized access to your transcripts and can begin your full review.</p>
          <p>You can track your progress anytime at <a href="https://irsresolutionservice.com/resolve">irsresolutionservice.com/resolve</a>.</p>
          <p style="color:#7a6e60;font-size:13px;margin-top:24px">IRS Resolution Service — irsresolutionservice.com</p>
        `,
      })
    });
  } catch (err) {
    console.error('Email send failed:', err.message);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
};

export const config = { path: '/api/submit-8821' };
