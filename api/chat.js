export const config = {
  runtime: 'edge', 
};

export default async function handler(req) {
  // 1. Handle Preflight CORS requests
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
    const rawKeys = process.env.GEMINI_KEYS_POOL || '';
    const keysPool = rawKeys.split(',').map(k => k.trim()).filter(Boolean);

    if (keysPool.length === 0) {
      return new Response(JSON.stringify({ error: 'API key pool is empty. Please set GEMINI_KEYS_POOL.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Smart Random Index Load Distribution across your 100 keys
    const randomIndex = Math.floor(Math.random() * keysPool.length);
    const selectedGeminiKey = keysPool[randomIndex];

    const body = await req.json();

    // 2. Forward payload to Google's standard OpenAI-compatible layer
    const googleResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${selectedGeminiKey}`,
      },
      body: JSON.stringify(body),
    });

    // 3. Preserve Google's streaming headers perfectly so Hermes reads output data natively
    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Content-Type', googleResponse.headers.get('Content-Type') || 'application/json');
    if (googleResponse.headers.get('Transfer-Encoding')) {
      responseHeaders.set('Transfer-Encoding', googleResponse.headers.get('Transfer-Encoding'));
    }

    return new Response(googleResponse.body, {
      status: googleResponse.status,
      headers: responseHeaders,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy Edge routing failure', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
