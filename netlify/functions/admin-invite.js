// netlify/functions/admin-invite.js
// Sends welcome email to new client. Netlify Identity invite is optional.

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const ADMIN_PASSWORD       = process.env.ADMIN_PASSWORD || '';
  const ADMIN_PASSWORD_ROMEO = process.env.ADMIN_PASSWORD_ROMEO || '';
  const netlifyToken         = process.env.NETLIFY_ACCESS_TOKEN;
  const netlifySiteId        = process.env.NETLIFY_SITE_ID;
  const resendKey            = process.env.RESEND_API_KEY;

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { adminPassword, email, name, resend } = body;

  const isValid = (ADMIN_PASSWORD && adminPassword === ADMIN_PASSWORD) ||
                  (ADMIN_PASSWORD_ROMEO && adminPassword === ADMIN_PASSWORD_ROMEO);
  if (!isValid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  if (!email)   return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing email' }) };

  const result = { ok: true, emailSent: false, identityInvited: false, note: '' };

  // Step 1 — Try Netlify Identity invite (optional, don't fail if it errors)
  if (netlifyToken && netlifySiteId) {
    try {
      const identityRes = await fetch(
        `https://api.netlify.com/api/v1/sites/${netlifySiteId}/identity/users/invite`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${netlifyToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, data: { full_name: name || email.split('@')[0] } }),
        }
      );
      if (identityRes.ok) {
        result.identityInvited = true;
      } else {
        const txt = await identityRes.text();
        result.note = `Identity invite skipped: ${identityRes.status} ${txt.substring(0,80)}`;
      }
    } catch(e) {
      result.note = `Identity invite error: ${e.message}`;
    }
  } else {
    result.note = 'NETLIFY_ACCESS_TOKEN or NETLIFY_SITE_ID not set — skipping identity invite';
  }

  // Step 2 — Send welcome email via Resend (always attempt this)
  if (resendKey) {
    try {
      await sendWelcomeEmail(resendKey, email, name, resend);
      result.emailSent = true;
    } catch(e) {
      result.note += ` | Email error: ${e.message}`;
    }
  } else {
    result.note += ' | RESEND_API_KEY not set — email not sent';
  }

  return { statusCode: 200, headers, body: JSON.stringify(result) };
};

