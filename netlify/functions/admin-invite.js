// netlify/functions/admin-invite.js
// Creates a Netlify Identity account and sends invite email

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
  const netlifyToken    = process.env.NETLIFY_ACCESS_TOKEN;
  const netlifySiteId   = process.env.NETLIFY_SITE_ID;
  const resendKey       = process.env.RESEND_API_KEY;

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { adminPassword, email, name, resend } = body;

  if ((adminPassword !== ADMIN_PASSWORD && adminPassword !== ADMIN_PASSWORD_ROMEO)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing email' }) };
  }

  if (!netlifyToken || !netlifySiteId) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'NETLIFY_ACCESS_TOKEN or NETLIFY_SITE_ID not configured' }) };
  }

  try {
    // Create/invite user via Netlify Identity API
    const identityRes = await fetch(
      `https://api.netlify.com/api/v1/sites/${netlifySiteId}/identity/users/invite`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${netlifyToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          data: { full_name: name || email.split('@')[0] },
        }),
      }
    );

    const identityText = await identityRes.text();
    let identityData = {};
    try { identityData = JSON.parse(identityText); } catch {}

    if (!identityRes.ok) {
      const errMsg = identityText || identityRes.status.toString();
      // User already exists — not a real error
      if (identityRes.status === 422 || errMsg.toLowerCase().includes('already')) {
        // Send custom email anyway if resending
        if (resend && resendKey) await sendWelcomeEmail(resendKey, email, name, true);
        return { statusCode: 200, headers, body: JSON.stringify({ ok: true, note: 'User already exists' }) };
      }
      return { statusCode: identityRes.status, headers, body: JSON.stringify({ error: errMsg }) };
    }

    // Send custom welcome email via Resend
    if (resendKey) {
      await sendWelcomeEmail(resendKey, email, name, resend);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, user: identityData }) };

  } catch (err) {
    console.error('[admin-invite]', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

async function sendWelcomeEmail(resendKey, email, name, isResend) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
        to: email,
        subject: isResend ? 'Your IRS Resolution Service login link' : 'Welcome — your account is ready',
        html: `
          <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
            <h2 style="color:#1a1410">Hi ${name || 'there'},</h2>
            <p>${isResend ? 'Here is a new link to access your IRS Resolution Service account.' : "Romeo's team has created your IRS Resolution Service account."}</p>
            <p>You should also receive a separate email from Netlify with a link to set your password. Once set, log in at:</p>
            <p style="margin:24px 0">
              <a href="https://irsresolutionservice.com/resolve" style="background:#c9a84c;color:white;padding:12px 24px;border-radius:2px;text-decoration:none;font-weight:600;font-size:15px">
                Go to your dashboard →
              </a>
            </p>
            <p style="color:#7a6e60;font-size:13px">Questions? Email Romeo at <a href="mailto:romeo@taxedright.com">romeo@taxedright.com</a></p>
          </div>
        `,
      }),
    });
  } catch(e) {
    console.warn('[admin-invite] Email failed:', e.message);
  }
}
