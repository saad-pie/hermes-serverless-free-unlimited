export const config = {
  runtime: 'edge',
};

// Cold-start key pool initialization
const keysPool = [];
for (let i = 1; i <= 100; i++) {
  const key = process.env[`Key_${i}`];
  if (key && key.trim()) keysPool.push(key.trim());
}
if (process.env.GEMINI_KEYS_POOL) {
  const pooled = process.env.GEMINI_KEYS_POOL.split(',').map(k => k.trim()).filter(Boolean);
  keysPool.push(...pooled);
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

  if (keysPool.length === 0) {
    return new Response(JSON.stringify({ error: 'No API keys found in environment variables.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const selectedKey = keysPool[Math.floor(Math.random() * keysPool.length)];

    // Fetch models directly from Google's dynamic models endpoint
    const googleResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${selectedKey}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await googleResponse.json();

    if (!googleResponse.ok) {
      return new Response(JSON.stringify(data), {
        status: googleResponse.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Map fields dynamically extracted directly from Google API response
    const formattedModels = (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => {
        const id = m.name.replace('models/', '');
        
        return {
          id: id,
          // Dynamically read quota properties if exposed by Google's endpoint response
          rpm: m.rateLimits?.requestsPerMinute ?? m.rpm ?? null,
          tpm: m.rateLimits?.tokensPerMinute ?? m.tpm ?? m.inputTokenLimit ?? null,
          rpd: m.rateLimits?.requestsPerDay ?? m.rpd ?? null,
        };
      });

    return new Response(JSON.stringify({ object: 'list', data: formattedModels }), {
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
