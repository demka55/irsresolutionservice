// netlify/functions/submit-8821.js
const { getStore } = require('@netlify/blobs');

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const resendKey = process.env.RESEND_API_KEY;

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { email, name, formData } = body;

  if (!email || !name || !formData) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  // Update client status to 8821_signed in Blobs
  try {
    const store = getStore('client-status');
    let existing = {};
    try {
      const raw = await store.get(email.toLowerCase());
      if (raw) existing = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {}

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
  } catch(err) {
    console.error('[submit-8821] Blob update failed:', err.message);
  }

  // Build email HTML
  const formHtml = `
    <h2>Form 8821 Signed — ${name}</h2>
    <p>A client has signed their Form 8821 and is ready for transcript access.</p>
    <table style="border-collapse:collapse;width:100%;max-width:600px;font-family:sans-serif;font-size:14px">
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600;width:200px">Client Name</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.taxpayerName}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">SSN (last 4)</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">***-**-${formData.ssnLast4}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Date of Birth</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.dob || '—'}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Address</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.address}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Tax Years</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.taxYears}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Filing Status</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${formData.filingStatus || '—'}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${email}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Signed at</td><td style="padding:8px 12px">${new Date().toLocaleString()}</td></tr>
    </table>
    <p style="margin-top:20px;color:#7a6e60;font-size:13px">
      Next step: Submit Form 8821 to IRS, then mark "IRS Approved 8821" in the
      <a href="https://irsresolutionservice.com/admin">admin dashboard</a>.
    </p>
  `;

  if (resendKey) {
    try {
      for (const to of ['romeo@taxedright.com', 'dmitry.dragilev@hey.com']) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
            to,
            subject: `Form 8821 signed — ${name}`,
            html: formHtml,
          })
        });
      }

      // Confirm to client
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
          to: email,
          subject: 'Form 8821 received — next steps',
          html: `
            <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1410">
              <h2 style="font-family:Georgia,serif">Hi ${name},</h2>
              <p style="font-size:15px;line-height:1.75;color:#4a3f32">We've received your signed Form 8821. Romeo's team will now submit it to the IRS.</p>
              <p style="font-size:15px;line-height:1.75;color:#4a3f32">Once the IRS processes it (typically 2–5 business days), Romeo will have authorized access to your transcripts and can begin your full review.</p>
              <p style="font-size:15px;line-height:1.75;color:#4a3f32">You can track your progress anytime at your dashboard:</p>
              <p style="margin:24px 0;text-align:center">
                <a href="https://irsresolutionservice.com/resolve" style="background:#c9a84c;color:#1a1410;padding:13px 28px;border-radius:2px;text-decoration:none;font-weight:700;font-size:15px">View your dashboard →</a>
              </p>
              <p style="font-size:13px;color:#7a6e60;margin-top:24px">IRS Resolution Service LLC — irsresolutionservice.com</p>
            </div>
          `,
        })
      });
    } catch(err) {
      console.error('[submit-8821] Email failed:', err.message);
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};
