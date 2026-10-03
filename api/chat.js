export const config = { runtime: 'edge' };

// ------------------------------------------------------------------
// Key pools
// ------------------------------------------------------------------
const rawGeminiKeys = [];
for (let i = 1; i <= 100; i++) {
  const k = process.env[`Key_${i}`];
  if (k && k.trim()) rawGeminiKeys.push(k.trim());
}
if (process.env.GEMINI_KEYS_POOL) {
  rawGeminiKeys.push(
    ...process.env.GEMINI_KEYS_POOL.split(',').map(s => s.trim()).filter(Boolean)
  );
}
if (process.env.GEMINI_API_KEY && !rawGeminiKeys.includes(process.env.GEMINI_API_KEY.trim())) {
  rawGeminiKeys.push(process.env.GEMINI_API_KEY.trim());
}

const rawUnorouterKeys = [];
for (let i = 101; i <= 105; i++) {
  const k = process.env[`Key_${i}`];
  if (k && k.trim()) rawUnorouterKeys.push(k.trim());
}

const rawAihubmixKeys = [];
for (let i = 106; i <= 111; i++) {
  const k = process.env[`Key_${i}`];
  if (k && k.trim()) rawAihubmixKeys.push(k.trim());
}

const rawOsaiiKey = process.env.Key_112?.trim() || '';
const rawAtriaKey =
  process.env.Key_113?.trim() || process.env.ATRIA_API_KEY?.trim() || '';
