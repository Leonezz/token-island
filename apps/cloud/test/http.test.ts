/**
 * HTTP-level contract tests: caching (ETag + 304), static pixel fonts, HEAD
 * semantics, 404 shapes and method handling — identical on both runtimes.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { bearer, postJson, registerUser, request, startTestServer, type TestServer } from './helpers.js';

let server: TestServer;
let apiKey = '';

before(async () => {
  server = await startTestServer();
  const user = await registerUser(server.baseUrl, 'httpuser');
  apiKey = user.apiKey;
});

after(async () => {
  await server.cleanup();
});

test('SVG responses carry a content-hash ETag and honour If-None-Match with 304', async () => {
  const first = await request(server.baseUrl, '/u/httpuser/badge.svg?metric=tokens');
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.ok(etag, 'ETag header missing');
  assert.match(etag, /^"[0-9a-f]{64}"$/);

  const cached = await request(server.baseUrl, '/u/httpuser/badge.svg?metric=tokens', {
    headers: { 'if-none-match': etag },
  });
  assert.equal(cached.status, 304);
  assert.equal(cached.text, '');
  assert.equal(cached.headers.get('etag'), etag);
});

test('HEAD returns headers without a body for HTML, JSON and SVG', async () => {
  for (const path of ['/healthz', '/u/httpuser', '/u/httpuser/badge.svg', '/fonts/Silkscreen-Regular.ttf']) {
    const result = await request(server.baseUrl, path, { method: 'HEAD' });
    assert.equal(result.status, 200, path);
    assert.equal(result.text, '', `${path}: HEAD body must be empty`);
  }
});

test('pixel fonts are served from /fonts/* with the right content type', async () => {
  for (const [file, type] of [
    ['Silkscreen-Regular.ttf', 'font/ttf'],
    ['Silkscreen-Bold.ttf', 'font/ttf'],
    ['VT323-Regular.ttf', 'font/ttf'],
    ['OFL-ofl-silkscreen.txt', 'text/plain'],
  ] as const) {
    const response = await fetch(`${server.baseUrl}/fonts/${file}`);
    assert.equal(response.status, 200, file);
    assert.match(String(response.headers.get('content-type')), new RegExp(type), file);
    assert.match(String(response.headers.get('cache-control')), /public, max-age=3600/, file);
    const bytes = await response.arrayBuffer();
    assert.ok(bytes.byteLength > 1000, `${file}: body looks empty`);
  }
  // Dashboard uses self-contained system/tabular-mono stacks (no external font CDN).
  const dashboard = await request(server.baseUrl, '/u/httpuser');
  assert.match(dashboard.text, /font-variant-numeric:\s*tabular-nums/);
  assert.doesNotMatch(dashboard.text, /fonts\.googleapis\.com/);

  const traversal = await fetch(`${server.baseUrl}/fonts/..%2F..%2Fpackage.json`);
  assert.equal(traversal.status, 404);
});

test('unknown users: 404 HTML page, 404 pixel SVG assets with a NO DATA label', async () => {
  for (const [path, contentType] of [
    ['/u/no-such-user/badge.svg', /image\/svg\+xml/],
    ['/u/no-such-user/chart.svg', /image\/svg\+xml/],
    ['/u/no-such-user/card.svg', /image\/svg\+xml/],
  ] as const) {
    const result = await request(server.baseUrl, path);
    assert.equal(result.status, 404, path);
    assert.match(String(result.headers.get('content-type')), contentType);
    assert.match(result.text, /^<svg /);
    assert.match(result.text, /NO DATA|unknown user/i);
    assert.match(String(result.headers.get('cache-control')), /public, max-age=60/);
  }
  const page = await request(server.baseUrl, '/u/no-such-user');
  assert.equal(page.status, 404);
  assert.match(page.text, /Profile not found/);
});

test('ingest/auth/me round trip survives the shared Web-API handler', async () => {
  const me = await request(server.baseUrl, '/api/v1/me', { headers: bearer(apiKey) });
  assert.equal(me.status, 200);
  assert.equal(me.json.username, 'httpuser');

  const ingest = await postJson(
    server.baseUrl,
    '/api/v1/ingest',
    {
      days: [
        {
          date: new Date().toISOString().slice(0, 10),
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheWriteTokens: 40,
          totalTokens: 999,
          costUsd: 0.5,
          messages: 2,
        },
      ],
    },
    bearer(apiKey),
  );
  assert.equal(ingest.status, 200);
  assert.equal(ingest.json.ok, true);

  const badge = await request(server.baseUrl, '/u/httpuser/badge.svg?metric=day');
  assert.equal(badge.status, 200);
});

test('favicon is a bare 204 and unknown API routes are JSON 404s', async () => {
  const favicon = await request(server.baseUrl, '/favicon.ico');
  assert.equal(favicon.status, 204);

  const missing = await request(server.baseUrl, '/api/v1/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'not_found');

  const badPost = await postJson(server.baseUrl, '/api/v1/nope', {});
  assert.equal(badPost.status, 404);
});

test('unsupported methods return 405 with an Allow header', async () => {
  const put = await request(server.baseUrl, '/api/v1/ingest', { method: 'PUT' });
  assert.equal(put.status, 405);
  assert.equal(put.json.error.code, 'method_not_allowed');
  assert.match(String(put.headers.get('allow')), /GET, HEAD, POST/);
});
