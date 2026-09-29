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

// ------------------------------------------------------------------
// Model classification
// ------------------------------------------------------------------
// Cheap denylist — catches obvious non-chat providers and endpoints.
const NON_TEXT_KEYWORDS = [
  'tts', 'transcribe', 'clip', 'robotics', 'audio',
  'embedding', 'rerank', 'moderation', 'video', '3d', 'stt',
  'whisper', 'lyria', 'nano-banana',
];

// Image-generation checkpoints (Stable Diffusion variants) whose IDs do
// not contain any of the keywords above but cannot serve chat completions.
const IMAGE_MODEL_PATTERN =
  /(sdxl|sd-?xl|pony|anime|illustrious|flux|checkpoint|diffusion|juggernaut|dreamshaper|deliberate|albedobase|absolutereality|rev-animated|anything-v\d|fustercluck|ampony|quiet-goodnight|flat-2d|icbinp|swampony|tunix|prefect|cyberrealistic|wai-|ntr-mix|lucid-origin|phoenix-1)/i;

// Google exposes internal and agentic endpoints that don't accept chat
// messages. These are not usable via /v1/chat/completions.
const NON_CHAT_GOOGLE_PATTERN =
  /(^antigravity-|^deep-research|computer-use-preview)/i;

function isChatModel(id, provider) {
  if (!id) return false;
  const lower = id.toLowerCase();
  if (NON_TEXT_KEYWORDS.some(kw => lower.includes(kw))) return false;
  if (IMAGE_MODEL_PATTERN.test(lower)) return false;
  if (provider === 'google' && NON_CHAT_GOOGLE_PATTERN.test(lower)) return false;
  return true;
}

// Gemini's native line. Anything matching this goes to Google.
const GEMINI_PATTERN = /^(gemini|gemma|models\/gemini|models\/gemma)/i;

// ------------------------------------------------------------------
// Live catalog cache (per warm edge instance, ~5 min TTL)
// ------------------------------------------------------------------
const CATALOG_TTL_MS = 5 * 60 * 1000;
let catalogCache = {
  at: 0,
  providers: {}, // providerName -> { ids: Set<string>, live: boolean, status: string }
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
          if (live) break; // one good key is enough to enumerate
        } catch {}
      }
      providers.google = { ids, live, status: live ? 'live' : 'unreachable' };
    })(),

    // ---- Unorouter (public catalog endpoint) ----
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

    // ---- AIHubMix (only free-callable IDs) ----
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
              // Only surface free-tier callable IDs; paid IDs will 402/403.
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

  // Reject non-chat models up front with a clear reason.
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

  // ---- Determine routing based on live catalog + model name ----
  const providers = await loadLiveCatalog();
  const matches = findProvidersForModel(originalModel, providers);

  const targets = [];
  const push = (t) => targets.push(t);

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

  // Vision requests prefer Gemini, then Atria.
  if (hasImages) {
    pushGemini();
    pushAtria();
  }

  // Route by where the model actually lives.
  if (GEMINI_PATTERN.test(modelName)) {
    pushGemini();
  } else if (modelName.includes('atria') || modelName.includes('dawn')) {
    pushAtria();
  } else if (matches.length > 0) {
    const order = ['unorouter', 'aihubmix', 'jankrouter', 'osaii', 'freeaixyz', 'atria', 'google'];
    const pushByName = {
      unorouter: pushUnorouter,
      aihubmix: pushAihubmix,
      jankrouter: pushJankrouter,
      osaii: pushOsaii,
      freeaixyz: pushFreeaixyz,
      atria: pushAtria,
      google: pushGemini,
    };
    for (const name of order) {
      if (matches.includes(name) && pushByName[name]) pushByName[name]();
    }
  } else {
    // Not found in any live catalog. Try providers known to be permissive.
    pushAihubmix();
    pushJankrouter();
    pushOsaii();
    pushUnorouter();
  }

  // ---- Execute ----
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
