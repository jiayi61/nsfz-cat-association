import { normalizeLedgerRows } from './normalizeLedger.js';
import { fetchTencentSheet } from './tencentDocs.js';

const CACHE_SECONDS = 300;

function allowedOrigins(env) {
  const configured = env.ALLOWED_ORIGINS || 'https://jiayi61.github.io,https://nsfzcat.com';
  return new Set(configured.split(',').map((origin) => origin.trim()).filter(Boolean));
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return { Vary: 'Origin' };
  if (!allowedOrigins(env).has(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function addCors(response, headers) {
  const output = new Response(response.body, response);
  Object.entries(headers).forEach(([name, value]) => output.headers.set(name, value));
  return output;
}

async function buildLedgerResponse(env) {
  const { rows } = await fetchTencentSheet(env);
  const entries = normalizeLedgerRows(rows);
  if (!entries.length) throw new Error('No public ledger entries were produced');
  return new Response(JSON.stringify({
    updatedAt: new Date().toISOString(),
    source: 'tencent-docs',
    entries,
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function handleLedgerRequest(request, env, context) {
  const cors = corsHeaders(request, env);
  if (!cors) return new Response('Forbidden', { status: 403 });

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'GET') return addCors(new Response('Method Not Allowed', { status: 405 }), cors);

  const cache = caches.default;
  const cacheKey = new Request(new URL('/ledger', request.url), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return addCors(cached, cors);

  try {
    const response = await buildLedgerResponse(env);
    context.waitUntil(cache.put(cacheKey, response.clone()));
    return addCors(response, cors);
  } catch (_) {
    return addCors(new Response(JSON.stringify({ error: 'ledger_unavailable' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    }), cors);
  }
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    if (url.pathname === '/ledger') return handleLedgerRequest(request, env, context);
    return new Response('Not Found', { status: 404 });
  },
};
