// netlify/functions/admin-invite.mjs
// Creates a Netlify Identity account for a client and sends them an invite email

export default async (req) => {
  // Read env vars inside handler — not at module load time
  const ADMIN_PASSWORD  = Netlify.env.get('ADMIN_PASSWORD') || '';
  const netlifyToken    = Netlify.env.get('NETLIFY_ACCESS_TOKEN');
  const netlifySiteId   = Netlify.env.get('NETLIFY_SITE_ID');
  const resendKey       = Netlify.env.get('RESEND_API_KEY');
  const headers = {
    'Access-Control-Allow-Origin': 'https://irsresolutionservice.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }

  const { adminPassword, email, name, resend } = body;

  if (adminPassword !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  if (!email) {
    return new Response(JSON.stringify({ error: 'Missing email' }), { status: 400, headers });
  }

  if (!netlifyToken || !netlifySiteId) {
    return new Response(JSON.stringify({ error: 'Netlify credentials not configured (NETLIFY_ACCESS_TOKEN, NETLIFY_SITE_ID)' }), { status: 503, headers });
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

    const identityData = await identityRes.json();

    if (!identityRes.ok) {
      // If user already exists and we're not resending, still return ok
      const errMsg = JSON.stringify(identityData);
      if (!resend && (errMsg.includes('already') || identityRes.status === 422)) {
        return new Response(JSON.stringify({ ok: true, note: 'User already exists' }), {
          status: 200, headers: { ...headers, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ error: errMsg }), { status: identityRes.status, headers });
    }

    // Send a custom welcome email via Resend (in addition to Netlify's invite email)
    if (resendKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
            to: email,
            subject: resend ? 'Your IRS Resolution Service access link' : 'Welcome — set up your account',
            html: `
              <h2>Hi ${name || 'there'},</h2>
              <p>${resend ? 'Here is a new link to set up your IRS Resolution Service account.' : 'Your IRS Resolution Service account has been created by Romeo\'s team.'}</p>
              <p>You should receive a separate email shortly with a link to set your password. Once set, you can log in at:</p>
              <p><a href="https://irsresolutionservice.com/login" style="background:#c9a84c;color:white;padding:12px 24px;border-radius:2px;text-decoration:none;font-weight:600;display:inline-block;margin:8px 0">Log in to your dashboard →</a></p>
              <p>Your dashboard shows your resolution progress step by step, lets you sign the required IRS authorization form, and gives you access to our free IRS notice decoder.</p>
              <p>Questions? Email Romeo directly at <a href="mailto:romeo@taxedright.com">romeo@taxedright.com</a></p>
              <p style="color:#7a6e60;font-size:13px;margin-top:24px">IRS Resolution Service — irsresolutionservice.com</p>
            `,
          }),
        });
      } catch(emailErr) {
        console.warn('[admin-invite] Custom email failed:', emailErr.message);
      }
    }

    return new Response(JSON.stringify({ ok: true, user: identityData }), {
      status: 200, headers: { ...headers, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('[admin-invite]', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
};

