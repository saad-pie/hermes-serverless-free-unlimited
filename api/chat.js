export const config = {
  runtime: 'edge', // Runs at the network edge—blazing fast, no cold starts, completely free
};

export default async function handler(req) {
  // 1. Handle Preflight CORS requests from your apps
  if (req.method === 'OPTIONS') {
    return new Response('OK', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 2. Extract your pool of keys from the environment variables
    // We parse a single comma-separated string containing your 100 keys
    const rawKeys = process.env.GEMINI_KEYS_POOL || '';
    const keysPool = rawKeys.split(',').map(k => k.trim()).filter(Boolean);

    if (keysPool.length === 0) {
      return new Response(JSON.stringify({ error: 'API key pool is empty. Please set GEMINI_KEYS_POOL.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Smart Rotation: Pull a random key from the 100 keys pool to distribute load evenly
    const randomIndex = Math.floor(Math.random() * keysPool.length);
    const selectedGeminiKey = keysPool[randomIndex];

    // 4. Parse incoming payload from Hermes
    const body = await req.json();

    // 5. Proxy the request directly to Google's OpenAI-compatible endpoint
    const googleResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${selectedGeminiKey}`,
      },
      body: JSON.stringify(body),
    });

    // 6. Return the raw streamed or standard response back to Hermes with standard CORS headers
    return new Response(googleResponse.body, {
      status: googleResponse.status,
      headers: {
        'Content-Type': googleResponse.headers.get('Content-Type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy Edge routing failure', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
        }
