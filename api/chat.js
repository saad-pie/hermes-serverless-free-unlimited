export const config = { runtime: 'edge' };

// ---- Key pools ----
const geminiKeysPool = [];
for (let i = 1; i <= 100; i++) {
  const k = process.env[`Key_${i}`];
  if (k && k.trim()) geminiKeysPool.push(k.trim());
}
if (process.env.GEMINI_KEYS_POOL) {
  geminiKeysPool.push(
    ...process.env.GEMINI_KEYS_POOL.split(',').map(s => s.trim()).filter(Boolean)
  );
}
if (process.env.GEMINI_API_KEY && !geminiKeysPool.includes(process.env.GEMINI_API_KEY.trim())) {
  geminiKeysPool.push(process.env.GEMINI_API_KEY.trim());
}

const unorouterKeysPool = [];
for (let i = 101; i <= 105; i++) {
  const k = process.env[`Key_${i}`];
  if (k && k.trim()) unorouterKeysPool.push(k.trim());
}

const aihubmixKeysPool = [];
for (let i = 106; i <= 111; i++) {
  const k = process.env[`Key_${i}`];
  if (k && k.trim()) aihubmixKeysPool.push(k.trim());
}

const osaiiKey = process.env.Key_112?.trim() || '';
const atriaKey = process.env.Key_113?.trim() || process.env.ATRIA_API_KEY?.trim() || '';

const NON_TEXT_KEYWORDS = [
  'tts', 'transcribe', 'clip', 'robotics', 'audio',
  'embedding', 'rerank', 'moderation', 'video', '3d', 'stt',
];

const JANK_MODELS = [
  'qwen3-guard-8b', 'qwen-guard', 'qwen-safety', 'qwen3.8-27b', 'qwen3.8',
  'qwen-27b', 'qwen3.8-flash', 'qwen3.8-flash-next', 'qwen3.8-next',
  'qwen-125b', 'nemotron-3.5-lightning-30b', 'nemotron', 'north-mini-code',
  'north-mini', 'glm-4.6v-flash', 'glm-4.6v', 'glm-flash', 'glm-5.3-flash',
  'glm-5.3-fast', 'gpt-5.6-luna', 'deepseek-v4-flash-0731',
  'deepseek-v4-flash', 'gemma-4-26b-a4b', 'gemma-4-26b-a4b-it', 'gemma-4-26b',
  'gemma-26b', 'diffusiongemma', 'moondream-3.1',
];

const FREEAI_MODELS = [
  'freeai-gemini-2.5-flash', 'freeai-gpt-4o-mini',
  'freeai-claude-3-haiku', 'freeai-deepseek-chat',
];

const OSAII_MODELS = [
  'fast', 'smart', 'mini', 'poolside/laguna-xs-2.1',
  'poolside/laguna-s-2.1', 'microsoft/bitnet-b1.58-2b-4t',
];

// ---- Helpers ----
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function errorResponse(message, status = 502, extra = {}) {
  return jsonResponse({
    error: { message, type: 'upstream_error', ...extra },
  }, status);
}

