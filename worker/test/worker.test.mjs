import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = {
  ALLOWED_ORIGINS: 'https://jiayi61.github.io,https://nsfzcat.com',
  TENCENT_DOCS_CLIENT_ID: 'test-client',
  TENCENT_DOCS_CLIENT_SECRET: 'test-secret',
  TENCENT_DOCS_REFRESH_TOKEN: 'test-refresh',
  TENCENT_DOCS_OPEN_ID: 'test-open-id',
  TENCENT_DOCS_ENCODED_ID: 'DWndhWGJwQ2ljc3dH',
};

function installEmptyCache() {
  globalThis.caches = {
    default: {
      async match() { return undefined; },
      async put() {},
    },
  };
}

function context() {
  return { waitUntil(promise) { return promise; } };
}

test('GET /ledger returns normalized public data with exact-origin CORS', async () => {
  installEmptyCache();
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/oauth/v2/token') {
      return Response.json({ access_token: 'temporary-token', expires_in: 259200, user_id: 'test-open-id' });
    }
    if (url.pathname === '/openapi/drive/v2/util/converter') {
      return Response.json({ ret: 0, data: { fileID: '300000000$TEST' } });
    }
    if (url.pathname.startsWith('/openapi/spreadsheet/v3/files/')) {
      return Response.json({ code: 0, properties: [{ sheetId: 'BB0000', title: '账本' }] });
    }
    if (url.pathname.startsWith('/openapi/sheetbook/v2/')) {
      return Response.json({
        ret: 0,
        data: { values: [
          ['日期', '项目', '分类', '收入', '支出', '净额', '内部备注'],
          ['2026.08.23', '猫粮', '日常支出', '', '44.98', '', '不公开'],
        ] },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const response = await worker.fetch(new Request('https://worker.example/ledger', {
    headers: { Origin: 'https://jiayi61.github.io' },
  }), env, context());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://jiayi61.github.io');
  assert.equal(body.source, 'tencent-docs');
  assert.equal(body.entries[0].expense, 44.98);
  assert.equal(body.entries[0].net, -44.98);
  assert.equal('内部备注' in body.entries[0], false);
  assert.equal(JSON.stringify(body).includes('temporary-token'), false);
});

test('Tencent failure returns a small sanitized 503 response', async () => {
  installEmptyCache();
  globalThis.fetch = async () => new Response('upstream failure details', { status: 500 });
  const response = await worker.fetch(new Request('https://worker.example/ledger', {
    headers: { Origin: 'https://nsfzcat.com' },
  }), env, context());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'ledger_unavailable' });
});

test('unknown browser origins are rejected without a wildcard', async () => {
  installEmptyCache();
  const response = await worker.fetch(new Request('https://worker.example/ledger', {
    headers: { Origin: 'https://untrusted.example' },
  }), env, context());
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});
