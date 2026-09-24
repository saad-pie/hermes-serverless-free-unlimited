export const config = {
  runtime: 'edge',
};

// Initialize Gemini keys pool (Key_1 to Key_100)
const geminiKeysPool = [];
for (let i = 1; i <= 100; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) {
    geminiKeysPool.push(key.trim());
  }
}
if (process.env.GEMINI_KEYS_POOL) {
  const pooled = process.env.GEMINI_KEYS_POOL.split(',').map(k => k.trim()).filter(Boolean);
  geminiKeysPool.push(...pooled);
}

// Initialize Unorouter keys pool (Key_101 to Key_106)
const unorouterKeysPool = [];
for (let i = 101; i <= 106; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) {
    unorouterKeysPool.push(key.trim());
  }
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

  try {
    // Clone request to read JSON payload for model detection
    const clonedReq = req.clone();
    const bodyJson = await clonedReq.json().catch(() => ({}));
    const modelName = (bodyJson.model || '').toLowerCase();

    // Determine target provider: Unorouter for :free models or explicit unorouter keys
    const isUnorouterModel = modelName.endsWith(':free') || modelName.includes('unorouter');
    
    let keysPool = isUnorouterModel ? unorouterKeysPool : geminiKeysPool;
    let targetUrl = isUnorouterModel 
      ? 'https://api.unorouter.com/v1/chat/completions' 
      : 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

    // Fallback if target pool is empty
    if (keysPool.length === 0) {
      keysPool = geminiKeysPool.length > 0 ? geminiKeysPool : unorouterKeysPool;
      targetUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    }

    if (keysPool.length === 0) {
      return new Response(JSON.stringify({ error: 'No API keys found in environment variables for any provider.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const bodyText = await req.text();
    let upstreamResponse = null;
    let attempts = 0;
    const maxAttempts = Math.min(5, keysPool.length);
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
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      try {
        upstreamResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${selectedKey}`,
          },
          body: bodyText,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (upstreamResponse.status !== 429 && upstreamResponse.status !== 403) {
          break;
        }
      } catch (err) {
        clearTimeout(timeoutId);
        if (attempts >= maxAttempts) throw err;
      }
    }

    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Content-Type', upstreamResponse.headers.get('Content-Type') || 'application/json');

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy Edge routing failure', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
