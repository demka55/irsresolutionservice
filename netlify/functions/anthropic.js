// netlify/functions/anthropic.js
// Proxies Anthropic API calls — API key never exposed to browser

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Anthropic API key not configured' }) };
  }

  try {
    const reqBody = JSON.parse(event.body);
    const stream = reqBody.stream === true;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: reqBody.max_tokens || 4096,
        system: reqBody.system,
        messages: reqBody.messages,
        stream,
      }),
    });

    const data = await res.text();
    if (!res.ok) {
      let errMsg = 'Anthropic API error ' + res.status;
      try { errMsg = JSON.parse(data)?.error?.message || errMsg; } catch {}
      return { statusCode: res.status, headers, body: JSON.stringify({ error: errMsg }) };
    }

    return {
      statusCode: 200,
      headers: {
        ...headers,
        'Content-Type': stream ? 'text/event-stream' : 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: data,
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
