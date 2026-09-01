// FASTRACK managed relay — OpenAI-compatible proxy to Groq.
// Deploy to Vercel; see relay/README.md.

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400'
};

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

// Best-effort per-token minute throttle (resets on cold start; honest limit for free hosting).
const buckets = new Map();
const RATE = { requestsPerMinute: 30, maxTokens: 4096 };

function allow(token) {
  const now = Date.now();
  const bucket = buckets.get(token) ?? { count: 0, windowStart: now };
  if (now - bucket.windowStart > 60000) {
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count += 1;
  buckets.set(token, bucket);
  return bucket.count <= RATE.requestsPerMinute;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
    return res.end();
  }
  if (req.method !== 'POST') {
    return json(res, 405, { error: { message: 'POST only' } });
  }

  const serverKey = process.env.GROQ_API_KEY;
  const clientTokens = (process.env.CLIENT_TOKENS ?? '').split(',').map((t) => t.trim()).filter(Boolean);

  if (!serverKey) {
    return json(res, 500, { error: { message: 'Relay is not configured (missing GROQ_API_KEY)' } });
  }

  const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!clientTokens.includes(auth)) {
    return json(res, 401, { error: { message: 'Invalid relay client token' } });
  }
  if (!allow(auth)) {
    return json(res, 429, {
      error: { message: `Relay rate limit: max ${RATE.requestsPerMinute} requests/minute per token. Please try again in 5s` }
    });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, 400, { error: { message: `Invalid JSON body: ${err.message}` } });
  }

  const allowlist = (process.env.MODEL_ALLOWLIST ?? 'openai/gpt-oss-120b,openai/gpt-oss-20b')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  const forwarded = {
    model: allowlist.includes(body.model) ? body.model : allowlist[0],
    messages: Array.isArray(body.messages) ? body.messages.slice(0, 64) : [],
    temperature: Math.min(Math.max(Number(body.temperature ?? 0.4) || 0.4, 0), 1),
    max_tokens: Math.min(Number(body.max_tokens ?? 2048) || 2048, RATE.maxTokens)
  };

  if (forwarded.messages.length === 0) {
    return json(res, 400, { error: { message: 'messages array is required' } });
  }

  let response;
  try {
    response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serverKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(forwarded)
    });
  } catch (err) {
    return json(res, 502, { error: { message: `Upstream model request failed: ${err.message}` } });
  }

  const payload = await response.text();
  res.statusCode = response.status;
  res.setHeader('Content-Type', 'application/json');
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  res.end(payload);
}
