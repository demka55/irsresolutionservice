// netlify/functions/status-email.mjs
// Sends an email to the client whenever their case status changes.
// Called internally by client-status.mjs right after a successful admin status update.

const STATUS_DEFS = {
  paid: {
    label: 'Awaiting Form 2848',
    clientMessage: "We're ready to get started. Please log into your dashboard and sign Form 2848 to authorize Romeo to access your IRS records.",
  },
  '2848_signed': {
    label: '2848 Signed by Client',
    clientMessage: "We've received your signed Form 2848. Romeo and the team will submit it to the IRS shortly.",
  },
  '2848_submitted': {
    label: '2848 Submitted to IRS',
    clientMessage: 'Romeo and the team have submitted your Form 2848 to the IRS.',
    showEstimate: true,
  },
  '2848_approved': {
    label: '2848 Approved — Pulling Transcripts',
    clientMessage: 'Good news — the IRS has approved your Form 2848. Romeo is about to pull your tax transcripts directly from the IRS.',
  },
  transcripts_pulled: {
    label: 'Transcripts Pulled — Analysis Started',
    clientMessage: 'Romeo and the team have successfully and securely pulled your tax transcripts from the IRS, and have started a full analysis of your case.',
  },
  analyzing: {
    label: 'Analyzing Your Records',
    clientMessage: 'Romeo is analyzing your tax records in detail. If anything needs clarification, he will reach out to you directly with questions.',
  },
  preparing_resolution: {
    label: 'Preparing Your Resolution',
    clientMessage: 'Romeo is now preparing a resolution for your case — this includes drafting letters, forms, and other documents needed to resolve your IRS matter.',
  },
  resolution_ready: {
    label: 'Resolution Ready',
    clientMessage: 'Your resolution is ready. Romeo will be in touch shortly to walk you through everything and confirm details before filing with the IRS in the next few days.',
  },
  filed: {
    label: 'Filed — Awaiting IRS Confirmation',
    clientMessage: 'Your resolution documents have been filed with the IRS. We are now waiting for confirmation and processing — this can take a few weeks.',
  },
  resolved: {
    label: 'Resolved',
    clientMessage: 'Your case has been fully resolved. Congratulations — thank you for trusting us with your IRS matter.',
  },
};

function addBusinessDays(date, days) {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0 && result.getDay() !== 6) added++;
  }
  return result;
}

export default async (req) => {
  const headers = { 'Content-Type': 'application/json' };
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const { email, name, status, internalKey } = body;

  // Only callable internally (from client-status.mjs) — not exposed publicly
  const expectedKey = Netlify.env.get('INTERNAL_FUNCTION_KEY');
  if (!expectedKey || !internalKey || internalKey !== expectedKey) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  if (!email || !status) return new Response(JSON.stringify({ error: 'Missing email or status' }), { status: 400, headers });

  const def = STATUS_DEFS[status];
  if (!def) return new Response(JSON.stringify({ ok: false, note: 'Unknown status — no email sent: ' + status }), { status: 200, headers });

  const resendKey = Netlify.env.get('RESEND_API_KEY');
  if (!resendKey) return new Response(JSON.stringify({ ok: false, note: 'RESEND_API_KEY not set' }), { status: 200, headers });

  const firstName = (name || 'there').split(' ')[0];

  let estimateHtml = '';
  if (def.showEstimate) {
    const estDate = addBusinessDays(new Date(), 5);
    const estStr = estDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    estimateHtml = `
      <div style="background:#f5f0e8;border-left:3px solid #c9a84c;padding:14px 18px;margin:1.25rem 0;border-radius:0 3px 3px 0">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8a6e2f;margin-bottom:4px">Estimated approval</div>
        <div style="font-size:15px;color:#1a1410;font-weight:600">${estStr}</div>
        <div style="font-size:12px;color:#7a6e60;margin-top:4px">The IRS typically takes 2–5 business days to process. We'll notify you as soon as it's confirmed.</div>
      </div>`;
  }

  const html = `
    <div style="font-family:sans-serif;max-width:580px;margin:0 auto;color:#1a1410">
      <div style="background:#1a1410;padding:20px 28px">
        <div style="font-family:Georgia,serif;font-size:20px;font-weight:600;color:#c9a84c">IRS Resolution Service</div>
        <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-top:3px">Status update on your case</div>
      </div>
      <div style="background:#ffffff;border:1px solid #d9cdb8;border-top:none;padding:28px">
        <h2 style="font-family:Georgia,serif;font-size:1.4rem;font-weight:600;color:#1a1410;margin-bottom:0.75rem">Hi ${firstName},</h2>
        <div style="display:inline-block;background:#f5ecd8;color:#8a6e2f;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:5px 14px;border-radius:20px;margin-bottom:1rem">${def.label}</div>
        <p style="font-size:15px;color:#4a3f32;line-height:1.75;margin-bottom:1rem">${def.clientMessage}</p>
        ${estimateHtml}
        <div style="margin:1.5rem 0;text-align:center">
          <a href="https://irsresolutionservice.com/resolve" style="display:inline-block;background:#c9a84c;color:#1a1410;text-decoration:none;padding:13px 28px;border-radius:2px;font-weight:700;font-size:15px">View your dashboard →</a>
        </div>
        <div style="font-size:13px;color:#7a6e60;line-height:1.8;border-top:1px solid #d9cdb8;padding-top:14px">
          Questions? Reach out anytime:<br>
          Romeo Razi, CPA: <a href="mailto:romeo@taxedright.com" style="color:#8a6e2f">romeo@taxedright.com</a><br>
          Dmitry Dragilev: <a href="mailto:dmitry.dragilev@hey.com" style="color:#8a6e2f">dmitry.dragilev@hey.com</a>
        </div>
        <div style="border-top:1px solid #d9cdb8;padding-top:14px;margin-top:14px;font-size:11px;color:#7a6e60">
          IRS Resolution Service LLC · 9673 Camino Capistrano, Las Vegas, NV
        </div>
      </div>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'IRS Resolution Service <noreply@irsresolutionservice.com>',
        to: email,
        subject: `Case update: ${def.label}`,
        html,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ ok: false, note: 'Resend error: ' + err.substring(0,150) }), { status: 200, headers });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, note: err.message }), { status: 200, headers });
  }
};
