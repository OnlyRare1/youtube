// Rare Tool Area - API proxy (Cloudflare Worker)
// Keeps the Gemini and YouTube API keys OFF your website and OFF GitHub.
//
// Secrets (set in Cloudflare, never in this file):
//   GEMINI_API_KEY    your Google AI Studio key
//   YOUTUBE_API_KEY   your YouTube Data API v3 key
// Variable:
//   ALLOWED_ORIGIN    your site, e.g. https://onlyrare1.github.io  (comma-separate several)

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const YOUTUBE_URL = 'https://www.googleapis.com/youtube/v3/videos';
const MAX_PROMPT_CHARS = 2000;

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request.headers.get('Origin'), env);
    if (!cors) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);

    // ---- YouTube video lookup: GET /youtube?id=VIDEO_ID ----
    if (url.pathname === '/youtube' && request.method === 'GET') {
      const id = url.searchParams.get('id') || '';
      if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return json({ error: { message: 'Invalid video ID' } }, 400, cors);
      const upstream = await fetch(
        `${YOUTUBE_URL}?part=snippet,statistics,contentDetails&id=${encodeURIComponent(id)}&key=${env.YOUTUBE_API_KEY}`
      );
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    // ---- Gemini generation: POST /gemini ----
    if (url.pathname === '/gemini' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: { message: 'Bad JSON' } }, 400, cors); }
      const text = body && body.contents && body.contents[0] && body.contents[0].parts && body.contents[0].parts[0] && body.contents[0].parts[0].text;
      if (typeof text !== 'string' || !text || text.length > MAX_PROMPT_CHARS) {
        return json({ error: { message: 'Invalid prompt' } }, 400, cors);
      }
      // Forward only what the site needs (fixed model, fixed output type)
      const upstream = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json', ...cors },
      });
    }

    return json({ error: { message: 'Not found' } }, 404, cors);
  },
};
