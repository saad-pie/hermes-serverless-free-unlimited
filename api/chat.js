export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
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
    // Collect all environment variables matching Key_1, Key_2... or GEMINI_KEYS_POOL
    const keysPool = [];

    // 1. Check for individual Key_1 to Key_100 vars
    for (let i = 1; i <= 100; i++) {
      const key = process.env[`Key_${i}`];
      if (key && key.trim()) {
        keysPool.push(key.trim());
      }
    }

    // 2. Fallback to GEMINI_KEYS_POOL if present
    if (process.env.GEMINI_KEYS_POOL) {
      const pooled = process.env.GEMINI_KEYS_POOL.split(',').map(k => k.trim()).filter(Boolean);
      keysPool.push(...pooled);
    }

    if (keysPool.length === 0) {
      return new Response(JSON.stringify({ error: 'No API keys found in environment variables.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const bodyText = await req.text();

    // Key Rotation Retry Logic
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

      if (googleResponse.status !== 429 && googleResponse.status !== 403) {
        break;
      }
    }

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
