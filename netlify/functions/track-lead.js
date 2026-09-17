const crypto = require('crypto');

const PIXEL_ID = 'H4um9gtUZ7KfrCXj5yMQAE';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.OPENAI_ADS_API_KEY;
  if (!apiKey) {
    console.error('track-lead: OPENAI_ADS_API_KEY is not set in the environment');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    // malformed/empty body — fall back to defaults below
  }

  const sourceUrl =
    body.source_url ||
    event.headers.referer ||
    event.headers.referrer ||
    'https://taxedright.com/contact';

  const payload = {
    validate_only: false,
    events: [
      {
        id: crypto.randomUUID(),
        type: 'lead_created',
        timestamp_ms: Date.now(),
        source_url: sourceUrl,
        action_source: 'web',
        data: {
          type: 'customer_action',
        },
      },
    ],
  };

  try {
    const res = await fetch(`https://bzr.openai.com/v1/events?pid=${PIXEL_ID}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();

    if (!res.ok) {
      console.error('track-lead: Conversions API error', res.status, text);
      return { statusCode: 502, body: JSON.stringify({ error: 'Conversions API error' }) };
    }

    return { statusCode: 200, body: text || JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('track-lead: request to Conversions API failed', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to send event' }) };
  }
};
