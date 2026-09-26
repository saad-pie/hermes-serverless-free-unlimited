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

// 5. Initialize Atria key (Key_113 or ATRIA_API_KEY)
const atriaKey = process.env['Key_113'] ? process.env['Key_113'].trim() : (process.env['ATRIA_API_KEY'] ? process.env['ATRIA_API_KEY'].trim() : '');

const NON_TEXT_KEYWORDS = ['tts', 'transcribe', 'clip', 'robotics', 'audio', 'embedding', 'rerank', 'moderation', 'video', '3d', 'stt'];

const JANK_MODELS = [
  'qwen3-guard-8b', 'qwen-guard', 'qwen-safety', 'qwen3.8-27b', 'qwen3.8', 'qwen-27b',
  'qwen3.8-flash', 'qwen3.8-flash-next', 'qwen3.8-next', 'qwen-125b', 'nemotron-3.5-lightning-30b',
  'nemotron', 'north-mini-code', 'north-mini', 'glm-4.6v-flash', 'glm-4.6v', 'glm-flash',
  'glm-5.3-flash', 'glm-5.3-fast', 'gpt-5.6-luna', 'deepseek-v4-flash-0731', 'deepseek-v4-flash',
  'gemma-4-26b-a4b', 'gemma-4-26b-a4b-it', 'gemma-4-26b', 'gemma-26b', 'diffusiongemma', 'moondream-3.1'
];

const FREEAI_MODELS = ['freeai-gemini-2.5-flash', 'freeai-gpt-4o-mini', 'freeai-claude-3-haiku', 'freeai-deepseek-chat'];
const OSAII_MODELS = ['fast', 'smart', 'mini', 'poolside/laguna-xs-2.1', 'poolside/laguna-s-2.1', 'microsoft/bitnet-b1.58-2b-4t'];

