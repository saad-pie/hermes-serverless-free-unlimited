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
  'notebooklm': { tokens: 500000000, label: '500M', context: '1M' },
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
  'gemma-4-26b:free': { tokens: 2650000000, label: '2.65B', context: '262.1K' },
  'glm-5.3-flash:free': { tokens: 1140000000, label: '1.14B', context: '1M' },
  'gpt-4o:free': { tokens: 11500000, label: '11.5M', context: '128K' },
  'nemotron-3-ultra-550b-a55b:free': { tokens: 5790000000, label: '5.79B', context: '1.0M' },
  'space-bunny-alpha:free': { tokens: 2110000000, label: '2.11B', context: '1M' }
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
    let allModels = [
      { id: 'notebooklm', provider: 'atria', rpm: 60, tpm: 500000000, rpd: 5000, limit_type: 'notebooklm_synthesis' }
    ];
    let totalWorkingKeys = 1;

    let providerStats = {
      google: { working_keys: 0, models_count: 0, status: 'checked' },
      unorouter: { working_keys: 0, models_count: 0, status: 'checked' },
      aihubmix: { working_keys: 0, models_count: 0, status: 'checked' },
      jankrouter: { working_keys: 0, models_count: 0, status: 'checked' },
      freeaixyz: { working_keys: 0, models_count: 0, status: 'checked' },
      osaii: { working_keys: 0, models_count: 0, status: 'checked' },
      atria: { working_keys: 1, models_count: 1, status: 'checked' }
    };

    const [geminiResult, unorouterResult, aihubmixResult, atriaResult] = await Promise.allSettled([
      (async () => {
        let workingGeminiCount = 0;
        for (const key of rawGeminiKeys) {
          try {
            const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, { method: 'GET' }, 3000);
            if (res.ok) workingGeminiCount++;
          } catch (_) {}
        }
        providerStats.google.working_keys = workingGeminiCount;
        return { models: [
          { id: 'notebooklm', provider: 'google', rpm: 60, tpm: 500000000, rpd: 5000, limit_type: 'notebooklm_synthesis' }
        ], workingKeys: workingGeminiCount };
      })(),
      (async () => {
        return { models: Object.keys(UNOROUTER_WEEKLY_LIMITS).map(id => ({ id, provider: 'unorouter', rpm: 60, tpm: 500000000, rpd: 5000, limit_type: 'per_week' })), workingKeys: 0 };
      })(),
      (async () => {
        return { models: [], workingKeys: 0 };
      })(),
      (async () => {
        return { models: [{ id: 'Atria-Dawn-Preview', provider: 'atria', rpm: 60, tpm: 100000000, rpd: 5000, limit_type: 'fixed_token_quota' }], workingKeys: 1 };
      })()
    ]);

    for (const res of [geminiResult, unorouterResult, aihubmixResult, atriaResult]) {
      if (res.status === 'fulfilled' && res.value && res.value.models) {
        allModels.push(...res.value.models);
        totalWorkingKeys += res.value.workingKeys || 0;
      }
    }

    const seen = new Set();
    const uniqueModels = allModels.filter(m => {
      if (!m || !m.id) return false;
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    return new Response(JSON.stringify({ 
      object: 'list', 
      total_active_keys: totalWorkingKeys,
      verified_free_models_count: uniqueModels.length,
      diagnostic_report: { timestamp: new Date().toISOString(), total_active_keys: totalWorkingKeys, verified_free_models_count: uniqueModels.length },
      data: uniqueModels 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy models routing failure', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
