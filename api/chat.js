export const config = { runtime: 'edge' };

// ------------------------------------------------------------------
// Key pools
// ------------------------------------------------------------------
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

// OpenRouter: primary stable tier for agent workloads.
const openrouterKey = process.env.OPENROUTER_API_KEY?.trim() || '';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ------------------------------------------------------------------
// Model classification
// ------------------------------------------------------------------
const NON_TEXT_KEYWORDS = [
  'tts', 'transcribe', 'clip', 'robotics', 'audio',
  'embedding', 'rerank', 'moderation', 'video', '3d', 'stt',
  'whisper', 'lyria', 'nano-banana',
];

const IMAGE_MODEL_PATTERN =
  /(sdxl|sd-?xl|pony|anime|illustrious|flux|checkpoint|diffusion|juggernaut|dreamshaper|deliberate|albedobase|absolutereality|rev-animated|anything-v\d|fustercluck|ampony|quiet-goodnight|flat-2d|icbinp|swampony|tunix|prefect|cyberrealistic|wai-|ntr-mix|lucid-origin|phoenix-1)/i;

const NON_CHAT_GOOGLE_PATTERN =
  /(^antigravity-|^deep-research|computer-use-preview)/i;

const NON_CHAT_GOOGLE_SUFFIX = /(-image$|-image-|-image-|^gemini-omni-)/i;

const EXTRA_NON_CHAT_IDS = new Set([
  'nova-3:free',
  'nova-3',
  'gemini-3.1-pro-preview-customtools',
  'gemini-omni-flash-preview',
  'gemini-omni-1.1-flash',
  'qwen3-guard-8b',
  'moondream-3.1',
  'nemotron-3.5-content-safety-free',
  'nemotron-3.5-content-safety',
  'osaii/voicellm',
  'osaii/faster-experimental',
  'osaii/ultrafast-experimental',
  'aura-1:free',
  'aura-1',
]);

function isChatModel(id, provider) {
  if (!id) return false;
  const lower = id.toLowerCase();
  if (EXTRA_NON_CHAT_IDS.has(lower)) return false;
  if (NON_TEXT_KEYWORDS.some(kw => lower.includes(kw))) return false;
  if (IMAGE_MODEL_PATTERN.test(lower)) return false;
  if (provider === 'google' && NON_CHAT_GOOGLE_PATTERN.test(lower)) return false;
  if (provider === 'google' && NON_CHAT_GOOGLE_SUFFIX.test(lower)) return false;
  return true;
}

const GEMINI_PATTERN = /^(gemini|gemma|models\/gemini|models\/gemma)/i;

