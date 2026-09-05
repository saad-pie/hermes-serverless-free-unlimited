export const config = {
  runtime: 'edge',
};

// Initialize environment keys
const keysPool = [];
for (let i = 1; i <= 100; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) keysPool.push(key.trim());
}
if (process.env.GEMINI_KEYS_POOL) {
  const pooled = process.env.GEMINI_KEYS_POOL.split(',').map(k => k.trim()).filter(Boolean);
  keysPool.push(...pooled);
}

// Baseline per-key quotas
const BASE_QUOTAS = {
  'gemini-3.5-flash-lite': { rpm: 30, rpd: 1500 },
  'gemini-3.5-flash': { rpm: 15, rpd: 1500 },
  'gemini-3.1-flash-lite': { rpm: 15, rpd: 1000 },
  'gemini-3.6-flash': { rpm: 10, rpd: 1500 },
  'gemini-2.5-flash': { rpm: 15, rpd: 1500 },
  'gemini-2.5-flash-lite': { rpm: 30, rpd: 1500 },
  'gemini-2.5-pro': { rpm: 5, rpd: 50 },
  'gemini-2.0-flash': { rpm: 15, rpd: 1500 },
  'gemma': { rpm: 30, rpd: 14400 },
  'default': { rpm: 15, rpd: 1000 }
};

const NON_TEXT_KEYWORDS = [
  'image', 'tts', 'transcribe', 'clip', 'robotics',
  'computer-use', 'banana', 'deep-research', 'antigravity-preview', 'lyria'
];

function getBaseQuota(id) {
  if (BASE_QUOTAS[id]) return BASE_QUOTAS[id];
  if (id.includes('gemma')) return BASE_QUOTAS.gemma;
  if (id.includes('pro')) return BASE_QUOTAS['gemini-2.5-pro'];
  return BASE_QUOTAS.default;
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

  const activeKeyCount = keysPool.length;
  if (activeKeyCount === 0) {
    return new Response(JSON.stringify({ error: 'No API keys found in environment variables.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    let googleResponse;
    let attempts = 0;
    const maxAttempts = Math.min(5, activeKeyCount);
    const triedIndices = new Set();

    // Retry loop across key pool if suspended/rate-limited keys are hit
    while (attempts < maxAttempts) {
      attempts++;
      let randomIndex;
      do {
        randomIndex = Math.floor(Math.random() * activeKeyCount);
      } while (triedIndices.has(randomIndex) && triedIndices.size < activeKeyCount);

      triedIndices.add(randomIndex);
      const selectedKey = keysPool[randomIndex];

      googleResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${selectedKey}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (googleResponse.ok) {
        break;
      }
    }

    const data = await googleResponse.json();

    if (!googleResponse.ok) {
      return new Response(JSON.stringify(data), {
        status: googleResponse.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const formattedModels = (data.models || [])
      .filter(m => {
        const id = m.name.replace('models/', '').toLowerCase();
        const supportsText = m.supportedGenerationMethods?.includes('generateContent');
        const isNonText = NON_TEXT_KEYWORDS.some(keyword => id.includes(keyword));
        return supportsText && !isNonText;
      })
      .map(m => {
        const id = m.name.replace('models/', '');
        const base = getBaseQuota(id);
        const tpmVal = m.inputTokenLimit || 1048576;

        return {
          id: id,
          rpm: base.rpm * activeKeyCount,
          tpm: tpmVal * activeKeyCount,
          rpd: base.rpd * activeKeyCount
        };
      });

    return new Response(JSON.stringify({ 
      object: 'list', 
      total_active_keys: activeKeyCount,
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