async function tryUpstream(url, headers, bodyText, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyText,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ---- Handler ----
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
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  // Global hard cap — leave headroom under Vercel Edge's invocation limit.
  const GLOBAL_DEADLINE_MS = 9000;
  const PER_TARGET_TIMEOUT_MS = 4500;
  const started = Date.now();

  let bodyText;
  try {
    bodyText = await req.text();
  } catch {
    return errorResponse('Could not read request body', 400);
  }

  let bodyJson;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    return errorResponse('Request body is not valid JSON', 400);
  }

  const originalModel = bodyJson.model || '';
  const modelName = originalModel.toLowerCase();
  if (!originalModel) return errorResponse('Missing "model" field', 400);

  if (NON_TEXT_KEYWORDS.some(kw => modelName.includes(kw))) {
    return errorResponse(
      `Model '${originalModel}' is a non-text capability model and cannot be served via chat completions.`,
      400,
      { requested_model: originalModel }
    );
  }

  const hasImages =
    bodyText.includes('"image_url"') || bodyText.includes('"base64"');

  // Don't silently rewrite max_tokens; clamp only when absurdly small.
  if (typeof bodyJson.max_tokens === 'number' && bodyJson.max_tokens < 1) {
    bodyJson.max_tokens = 1;
  }
  const sanitizedBodyText = JSON.stringify(bodyJson);

  // ---- Build an ordered list of candidate upstreams ----
  // Each entry: { name, url, headers, body, rewritesModel }
  const targets = [];

  const atriaHeaders = atriaKey
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${atriaKey}` }
    : { 'Content-Type': 'application/json' };

  if (hasImages) {
    for (const k of geminiKeysPool) {
      targets.push({
        name: 'gemini',
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
        body: sanitizedBodyText,
        rewritesModel: false,
      });
    }
    targets.push({
      name: 'atria',
      url: 'https://api.atria-asi.ai/v1/chat/completions',
      headers: atriaHeaders,
      body: sanitizedBodyText,
      rewritesModel: false,
    });
  }

  if (modelName.includes('atria') || modelName.includes('dawn')) {
    targets.push({
      name: 'atria',
      url: 'https://api.atria-asi.ai/v1/chat/completions',
      headers: atriaHeaders,
      body: sanitizedBodyText,
      rewritesModel: false,
    });
  } else if (modelName.includes(':free') || modelName.includes('unorouter')) {
    for (const k of unorouterKeysPool) {
      targets.push({
        name: 'unorouter',
        url: 'https://api.unorouter.com/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
        body: sanitizedBodyText,
        rewritesModel: false,
      });
    }
    targets.push({
      name: 'unorouter',
      url: 'https://api.unorouter.com/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      body: sanitizedBodyText,
      rewritesModel: false,
    });
  } else if (
    JANK_MODELS.some(m => modelName.includes(m)) ||
    FREEAI_MODELS.some(m => modelName.includes(m)) ||
    modelName.includes('freeai')
  ) {
    targets.push({
      name: 'jankrouter',
      url: 'http://jankrouter.waifly.com/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      body: sanitizedBodyText,
      rewritesModel: false,
    });
    targets.push({
      name: 'freeaixyz',
      url: 'https://freeaixyz4all.vercel.app/api/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      body: sanitizedBodyText,
      rewritesModel: false,
    });
  } else if (
    OSAII_MODELS.some(m => modelName.includes(m)) ||
    modelName.includes('poolside/') ||
    modelName.includes('bitnet')
  ) {
    targets.push({
      name: 'osaii',
      url: 'https://osaii.wyvernhub.net/api/v1/chat/completions',
      headers: osaiiKey
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${osaiiKey}` }
        : { 'Content-Type': 'application/json' },
      body: sanitizedBodyText,
      rewritesModel: false,
    });
  } else if (
    modelName.includes('gpt-') ||
    modelName.includes('claude-') ||
    modelName.includes('aihubmix') ||
    modelName.includes('deepseek')
  ) {
    for (const k of aihubmixKeysPool) {
      targets.push({
        name: 'aihubmix',
        url: 'https://aihubmix.com/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
        body: sanitizedBodyText,
        rewritesModel: false,
      });
    }
  }

  // Explicit fallback tiers — no model rewriting, tag rewritesModel so
  // we can report substitutions instead of hiding them.
  targets.push({
    name: 'atria',
    url: 'https://api.atria-asi.ai/v1/chat/completions',
    headers: atriaHeaders,
    body: sanitizedBodyText,
    rewritesModel: false,
  });

  for (const k of geminiKeysPool) {
    let geminiBody = sanitizedBodyText;
    let rewritesModel = false;
    if (
      modelName.includes('qwen') ||
      modelName.includes('glm') ||
      modelName.includes('deepseek') ||
      modelName.includes('freeai') ||
      modelName.includes('jank') ||
      modelName.includes('atria')
    ) {
      try {
        const parsed = JSON.parse(sanitizedBodyText);
        parsed.model = 'gemini-2.5-flash';
        geminiBody = JSON.stringify(parsed);
        rewritesModel = true;
      } catch {}
    }
    targets.push({
      name: 'gemini',
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
      body: geminiBody,
      rewritesModel,
    });
  }

  targets.push({
    name: 'osaii',
    url: 'https://osaii.wyvernhub.net/api/v1/chat/completions',
    headers: osaiiKey
      ? { 'Content-Type': 'application/json', Authorization: `Bearer ${osaiiKey}` }
      : { 'Content-Type': 'application/json' },
    body: sanitizedBodyText,
    rewritesModel: false,
  });
  targets.push({
    name: 'freeaixyz',
    url: 'https://freeaixyz4all.vercel.app/api/v1/chat/completions',
    headers: { 'Content-Type': 'application/json' },
    body: sanitizedBodyText,
    rewritesModel: false,
  });

  // ---- Try each target, honoring the global deadline ----
  const attempts = [];

  for (const t of targets) {
    const elapsed = Date.now() - started;
    const budget = Math.min(PER_TARGET_TIMEOUT_MS, GLOBAL_DEADLINE_MS - elapsed);
    if (budget <= 200) {
      attempts.push({ target: t.name, outcome: 'skipped_deadline' });
      break;
    }

    let res;
    try {
      res = await tryUpstream(t.url, t.headers, t.body, budget);
    } catch (err) {
      attempts.push({
        target: t.name,
        outcome: err.name === 'AbortError' ? 'timeout' : 'network_error',
        detail: err.message,
      });
      continue;
    }

    if (!res.ok) {
      attempts.push({ target: t.name, outcome: 'http_error', status: res.status });
      continue;
    }

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json') && !ct.includes('text/event-stream')) {
      attempts.push({ target: t.name, outcome: 'bad_content_type', contentType: ct });
      continue;
    }

    // Success — pass through but annotate substitutions in a header so
    // clients can detect rewrites without us mutating the body.
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('X-Antigravity-Target', t.name);
    headers.set('X-Antigravity-Requested-Model', originalModel);
    if (t.rewritesModel) {
      headers.set('X-Antigravity-Model-Rewritten', 'true');
    }
    if (attempts.length > 0) {
      headers.set(
        'X-Antigravity-Attempts',
        attempts.map(a => `${a.target}:${a.outcome}`).join(',')
      );
    }
    return new Response(res.body, { status: res.status, headers });
  }

  // ---- All targets failed: return a real error, not a fake 200 ----
  return jsonResponse(
    {
      error: {
        message: 'All upstream targets failed for this request.',
        type: 'all_upstreams_failed',
        requested_model: originalModel,
        attempts,
        elapsed_ms: Date.now() - started,
      },
    },
    502
  );
}