const rawOpenrouterKey = process.env.OPENROUTER_API_KEY?.trim() || '';

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

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 's-maxage=210, stale-while-revalidate',
    },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response('OK', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const providerStats = {
    openrouter: { configured_keys: rawOpenrouterKey ? 1 : 0, live: false, models_count: 0, status: 'unchecked' },
    google:     { configured_keys: rawGeminiKeys.length,    live: false, models_count: 0, status: 'unchecked' },
    unorouter:  { configured_keys: rawUnorouterKeys.length, live: false, models_count: 0, status: 'unchecked' },
    aihubmix:   { configured_keys: rawAihubmixKeys.length,  live: false, models_count: 0, status: 'unchecked' },
    jankrouter: { configured_keys: 0,                       live: false, models_count: 0, status: 'unchecked' },
    freeaixyz:  { configured_keys: 0,                       live: false, models_count: 0, status: 'unchecked' },
    osaii:      { configured_keys: rawOsaiiKey ? 1 : 0,     live: false, models_count: 0, status: 'unchecked' },
    atria:      { configured_keys: rawAtriaKey ? 1 : 0,     live: false, models_count: 0, status: 'unchecked' },
  };

  const allFormattedModels = [];
  const allWorkingKeyIds = new Set();
  let totalWorkingKeys = 0;

  const settleSafe = async (fn) => {
    try { return { ok: true, value: await fn() }; }
    catch (e) { return { ok: false, error: e.message }; }
  };

  const results = await Promise.all([
    // ---- OpenRouter ----
    settleSafe(async () => {
      if (!rawOpenrouterKey) {
        providerStats.openrouter.status = 'no_keys_configured';
        return { models: [], workingKeys: 0 };
      }
      const res = await fetchWithTimeout('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${rawOpenrouterKey}` },
      }, 4000).catch(() => null);
      if (!res || !res.ok) {
        providerStats.openrouter.status = 'unreachable';
        return { models: [], workingKeys: 0 };
      }
      const data = await res.json();
      const models = (data.data || [])
        .filter(m => {
          const id = (m.id || '').toLowerCase();
          return /:free$/.test(id) && isChatModel(m.id, 'openrouter');
        })
        .map(m => ({
          id: m.id,
          provider: 'openrouter',
          rpm: 20,
          tpm: m.context_length || 200000,
          rpd: 1000,
          limit_type: 'per_day',
        }));
      providerStats.openrouter.live = models.length > 0;
      providerStats.openrouter.status = models.length > 0 ? 'live' : 'empty_catalog';
      providerStats.openrouter.models_count = models.length;
      if (models.length > 0) allWorkingKeyIds.add('openrouter');
      return { models, workingKeys: models.length > 0 ? 1 : 0 };
    }),

    // ---- Google Gemini ----
    settleSafe(async () => {
      let working = 0;
      let sample = null;
      for (const key of rawGeminiKeys) {
        const res = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
          {}, 4000
        ).catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          working++;
          allWorkingKeyIds.add(`gemini:${key.slice(-6)}`);
          if (!sample) sample = data;
        }
      }
      providerStats.google.live = working > 0;
      providerStats.google.status = working > 0 ? 'live' : 'unreachable';

      if (sample && sample.models) {
        const models = sample.models
          .filter(m => {
            const id = m.name.replace('models/', '');
            const text = (m.supportedGenerationMethods || []).includes('generateContent');
            return text && isChatModel(id, 'google');
          })
          .map(m => {
            const id = m.name.replace('models/', '');
            return {
              id,
              provider: 'google',
              rpm: 15,
              rpm_aggregate: 15 * working,
              tpm: m.inputTokenLimit || 250000,
              rpd: 1500,
              limit_type: 'per_minute',
            };
          });
        providerStats.google.models_count = models.length;
        return { models, workingKeys: working };
      }
      return { models: [], workingKeys: working };
    }),

    // ---- Unorouter ----
    settleSafe(async () => {
      let models = [];
      try {
        const res = await fetchWithTimeout(
          'https://api.unorouter.com/api/pricing/catalog', {}, 4000
        );
        if (res.ok) {
          const data = await res.json();
          models = (data.models || [])
            .filter(m =>
              m.online === true &&
              m.is_free === true &&
              isChatModel(m.model_name, 'unorouter')
            )
            .map(m => ({
              id: m.model_name,
              provider: 'unorouter',
              rpm: m.rate_limit_rpm || 60,
              tpm: m.weekly_limit_tokens || m.context_window || 500000,
              rpd: 5000,
              limit_type: 'per_week',
            }));
        }
      } catch {}

      let working = 0;
      if (rawUnorouterKeys.length > 0) {
        const test = await fetchWithTimeout('https://api.unorouter.com/v1/models', {
          headers: { Authorization: `Bearer ${rawUnorouterKeys[0]}` },
        }, 4000).catch(() => null);
        if (test && test.ok) {
          working = rawUnorouterKeys.length;
          allWorkingKeyIds.add('unorouter');
        }
      }

      providerStats.unorouter.live = models.length > 0 && working > 0;
      providerStats.unorouter.status =
        models.length === 0 ? 'unreachable' :
        working === 0 ? 'no_working_keys' :
        'live';
      providerStats.unorouter.models_count = models.length;
      return { models, workingKeys: working };
    }),

    // ---- AIHubMix ----
    settleSafe(async () => {
      if (rawAihubmixKeys.length === 0) {
        providerStats.aihubmix.status = 'no_keys_configured';
        return { models: [], workingKeys: 0 };
      }
      let working = 0;
      let catalog = null;
      for (const key of rawAihubmixKeys) {
        const res = await fetchWithTimeout('https://aihubmix.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        }, 4000).catch(() => null);
        if (res && res.ok) {
          working++;
          allWorkingKeyIds.add(`aihubmix:${key.slice(-6)}`);
          if (!catalog) catalog = await res.json();
        }
      }
      if (!catalog) {
        providerStats.aihubmix.status = 'unreachable';
        return { models: [], workingKeys: working };
      }
      const models = (catalog.data || [])
        .filter(m => {
          const id = (m.id || '').toLowerCase();
          const isFreeCallable = /-free$|:free$|-free-/.test(id);
          return isFreeCallable && isChatModel(id, 'aihubmix');
        })
        .map(m => ({
          id: m.id,
          provider: 'aihubmix',
          rpm: 60,
          tpm: 1000000,
          rpd: 1000,
          limit_type: 'fixed_token_quota',
        }));
      providerStats.aihubmix.live = working > 0 && models.length > 0;
      providerStats.aihubmix.status = models.length === 0 ? 'unreachable' : 'live';
      providerStats.aihubmix.models_count = models.length;
      return { models, workingKeys: working };
    }),

    // ---- JankRouter ----
    settleSafe(async () => {
      const res = await fetchWithTimeout(
        'http://jankrouter.waifly.com/v1/models', {}, 4000
      ).catch(() => null);
      if (!res || !res.ok) {
        providerStats.jankrouter.status = 'unreachable';
        return { models: [], workingKeys: 0 };
      }
      const data = await res.json();
      const models = (data.data || [])
        .filter(m => isChatModel(m.id, 'jankrouter'))
        .map(m => ({
          id: m.id,
          provider: 'jankrouter',
          rpm: 30,
          tpm: m.tpm || 64000,
          rpd: 1000,
          limit_type: 'per_minute',
        }));
      providerStats.jankrouter.live = models.length > 0;
      providerStats.jankrouter.status = models.length > 0 ? 'live' : 'empty_catalog';
      providerStats.jankrouter.models_count = models.length;
      return { models, workingKeys: 0 };
    }),

    // ---- FreeAIXYZ ----
    settleSafe(async () => {
      const res = await fetchWithTimeout(
        'https://freeaixyz4all.vercel.app/api/v1/models', {}, 4000
      ).catch(() => null);
      if (!res || !res.ok) {
        providerStats.freeaixyz.status = 'unreachable';
        return { models: [], workingKeys: 0 };
      }
      let data;
      try { data = await res.json(); }
      catch {
        providerStats.freeaixyz.status = 'invalid_json';
        return { models: [], workingKeys: 0 };
      }
      const list = data.data || data.models || data;
      if (!Array.isArray(list)) {
        providerStats.freeaixyz.status = 'unexpected_shape';
        return { models: [], workingKeys: 0 };
      }
      const models = list
        .filter(m => isChatModel(typeof m === 'string' ? m : (m.id || ''), 'freeaixyz'))
        .map(m => ({
          id: typeof m === 'string' ? m : m.id,
          provider: 'freeaixyz',
          rpm: 60,
          tpm: 128000,
          rpd: 2000,
          limit_type: 'per_minute',
        }));
      providerStats.freeaixyz.live = models.length > 0;
      providerStats.freeaixyz.status = models.length > 0 ? 'live' : 'empty_catalog';
      providerStats.freeaixyz.models_count = models.length;
      return { models, workingKeys: 0 };
    }),

    // ---- OSAII ----
    settleSafe(async () => {
      const headers = { 'Content-Type': 'application/json' };
      if (rawOsaiiKey) headers.Authorization = `Bearer ${rawOsaiiKey}`;
      const res = await fetchWithTimeout(
        'https://osaii.wyvernhub.net/api/v1/models', { headers }, 4000
      ).catch(() => null);
      if (!res || !res.ok) {
        providerStats.osaii.status = 'unreachable';
        return { models: [], workingKeys: 0 };
      }
      const data = await res.json();
      const list = data.data || data.models || data;
      if (!Array.isArray(list)) {
        providerStats.osaii.status = 'unexpected_shape';
        return { models: [], workingKeys: 0 };
      }
      const models = list
        .filter(m => isChatModel(typeof m === 'string' ? m : (m.id || ''), 'osaii'))
        .map(m => ({
          id: typeof m === 'string' ? m : m.id,
          provider: 'osaii',
          rpm: rawOsaiiKey ? 120 : 60,
          tpm: 256000,
          rpd: 5000,
          limit_type: 'per_minute',
        }));
      if (rawOsaiiKey) allWorkingKeyIds.add('osaii');
      providerStats.osaii.live = models.length > 0;
      providerStats.osaii.status = models.length > 0 ? 'live' : 'empty_catalog';
      providerStats.osaii.models_count = models.length;
      return { models, workingKeys: rawOsaiiKey ? 1 : 0 };
    }),

    // ---- Atria ----
    settleSafe(async () => {
      if (!rawAtriaKey) {
        providerStats.atria.status = 'no_keys_configured';
        return { models: [], workingKeys: 0 };
      }
      let live = false;
      let remoteModels = [];
      try {
        const res = await fetchWithTimeout(
          'https://api.atria-asi.ai/v1/models',
          { headers: { Authorization: `Bearer ${rawAtriaKey}` } },
          4000
        );
        if (res.ok) {
          live = true;
          allWorkingKeyIds.add('atria');
          const data = await res.json();
          const list = data.data || data.models || data;
          if (Array.isArray(list)) {
            remoteModels = list
              .filter(m => isChatModel(typeof m === 'string' ? m : (m.id || ''), 'atria'))
              .map(m => ({
                id: typeof m === 'string' ? m : m.id,
                provider: 'atria',
                rpm: 60,
                tpm: 100000000,
                rpd: 5000,
                limit_type: 'fixed_token_quota',
              }));
          }
        }
      } catch {}
      if (remoteModels.length === 0) {
        remoteModels = [{
          id: 'Atria-Dawn-Preview',
          provider: 'atria',
          rpm: 60,
          tpm: 100000000,
          rpd: 5000,
          limit_type: 'fixed_token_quota',
        }];
      }
      providerStats.atria.live = live;
      providerStats.atria.status = live ? 'live' : 'unreachable';
      providerStats.atria.models_count = remoteModels.length;
      return { models: remoteModels, workingKeys: live ? 1 : 0 };
    }),
  ]);

  for (const r of results) {
    if (r.ok && r.value) {
      allFormattedModels.push(...(r.value.models || []));
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const m of allFormattedModels) {
    const key = `${m.provider}::${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(m);
  }

  totalWorkingKeys = allWorkingKeyIds.size;

  const liveProviders = Object.entries(providerStats)
    .filter(([, s]) => s.live)
    .map(([name]) => name);

  return jsonResponse({
    object: 'list',
    total_active_keys: totalWorkingKeys,
    verified_free_models_count: deduped.length,
    diagnostic_report: {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'production',
      total_active_keys: totalWorkingKeys,
      verified_free_models_count: deduped.length,
      live_providers: liveProviders,
      providers: providerStats,
    },
    data: deduped,
  });
}
