/**
 * API contract tests: register → ingest → me, auth, validation, latest-wins,
 * public stats, the 400 KB body limit and graceful error shapes.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  bearer,
  jsonHeaders,
  postJson,
  recentDateKeys,
  registerUser,
  request,
  sampleDay,
  startTestServer,
  todayKey,
  type TestServer,
} from './helpers.js';

let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.cleanup();
});

test('GET /healthz reports users, days and uptime', async () => {
  const result = await request(server.baseUrl, '/healthz');
  assert.equal(result.status, 200);
  assert.match(String(result.headers.get('content-type')), /application\/json/);
  assert.equal(result.json.ok, true);
  assert.equal(typeof result.json.users, 'number');
  assert.equal(typeof result.json.days, 'number');
  assert.equal(typeof result.json.uptimeSec, 'number');
});

test('HEAD /healthz returns headers without a body', async () => {
  const result = await request(server.baseUrl, '/healthz', { method: 'HEAD' });
  assert.equal(result.status, 200);
  assert.equal(result.text, '');
});

test('POST /api/v1/register creates a random profile and returns the key once', async () => {
  const result = await postJson(server.baseUrl, '/api/v1/register', {});
  assert.equal(result.status, 201);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.match(result.json.username, /^ti-[0-9a-z]{6}$/);
  assert.match(result.json.apiKey, /^ti_[0-9a-f]{32}$/);
  assert.match(result.json.ingest, /\/api\/v1\/ingest$/);
  assert.equal(result.json.docs, `/u/${result.json.username}`);
  for (const key of ['tokens', 'cost', 'streak', 'chart', 'card']) {
    assert.equal(typeof result.json.badges[key], 'string', `badges.${key} missing`);
    assert.match(result.json.badges[key], /^http:\/\/127\.0\.0\.1:\d+\/u\//);
  }
  // The key is never returned again: /me requires it but does not echo it.
  const me = await request(server.baseUrl, '/api/v1/me', {
    headers: bearer(result.json.apiKey as string),
  });
  assert.equal(me.status, 200);
  assert.equal(me.json.username, result.json.username);
  assert.equal(me.json.apiKey, undefined);
});

test('POST /api/v1/register validates usernames and rejects duplicates', async () => {
  const first = await postJson(server.baseUrl, '/api/v1/register', {
    username: 'test-user_1',
    displayName: 'Test User',
  });
  assert.equal(first.status, 201);
  assert.equal(first.json.username, 'test-user_1');
  assert.equal(first.json.displayName, 'Test User');

  const duplicate = await postJson(server.baseUrl, '/api/v1/register', { username: 'test-user_1' });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.json.error.code, 'username_taken');

  for (const username of ['ab', 'Demo', 'has space', 'way-too-long-'.repeat(3), 'emoji🙂']) {
    const invalid = await postJson(server.baseUrl, '/api/v1/register', { username });
    assert.equal(invalid.status, 400, `username ${JSON.stringify(username)} should be rejected`);
    assert.equal(invalid.json.error.code, 'invalid_username');
  }
});

test('registration can be locked with an admin token', async () => {
  const locked = await startTestServer({ adminToken: 'super-secret-admin' });
  try {
    const anonymous = await postJson(locked.baseUrl, '/api/v1/register', { username: 'nope' });
    assert.equal(anonymous.status, 401);
    const wrong = await postJson(locked.baseUrl, '/api/v1/register', { username: 'nope' }, {
      authorization: 'Bearer not-the-token',
    });
    assert.equal(wrong.status, 401);
    const allowed = await postJson(locked.baseUrl, '/api/v1/register', { username: 'admin-made' }, {
      authorization: 'Bearer super-secret-admin',
    });
    assert.equal(allowed.status, 201);
  } finally {
    await locked.cleanup();
  }

  const closed = await startTestServer({ allowRegister: false });
  try {
    const disabled = await postJson(closed.baseUrl, '/api/v1/register', { username: 'nope' });
    assert.equal(disabled.status, 403);
    assert.equal(disabled.json.error.code, 'registration_disabled');
  } finally {
    await closed.cleanup();
  }
});

test('bearer authentication is required for /me and /ingest', async () => {
  const user = await registerUser(server.baseUrl, 'auth-check');

  const noHeader = await request(server.baseUrl, '/api/v1/me');
  assert.equal(noHeader.status, 401);
  assert.equal(noHeader.json.error.code, 'unauthorized');

  const badKey = await request(server.baseUrl, '/api/v1/me', {
    headers: bearer('ti_00000000000000000000000000000000'),
  });
  assert.equal(badKey.status, 401);

  const garbage = await request(server.baseUrl, '/api/v1/me', {
    headers: { authorization: 'Basic dXNlcjpwYXNz' },
  });
  assert.equal(garbage.status, 401);

  const ingestNoAuth = await postJson(server.baseUrl, '/api/v1/ingest', { days: [] });
  assert.equal(ingestNoAuth.status, 401);
});

test('POST /api/v1/ingest validates the payload with JSON 400 errors', async () => {
  const user = await registerUser(server.baseUrl, 'ingest-validation');
  const headers = bearer(user.apiKey);
  const date = todayKey();

  const cases: Array<{ payload: unknown; label: string }> = [
    { payload: {}, label: 'missing days' },
    { payload: { days: 'nope' }, label: 'days not an array' },
    { payload: { days: [null] }, label: 'day not an object' },
    { payload: { days: [{ ...sampleDay(date), date: '2026-13-40' }] }, label: 'invalid calendar date' },
    { payload: { days: [{ ...sampleDay(date), date: '24-11-2026' }] }, label: 'invalid date format' },
    { payload: { days: [{ ...sampleDay(date), inputTokens: -1 }] }, label: 'negative tokens' },
    { payload: { days: [{ ...sampleDay(date), costUsd: -0.5 }] }, label: 'negative cost' },
    { payload: { days: [{ ...sampleDay(date), messages: -2 }] }, label: 'negative messages' },
    { payload: { days: [{ ...sampleDay(date), outputTokens: 'many' }] }, label: 'string token count' },
    { payload: { days: [{ ...sampleDay(date), models: { x: -1 } }] }, label: 'negative model tokens' },
    { payload: { days: Array.from({ length: 401 }, (_, index) => sampleDay(`2025-01-${String((index % 28) + 1).padStart(2, '0')}`)) }, label: 'more than 400 days' },
  ];
  for (const testCase of cases) {
    const result = await postJson(server.baseUrl, '/api/v1/ingest', testCase.payload, headers);
    assert.equal(result.status, 400, `${testCase.label}: expected 400, got ${result.status}`);
    assert.equal(result.json.error.code, 'invalid_days', testCase.label);
    assert.equal(typeof result.json.error.message, 'string');
  }

  const invalidJson = await request(server.baseUrl, '/api/v1/ingest', {
    method: 'POST',
    body: '{not json',
    headers: jsonHeaders(headers),
  });
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.json.error.code, 'invalid_json');

  const oversized = await request(server.baseUrl, '/api/v1/ingest', {
    method: 'POST',
    body: JSON.stringify({ days: [], padding: 'x'.repeat(420 * 1024) }),
    headers: jsonHeaders(headers),
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.json.error.code, 'payload_too_large');
});

test('ingest → me round trip, idempotency and latest-wins upserts', async () => {
  const user = await registerUser(server.baseUrl, 'round-trip');
  const headers = bearer(user.apiKey);
  const [d1, d2, d3] = recentDateKeys(3);
  assert.ok(d1 && d2 && d3);
  const days = [
    sampleDay(d1, { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 2000, cacheWriteTokens: 100, totalTokens: 999_999, messages: 3 }),
    sampleDay(d2, { inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40, messages: 1, models: undefined }),
    sampleDay(d3, { inputTokens: 5, outputTokens: 5, cacheReadTokens: 5, cacheWriteTokens: 5, costUsd: 1.25, messages: 2 }),
  ];

  const first = await postJson(server.baseUrl, '/api/v1/ingest', { version: '0.1.0', client: 'collector', days }, headers);
  assert.equal(first.status, 200);
  assert.equal(first.json.ok, true);
  assert.equal(first.json.username, 'round-trip');
  assert.equal(first.json.days, 3);
  assert.equal(first.json.firstDate, d1);
  assert.equal(first.json.lastDate, d3);
  assert.equal(typeof first.json.lastSyncAt, 'number');

  const me = await request(server.baseUrl, '/api/v1/me', { headers });
  assert.equal(me.status, 200);
  assert.equal(me.json.days, 3);
  assert.equal(me.json.firstDate, d1);
  assert.equal(me.json.lastDate, d3);
  assert.equal(me.json.totals.totalTokens, 3600 + 100 + 20);
  assert.equal(me.json.totals.messages, 3 + 1 + 2);
  // totalTokens is recomputed from the four buckets, never trusted from the wire.
  assert.equal(me.json.totals.reasoningTokens, 150);
  assert.ok(Math.abs(me.json.totals.costUsd - 1.35) < 1e-9);

  const second = await postJson(server.baseUrl, '/api/v1/ingest', { days }, headers);
  assert.equal(second.status, 200);
  assert.equal(second.json.days, 3);
  assert.equal(second.json.totalDays, 3);
  const meAgain = await request(server.baseUrl, '/api/v1/me', { headers });
  assert.equal(meAgain.json.days, 3);
  assert.equal(meAgain.json.totals.totalTokens, 3720);

  const replacement = [
    sampleDay(d2, { inputTokens: 100, outputTokens: 100, cacheReadTokens: 100, cacheWriteTokens: 100, messages: 10 }),
  ];
  const third = await postJson(server.baseUrl, '/api/v1/ingest', { days: replacement }, headers);
  assert.equal(third.status, 200);
  const meLatest = await request(server.baseUrl, '/api/v1/me', { headers });
  assert.equal(meLatest.json.days, 3, 'latest-wins must not create a new day');
  assert.equal(meLatest.json.totals.messages, 3 + 10 + 2);
  assert.equal(meLatest.json.totals.totalTokens, 3600 + 400 + 20);
});

test('GET /api/v1/u/:user is public JSON and 404s for unknown users', async () => {
  const user = await registerUser(server.baseUrl, 'public-stats');
  const day = todayKey();
  await postJson(server.baseUrl, '/api/v1/ingest', { days: [sampleDay(day)] }, bearer(user.apiKey));

  const result = await request(server.baseUrl, '/api/v1/u/public-stats');
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(result.json.username, 'public-stats');
  assert.equal(result.json.daily.length, 1);
  assert.equal(result.json.daily[0].date, day);
  assert.equal(result.json.totals.totalTokens, 3600);
  assert.equal(result.json.streak.todayActive, true);
  assert.equal(result.json.models[0].model, 'claude-sonnet-4-6');
  assert.ok(Array.isArray(result.json.sources));
  assert.equal(typeof result.json.windows['30d'].totalTokens, 'number');

  const missing = await request(server.baseUrl, '/api/v1/u/nobody-here');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'not_found');
});

test('unknown users render 404 assets for badge, chart and card', async () => {
  for (const path of ['/u/missing-user/badge.svg', '/u/missing-user/chart.svg', '/u/missing-user/card.svg']) {
    const result = await request(server.baseUrl, path);
    assert.equal(result.status, 404, path);
    assert.match(String(result.headers.get('content-type')), /image\/svg\+xml/);
    assert.match(result.text, /^<svg /);
    assert.match(result.text, /unknown user/);
  }
  const dashboard = await request(server.baseUrl, '/u/missing-user');
  assert.equal(dashboard.status, 404);
  assert.match(String(dashboard.headers.get('content-type')), /text\/html/);
  assert.match(dashboard.text, /Profile not found/);
});

test('unsupported methods and unknown API routes return JSON errors', async () => {
  const put = await request(server.baseUrl, '/api/v1/ingest', { method: 'PUT' });
  assert.equal(put.status, 405);
  assert.equal(put.json.error.code, 'method_not_allowed');

  const missing = await request(server.baseUrl, '/api/v1/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'not_found');

  const badPost = await postJson(server.baseUrl, '/api/v1/nope', {});
  assert.equal(badPost.status, 404);
});
