export const config = {
  runtime: 'edge',
};

// 1. Pre-initialize key pool once globally during cold start
const keysPool = [];
for (let i = 1; i <= 100; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) {
    keysPool.push(key.trim());
  }
}
if (process.env.GEMINI_KEYS_POOL) {
  const pooled = process.env.GEMINI_KEYS_POOL.split(',').map(k => k.trim()).filter(Boolean);
  keysPool.push(...pooled);
}

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

  if (keysPool.length === 0) {
    return new Response(JSON.stringify({ error: 'No API keys found in environment variables.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const bodyText = await req.text();
    let googleResponse = null;
    let attempts = 0;
    const maxAttempts = Math.min(3, keysPool.length);

    // Track tried indices to avoid picking the exact same dead key back-to-back
    const triedIndices = new Set();

    while (attempts < maxAttempts) {
      attempts++;

      let randomIndex;
      do {
        randomIndex = Math.floor(Math.random() * keysPool.length);
      } while (triedIndices.has(randomIndex) && triedIndices.size < keysPool.length);

      triedIndices.add(randomIndex);
      const selectedKey = keysPool[randomIndex];

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout per attempt

      try {
        googleResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${selectedKey}`,
          },
          body: bodyText,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (googleResponse.status !== 429 && googleResponse.status !== 403) {
          break;
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (attempts >= maxAttempts) throw err;
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
