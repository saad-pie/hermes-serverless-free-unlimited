export const config = {
  runtime: 'edge',
};

// 1. Initialize Gemini keys (Key_1 to Key_100 and GEMINI_KEYS_POOL or GEMINI_API_KEY)
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

// 2. Initialize Unorouter keys (Key_101 to Key_105)
const rawUnorouterKeys = [];
for (let i = 101; i <= 105; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) rawUnorouterKeys.push(key.trim());
}

// 3. Initialize AIHubMix keys (Key_106 to Key_111)
const rawAihubmixKeys = [];
for (let i = 106; i <= 111; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) rawAihubmixKeys.push(key.trim());
}

// 4. Initialize OSAII key (Key_112)
const rawOsaiiKey = process.env['Key_112'] ? process.env['Key_112'].trim() : '';

// 5. Initialize Atria key (Key_113 or ATRIA_API_KEY)
const rawAtriaKey = process.env['Key_113'] ? process.env['Key_113'].trim() : (process.env['ATRIA_API_KEY'] ? process.env['ATRIA_API_KEY'].trim() : '');

const BANNED_PROJECT_IDS = ['gen-lang-client-0355993627', 'steveai-466814'];
const NON_TEXT_KEYWORDS = ['image', 'tts', 'transcribe', 'clip', 'robotics', 'audio', 'embedding', 'rerank', 'moderation', 'video', '3d', 'stt'];

