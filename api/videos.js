export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response('OK', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    const bodyText = await req.text();
    let bodyJson = {};
    try {
      bodyJson = JSON.parse(bodyText);
    } catch (_) {}

    const model = bodyJson.model || 'notebooklm';
    const prompt = bodyJson.prompt || 'Synthesized NotebookLM Video Overview';
    const theme = bodyJson.Theme || bodyJson.theme || 'Cinematic Synthwave';

    const sampleVideoUrl = 'https://assets.mixkit.co/videos/preview/mixkit-digital-animation-of-screens-and-code-31910-large.mp4';

    return new Response(JSON.stringify({
      created: Math.floor(Date.now() / 1000),
      model: model,
      notebook_id: "nb-syn-9982731",
      theme: theme,
      status: "success",
      data: [
        {
          url: sampleVideoUrl,
          revised_prompt: prompt,
          theme_applied: theme,
          audio_overview: "Generated synthetic audio podcast overview from Google Workspace notes.",
          duration_seconds: 45
        }
      ]
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: 'NotebookLM video generation failed', details: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
