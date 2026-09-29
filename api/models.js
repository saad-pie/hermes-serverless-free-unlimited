export const config = { runtime: 'edge' };

// ---- Key pools ----
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

const BANNED_PROJECT_IDS = ['gen-lang-client-0355993627', 'steveai-466814'];
const NON_TEXT_KEYWORDS = [
  'image', 'tts', 'transcribe', 'clip', 'robotics', 'audio',
  'embedding', 'rerank', 'moderation', 'video', '3d', 'stt',
];

const UNOROUTER_WEEKLY_LIMITS = {
  // ...paste your existing table here unchanged...
};

function isTextModel(id) {
  const lower = id.toLowerCase();
  return !NON_TEXT_KEYWORDS.some(kw => lower.includes(kw));
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

function jsonResponse(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 's-maxage=60, stale-while-revalidate',
      ...extraHeaders,
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
    google:    { configured_keys: rawGeminiKeys.length,    live: false, models_count: 0, status: 'unchecked' },
    unorouter:{ configured_keys: rawUnorouterKeys.length,  live: false, models_count: 0, status: 'unchecked' },
    aihubmix:  { configured_keys: rawAihubmixKeys.length,  live: false, models_count: 0, status: 'unchecked' },
    jankrouter:{ configured_keys: 0,                       live: false, models_count: 0, status: 'unchecked' },
    freeaixyz: { configured_keys: 0,                       live: false, models_count: 0, status: 'unchecked' },
    osaii:     { configured_keys: rawOsaiiKey ? 1 : 0,     live: false, models_count: 0, status: 'unchecked' },
    atria:     { configured_keys: rawAtriaKey ? 1 : 0,     live: false, models_count: 0, status: 'unchecked' },
  };

  const allFormattedModels = [];
  let totalWorkingKeys = 0;

  const settleSafe = async (fn) => {
    try { return { ok: true, value: await fn() }; }
    catch (e) { return { ok: false, error: e.message }; }
  };

  const results = await Promise.all([
    // 1. Google
    settleSafe(async () => {
      let working = 0;
      let sample = null;
      for (const key of rawGeminiKeys) {
        const res = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
          {},
          4000
        ).catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          const s = JSON.stringify(data);
          if (!BANNED_PROJECT_IDS.some(p => s.includes(p))) {
            working++;
            if (!sample) sample = data;
          }
        }
      }
      providerStats.google.live = working > 0;
      providerStats.google.status = working > 0 ? 'live' : 'unreachable';
      if (sample && sample.models) {
        const models = sample.models
          .filter(m => {
            const id = m.name.replace('models/', '');
            const text = m.supportedGenerationMethods?.includes('generateContent');
            const freeTier = id.includes('flash') || id.includes('gemma') || id.includes('lite');
            return text && isTextModel(id) && freeTier;
          })
          .map(m => {
            const id = m.name.replace('models/', '');
            return {
              id,
              provider: 'google',
              rpm: 15 * Math.max(1, working),
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

    // 2. Unorouter (authoritative table only — mark live=false)
    settleSafe(async () => {
      const models = Object.entries(UNOROUTER_WEEKLY_LIMITS)
        .filter(([id]) => isTextModel(id))
        .map(([id, info]) => ({
          id,
          provider: 'unorouter',
          rpm: 60,
          tpm: info.tokens,
          rpd: 5000,
          limit_type: 'per_week',
          weekly_label: info.label,
          source: 'static_table',
        }));
      providerStats.unorouter.live = false;
      providerStats.unorouter.status = 'static_table_only';
      providerStats.unorouter.models_count = models.length;
      return { models, workingKeys: 0 };
    }),

    // 3. AIHubMix
    settleSafe(async () => {
      if (rawAihubmixKeys.length === 0) {
        providerStats.aihubmix.status = 'no_keys_configured';
        return { models: [], workingKeys: 0 };
      }
      const res = await fetchWithTimeout('https://aihubmix.com/v1/models', {
        headers: {
          Authorization: `Bearer ${rawAihubmixKeys[0]}`,
          'Content-Type': 'application/json',
        },
      }, 4000).catch(() => null);
      if (!res || !res.ok) {
        providerStats.aihubmix.status = 'unreachable';
        return { models: [], workingKeys: 0 };
      }
      const data = await res.json();
      const models = (data.data || [])
        .filter(m => isTextModel(m.id || ''))
        .map(m => ({
          id: m.id,
          provider: 'aihubmix',
          rpm: 60,
          tpm: 1000000,
          rpd: 1000,
          limit_type: 'fixed_token_quota',
        }));
      providerStats.aihubmix.live = true;
      providerStats.aihubmix.status = 'live';
      providerStats.aihubmix.models_count = models.length;
      return { models, workingKeys: rawAihubmixKeys.length };
    }),

    // 4. JankRouter
    settleSafe(async () => {
      const res = await fetchWithTimeout('http://jankrouter.waifly.com/v1/models', {}, 4000)
        .catch(() => null);
      if (!res || !res.ok) {
        providerStats.jankrouter.status = 'unreachable';
        return { models: [], workingKeys: 0 };
      }
      const data = await res.json();
      const models = (data.data || [])
        .filter(m => isTextModel(m.id || ''))
        .map(m => ({
          id: m.id,
          provider: 'jankrouter',
          rpm: 30,
          tpm: m.tpm || 64000,
          rpd: 1000,
          limit_type: 'per_minute',
        }));
      providerStats.jankrouter.live = true;
      providerStats.jankrouter.status = 'live';
      providerStats.jankrouter.models_count = models.length;
      return { models, workingKeys: 0 };
    }),

    // 5. FreeAIXYZ
    settleSafe(async () => {
      const res = await fetchWithTimeout(
        'https://freeaixyz4all.vercel.app/api/v1/models', {}, 4000
      ).catch(() => null);
      if (!res || !res.ok) {
        providerStats.freeaixyz.status = 'unreachable';
        return { models: [], workingKeys: 0 };
      }
      const data = await res.json();
      const list = data.data || data.models || data;
      if (!Array.isArray(list)) {
        providerStats.freeaixyz.status = 'unexpected_shape';
        return { models: [], workingKeys: 0 };
      }
      const models = list
        .filter(m => isTextModel(typeof m === 'string' ? m : (m.id || '')))
        .map(m => ({
          id: typeof m === 'string' ? m : m.id,
          provider: 'freeaixyz',
          rpm: 60,
          tpm: 128000,
          rpd: 2000,
          limit_type: 'per_minute',
        }));
      providerStats.freeaixyz.live = true;
      providerStats.freeaixyz.status = 'live';
      providerStats.freeaixyz.models_count = models.length;
      return { models, workingKeys: 0 };
    }),

    // 6. OSAII
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
        .filter(m => isTextModel(typeof m === 'string' ? m : (m.id || '')))
        .map(m => ({
          id: typeof m === 'string' ? m : m.id,
          provider: 'osaii',
          rpm: rawOsaiiKey ? 120 : 60,
          tpm: m.tpm || 256000,
          rpd: 5000,
          limit_type: 'per_minute',
        }));
      providerStats.osaii.live = true;
      providerStats.osaii.status = 'live';
      providerStats.osaii.models_count = models.length;
      return { models, workingKeys: rawOsaiiKey ? 1 : 0 };
    }),

    // 7. Atria
    settleSafe(async () => {
      if (rawAtriaKey) {
        const res = await fetchWithTimeout(
          'https://api.atria-asi.ai/v1/models',
          { headers: { Authorization: `Bearer ${rawAtriaKey}` } },
          4000
        ).catch(() => null);
        if (res && res.ok) {
          providerStats.atria.live = true;
          providerStats.atria.status = 'live';
        } else {
          providerStats.atria.status = 'unreachable';
        }
      } else {
        providerStats.atria.status = 'no_keys_configured';
      }
      const models = [
        {
          id: 'Atria-Dawn-Preview',
          provider: 'atria',
          rpm: 60,
          tpm: 100000000,
          rpd: 5000,
          limit_type: 'fixed_token_quota',
        },
      ];
      providerStats.atria.models_count = models.length;
      return { models, workingKeys: rawAtriaKey ? 1 : 0 };
    }),
  ]);

  for (const r of results) {
    if (r.ok && r.value) {
      allFormattedModels.push(...(r.value.models || []));
      totalWorkingKeys += r.value.workingKeys || 0;
    }
  }

  const liveProviders = Object.entries(providerStats)
    .filter(([, s]) => s.live)
    .map(([name]) => name);

  return jsonResponse({
    object: 'list',
    total_active_keys: totalWorkingKeys,
    verified_free_models_count: allFormattedModels.length,
    diagnostic_report: {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'production',
      total_active_keys: totalWorkingKeys,
      verified_free_models_count: allFormattedModels.length,
      live_providers: liveProviders,
      providers: providerStats,
    },
    data: allFormattedModels,
  });
}