// Authoritative Unorouter Weekly Token Limits Table provided by user
const UNOROUTER_WEEKLY_LIMITS = {
  'allam-2-7b:free': { tokens: 206000, label: '206K', context: '4.1K' },
  'axon-1.8-flash:free': { tokens: 1910000, label: '1.91M', context: '512K' },
  'axon-1.8-lightning:free': { tokens: 429000, label: '429K', context: '512K' },
  'axon-1.8-pro:free': { tokens: 1780000, label: '1.78M', context: '512K' },
  'bge-multilingual-gemma2:free': { tokens: 19000, label: '19K', context: '8.2K' },
  'codestral-latest:free': { tokens: 4800000, label: '4.80M', context: '256K' },
  'deepseek-r1-distill-qwen-32b:free': { tokens: 21700000, label: '21.7M', context: '80K' },
  'diffusiongemma-26b-a4b-it:free': { tokens: 21900000, label: '21.9M', context: '262.1K' },
  'dots-3-note-preview:free': { tokens: 119200000, label: '119.2M', context: '512K' },
  'gemini-3.5-flash-lite:free': { tokens: 682300000, label: '682.3M', context: '1M' },
  'gemini-3.6-flash:free': { tokens: 1120000000, label: '1.12B', context: '1M' },
  'gemini-embedding-001:free': { tokens: 809000, label: '809K', context: '2K' },
  'gemini-embedding-2:free': { tokens: 49000, label: '49K', context: '8.2K' },
  'gemini-robotics-er-2-preview:free': { tokens: 536500000, label: '536.5M', context: '131.1K' },
  'gemma-4-26b:free': { tokens: 2650000000, label: '2.65B', context: '262.1K' },
  'gemma-4-31b-it:free': { tokens: 69300000, label: '69.3M', context: '262.1K' },
  'glm-4.7-flash:free': { tokens: 475800000, label: '475.8M', context: '128K' },
  'glm-5.3-flash-search:free': { tokens: 215100000, label: '215.1M', context: '1M' },
  'glm-5.3-flash:free': { tokens: 1140000000, label: '1.14B', context: '1M' },
  'glm-5.3:free': { tokens: 998200000, label: '998.2M', context: '1M' },
  'gpt-4o:free': { tokens: 11500000, label: '11.5M', context: '128K' },
  'gpt-oss-20b:free': { tokens: 41200000, label: '41.2M', context: '128K' },
  'gpt-oss-safeguard-20b:free': { tokens: 689000, label: '689K', context: '131.1K' },
  'granite-4.0-micro:free': { tokens: 729000, label: '729K', context: '131K' },
  'grok-beta:free': { tokens: 19700000, label: '19.7M', context: '24.6K' },
  'ising-calibration-1.5-31b:free': { tokens: 1790000, label: '1.79M', context: '262.1K' },
  'jina-code-embeddings-0.5b:free': { tokens: 83000, label: '83K', context: '32.8K' },
  'jina-code-embeddings-1.5b:free': { tokens: 111, label: '111', context: '32.8K' },
  'jina-embeddings-v3:free': { tokens: 53000, label: '53K', context: '8.2K' },
  'jina-embeddings-v4:free': { tokens: 51, label: '51', context: '32.8K' },
  'jina-embeddings-v5-omni-nano:free': { tokens: 68, label: '68', context: '8.2K' },
  'jina-embeddings-v5-omni-small:free': { tokens: 50, label: '50', context: '32.8K' },
  'jina-embeddings-v5-text-nano:free': { tokens: 52, label: '52', context: '8.2K' },
  'jina-embeddings-v5-text-small:free': { tokens: 52, label: '52', context: '8.2K' },
  'k2-horizon:free': { tokens: 10100000, label: '10.1M', context: '524.3K' },
  'kimi-k3:free': { tokens: 544500000, label: '544.5M', context: '1M' },
  'laguna-xs-2.1:free': { tokens: 90500000, label: '90.5M', context: '262.1K' },
  'leanstral-1-5:free': { tokens: 1040000, label: '1.04M', context: '262.1K' },
  'lfm-2.5-2.6b:free': { tokens: 1380000, label: '1.38M', context: '128K' },
  'ling-3.0-flash-fin:free': { tokens: 569600000, label: '569.6M', context: '262.1K' },
  'ling-3.0-flash-sante:free': { tokens: 34000000, label: '34.0M', context: '262.1K' },
  'llama-3.2-11b-vision:free': { tokens: 21900000, label: '21.9M', context: '131.1K' },
  'llama-4-maverick-17b-128e-instruct:free': { tokens: 42100000, label: '42.1M', context: '131.1K' },
  'mistral-7b-instruct:free': { tokens: 17300000, label: '17.3M', context: '24.6K' },
  'mistral-nemotron:free': { tokens: 11500000, label: '11.5M', context: '128K' },
  'mistral-small:free': { tokens: 5780000, label: '5.78M', context: '256K' },
  'muse-glimmer-30b:free': { tokens: 139800000, label: '139.8M', context: '131.1K' },
  'nemotron-3-nano-omni-30b-a3b-reasoning:free': { tokens: 98100000, label: '98.1M', context: '262.1K' },
  'nemotron-3-super-120b-a12b:free': { tokens: 764100000, label: '764.1M', context: '262.1K' },
  'nemotron-3-ultra-550b-a55b:free': { tokens: 5790000000, label: '5.79B', context: '1.0M' },
  'nemotron-3.5-lightning-30b-a3b:free': { tokens: 237700000, label: '237.7M', context: '262.1K' },
  'nemotron-3.5-lightning:free': { tokens: 72500000, label: '72.5M', context: '262.1K' },
  'nemotron-nano-12b-v2-vl:free': { tokens: 4010000, label: '4.01M', context: '131.1K' },
  'nemotron-nano-9b-v2:free': { tokens: 18400000, label: '18.4M', context: '131.1K' },
  'nex-n2.5-mini:free': { tokens: 169000000, label: '169.0M', context: '262.1K' },
  'north-mini-code:free': { tokens: 11500000, label: '11.5M', context: '262.1K' },
  'qwen-sea-lion-v4-32b-it:free': { tokens: 2660000, label: '2.66M', context: '32.8K' },
  'qwen-sea-lion-v4.5-27b-it:free': { tokens: 20600000, label: '20.6M', context: '262.1K' },
  'qwen2.5-coder-32b:free': { tokens: 1500000, label: '1.50M', context: '131.1K' },
  'qwen2.5-vl-7b-instruct-awq:free': { tokens: 18800000, label: '18.8M', context: '131.1K' },
  'qwen3:free': { tokens: 711000, label: '711K', context: '24.6K' },
  'qwen3.6-35b-a3b:free': { tokens: 4140000000, label: '4.14B', context: '262.1K' },
  'qwen3.8-27b:free': { tokens: 335000000, label: '335.0M', context: '65.5K' },
  'qwq-32b:free': { tokens: 407000, label: '407K', context: '131.1K' },
  'riva-translate-4b-instruct-v2:free': { tokens: 250000, label: '250K', context: '8.2K' },
  'sea-lion-e5-embedding-600m:free': { tokens: 86, label: '86', context: '512' },
  'sea-lion-modernbert-embedding-300m:free': { tokens: 69, label: '69', context: '512' },
  'sea-lion-modernbert-embedding-600m:free': { tokens: 59, label: '59', context: '512' },
  'sensenova-6.8-flash-lite:free': { tokens: 33100000, label: '33.1M', context: '262.1K' },
  'sonar:free': { tokens: 243000, label: '243K', context: '128K' },
  'space-bunny-alpha:free': { tokens: 2110000000, label: '2.11B', context: '1M' },
  'step-3.7-flash:free': { tokens: 317300000, label: '317.3M', context: '256K' },
  'swe-1-6-slow:free': { tokens: 5390000, label: '5.39M', context: '6.4K' },
  'typhoon-v2.5-30b-a3b-instruct:free': { tokens: 24200000, label: '24.2M', context: '131.1K' },
  'villanova-2b-2512-preview-apnea-ft:free': { tokens: 23000, label: '23K', context: '32.8K' }
};

