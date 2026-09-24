export const config = {
  runtime: 'edge',
};

// Initialize Gemini keys (Key_1 to Key_100)
const rawGeminiKeys = [];
for (let i = 1; i <= 100; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) rawGeminiKeys.push(key.trim());
}
if (process.env.GEMINI_KEYS_POOL) {
  const pooled = process.env.GEMINI_KEYS_POOL.split(',').map(k => k.trim()).filter(Boolean);
  rawGeminiKeys.push(...pooled);
}

// Initialize Unorouter keys (Key_101 to Key_106)
const rawUnorouterKeys = [];
for (let i = 101; i <= 106; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) rawUnorouterKeys.push(key.trim());
}

const EXACT_FREE_QUOTAS = {
  'gemini-3.1-flash-lite': { rpm: 15, tpm: 250000, rpd: 500 },
  'gemini-2.5-flash-lite': { rpm: 10, tpm: 250000, rpd: 20 },
  'gemini-2.5-flash': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemini-3-flash-preview': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemini-3.5-flash': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemma-4-26b-a4b-it': { rpm: 30, tpm: 16000, rpd: 14400 },
};

const BANNED_PROJECT_IDS = ['gen-lang-client-0355993627', 'steveai-466814'];
const NON_TEXT_KEYWORDS = ['image', 'tts', 'transcribe', 'clip', 'robotics', 'audio'];

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
          const id = m.name.replace('models/', '').toLowerCase();
          const supportsText = m.supportedGenerationMethods?.includes('generateContent');
          return supportsText && !NON_TEXT_KEYWORDS.some(kw => id.includes(kw));
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

    // 2. Fetch Unorouter Free Models Catalog (Public endpoint: no key required!)
    try {
      const unorouterRes = await fetch('https://api.unorouter.com/api/pricing/catalog', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      if (unorouterRes.ok) {
        const unorouterData = await unorouterRes.json();
        if (unorouterData && unorouterData.models) {
          const freeUnorouterModels = unorouterData.models
            .filter(m => m.is_free === true && m.online === true)
            .map(m => ({
              id: `${m.model_name}:free`,
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
      // Ignore unorouter catalog fetch errors if offline
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