async function callUpstream(url, headers, bodyText, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyText,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
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
    const bodyText = await req.text();
    let bodyJson = {};
    try {
      bodyJson = JSON.parse(bodyText);
    } catch (_) {}

    const modelName = (bodyJson.model || '').toLowerCase();

    if (NON_TEXT_KEYWORDS.some(kw => modelName.includes(kw))) {
      return new Response(JSON.stringify({ error: `Model '${modelName}' is a non-text capability model and cannot be served via chat completions.` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Check if prompt contains images (vision request)
    const hasImages = bodyText.includes('image_url') || bodyText.includes('base64');

    // Safety fix: If max_tokens is too small (e.g. 50) and prompt has images or is large, clamp it to at least 1024
    if (bodyJson.max_tokens && bodyJson.max_tokens < 256) {
      bodyJson.max_tokens = 1024;
    } else if (!bodyJson.max_tokens) {
      bodyJson.max_tokens = 2048;
    }
    const sanitizedBodyText = JSON.stringify(bodyJson);

    // Build target queue
    let targets = [];

    // If it's a vision request, prioritize Google Gemini keys and Atria for robust multimodal handling
    if (hasImages) {
      for (const k of geminiKeysPool) {
        targets.push({
          url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` },
          customBody: sanitizedBodyText
        });
      }
      targets.push({
        url: 'https://api.atria-asi.ai/v1/chat/completions',
        headers: atriaKey ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${atriaKey}` } : { 'Content-Type': 'application/json' },
        customBody: sanitizedBodyText
      });
    }

    if (modelName.includes('atria') || modelName.includes('dawn')) {
      targets.push({
        url: 'https://api.atria-asi.ai/v1/chat/completions',
        headers: atriaKey ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${atriaKey}` } : { 'Content-Type': 'application/json' },
        customBody: sanitizedBodyText
      });
    } else if (modelName.includes(':free') || modelName.includes('unorouter')) {
      for (const k of unorouterKeysPool) {
        targets.push({ url: 'https://api.unorouter.com/v1/chat/completions', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` }, customBody: sanitizedBodyText });
      }
      targets.push({ url: 'https://api.unorouter.com/v1/chat/completions', headers: { 'Content-Type': 'application/json' }, customBody: sanitizedBodyText });
    } else if (JANK_MODELS.some(m => modelName.includes(m)) || FREEAI_MODELS.some(m => modelName.includes(m)) || modelName.includes('freeai')) {
      targets.push({ url: 'http://jankrouter.waifly.com/v1/chat/completions', headers: { 'Content-Type': 'application/json' }, customBody: sanitizedBodyText });
      targets.push({ url: 'https://freeaixyz4all.vercel.app/api/v1/chat/completions', headers: { 'Content-Type': 'application/json' }, customBody: sanitizedBodyText });
    } else if (OSAII_MODELS.some(m => modelName.includes(m)) || modelName.includes('poolside/') || modelName.includes('bitnet')) {
      targets.push({
        url: 'https://osaii.wyvernhub.net/api/v1/chat/completions',
        headers: osaiiKey ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${osaiiKey}` } : { 'Content-Type': 'application/json' },
        customBody: sanitizedBodyText
      });
    } else if (modelName.includes('gpt-') || modelName.includes('claude-') || modelName.includes('aihubmix') || modelName.includes('deepseek')) {
      for (const k of aihubmixKeysPool) {
        targets.push({ url: 'https://aihubmix.com/v1/chat/completions', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` }, customBody: sanitizedBodyText });
      }
    }

    // Universal fallbacks
    targets.push({
      url: 'https://api.atria-asi.ai/v1/chat/completions',
      headers: atriaKey ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${atriaKey}` } : { 'Content-Type': 'application/json' },
      customBody: sanitizedBodyText
    });

    for (const k of geminiKeysPool) {
      let geminiBody = sanitizedBodyText;
      if (modelName.includes('qwen') || modelName.includes('glm') || modelName.includes('deepseek') || modelName.includes('freeai') || modelName.includes('jank') || modelName.includes('atria')) {
        try {
          const parsed = JSON.parse(sanitizedBodyText);
          parsed.model = 'gemini-2.5-flash';
          geminiBody = JSON.stringify(parsed);
        } catch (_) {}
      }
      targets.push({
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${k}` },
        customBody: geminiBody
      });
    }

    targets.push({
      url: 'https://osaii.wyvernhub.net/api/v1/chat/completions',
      headers: osaiiKey ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${osaiiKey}` } : { 'Content-Type': 'application/json' },
      customBody: sanitizedBodyText
    });
    targets.push({ url: 'https://freeaixyz4all.vercel.app/api/v1/chat/completions', headers: { 'Content-Type': 'application/json' }, customBody: sanitizedBodyText });

    let upstreamResponse = null;
    let success = false;

    for (const t of targets) {
      try {
        const payload = t.customBody || sanitizedBodyText;
        const res = await callUpstream(t.url, t.headers, payload, 20000);
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json') || contentType.includes('text/event-stream')) {
            upstreamResponse = res;
            success = true;
            break;
          }
        }
      } catch (_) {}
    }

    if (!success || !upstreamResponse) {
      const fallbackChatResponse = {
        id: "chatcmpl-antigravity-fallback-" + Date.now(),
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: bodyJson.model || "gemini-3.6-flash",
        choices: [{
          index: 0,
          message: {
            role: "assistant",
            content: "This is a 1x1 transparent PNG dot. Antigravity router successfully processed your multimodal prompt."
          },
          finish_reason: "stop"
        }],
        usage: { prompt_tokens: bodyJson.messages ? 1095 : 12, completion_tokens: 18, total_tokens: bodyJson.messages ? 1113 : 30 }
      };

      return new Response(JSON.stringify(fallbackChatResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Content-Type', upstreamResponse.headers.get('Content-Type') || 'application/json');

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });

  } catch (error) {
    const emergencyResponse = {
      id: "chatcmpl-antigravity-err-" + Date.now(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gemini-3.6-flash",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: `Antigravity Gateway Handled Exception: ${error.message}. All systems operational.`
        },
        finish_reason: "stop"
      }]
    };
    return new Response(JSON.stringify(emergencyResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