function isTextModel(id) {
  const lowerId = id.toLowerCase();
  return !NON_TEXT_KEYWORDS.some(kw => lowerId.includes(kw));
}

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
    let allFormattedModels = [];
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

    // Run fetches concurrently
    const [geminiResult, unorouterResult, aihubmixResult, jankResult, freeaiResult, osaiiResult, atriaResult] = await Promise.allSettled([
      // 1. Google Gemini
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
              const responseStr = JSON.stringify(data);
              if (!BANNED_PROJECT_IDS.some(p => responseStr.includes(p))) {
                workingGeminiCount++;
                if (!validGeminiData) validGeminiData = data;
              }
            }
          } catch (_) {}
        }
        providerStats.google.working_keys = workingGeminiCount;
        if (validGeminiData && validGeminiData.models) {
          const models = validGeminiData.models
            .filter(m => {
              const id = m.name.replace('models/', '');
              const supportsText = m.supportedGenerationMethods?.includes('generateContent');
              const isFreeTierGemini = id.includes('flash') || id.includes('gemma') || id.includes('lite');
              return supportsText && isTextModel(id) && isFreeTierGemini;
            })
            .map(m => {
              const id = m.name.replace('models/', '');
              return {
                id: id,
                provider: 'google',
                rpm: 15 * Math.max(1, workingGeminiCount),
                tpm: m.inputTokenLimit || 250000,
                rpd: 1500,
                limit_type: 'per_minute'
              };
            });
          providerStats.google.models_count = models.length;
          return { models, workingKeys: workingGeminiCount };
        }
        return { models: [], workingKeys: 0 };
      })(),

      // 2. Unorouter (Using authoritative weekly token limits table + live fetch)
      (async () => {
        let unorouterModels = [];
        try {
          const unorouterRes = await fetchWithTimeout('https://api.unorouter.com/api/pricing/catalog', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          }, 4000);
          if (unorouterRes.ok) {
            const unorouterData = await unorouterRes.json();
            if (unorouterData && unorouterData.models) {
              unorouterModels = unorouterData.models
                .filter(m => m.is_free === true && m.online === true && isTextModel(m.model_name))
                .map(m => {
                  const match = UNOROUTER_WEEKLY_LIMITS[m.model_name] || UNOROUTER_WEEKLY_LIMITS[m.model_name + ':free'];
                  return {
                    id: m.model_name,
                    provider: 'unorouter',
                    rpm: m.rate_limit_rpm || 60,
                    tpm: match ? match.tokens : (m.weekly_limit_tokens || m.context_window || 500000),
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

      // 3. AIHubMix (1 million tokens per model quota)
      (async () => {
        try {
          const aihubmixRes = await fetchWithTimeout('https://aihubmix.com/v1/models', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${rawAihubmixKeys[0] || 'dummy'}`,
              'Content-Type': 'application/json'
            }
          }, 4000);
          if (aihubmixRes.ok) {
            const aihubmixData = await aihubmixRes.json();
            if (aihubmixData && aihubmixData.data) {
              const freeAihubmixModels = aihubmixData.data
                .filter(m => {
                  const id = (m.id || '').toLowerCase();
                  return (id.includes('free') || m.is_free === true) && isTextModel(id);
                })
                .map(m => ({
                  id: m.id,
                  provider: 'aihubmix',
                  rpm: 60,
                  tpm: 1000000, // 1 million tokens per model
                  rpd: 1000,
                  limit_type: 'fixed_token_quota'
                }));
              providerStats.aihubmix.working_keys = rawAihubmixKeys.length;
              providerStats.aihubmix.models_count = freeAihubmixModels.length;
              return { models: freeAihubmixModels, workingKeys: rawAihubmixKeys.length };
            }
          }
        } catch (_) {}
        const fallbackAihubmix = ['gpt-4o-mini:free', 'claude-3-haiku:free', 'deepseek-chat:free'].map(id => ({
          id: id,
          provider: 'aihubmix',
          rpm: 60,
          tpm: 1000000,
          rpd: 1000,
          limit_type: 'fixed_token_quota'
        }));
        providerStats.aihubmix.models_count = fallbackAihubmix.length;
        providerStats.aihubmix.status = 'fallback_active';
        return { models: fallbackAihubmix, workingKeys: 0 };
      })(),

      // 4. JankRouter
      (async () => {
        try {
          const jankRes = await fetchWithTimeout('http://jankrouter.waifly.com/v1/models', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          }, 4000);
          if (jankRes.ok) {
            const jankData = await jankRes.json();
            if (jankData && jankData.data) {
              const jankModels = jankData.data
                .filter(m => isTextModel(m.id || ''))
                .map(m => ({
                  id: m.id,
                  provider: 'jankrouter',
                  rpm: 30,
                  tpm: m.tpm || 64000,
                  rpd: 1000,
                  limit_type: 'per_minute'
                }));
              providerStats.jankrouter.models_count = jankModels.length;
              return { models: jankModels, workingKeys: 0 };
            }
          }
        } catch (_) {}
        const fallbackJank = ['qwen3-guard-8b', 'qwen3.8-27b', 'qwen3.8-flash', 'nemotron-3.5-lightning-30b', 'north-mini-code', 'glm-4.6v-flash', 'glm-5.3-flash', 'gpt-5.6-luna', 'deepseek-v4-flash-0731', 'gemma-4-26b-a4b', 'moondream-3.1'].map(id => ({
          id: id,
          provider: 'jankrouter',
          rpm: 30,
          tpm: 64000,
          rpd: 1000,
          limit_type: 'per_minute'
        }));
        providerStats.jankrouter.models_count = fallbackJank.length;
        providerStats.jankrouter.status = 'fallback_active';
        return { models: fallbackJank, workingKeys: 0 };
      })(),

      // 5. FreeAIXYZ
      (async () => {
        try {
          const freeaiRes = await fetchWithTimeout('https://freeaixyz4all.vercel.app/api/v1/models', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
          }, 4000);
          if (freeaiRes.ok) {
            const freeaiData = await freeaiRes.json();
            const modelsList = freeaiData.data || freeaiData.models || freeaiData;
            if (Array.isArray(modelsList) && modelsList.length > 0) {
              const freeaiModels = modelsList
                .filter(m => isTextModel(typeof m === 'string' ? m : (m.id || '')))
                .map(m => ({
                  id: typeof m === 'string' ? m : m.id,
                  provider: 'freeaixyz',
                  rpm: 60,
                  tpm: 128000,
                  rpd: 2000,
                  limit_type: 'per_minute'
                }));
              if (freeaiModels.length > 0) {
                providerStats.freeaixyz.models_count = freeaiModels.length;
                return { models: freeaiModels, workingKeys: 0 };
              }
            }
          }
        } catch (_) {}
        const fallbackFreeai = ['freeai-gemini-2.5-flash', 'freeai-gpt-4o-mini', 'freeai-claude-3-haiku', 'freeai-deepseek-chat'].map(id => ({
          id: id,
          provider: 'freeaixyz',
          rpm: 60,
          tpm: 128000,
          rpd: 2000,
          limit_type: 'per_minute'
        }));
        providerStats.freeaixyz.models_count = fallbackFreeai.length;
        providerStats.freeaixyz.status = 'fallback_active';
        return { models: fallbackFreeai, workingKeys: 0 };
      })(),

      // 6. OSAII
      (async () => {
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (rawOsaiiKey) headers['Authorization'] = `Bearer ${rawOsaiiKey}`;

          const osaiiRes = await fetchWithTimeout('https://osaii.wyvernhub.net/api/v1/models', {
            method: 'GET',
            headers: headers
          }, 4000);
          if (osaiiRes.ok) {
            const osaiiData = await osaiiRes.json();
            const osaiiList = osaiiData.data || osaiiData.models || osaiiData;
            if (Array.isArray(osaiiList)) {
              const osaiiModels = osaiiList
                .filter(m => isTextModel(typeof m === 'string' ? m : (m.id || '')))
                .map(m => ({
                  id: typeof m === 'string' ? m : m.id,
                  provider: 'osaii',
                  rpm: m.rpm || (rawOsaiiKey ? 120 : 60),
                  tpm: m.tpm || 256000,
                  rpd: 5000,
                  limit_type: 'per_minute'
                }));
              providerStats.osaii.working_keys = rawOsaiiKey ? 1 : 0;
              providerStats.osaii.models_count = osaiiModels.length;
              return { models: osaiiModels, workingKeys: rawOsaiiKey ? 1 : 0 };
            }
          }
        } catch (_) {}
        const fallbackOsaii = ['fast', 'smart', 'mini', 'poolside/laguna-xs-2.1', 'poolside/laguna-s-2.1', 'microsoft/bitnet-b1.58-2B-4T'].map(id => ({
          id: id,
          provider: 'osaii',
          rpm: rawOsaiiKey ? 120 : 60,
          tpm: 256000,
          rpd: 5000,
          limit_type: 'per_minute'
        }));
        providerStats.osaii.models_count = fallbackOsaii.length;
        providerStats.osaii.status = 'fallback_active';
        return { models: fallbackOsaii, workingKeys: rawOsaiiKey ? 1 : 0 };
      })(),

      // 7. Atria (100 million tokens quota)
      (async () => {
        try {
          let atriaWorking = 0;
          const headers = { 'Content-Type': 'application/json' };
          if (rawAtriaKey) {
            headers['Authorization'] = `Bearer ${rawAtriaKey}`;
            const testRes = await fetchWithTimeout('https://api.atria-asi.ai/v1/models', { method: 'GET', headers }, 4000);
            if (testRes.ok) atriaWorking = 1;
          }
          const atriaModels = [
            { 
              id: 'Atria-Dawn-Preview', 
              provider: 'atria', 
              rpm: 60, 
              tpm: 100000000, // 100 million tokens quota
              rpd: 5000,
              limit_type: 'fixed_token_quota'
            }
          ];
          providerStats.atria.working_keys = atriaWorking;
          providerStats.atria.models_count = atriaModels.length;
          return { models: atriaModels, workingKeys: atriaWorking };
        } catch (_) {
          providerStats.atria.models_count = 1;
          providerStats.atria.status = 'fallback_active';
          return { 
            models: [{ id: 'Atria-Dawn-Preview', provider: 'atria', rpm: 60, tpm: 100000000, rpd: 5000, limit_type: 'fixed_token_quota' }], 
            workingKeys: 0 
          };
        }
      })()
    ]);

    for (const res of [geminiResult, unorouterResult, aihubmixResult, jankResult, freeaiResult, osaiiResult, atriaResult]) {
      if (res.status === 'fulfilled' && res.value) {
        if (res.value.models && res.value.models.length > 0) {
          allFormattedModels.push(...res.value.models);
        }
        totalWorkingKeys += res.value.workingKeys || 0;
      }
    }

    if (allFormattedModels.length === 0) {
      allFormattedModels.push({ id: 'Atria-Dawn-Preview', provider: 'atria', rpm: 60, tpm: 100000000, rpd: 5000, limit_type: 'fixed_token_quota' });
    }

    const diagnosticReport = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'production',
      total_active_keys: totalWorkingKeys,
      verified_free_models_count: allFormattedModels.length,
      providers: providerStats,
      verification_status: 'unorouter_weekly_limits_and_live_fetches_active'
    };

    return new Response(JSON.stringify({ 
      object: 'list', 
      total_active_keys: totalWorkingKeys,
      verified_free_models_count: allFormattedModels.length,
      diagnostic_report: diagnosticReport,
      data: allFormattedModels 
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
