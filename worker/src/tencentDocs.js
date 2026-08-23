const TENCENT_DOCS_ORIGIN = 'https://docs.qq.com';
const memoryToken = { accessToken: '', expiresAt: 0 };

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing Worker configuration: ${name}`);
  return value;
}

async function readJson(response, service) {
  if (!response.ok) throw new Error(`${service} returned HTTP ${response.status}`);
  const payload = await response.json();
  const businessCode = payload.ret ?? payload.code;
  if (businessCode !== undefined && Number(businessCode) !== 0) {
    throw new Error(`${service} rejected the request`);
  }
  return payload;
}

async function tencentFetch(url, env, accessToken) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Access-Token': accessToken,
      'Client-Id': required(env, 'TENCENT_DOCS_CLIENT_ID'),
      'Open-Id': required(env, 'TENCENT_DOCS_OPEN_ID'),
    },
  });
  return readJson(response, 'Tencent Docs API');
}

export async function refreshAccessToken(env) {
  const url = new URL('/oauth/v2/token', TENCENT_DOCS_ORIGIN);
  url.searchParams.set('client_id', required(env, 'TENCENT_DOCS_CLIENT_ID'));
  url.searchParams.set('client_secret', required(env, 'TENCENT_DOCS_CLIENT_SECRET'));
  url.searchParams.set('grant_type', 'refresh_token');
  url.searchParams.set('refresh_token', required(env, 'TENCENT_DOCS_REFRESH_TOKEN'));

  const payload = await readJson(await fetch(url, { headers: { Accept: 'application/json' } }), 'Tencent OAuth');
  if (!payload.access_token || !Number.isFinite(Number(payload.expires_in))) {
    throw new Error('Tencent OAuth returned an invalid token');
  }

  const token = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in) * 1000,
  };
  memoryToken.accessToken = token.accessToken;
  memoryToken.expiresAt = token.expiresAt;

  if (env.TOKEN_STORE) {
    await env.TOKEN_STORE.put('tencent-access-token', JSON.stringify(token), {
      expirationTtl: Math.max(60, Math.floor(Number(payload.expires_in) - 60)),
    });
  }
  return token.accessToken;
}

export async function getValidAccessToken(env) {
  const safetyWindow = 60_000;
  if (memoryToken.accessToken && memoryToken.expiresAt > Date.now() + safetyWindow) return memoryToken.accessToken;

  if (env.TOKEN_STORE) {
    const saved = await env.TOKEN_STORE.get('tencent-access-token', 'json');
    if (saved?.accessToken && Number(saved.expiresAt) > Date.now() + safetyWindow) {
      memoryToken.accessToken = saved.accessToken;
      memoryToken.expiresAt = Number(saved.expiresAt);
      return saved.accessToken;
    }
  }
  return refreshAccessToken(env);
}

async function convertEncodedId(env, accessToken) {
  const url = new URL('/openapi/drive/v2/util/converter', TENCENT_DOCS_ORIGIN);
  url.searchParams.set('type', '2');
  url.searchParams.set('value', required(env, 'TENCENT_DOCS_ENCODED_ID'));
  const payload = await tencentFetch(url, env, accessToken);
  const fileId = payload.data?.fileID ?? payload.data?.fileId;
  if (!fileId) throw new Error('Tencent Docs did not return a fileID');
  return fileId;
}

async function getSheet(env, accessToken, fileId) {
  const url = new URL(`/openapi/spreadsheet/v3/files/${encodeURIComponent(fileId)}`, TENCENT_DOCS_ORIGIN);
  url.searchParams.set('concise', '1');
  const payload = await tencentFetch(url, env, accessToken);
  const sheets = payload.properties ?? payload.data?.properties;
  if (!Array.isArray(sheets) || !sheets.length) throw new Error('Tencent Docs did not return any worksheets');

  const configuredId = env.TENCENT_DOCS_SHEET_ID?.trim();
  const configuredName = env.TENCENT_DOCS_SHEET_NAME?.trim();
  const selected =
    (configuredId && sheets.find((sheet) => sheet.sheetId === configuredId)) ||
    (configuredName && sheets.find((sheet) => sheet.title === configuredName)) ||
    (!configuredId && !configuredName ? sheets[0] : null);
  if (!selected?.sheetId) throw new Error('Configured Tencent worksheet was not found');
  return selected;
}

async function getSheetValues(env, accessToken, fileId, sheetId) {
  const rangeEnd = env.TENCENT_DOCS_RANGE_END?.trim() || 'Z2000';
  const range = `${sheetId}!A1:${rangeEnd}`;
  const url = new URL(`/openapi/sheetbook/v2/${encodeURIComponent(fileId)}/values/${encodeURIComponent(range)}`, TENCENT_DOCS_ORIGIN);
  const payload = await tencentFetch(url, env, accessToken);
  const values = payload.data?.values;
  if (!Array.isArray(values)) throw new Error('Tencent Docs did not return worksheet values');
  return values;
}

export async function fetchTencentSheet(env) {
  const accessToken = await getValidAccessToken(env);
  const fileId = await convertEncodedId(env, accessToken);
  const sheet = await getSheet(env, accessToken, fileId);
  const rows = await getSheetValues(env, accessToken, fileId, sheet.sheetId);
  return { rows, sheetId: sheet.sheetId, sheetTitle: sheet.title ?? '' };
}
