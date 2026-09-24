export const config = {
  runtime: 'edge',
};

// 1. Initialize Gemini keys pool (Key_1 to Key_100)
const geminiKeysPool = [];
for (let i = 1; i <= 100; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) geminiKeysPool.push(key.trim());
}
if (process.env.GEMINI_KEYS_POOL) {
  const pooled = process.env.GEMINI_KEYS_POOL.split(',').map(k => k.trim()).filter(Boolean);
  geminiKeysPool.push(...pooled);
}

// 2. Initialize Unorouter keys pool (Key_101 to Key_105)
const unorouterKeysPool = [];
for (let i = 101; i <= 105; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) unorouterKeysPool.push(key.trim());
}

// 3. Initialize AIHubMix keys pool (Key_106 to Key_111)
const aihubmixKeysPool = [];
for (let i = 106; i <= 111; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) aihubmixKeysPool.push(key.trim());
}

const NON_TEXT_KEYWORDS = ['image', 'tts', 'transcribe', 'clip', 'robotics', 'audio', 'embedding', 'rerank', 'moderation', 'video', '3d', 'stt'];

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
    const clonedReq = req.clone();
    const bodyJson = await clonedReq.json().catch(() => ({}));
    const modelName = (bodyJson.model || '').toLowerCase();

    // Prevent non-text models from passing through chat completion endpoints
    if (NON_TEXT_KEYWORDS.some(kw => modelName.includes(kw))) {
      return new Response(JSON.stringify({ error: `Model '${modelName}' is a non-text capability model and cannot be served via chat completions.` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Determine target provider
    let keysPool = geminiKeysPool;
    let targetUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

    if (modelName.includes(':free') || modelName.includes('unorouter')) {
      keysPool = unorouterKeysPool;
      targetUrl = 'https://api.unorouter.com/v1/chat/completions';
    } else if (modelName.includes('gpt-') || modelName.includes('claude-') || modelName.includes('aihubmix') || modelName.includes('deepseek')) {
      keysPool = aihubmixKeysPool;
      targetUrl = 'https://aihubmix.com/v1/chat/completions';
    }

    // Fallback if specific pool is empty
    if (keysPool.length === 0) {
      if (geminiKeysPool.length > 0) {
        keysPool = geminiKeysPool;
        targetUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
      } else if (aihubmixKeysPool.length > 0) {
        keysPool = aihubmixKeysPool;
        targetUrl = 'https://aihubmix.com/v1/chat/completions';
      } else if (unorouterKeysPool.length > 0) {
        keysPool = unorouterKeysPool;
        targetUrl = 'https://api.unorouter.com/v1/chat/completions';
      }
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
