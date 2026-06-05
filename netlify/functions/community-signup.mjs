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
        from: 'Romeo Razi, CPA <noreply@irsresolutionservice.com>',
        to: email,
        subject: "You're in — IRS Resolution Community for CPAs (launching this summer)",
        html: `
          <div style="font-family:sans-serif;max-width:540px;margin:0 auto;color:#1a1410">
            <h2 style="font-family:Georgia,serif;font-size:1.6rem;margin-bottom:0.5rem">Hi ${name.split(' ')[0]},</h2>
            <p style="font-size:15px;line-height:1.75;color:#4a3f32">Thanks for showing interest — you're on the waitlist for the IRS Resolution Community.</p>
            <p style="font-size:15px;line-height:1.75;color:#4a3f32">We're launching <strong>this summer</strong>. As a founding member you'll get your <strong>first month free</strong> and be locked in at the current rate for as long as you stay.</p>
            <div style="background:#f5f0e8;border-left:3px solid #c9a84c;padding:1rem 1.25rem;margin:1.5rem 0;border-radius:0 3px 3px 0">
              <strong style="font-size:14px;color:#8a6e2f">Your plan:</strong><br>
              <span style="font-size:15px;color:#1a1410">${planLabel} · First month free</span>
            </div>
            ${question ? `
            <div style="background:#eef3f8;border-left:3px solid #1a3a5c;padding:1rem 1.25rem;margin:1.5rem 0;border-radius:0 3px 3px 0">
              <strong style="font-size:13px;color:#1a3a5c;text-transform:uppercase;letter-spacing:0.06em">Your question:</strong><br>
              <span style="font-size:14px;color:#4a3f32;line-height:1.65;font-style:italic">"${question}"</span><br>
              <span style="font-size:12px;color:#7a6e60;margin-top:6px;display:block">I read every question submitted. This one is noted — it may well be our first month's topic.</span>
            </div>` : ''}
            <p style="font-size:15px;line-height:1.75;color:#4a3f32">Here's what you're getting into: once a month, we hop on a call and go deep on one IRS resolution question practitioners are actually wrestling with. I walk through it from both the practitioner and IRS side — because I've been on both. Then we open it up for a rapid-fire Q&A round.</p>
            <p style="font-size:15px;line-height:1.75;color:#4a3f32">We'll reach out before launch with everything you need to get started.</p>
            <p style="font-size:15px;line-height:1.75;color:#4a3f32">Any questions in the meantime — just reply to this email.</p>
            <p style="font-size:15px;margin-top:2rem;color:#1a1410">— Romeo</p>
            <p style="font-size:13px;color:#7a6e60;margin-top:0.25rem">Romeo Razi, CPA · Former IRS Auditor<br>IRS Resolution Service — irsresolutionservice.com</p>
          </div>
        `,
      }),
    }).catch(e => console.warn('Confirm email failed:', e.message));
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
