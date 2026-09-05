export const config = {
  runtime: 'edge',
};

// Initialize environment keys
const rawKeysPool = [];
for (let i = 1; i <= 100; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) rawKeysPool.push(key.trim());
}
if (process.env.GEMINI_KEYS_POOL) {
  const pooled = process.env.GEMINI_KEYS_POOL.split(',').map(k => k.trim()).filter(Boolean);
  rawKeysPool.push(...pooled);
}

// Actual Free Tier Quotas from AI Studio Console
const EXACT_FREE_QUOTAS = {
  'gemini-3.1-flash-lite': { rpm: 15, tpm: 250000, rpd: 500 },
  'gemini-3.1-flash-lite-preview': { rpm: 15, tpm: 250000, rpd: 500 },
  'gemini-3.5-flash-lite': { rpm: 15, tpm: 250000, rpd: 500 },
  'gemini-2.5-flash-lite': { rpm: 10, tpm: 250000, rpd: 20 },
  'gemini-2.5-flash': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemini-3-flash-preview': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemini-3.5-flash': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemini-3.6-flash': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemini-3.7-flash': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemini-3.8-flash': { rpm: 5, tpm: 250000, rpd: 20 },
  'gemma-4-26b-a4b-it': { rpm: 30, tpm: 16000, rpd: 14400 },
  'gemma-4-31b-it': { rpm: 30, tpm: 16000, rpd: 14400 },
  'gemini-2.5-pro': { rpm: 0, tpm: 0, rpd: 0 },
  'gemini-3.1-pro-preview': { rpm: 0, tpm: 0, rpd: 0 }
};

const BANNED_PROJECT_IDS = ['gen-lang-client-0355993627', 'steveai-466814'];

const NON_TEXT_KEYWORDS = [
  'image', 'tts', 'transcribe', 'clip', 'robotics',
  'computer-use', 'banana', 'deep-research', 'antigravity-preview', 
  'lyria', 'live', 'omni', 'audio'
];

function getExactQuota(id) {
  if (EXACT_FREE_QUOTAS[id]) return EXACT_FREE_QUOTAS[id];
  if (id.includes('flash-lite')) return { rpm: 15, tpm: 250000, rpd: 500 };
  if (id.includes('flash')) return { rpm: 5, tpm: 250000, rpd: 20 };
  if (id.includes('gemma')) return { rpm: 30, tpm: 16000, rpd: 14400 };
  return { rpm: 0, tpm: 0, rpd: 0 };
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

  if (rawKeysPool.length === 0) {
    return new Response(JSON.stringify({ error: 'No API keys found.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    let validModelsData = null;
    let workingKeyCount = 0;

    // Probe keys in pool to test validity & eliminate revoked project IDs
    for (const key of rawKeysPool) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const errStr = JSON.stringify(errJson);
        // Skip revoked keys or blacklisted project keys
        if (BANNED_PROJECT_IDS.some(p => errStr.includes(p))) continue;
        if (res.status === 403 || res.status === 400) continue;
      } else {
        const data = await res.json();
        const responseStr = JSON.stringify(data);

        // Check if response belongs to banned projects
        if (BANNED_PROJECT_IDS.some(p => responseStr.includes(p))) {
          continue;
        }

        workingKeyCount++;
        if (!validModelsData) {
          validModelsData = data;
        }
      }
    }

    if (workingKeyCount === 0 || !validModelsData) {
      return new Response(JSON.stringify({ 
        error: 'No active/valid keys remaining. Check key permissions or project status.' 
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Filter text-only models and compute cumulative limits across working keys
    const formattedModels = (validModelsData.models || [])
      .filter(m => {
        const id = m.name.replace('models/', '').toLowerCase();
        const supportsText = m.supportedGenerationMethods?.includes('generateContent');
        const isNonText = NON_TEXT_KEYWORDS.some(keyword => id.includes(keyword));
        return supportsText && !isNonText;
      })
      .map(m => {
        const id = m.name.replace('models/', '');
        const exact = getExactQuota(id);

        return {
          id: id,
          rpm: exact.rpm * workingKeyCount,
          tpm: exact.tpm * workingKeyCount,
          rpd: exact.rpd * workingKeyCount
        };
      });

    return new Response(JSON.stringify({ 
      object: 'list', 
      total_active_keys: workingKeyCount,
      data: formattedModels 
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