// ------------------------------------------------------------------
// Live catalog cache — refresh every 3.5 minutes
// ------------------------------------------------------------------
const CATALOG_TTL_MS = 3.5 * 60 * 1000;
let catalogCache = {
  at: 0,
  providers: {},
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function loadLiveCatalog() {
  if (Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.providers;

  const providers = {};

  const tasks = [
    // ---- OpenRouter ----
    (async () => {
      const ids = new Set();
      let live = false;
      if (openrouterKey) {
        try {
          const res = await fetchWithTimeout('https://openrouter.ai/api/v1/models', {
            headers: { Authorization: `Bearer ${openrouterKey}` },
          }, 3500);
          if (res.ok) {
            const data = await res.json();
            for (const m of data.data || []) {
              const id = m.id || '';
              if (!id) continue;
              const lower = id.toLowerCase();
              // Surface free-tier IDs only. Paid IDs are hidden because
              // calling them returns 402 without credits, or burns the
              // purchased balance if credits exist.
              const isFree = /:free$/.test(lower);
              if (isFree && isChatModel(id, 'openrouter')) {
                ids.add(lower);
              }
            }
            live = ids.size > 0;
          }
        } catch {}
      }
      providers.openrouter = {
        ids,
        live,
        status: openrouterKey ? (live ? 'live' : 'unreachable') : 'no_keys_configured',
      };
    })(),

    // ---- Google Gemini ----
    (async () => {
      const ids = new Set();
      let live = false;
      for (const key of geminiKeysPool) {
        try {
          const res = await fetchWithTimeout(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
            {}, 3500
          );
          if (!res.ok) continue;
          const data = await res.json();
          for (const m of data.models || []) {
            const id = (m.name || '').replace('models/', '');
            if (!id) continue;
            const supportsText = (m.supportedGenerationMethods || []).includes('generateContent');
            if (supportsText && isChatModel(id, 'google')) {
              ids.add(id.toLowerCase());
              live = true;
            }
          }
          if (live) break;
        } catch {}
      }
      providers.google = { ids, live, status: live ? 'live' : 'unreachable' };
    })(),

    // ---- Unorouter ----
    (async () => {
      const ids = new Set();
      let live = false;
      try {
        const res = await fetchWithTimeout(
          'https://api.unorouter.com/api/pricing/catalog', {}, 3500
        );
        if (res.ok) {
          const data = await res.json();
          for (const m of data.models || []) {
            if (m.online && m.is_free && m.model_name && isChatModel(m.model_name, 'unorouter')) {
              ids.add(m.model_name.toLowerCase());
              live = true;
            }
          }
        }
      } catch {}
      providers.unorouter = { ids, live, status: live ? 'live' : 'unreachable' };
    })(),

    // ---- AIHubMix ----
    (async () => {
      const ids = new Set();
      let live = false;
      if (aihubmixKeysPool.length > 0) {
        try {
          const res = await fetchWithTimeout('https://aihubmix.com/v1/models', {
            headers: { Authorization: `Bearer ${aihubmixKeysPool[0]}` },
          }, 3500);
          if (res.ok) {
            const data = await res.json();
            for (const m of data.data || []) {
              const id = (m.id || '').toLowerCase();
              const isFreeCallable = /-free$|:free$|-free-/.test(id);
              if (isFreeCallable && isChatModel(id, 'aihubmix')) {
                ids.add(id);
              }
            }
            live = ids.size > 0;
          }
        } catch {}
      }
      providers.aihubmix = { ids, live, status: live ? 'live' : 'unreachable' };
    })(),

    // ---- JankRouter ----
    (async () => {
      const ids = new Set();
      let live = false;
      try {
        const res = await fetchWithTimeout('http://jankrouter.waifly.com/v1/models', {}, 3500);
        if (res.ok) {
          const data = await res.json();
          for (const m of data.data || []) {
            if (m.id && isChatModel(m.id, 'jankrouter')) {
              ids.add(m.id.toLowerCase());
            }
          }
          live = ids.size > 0;
        }
      } catch {}
      providers.jankrouter = { ids, live, status: live ? 'live' : 'unreachable' };
    })(),

    // ---- OSAII ----
    (async () => {
      const ids = new Set();
      let live = false;
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (osaiiKey) headers.Authorization = `Bearer ${osaiiKey}`;
        const res = await fetchWithTimeout(
          'https://osaii.wyvernhub.net/api/v1/models', { headers }, 3500
        );
        if (res.ok) {
          const data = await res.json();
          const list = data.data || data.models || data;
          if (Array.isArray(list)) {
            for (const m of list) {
              const id = typeof m === 'string' ? m : m.id;
              if (id && isChatModel(id, 'osaii')) ids.add(id.toLowerCase());
            }
            live = ids.size > 0;
          }
        }
      } catch {}
      providers.osaii = { ids, live, status: live ? 'live' : 'unreachable' };
    })(),

    // ---- FreeAIXYZ ----
    (async () => {
      const ids = new Set();
      let live = false;
      try {
        const res = await fetchWithTimeout(
          'https://freeaixyz4all.vercel.app/api/v1/models', {}, 3500
        );
        if (res.ok) {
          const data = await res.json();
          const list = data.data || data.models || data;
          if (Array.isArray(list)) {
            for (const m of list) {
              const id = typeof m === 'string' ? m : m.id;
              if (id && isChatModel(id, 'freeaixyz')) ids.add(id.toLowerCase());
            }
            live = ids.size > 0;
          }
        }
      } catch {}
      providers.freeaixyz = { ids, live, status: live ? 'live' : 'unreachable' };
    })(),

    // ---- Atria ----
    (async () => {
      const ids = new Set(['atria-dawn-preview']);
      let live = false;
      if (atriaKey) {
        try {
          const res = await fetchWithTimeout(
            'https://api.atria-asi.ai/v1/models',
            { headers: { Authorization: `Bearer ${atriaKey}` } },
            3500
          );
          live = res.ok;
        } catch {}
      }
      providers.atria = {
        ids,
        live,
        status: atriaKey ? (live ? 'live' : 'unreachable') : 'no_keys_configured',
      };
    })(),
  ];

  await Promise.allSettled(tasks);

  catalogCache = { at: Date.now(), providers };
  return providers;
}

function findProvidersForModel(requestedModel, providers) {
  const want = requestedModel.toLowerCase();
  const bare = want.replace(/:free$/, '');
  const matches = [];
  for (const [name, info] of Object.entries(providers)) {
    if (info.ids.has(want) || info.ids.has(bare) || info.ids.has(bare + ':free')) {
      matches.push(name);
    }
  }
  return matches;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
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
  return jsonResponse(
    { error: { message, type: 'upstream_error', ...extra } },
    status
  );
}

// ------------------------------------------------------------------
// Handler
// ------------------------------------------------------------------
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

  if (!isChatModel(originalModel, '')) {
    return errorResponse(
      `Model '${originalModel}' is not a chat-capable model and cannot be served via chat completions.`,
      400,
      { requested_model: originalModel }
    );
  }

  const hasImages =
    bodyText.includes('"image_url"') || bodyText.includes('"base64"');

  if (typeof bodyJson.max_tokens === 'number' && bodyJson.max_tokens < 1) {
    bodyJson.max_tokens = 1;
  }
  const sanitizedBodyText = JSON.stringify(bodyJson);

  const atriaHeaders = atriaKey
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${atriaKey}` }
    : { 'Content-Type': 'application/json' };

  const providers = await loadLiveCatalog();
  const matches = findProvidersForModel(originalModel, providers);

  const targets = [];
  const push = (t) => targets.push(t);

  // OpenRouter headers include optional referer/title for their dashboard.
  const openrouterHeaders = openrouterKey
    ? {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openrouterKey}`,
        'HTTP-Referer': 'https://antigravity-seven-delta.vercel.app',
        'X-Title': 'Antigravity Gateway',
      }
    : null;

  const pushOpenRouter = () => {
    if (!openrouterHeaders) return;
    push({
      name: 'openrouter',
      url: OPENROUTER_URL,
      headers: openrouterHeaders,
      body: sanitizedBodyText,
      rewritesModel: false,
    });
  };
  const pushGemini = () => {
    for (const k of geminiKeysPool) {
      push({
        name: 'gemini',
        url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
        body: sanitizedBodyText,
        rewritesModel: false,
      });
    }
  };
  const pushUnorouter = () => {
    for (const k of unorouterKeysPool) {
      push({
        name: 'unorouter',
        url: 'https://api.unorouter.com/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
        body: sanitizedBodyText,
        rewritesModel: false,
      });
    }
    push({
      name: 'unorouter',
      url: 'https://api.unorouter.com/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      body: sanitizedBodyText,
      rewritesModel: false,
    });
  };
  const pushAihubmix = () => {
    for (const k of aihubmixKeysPool) {
      push({
        name: 'aihubmix',
        url: 'https://aihubmix.com/v1/chat/completions',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
        body: sanitizedBodyText,
        rewritesModel: false,
      });
    }
  };
  const pushJankrouter = () => {
    push({
      name: 'jankrouter',
      url: 'http://jankrouter.waifly.com/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      body: sanitizedBodyText,
      rewritesModel: false,
    });
  };
  const pushOsaii = () => {
    push({
      name: 'osaii',
      url: 'https://osaii.wyvernhub.net/api/v1/chat/completions',
      headers: osaiiKey
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${osaiiKey}` }
        : { 'Content-Type': 'application/json' },
      body: sanitizedBodyText,
      rewritesModel: false,
    });
  };
  const pushFreeaixyz = () => {
    push({
      name: 'freeaixyz',
      url: 'https://freeaixyz4all.vercel.app/api/v1/chat/completions',
      headers: { 'Content-Type': 'application/json' },
      body: sanitizedBodyText,
      rewritesModel: false,
    });
  };
  const pushAtria = () => {
    push({
      name: 'atria',
      url: 'https://api.atria-asi.ai/v1/chat/completions',
      headers: atriaHeaders,
      body: sanitizedBodyText,
      rewritesModel: false,
    });
  };

  const pushByName = {
    openrouter: pushOpenRouter,
    unorouter: pushUnorouter,
    aihubmix: pushAihubmix,
    jankrouter: pushJankrouter,
    osaii: pushOsaii,
    freeaixyz: pushFreeaixyz,
    atria: pushAtria,
    google: pushGemini,
  };

  // Vision requests prefer Gemini, then Atria.
  if (hasImages) {
    pushGemini();
    pushAtria();
  }

  // Routing priority (when not vision):
  //   1. OpenRouter if the live catalog says it carries the exact ID
  //      (this preserves OSAII's `vendor/model` slugs, which also contain `/`)
  //   2. Gemini pattern → Google
  //   3. Atria/Dawn → Atria
  //   4. Any provider the live catalog says actually has the model
  //   5. Nothing matched → permissive fallback chain
  if (hasImages) {
    // already handled above
  } else if (matches.includes('openrouter')) {
    pushOpenRouter();
    for (const name of ['unorouter', 'aihubmix', 'jankrouter', 'osaii', 'atria', 'google']) {
      if (matches.includes(name)) pushByName[name]();
    }
  } else if (GEMINI_PATTERN.test(modelName)) {
    pushGemini();
    pushOpenRouter();
  } else if (modelName.includes('atria') || modelName.includes('dawn')) {
    pushAtria();
    pushOpenRouter();
  } else if (matches.length > 0) {
    const order = ['unorouter', 'aihubmix', 'jankrouter', 'osaii', 'freeaixyz', 'atria', 'google'];
    for (const name of order) {
      if (matches.includes(name) && pushByName[name]) pushByName[name]();
    }
  } else {
    pushAihubmix();
    pushJankrouter();
    pushOsaii();
    pushUnorouter();
  }

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
      res = await fetchWithTimeout(t.url, {
        method: 'POST',
        headers: t.headers,
        body: t.body,
      }, budget);
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

    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('X-Antigravity-Target', t.name);
    headers.set('X-Antigravity-Requested-Model', originalModel);
    if (t.rewritesModel) headers.set('X-Antigravity-Model-Rewritten', 'true');
    if (attempts.length > 0) {
      headers.set(
        'X-Antigravity-Attempts',
        attempts.map(a => `${a.target}:${a.outcome}`).join(',')
      );
    }
    return new Response(res.body, { status: res.status, headers });
  }

  return jsonResponse(
    {
      error: {
        message: 'All upstream targets failed for this request.',
        type: 'all_upstreams_failed',
        requested_model: originalModel,
        matches_in_catalog: matches,
        attempts,
        elapsed_ms: Date.now() - started,
      },
    },
    502
  );
}