async function sendWelcomeEmail(resendKey, email, name, isResend) {
  const firstName = (name || 'there').split(' ')[0];
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Romeo Razi, CPA — IRS Resolution Service <noreply@irsresolutionservice.com>',
      to: email,
      subject: isResend
        ? 'Your IRS Resolution Service account — access link'
        : `Welcome to IRS Resolution Service, ${firstName}`,
      html: `
        <div style="font-family:sans-serif;max-width:580px;margin:0 auto;color:#1a1410">

          <div style="background:#1a1410;padding:20px 28px">
            <div style="font-family:Georgia,serif;font-size:20px;font-weight:600;color:#c9a84c">IRS Resolution Service</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:3px">irsresolutionservice.com</div>
          </div>

          <div style="background:#ffffff;border:1px solid #d9cdb8;border-top:none;padding:28px">

            <h2 style="font-family:Georgia,serif;font-size:1.5rem;font-weight:600;color:#1a1410;margin-bottom:0.5rem">
              ${isResend ? `Hi ${firstName}, here's your access link.` : `Welcome, ${firstName}.`}
            </h2>
            <p style="font-size:15px;color:#4a3f32;line-height:1.75;margin-bottom:1.5rem">
              ${isResend
                ? 'Here is a new link to access your IRS Resolution Service client dashboard.'
                : 'Romeo, Dmitry, and the team at IRS Resolution Service LLC have set up your account. You\'re in good hands — let\'s get started.'}
            </p>

            <div style="background:#f5f0e8;border-left:3px solid #c9a84c;padding:16px 20px;margin-bottom:1.5rem;border-radius:0 3px 3px 0">
              <div style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8a6e2f;margin-bottom:10px">Your next steps</div>
              <table style="width:100%;border-collapse:collapse">
                <tr>
                  <td style="vertical-align:top;padding:6px 0;width:28px">
                    <div style="width:22px;height:22px;background:#c9a84c;border-radius:50%;text-align:center;line-height:22px;font-size:12px;font-weight:700;color:#1a1410">1</div>
                  </td>
                  <td style="vertical-align:top;padding:6px 0 6px 10px;font-size:14px;color:#1a1410;line-height:1.6">
                    <strong>Create your account</strong> — click the button below to set your password and log into your secure client dashboard.
                  </td>
                </tr>
                <tr>
                  <td style="vertical-align:top;padding:6px 0;width:28px">
                    <div style="width:22px;height:22px;background:#c9a84c;border-radius:50%;text-align:center;line-height:22px;font-size:12px;font-weight:700;color:#1a1410">2</div>
                  </td>
                  <td style="vertical-align:top;padding:6px 0 6px 10px;font-size:14px;color:#1a1410;line-height:1.6">
                    <strong>Sign your Form 8821</strong> — this is the first thing you'll see once you log in.
                  </td>
                </tr>
                <tr>
                  <td style="vertical-align:top;padding:6px 0;width:28px">
                    <div style="width:22px;height:22px;background:#c9a84c;border-radius:50%;text-align:center;line-height:22px;font-size:12px;font-weight:700;color:#1a1410">3</div>
                  </td>
                  <td style="vertical-align:top;padding:6px 0 6px 10px;font-size:14px;color:#1a1410;line-height:1.6">
                    <strong>Our team takes it from there</strong> — once you sign, Romeo submits it to the IRS and begins pulling your transcripts.
                  </td>
                </tr>
              </table>
            </div>

            <div style="margin-bottom:1.5rem;text-align:center">
              <a href="https://irsresolutionservice.com/resolve"
                 style="display:inline-block;background:#c9a84c;color:#1a1410;text-decoration:none;padding:14px 32px;border-radius:2px;font-weight:700;font-size:15px;letter-spacing:0.03em">
                Go to your dashboard →
              </a>
            </div>

            <div style="background:#f9f6f1;border:1px solid #d9cdb8;border-radius:4px;padding:20px;margin-bottom:1.5rem">
              <div style="font-family:Georgia,serif;font-size:1.05rem;font-weight:600;color:#1a1410;margin-bottom:8px">What is Form 8821?</div>
              <p style="font-size:14px;color:#4a3f32;line-height:1.75;margin:0">
                Form 8821 is an IRS Tax Information Authorization. By signing it, you authorize Romeo Razi, CPA to access and review your IRS tax records on your behalf — including transcripts of your tax returns, account activity, and filed information.
              </p>
              <p style="font-size:14px;color:#4a3f32;line-height:1.75;margin-top:10px;margin-bottom:0">
                <strong>Important:</strong> This is a read-only authorization. It lets Romeo see your records but not make changes or file on your behalf without a separate agreement. You can revoke it at any time.
              </p>
            </div>

            <div style="background:#f9f6f1;border:1px solid #d9cdb8;border-radius:4px;padding:20px;margin-bottom:1.5rem">
              <div style="font-family:Georgia,serif;font-size:1.05rem;font-weight:600;color:#1a1410;margin-bottom:8px">What happens after you sign</div>
              <p style="font-size:14px;color:#4a3f32;line-height:1.75;margin:0">
                Romeo submits your signed Form 8821 to the IRS Centralized Authorization File (CAF). The IRS typically processes this in <strong>2–5 business days</strong>. Once confirmed, our team will securely pull your IRS transcripts directly from the IRS — no further action needed from you.
              </p>
              <p style="font-size:14px;color:#4a3f32;line-height:1.75;margin-top:10px;margin-bottom:0">
                You can track every step in your dashboard. All status updates — from Form 8821 submission through transcript retrieval, resolution planning, and final resolution — will be visible to you there.
              </p>
            </div>

            <div style="font-size:14px;color:#4a3f32;line-height:1.75;margin-bottom:1.5rem">
              <strong>Questions?</strong> Reach out to us directly:<br>
              Romeo Razi, CPA: <a href="mailto:romeo@taxedright.com" style="color:#8a6e2f">romeo@taxedright.com</a><br>
              Dmitry Dragilev: <a href="mailto:dmitry.dragilev@hey.com" style="color:#8a6e2f">dmitry.dragilev@hey.com</a>
            </div>

            <div style="border-top:1px solid #d9cdb8;padding-top:16px;font-size:12px;color:#7a6e60;line-height:1.6">
              IRS Resolution Service LLC · 9673 Camino Capistrano, Las Vegas, NV<br>
              <a href="https://irsresolutionservice.com" style="color:#8a6e2f;text-decoration:none">irsresolutionservice.com</a>
            </div>

          </div>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend failed ${res.status}: ${err.substring(0,100)}`);
  }
}
