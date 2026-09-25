export const config = {
  runtime: 'edge',
};

// 1. Initialize Gemini keys pool (Key_1 to Key_100 and GEMINI_KEYS_POOL or GEMINI_API_KEY)
const geminiKeysPool = [];
for (let i = 1; i <= 100; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) geminiKeysPool.push(key.trim());
}
if (process.env.GEMINI_KEYS_POOL) {
  const pooled = process.env.GEMINI_KEYS_POOL.split(',').map(k => k.trim()).filter(Boolean);
  geminiKeysPool.push(...pooled);
}
if (process.env.GEMINI_API_KEY && !geminiKeysPool.includes(process.env.GEMINI_API_KEY.trim())) {
  geminiKeysPool.push(process.env.GEMINI_API_KEY.trim());
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

// 4. Initialize OSAII key (Key_112)
const osaiiKey = process.env['Key_112'] ? process.env['Key_112'].trim() : '';

const NON_TEXT_KEYWORDS = ['image', 'tts', 'transcribe', 'clip', 'robotics', 'audio', 'embedding', 'rerank', 'moderation', 'video', '3d', 'stt'];

// JankRouter specific models mapping
const JANK_MODELS = [
  'qwen3-guard-8b', 'qwen-guard', 'qwen-safety', 'qwen3.8-27b', 'qwen3.8', 'qwen-27b',
  'qwen3.8-flash', 'qwen3.8-flash-next', 'qwen3.8-next', 'qwen-125b', 'nemotron-3.5-lightning-30b',
  'nemotron', 'north-mini-code', 'north-mini', 'glm-4.6v-flash', 'glm-4.6v', 'glm-flash',
  'glm-5.3-flash', 'glm-5.3-fast', 'gpt-5.6-luna', 'deepseek-v4-flash-0731', 'deepseek-v4-flash',
  'gemma-4-26b-a4b', 'gemma-4-26b-a4b-it', 'gemma-4-26b', 'gemma-26b', 'diffusiongemma', 'moondream-3.1'
];

// FreeAIXYZ specific models mapping
const FREEAI_MODELS = ['freeai-gemini-2.5-flash', 'freeai-gpt-4o-mini', 'freeai-claude-3-haiku', 'freeai-deepseek-chat'];

// OSAII specific models mapping
const OSAII_MODELS = [
  'fast', 'smart', 'mini', 'poolside/laguna-xs-2.1', 'poolside/laguna-s-2.1', 'microsoft/bitnet-b1.58-2b-4t'
];

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
    const bodyText = await req.text();
    let bodyJson = {};
    try {
      bodyJson = JSON.parse(bodyText);
    } catch (_) {}

    const modelName = (bodyJson.model || '').toLowerCase();

    // Prevent non-text models from passing through chat completion endpoints
    if (NON_TEXT_KEYWORDS.some(kw => modelName.includes(kw))) {
      return new Response(JSON.stringify({ error: `Model '${modelName}' is a non-text capability model and cannot be served via chat completions.` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Determine target provider and URL
    let keysPool = [];
    let targetUrl = '';
    let isKeyless = false;
    let explicitAuthKey = '';

    if (modelName.includes(':free') || modelName.includes('unorouter')) {
      keysPool = unorouterKeysPool;
      targetUrl = 'https://api.unorouter.com/v1/chat/completions';
    } else if (JANK_MODELS.some(m => modelName.includes(m))) {
      targetUrl = 'http://jankrouter.waifly.com/v1/chat/completions';
      isKeyless = true;
    } else if (FREEAI_MODELS.some(m => modelName.includes(m)) || modelName.includes('freeai')) {
      targetUrl = 'https://freeaixyz4all.vercel.app/api/v1/chat/completions';
      isKeyless = true;
    } else if (OSAII_MODELS.some(m => modelName.includes(m)) || modelName.includes('poolside/') || modelName.includes('bitnet')) {
      targetUrl = 'https://osaii.wyvernhub.net/api/v1/chat/completions';
      if (osaiiKey) explicitAuthKey = osaiiKey;
      // OSAII allows anonymous requests natively if no key is present
    } else if (modelName.includes('gpt-') || modelName.includes('claude-') || modelName.includes('aihubmix') || modelName.includes('deepseek')) {
      keysPool = aihubmixKeysPool;
      targetUrl = 'https://aihubmix.com/v1/chat/completions';
    } else {
      // Default to OSAII or FreeAIXYZ
      targetUrl = 'https://osaii.wyvernhub.net/api/v1/chat/completions';
      if (osaiiKey) explicitAuthKey = osaiiKey;
    }

    // Fallback pools if specific ones are empty
    if (!isKeyless && !explicitAuthKey && keysPool.length === 0) {
      if (geminiKeysPool.length > 0) {
        keysPool = geminiKeysPool;
        targetUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
      } else if (aihubmixKeysPool.length > 0) {
        keysPool = aihubmixKeysPool;
        targetUrl = 'https://aihubmix.com/v1/chat/completions';
      } else if (unorouterKeysPool.length > 0) {
        keysPool = unorouterKeysPool;
        targetUrl = 'https://api.unorouter.com/v1/chat/completions';
      } else {
        targetUrl = 'https://freeaixyz4all.vercel.app/api/v1/chat/completions';
        isKeyless = true;
      }
    }

    let upstreamResponse = null;

    if (isKeyless || (!explicitAuthKey && keysPool.length === 0)) {
      // Keyless upstream request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      try {
        upstreamResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: bodyText,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    } else if (explicitAuthKey) {
      // Single Bearer token request (e.g., OSAII with Key_112)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      try {
        upstreamResponse = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${explicitAuthKey}`,
          },
          body: bodyText,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    } else {
      // Key-pooled upstream request (Gemini / Unorouter / AIHubMix)
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
    }

    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Content-Type', upstreamResponse.headers.get('Content-Type') || 'application/json');

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy routing failure', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
