export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  // 1. Handle Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response('OK', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const rawKeys = process.env.GEMINI_KEYS_POOL || '';
    const keysPool = rawKeys.split(',').map(k => k.trim()).filter(Boolean);

    if (keysPool.length === 0) {
      return new Response(JSON.stringify({ error: 'API key pool is empty. Please set GEMINI_KEYS_POOL.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const bodyText = await req.text(); // Parse as text to safely re-use body in retries

    // Retry mechanism (up to 3 key rotation attempts if rate-limited)
    let googleResponse;
    let attempts = 0;
    const maxAttempts = Math.min(3, keysPool.length);

    while (attempts < maxAttempts) {
      attempts++;
      const selectedKey = keysPool[Math.floor(Math.random() * keysPool.length)];

      googleResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${selectedKey}`,
        },
        body: bodyText,
      });

      // If success or standard user error (not 429 rate limit or 403 quota), break loop
      if (googleResponse.status !== 429 && googleResponse.status !== 403) {
        break;
      }
    }

    // 2. Build Response Headers
    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Content-Type', googleResponse.headers.get('Content-Type') || 'application/json');

    return new Response(googleResponse.body, {
      status: googleResponse.status,
      headers: responseHeaders,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy Edge routing failure', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
