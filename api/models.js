export const config = {
  runtime: 'edge',
};

// 1. Initialize Gemini keys (Key_1 to Key_100)
const rawGeminiKeys = [];
for (let i = 1; i <= 100; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) rawGeminiKeys.push(key.trim());
}
if (process.env.GEMINI_KEYS_POOL) {
  const pooled = process.env.GEMINI_KEYS_POOL.split(',').map(k => k.trim()).filter(Boolean);
  rawGeminiKeys.push(...pooled);
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

const EXACT_FREE_QUOTAS = {
  'gemini-3.1-flash-lite': { rpm: 15, tpm: 250000, rpd: 500 },
  'gemini-2.5-flash-lite': { rpm: 10, tpm: 250000, rpd: 20 },
  'gemini-2.5-flash': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemini-3-flash-preview': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemini-3.5-flash': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemma-4-26b-a4b-it': { rpm: 30, tpm: 16000, rpd: 14400 },
};

const BANNED_PROJECT_IDS = ['gen-lang-client-0355993627', 'steveai-466814'];
const NON_TEXT_KEYWORDS = ['image', 'tts', 'transcribe', 'clip', 'robotics', 'audio', 'embedding', 'rerank', 'moderation', 'video', '3d', 'stt'];

function isTextModel(id) {
  const lowerId = id.toLowerCase();
  return !NON_TEXT_KEYWORDS.some(kw => lowerId.includes(kw));
}

function getExactQuota(id) {
  if (EXACT_FREE_QUOTAS[id]) return EXACT_FREE_QUOTAS[id];
  if (id.includes('flash')) return { rpm: 5, tpm: 250000, rpd: 20 };
  if (id.includes('gemma')) return { rpm: 30, tpm: 16000, rpd: 14400 };
  return { rpm: 10, tpm: 100000, rpd: 100 };
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

    // 1. Fetch & Validate Gemini Models
    let validGeminiData = null;
    let workingGeminiCount = 0;
    for (const key of rawGeminiKeys) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        const responseStr = JSON.stringify(data);
        if (!BANNED_PROJECT_IDS.some(p => responseStr.includes(p))) {
          workingGeminiCount++;
          if (!validGeminiData) validGeminiData = data;
        }
      }
    }

    if (validGeminiData && validGeminiData.models) {
      const geminiModels = validGeminiData.models
        .filter(m => {
          const id = m.name.replace('models/', '');
          const supportsText = m.supportedGenerationMethods?.includes('generateContent');
          return supportsText && isTextModel(id);
        })
        .map(m => {
          const id = m.name.replace('models/', '');
          const exact = getExactQuota(id);
          return {
            id: id,
            provider: 'google',
            rpm: exact.rpm * workingGeminiCount,
            tpm: exact.tpm * workingGeminiCount,
            rpd: exact.rpd * workingGeminiCount
          };
        });
      allFormattedModels.push(...geminiModels);
      totalWorkingKeys += workingGeminiCount;
    }

    // 2. Fetch Unorouter Free Models Catalog
    try {
      const unorouterRes = await fetch('https://api.unorouter.com/api/pricing/catalog', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      if (unorouterRes.ok) {
        const unorouterData = await unorouterRes.json();
        if (unorouterData && unorouterData.models) {
          const freeUnorouterModels = unorouterData.models
            .filter(m => m.is_free === true && m.online === true && isTextModel(m.model_name))
            .map(m => ({
              id: m.model_name,
              provider: 'unorouter',
              rpm: 30 * Math.max(1, rawUnorouterKeys.length),
              tpm: 150000 * Math.max(1, rawUnorouterKeys.length),
              rpd: 1000 * Math.max(1, rawUnorouterKeys.length)
            }));
          allFormattedModels.push(...freeUnorouterModels);
          totalWorkingKeys += rawUnorouterKeys.length;
        }
      }
    } catch (e) {
      // Ignore if offline
    }

    // 3. Fetch AIHubMix Free Models Catalog
    try {
      const aihubmixRes = await fetch('https://aihubmix.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${rawAihubmixKeys[0] || 'dummy'}`,
          'Content-Type': 'application/json'
        }
      });
      if (aihubmixRes.ok) {
        const aihubmixData = await aihubmixRes.json();
        if (aihubmixData && aihubmixData.data) {
          const freeAihubmixModels = aihubmixData.data
            .filter(m => {
              const id = (m.id || '').toLowerCase();
              const isFreeExplicit = id.includes('free') || m.is_free === true || id.includes('mini') || id.includes('flash');
              return isFreeExplicit && isTextModel(id);
            })
            .map(m => ({
              id: m.id,
              provider: 'aihubmix',
              rpm: 20 * Math.max(1, rawAihubmixKeys.length),
              tpm: 100000 * Math.max(1, rawAihubmixKeys.length),
              rpd: 500 * Math.max(1, rawAihubmixKeys.length)
            }));
          allFormattedModels.push(...freeAihubmixModels);
          totalWorkingKeys += rawAihubmixKeys.length;
        }
      }
    } catch (e) {
      if (rawAihubmixKeys.length > 0) {
        const fallbackAihubmix = ['gpt-4o-mini', 'claude-3-haiku-20240307'].map(id => ({
          id: id,
          provider: 'aihubmix',
          rpm: 20 * rawAihubmixKeys.length,
          tpm: 100000 * rawAihubmixKeys.length,
          rpd: 500 * rawAihubmixKeys.length
        }));
        allFormattedModels.push(...fallbackAihubmix);
        totalWorkingKeys += rawAihubmixKeys.length;
      }
    }

    // 4. Fetch JankRouter Models (Keyless)
    try {
      const jankRes = await fetch('http://jankrouter.waifly.com/v1/models', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      if (jankRes.ok) {
        const jankData = await jankRes.json();
        if (jankData && jankData.data) {
          const jankModels = jankData.data
            .filter(m => isTextModel(m.id || ''))
            .map(m => ({
              id: m.id,
              provider: 'jankrouter',
              rpm: 30,
              tpm: 100000,
              rpd: 1000
            }));
          allFormattedModels.push(...jankModels);
        }
      }
    } catch (e) {
      const fallbackJank = ['qwen3-guard-8b', 'qwen3.8-27b', 'qwen3.8-flash', 'nemotron-3.5-lightning-30b', 'north-mini-code', 'glm-4.6v-flash', 'glm-5.3-flash', 'gpt-5.6-luna', 'deepseek-v4-flash-0731', 'gemma-4-26b-a4b', 'moondream-3.1'].map(id => ({
        id: id,
        provider: 'jankrouter',
        rpm: 30,
        tpm: 100000,
        rpd: 1000
      }));
      allFormattedModels.push(...fallbackJank);
    }

    // 5. Fetch FreeAIXYZ Models (Keyless)
    try {
      const freeaiRes = await fetch('https://freeaixyz4all.vercel.app/api/v1/models', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      if (freeaiRes.ok) {
        const freeaiData = await freeaiRes.json();
        const modelsList = freeaiData.data || freeaiData.models || freeaiData;
        if (Array.isArray(modelsList)) {
          const freeaiModels = modelsList
            .filter(m => {
              const modelId = typeof m === 'string' ? m : (m.id || '');
              return isTextModel(modelId);
            })
            .map(m => {
              const modelId = typeof m === 'string' ? m : m.id;
              return {
                id: modelId,
                provider: 'freeaixyz',
                rpm: 50,
                tpm: 200000,
                rpd: 2000
              };
            });
          allFormattedModels.push(...freeaiModels);
        }
      }
    } catch (e) {
      // Fallback
    }

    // 6. Fetch OSAII Models (Supports Key_112 or anonymous fallback)
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (rawOsaiiKey) headers['Authorization'] = `Bearer ${rawOsaiiKey}`;

      const osaiiRes = await fetch('https://osaii.wyvernhub.net/api/v1/models', {
        method: 'GET',
        headers: headers
      });
      if (osaiiRes.ok) {
        const osaiiData = await osaiiRes.json();
        const osaiiList = osaiiData.data || osaiiData.models || osaiiData;
        if (Array.isArray(osaiiList)) {
          const osaiiModels = osaiiList
            .filter(m => {
              const modelId = typeof m === 'string' ? m : (m.id || '');
              return isTextModel(modelId);
            })
            .map(m => {
              const modelId = typeof m === 'string' ? m : m.id;
              return {
                id: modelId,
                provider: 'osaii',
                rpm: rawOsaiiKey ? 100 : 30,
                tpm: 500000,
                rpd: 5000
              };
            });
          allFormattedModels.push(...osaiiModels);
          if (rawOsaiiKey) totalWorkingKeys += 1;
        }
      }
    } catch (e) {
      // Fallback OSAII standard documented models if endpoint fails
      const fallbackOsaii = ['fast', 'smart', 'mini', 'poolside/laguna-xs-2.1', 'poolside/laguna-s-2.1', 'microsoft/bitnet-b1.58-2B-4T'].map(id => ({
        id: id,
        provider: 'osaii',
        rpm: rawOsaiiKey ? 100 : 30,
        tpm: 500000,
        rpd: 5000
      }));
      allFormattedModels.push(...fallbackOsaii);
      if (rawOsaiiKey) totalWorkingKeys += 1;
    }

    if (allFormattedModels.length === 0) {
      return new Response(JSON.stringify({ error: 'No active models or valid keys found across providers.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    return new Response(JSON.stringify({ 
      object: 'list', 
      total_active_keys: totalWorkingKeys,
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
    
