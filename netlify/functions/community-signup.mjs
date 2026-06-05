// netlify/functions/community-signup.mjs
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

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers }); }

  const { name, email, credential, plan, question, submittedAt } = body;
  if (!name || !email) return new Response(JSON.stringify({ error: 'Missing name or email' }), { status: 400, headers });

  const resendKey = Netlify.env.get('RESEND_API_KEY');

  // Save to Blobs
  try {
    const store = getStore('community');
    const id = `member-${Date.now()}-${email.toLowerCase().replace(/[^a-z0-9]/g,'-')}`;
    const member = { id, name, email, credential, plan, question, submittedAt: submittedAt || new Date().toISOString(), status: 'waitlist', notes: '' };
    await store.set(id, JSON.stringify(member));
    let index = [];
    try {
      const raw = await store.get('__index__');
      if (raw) index = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {}
    index.unshift(id);
    await store.set('__index__', JSON.stringify(index));
  } catch(err) {
    console.error('[community-signup] Blobs error:', err.message);
  }

  const planLabel = plan === 'annual' ? 'Annual — $999/year' : 'Monthly — $99/month';

  // Internal notification email
  const internalHtml = `
    <h2>New Community Waitlist Signup</h2>
    <table style="border-collapse:collapse;width:100%;max-width:520px;font-family:sans-serif;font-size:14px">
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600;width:160px">Name</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${name}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Email</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${email}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Credential</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${credential || '—'}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600">Plan</td><td style="padding:8px 12px;border-bottom:1px solid #d9cdb8">${planLabel}</td></tr>
      <tr><td style="padding:8px 12px;background:#f5f0e8;font-weight:600;vertical-align:top">Their question</td><td style="padding:8px 12px;white-space:pre-wrap">${question || '(none submitted)'}</td></tr>
    </table>
    <p style="margin-top:16px;color:#7a6e60;font-size:13px">View all in <a href="https://irsresolutionservice.com/admin">admin → Community tab</a></p>
  `;

  if (resendKey) {
    for (const to of ['romeo@taxedright.com', 'dmitry.dragilev@hey.com']) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'IRS Resolution Service <noreply@irsresolutionservice.com>', to, subject: `New community signup — ${name} (${credential || 'Tax Pro'})`, html: internalHtml }),
      }).catch(e => console.warn('Email failed:', e.message));
    }

    // Confirmation to signup
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Romeo Razi, CPA — IRS Resolution Service <noreply@irsresolutionservice.com>',
        to: email,
        subject: `You're on the list — IRS Resolution Community for CPAs & EAs (launching summer 2026)`,
        html: `
          <div style="font-family:sans-serif;max-width:580px;margin:0 auto;color:#1a1410">

            <div style="background:#1a1410;padding:20px 28px;margin-bottom:0">
              <div style="font-family:Georgia,serif;font-size:20px;font-weight:600;color:#c9a84c">IRS Resolution Community</div>
              <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:3px">For CPAs & Enrolled Agents · irsresolutionservice.com</div>
            </div>

            <div style="background:#ffffff;border:1px solid #d9cdb8;border-top:none;padding:28px">

              <h2 style="font-family:Georgia,serif;font-size:1.5rem;font-weight:600;color:#1a1410;margin-bottom:0.5rem">Hi ${name.split(' ')[0]},</h2>
              <p style="font-size:15px;color:#4a3f32;line-height:1.75;margin-bottom:1.25rem">You're on the waitlist — thanks for showing interest. We're kicking off the IRS Resolution Community <strong>summer 2026</strong> and you'll be among the first to get access.</p>

              <div style="background:#f5f0e8;border-left:3px solid #c9a84c;padding:16px 20px;margin-bottom:1.5rem;border-radius:0 3px 3px 0">
                <div style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#8a6e2f;margin-bottom:6px">Your plan</div>
                <div style="font-size:15px;color:#1a1410;font-weight:600">${planLabel}</div>
                <div style="font-size:13px;color:#c9a84c;margin-top:4px;font-weight:600">🎁 First month free — no credit card needed now</div>
              </div>

              ${question ? `
              <div style="background:#eef3f8;border-left:3px solid #1a3a5c;padding:16px 20px;margin-bottom:1.5rem;border-radius:0 3px 3px 0">
                <div style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#1a3a5c;margin-bottom:6px">Your question</div>
                <p style="font-size:14px;color:#4a3f32;line-height:1.7;font-style:italic;margin:0">"${question}"</p>
                <p style="font-size:12px;color:#7a6e60;margin-top:8px;margin-bottom:0">Romeo reads every question submitted. This one will inform what we cover in the early calls.</p>
              </div>` : ''}

              <div style="margin-bottom:1.5rem">
                <div style="font-family:Georgia,serif;font-size:1.1rem;font-weight:600;color:#1a1410;margin-bottom:10px">What to expect</div>
                <p style="font-size:14px;color:#4a3f32;line-height:1.75;margin-bottom:10px">Once a month, we get on a call and go deep on one IRS resolution question practitioners are actually wrestling with. Romeo walks through it from both the practitioner and IRS perspective — because he's been on both sides.</p>
                <p style="font-size:14px;color:#4a3f32;line-height:1.75;margin-bottom:10px">After the main topic, we open it up for rapid-fire Q&A. You can also submit questions in advance to shape the agenda.</p>
                <p style="font-size:14px;color:#4a3f32;line-height:1.75;">We'll reach out before launch with the call schedule, platform details, and everything you need to get started.</p>
              </div>

              <div style="background:#f9f6f1;border:1px solid #d9cdb8;border-radius:4px;padding:18px 20px;margin-bottom:1.5rem">
                <div style="font-family:Georgia,serif;font-size:1rem;font-weight:600;color:#1a1410;margin-bottom:8px">Have a topic you'd like us to cover?</div>
                <p style="font-size:14px;color:#4a3f32;line-height:1.75;margin-bottom:8px">We want to hear from you. Email us with topics, questions, or anything you'd like to see covered on the calls. We'll be building the agenda around what practitioners actually need.</p>
                <div style="font-size:14px;color:#4a3f32;line-height:1.9">
                  Romeo Razi, CPA: <a href="mailto:romeo@taxedright.com" style="color:#8a6e2f;font-weight:600">romeo@taxedright.com</a><br>
                  Dmitry Dragilev: <a href="mailto:dmitry.dragilev@hey.com" style="color:#8a6e2f;font-weight:600">dmitry.dragilev@hey.com</a>
                </div>
              </div>

              <p style="font-size:14px;color:#4a3f32;line-height:1.75;margin-bottom:1.5rem">Talk soon,<br><strong>Romeo &amp; Dmitry</strong></p>

              <div style="border-top:1px solid #d9cdb8;padding-top:16px;font-size:12px;color:#7a6e60;line-height:1.6">
                IRS Resolution Service LLC · 9673 Camino Capistrano, Las Vegas, NV<br>
                <a href="https://irsresolutionservice.com" style="color:#8a6e2f;text-decoration:none">irsresolutionservice.com</a>
              </div>
            </div>

          </div>
        `,
      }),
    }).catch(e => console.warn('Confirm email failed:', e.message));
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
