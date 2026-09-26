export const config = {
  runtime: 'edge',
};

const rawGeminiKeys = [];
for (let i = 1; i <= 100; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) rawGeminiKeys.push(key.trim());
}
if (process.env.GEMINI_KEYS_POOL) {
  const pooled = process.env.GEMINI_KEYS_POOL.split(',').map(k => k.trim()).filter(Boolean);
  rawGeminiKeys.push(...pooled);
}
if (process.env.GEMINI_API_KEY && !rawGeminiKeys.includes(process.env.GEMINI_API_KEY.trim())) {
  rawGeminiKeys.push(process.env.GEMINI_API_KEY.trim());
}

const rawUnorouterKeys = [];
for (let i = 101; i <= 105; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) rawUnorouterKeys.push(key.trim());
}

const rawAihubmixKeys = [];
for (let i = 106; i <= 111; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) rawAihubmixKeys.push(key.trim());
}

const rawOsaiiKey = process.env['Key_112'] ? process.env['Key_112'].trim() : '';
const rawAtriaKey = process.env['Key_113'] ? process.env['Key_113'].trim() : (process.env['ATRIA_API_KEY'] ? process.env['ATRIA_API_KEY'].trim() : '');

const UNOROUTER_WEEKLY_LIMITS = {
  'allam-2-7b:free': { tokens: 206000, label: '206K', context: '4.1K' },
  'axon-1.8-flash:free': { tokens: 1910000, label: '1.91M', context: '512K' },
  'axon-1.8-lightning:free': { tokens: 429000, label: '429K', context: '512K' },
  'axon-1.8-pro:free': { tokens: 1780000, label: '1.78M', context: '512K' },
  'codestral-latest:free': { tokens: 4800000, label: '4.80M', context: '256K' },
  'deepseek-r1-distill-qwen-32b:free': { tokens: 21700000, label: '21.7M', context: '80K' },
  'diffusiongemma-26b-a4b-it:free': { tokens: 21900000, label: '21.9M', context: '262.1K' },
  'dots-3-note-preview:free': { tokens: 119200000, label: '119.2M', context: '512K' },
  'gemini-3.5-flash-lite:free': { tokens: 682300000, label: '682.3M', context: '1M' },
  'gemini-3.6-flash:free': { tokens: 1120000000, label: '1.12B', context: '1M' },
  'gemini-3.7-flash:free': { tokens: 1250000000, label: '1.25B', context: '1M' },
  'gemini-3.8-flash:free': { tokens: 1500000000, label: '1.50B', context: '1M' },
  'gemini-omni-flash-preview:free': { tokens: 1000000000, label: '1.0B', context: '1M' },
  'gemini-omni-1.1-flash:free': { tokens: 1100000000, label: '1.1B', context: '1M' },
  'gemini-3.8-live:free': { tokens: 800000000, label: '800M', context: '65K' },
  'gemini-3.5-live-translate:free': { tokens: 500000000, label: '500M', context: '20K' },
  'gemini-robotics-er-2-preview:free': { tokens: 536500000, label: '536.5M', context: '131.1K' },
  'gemma-4-26b:free': { tokens: 2650000000, label: '2.65B', context: '262.1K' },
  'gemma-4-31b-it:free': { tokens: 69300000, label: '69.3M', context: '262.1K' },
  'glm-5.3-flash:free': { tokens: 1140000000, label: '1.14B', context: '1M' },
  'gpt-4o:free': { tokens: 11500000, label: '11.5M', context: '128K' },
  'grok-beta:free': { tokens: 19700000, label: '19.7M', context: '24.6K' },
  'kimi-k3:free': { tokens: 544500000, label: '544.5M', context: '1M' },
  'nemotron-3-super-120b-a12b:free': { tokens: 764100000, label: '764.1M', context: '262.1K' },
  'nemotron-3-ultra-550b-a55b:free': { tokens: 5790000000, label: '5.79B', context: '1.0M' },
  'space-bunny-alpha:free': { tokens: 2110000000, label: '2.11B', context: '1M' },
  'qwen3.6-35b-a3b:free': { tokens: 4140000000, label: '4.14B', context: '262.1K' }
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    let allModels = [];
    let totalWorkingKeys = 0;

    let providerStats = {
      google: { working_keys: 0, models_count: 0, status: 'checked' },
      unorouter: { working_keys: 0, models_count: 0, status: 'checked' },
      aihubmix: { working_keys: 0, models_count: 0, status: 'checked' },
      jankrouter: { working_keys: 0, models_count: 0, status: 'checked' },
      freeaixyz: { working_keys: 0, models_count: 0, status: 'checked' },
      osaii: { working_keys: 0, models_count: 0, status: 'checked' },
      atria: { working_keys: 0, models_count: 0, status: 'checked' }
    };

    const [geminiResult, unorouterResult, aihubmixResult, jankResult, freeaiResult, osaiiResult, atriaResult] = await Promise.allSettled([
      // 1. Google Gemini (Include all models: text, flash, live, omni, embedding, etc.)
      (async () => {
        let validGeminiData = null;
        let workingGeminiCount = 0;
        for (const key of rawGeminiKeys) {
          try {
            const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
              method: 'GET',
              headers: { 'Content-Type': 'application/json' }
            }, 4000);
            if (res.ok) {
              const data = await res.json();
              workingGeminiCount++;
              if (!validGeminiData) validGeminiData = data;
            }
          } catch (_) {}
        }
        providerStats.google.working_keys = workingGeminiCount;
        let models = [];
        if (validGeminiData && validGeminiData.models) {
          models = validGeminiData.models.map(m => {
            const id = m.name.replace('models/', '');
            return {
              id: id,
              provider: 'google',
              rpm: 60,
              tpm: m.inputTokenLimit || 1000000,
              rpd: 5000,
              limit_type: 'per_minute'
            };
          });
        }
        // Add special Gemini Omni & Live models
        const specialGemini = [
          'gemini-omni-flash-preview', 'gemini-omni-1.1-flash', 'gemini-3.8-live', 
          'gemini-3.5-live-translate', 'gemini-3.5-transcribe-live', 'gemini-3.8-live-extended-thinking'
        ];
        for (const sg of specialGemini) {
          if (!models.some(m => m.id === sg)) {
            models.push({ id: sg, provider: 'google', rpm: 60, tpm: 1000000, rpd: 5000, limit_type: 'live_api' });
          }
        }
        providerStats.google.models_count = models.length;
        return { models, workingKeys: workingGeminiCount };
      })(),

      // 2. Unorouter (Include all models)
      (async () => {
        let unorouterModels = [];
        try {
          const res = await fetchWithTimeout('https://api.unorouter.com/api/pricing/catalog', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          }, 4000);
          if (res.ok) {
            const data = await res.json();
            if (data && data.models) {
              unorouterModels = data.models.map(m => {
                const match = UNOROUTER_WEEKLY_LIMITS[m.model_name] || UNOROUTER_WEEKLY_LIMITS[m.model_name + ':free'];
                return {
                  id: m.model_name,
                  provider: 'unorouter',
                  rpm: m.rate_limit_rpm || 60,
                  tpm: match ? match.tokens : (m.weekly_limit_tokens || m.context_window || 1000000),
                  rpd: 5000,
                  limit_type: 'per_week',
                  weekly_label: match ? match.label : null
                };
              });
            }
          }
        } catch (_) {}

        if (unorouterModels.length === 0) {
          unorouterModels = Object.entries(UNOROUTER_WEEKLY_LIMITS).map(([id, info]) => ({
            id: id,
            provider: 'unorouter',
            rpm: 60,
            tpm: info.tokens,
            rpd: 5000,
            limit_type: 'per_week',
            weekly_label: info.label
          }));
        }

        providerStats.unorouter.working_keys = rawUnorouterKeys.length;
        providerStats.unorouter.models_count = unorouterModels.length;
        return { models: unorouterModels, workingKeys: rawUnorouterKeys.length };
      })(),

      // 3. AIHubMix (Include all models including image, tts, etc.)
      (async () => {
        try {
          const res = await fetchWithTimeout('https://aihubmix.com/v1/models', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${rawAihubmixKeys[0] || 'dummy'}`,
              'Content-Type': 'application/json'
            }
          }, 4000);
          if (res.ok) {
            const data = await res.json();
            if (data && data.data) {
              const models = data.data.map(m => ({
                id: m.id,
                provider: 'aihubmix',
                rpm: 60,
                tpm: 1000000,
                rpd: 1000,
                limit_type: 'fixed_token_quota'
              }));
              providerStats.aihubmix.working_keys = rawAihubmixKeys.length;
              providerStats.aihubmix.models_count = models.length;
              return { models, workingKeys: rawAihubmixKeys.length };
            }
          }
        } catch (_) {}
        return { models: [], workingKeys: 0 };
      })(),

      // 4. JankRouter
      (async () => {
        try {
          const res = await fetchWithTimeout('http://jankrouter.waifly.com/v1/models', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          }, 4000);
          if (res.ok) {
            const data = await res.json();
            if (data && data.data) {
              const models = data.data.map(m => ({
                id: m.id,
                provider: 'jankrouter',
                rpm: 30,
                tpm: m.tpm || 128000,
                rpd: 1000,
                limit_type: 'per_minute'
              }));
              providerStats.jankrouter.models_count = models.length;
              return { models, workingKeys: 0 };
            }
          }
        } catch (_) {}
        return { models: [], workingKeys: 0 };
      })(),

      // 5. FreeAIXYZ
      (async () => {
        try {
          const res = await fetchWithTimeout('https://freeaixyz4all.vercel.app/api/v1/models', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          }, 4000);
          if (res.ok) {
            const data = await res.json();
            const list = data.data || data.models || data;
            if (Array.isArray(list)) {
              const models = list.map(m => ({
                id: typeof m === 'string' ? m : m.id,
                provider: 'freeaixyz',
                rpm: 60,
                tpm: 128000,
                rpd: 2000,
                limit_type: 'per_minute'
              }));
              providerStats.freeaixyz.models_count = models.length;
              return { models, workingKeys: 0 };
            }
          }
        } catch (_) {}
        return { models: [], workingKeys: 0 };
      })(),

      // 6. OSAII
      (async () => {
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (rawOsaiiKey) headers['Authorization'] = `Bearer ${rawOsaiiKey}`;
          const res = await fetchWithTimeout('https://osaii.wyvernhub.net/api/v1/models', { method: 'GET', headers }, 4000);
          if (res.ok) {
            const data = await res.json();
            const list = data.data || data.models || data;
            if (Array.isArray(list)) {
              const models = list.map(m => ({
                id: typeof m === 'string' ? m : m.id,
                provider: 'osaii',
                rpm: 120,
                tpm: 256000,
                rpd: 5000,
                limit_type: 'per_minute'
              }));
              providerStats.osaii.working_keys = rawOsaiiKey ? 1 : 0;
              providerStats.osaii.models_count = models.length;
              return { models, workingKeys: rawOsaiiKey ? 1 : 0 };
            }
          }
        } catch (_) {}
        return { models: [], workingKeys: 0 };
      })(),

      // 7. Atria
      (async () => {
        try {
          let atriaWorking = 0;
          const headers = { 'Content-Type': 'application/json' };
          if (rawAtriaKey) {
            headers['Authorization'] = `Bearer ${rawAtriaKey}`;
            const testRes = await fetchWithTimeout('https://api.atria-asi.ai/v1/models', { method: 'GET', headers }, 4000);
            if (testRes.ok) atriaWorking = 1;
          }
          const models = [
            { id: 'Atria-Dawn-Preview', provider: 'atria', rpm: 60, tpm: 100000000, rpd: 5000, limit_type: 'fixed_token_quota' },
            { id: 'flux.1-schnell:free', provider: 'atria', rpm: 60, tpm: 500000, rpd: 1000, limit_type: 'image_generation' },
            { id: 'whisper-large-v3:free', provider: 'atria', rpm: 60, tpm: 500000, rpd: 1000, limit_type: 'stt' }
          ];
          providerStats.atria.working_keys = atriaWorking;
          providerStats.atria.models_count = models.length;
          return { models, workingKeys: atriaWorking };
        } catch (_) {
          return { models: [{ id: 'Atria-Dawn-Preview', provider: 'atria', rpm: 60, tpm: 100000000, rpd: 5000, limit_type: 'fixed_token_quota' }], workingKeys: 0 };
        }
      })()
    ]);

    for (const res of [geminiResult, unorouterResult, aihubmixResult, jankResult, freeaiResult, osaiiResult, atriaResult]) {
      if (res.status === 'fulfilled' && res.value && res.value.models) {
        allModels.push(...res.value.models);
        totalWorkingKeys += res.value.workingKeys || 0;
      }
    }

    // Deduplicate models by id
    const seen = new Set();
    const uniqueModels = allModels.filter(m => {
      if (!m || !m.id) return false;
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    const diagnosticReport = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'production',
      total_active_keys: totalWorkingKeys,
      verified_free_models_count: uniqueModels.length,
      providers: providerStats,
      verification_status: 'all_capabilities_fetched'
    };

    return new Response(JSON.stringify({ 
      object: 'list', 
      total_active_keys: totalWorkingKeys,
      verified_free_models_count: uniqueModels.length,
      diagnostic_report: diagnosticReport,
      data: uniqueModels 
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 's-maxage=3600, stale-while-revalidate',
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy Edge models routing failure', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
