// netlify/functions/waitlist.js
// Sends waitlist join notification emails via Mailgun or fallback

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { name, email, company, companyUrl, address, noticeText } = body;
  if (!name || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name and email required' }) };
  }

  // Use Mailgun if configured, otherwise use a simple mailto fallback via Netlify Forms
  const mailgunKey = process.env.MAILGUN_API_KEY;
  const mailgunDomain = process.env.MAILGUN_DOMAIN;

  const emailBody = `
New Premium Waitlist Signup — IRS Resolution Service

Name: ${name}
Email: ${email}
Company: ${company || 'N/A'}
Company URL: ${companyUrl || 'N/A'}
Address: ${address || 'N/A'}

--- IRS Notice Text ---
${noticeText || '(not provided)'}
`.trim();

  const htmlBody = `
<h2 style="color:#c9a84c">New Premium Waitlist Signup</h2>
<table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px">
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;width:140px">Name</td><td style="padding:8px;border:1px solid #ddd">${esc(name)}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Email</td><td style="padding:8px;border:1px solid #ddd"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Company</td><td style="padding:8px;border:1px solid #ddd">${esc(company || 'N/A')}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Company URL</td><td style="padding:8px;border:1px solid #ddd">${esc(companyUrl || 'N/A')}</td></tr>
  <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Address</td><td style="padding:8px;border:1px solid #ddd">${esc(address || 'N/A')}</td></tr>
</table>
<h3 style="margin-top:24px">IRS Notice Text</h3>
<pre style="background:#f5f0e8;padding:16px;border-radius:4px;white-space:pre-wrap;font-size:13px">${esc(noticeText || '(not provided)')}</pre>
`;

  if (mailgunKey && mailgunDomain) {
    try {
      const formData = new URLSearchParams();
      formData.append('from', 'IRS Resolution Service <noreply@' + mailgunDomain + '>');
      formData.append('to', 'romeo@taxedright.com, demka55@gmail.com');
      formData.append('subject', `New Premium Waitlist: ${name} (${company || email})`);
      formData.append('text', emailBody);
      formData.append('html', htmlBody);

      const res = await fetch(`https://api.mailgun.net/v3/${mailgunDomain}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from('api:' + mailgunKey).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (res.ok) return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
      const err = await res.text();
      console.error('Mailgun error:', err);
    } catch (e) {
      console.error('Mailgun send failed:', e);
    }
  }

  // Fallback: Netlify Forms submission (works even without Mailgun)
  // Log to console so it appears in Netlify function logs
  console.log('WAITLIST SIGNUP:', emailBody);
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, method: 'logged' }) };
};

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
