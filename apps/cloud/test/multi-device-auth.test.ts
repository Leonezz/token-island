/**
 * Tests for Schema v2 multi-device additive sync, GitHub OAuth Device Flow,
 * per-device token revocation, and profile visibility tiers.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearer, postJson, request, sampleDay, startTestServer, todayKey } from './helpers.js';

test('GitHub OAuth Device Flow issues independent per-device tokens and sums multi-Mac daily tokens without overwrite', async () => {
  let pollAttempt = 0;

  const mockFetch: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith('/login/device/code')) {
      return new Response(
        JSON.stringify({
          device_code: 'gh_dev_code_abc123',
          user_code: 'WDJB-MJHT',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (url.endsWith('/login/oauth/access_token')) {
      pollAttempt += 1;
      if (pollAttempt === 1) {
        return new Response(JSON.stringify({ error: 'authorization_pending' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (pollAttempt === 2) {
        return new Response(JSON.stringify({ error: 'slow_down', interval: 10 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          access_token: 'gho_ephemeral_token',
          token_type: 'bearer',
          scope: 'read:user',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (url.endsWith('/user')) {
      return new Response(
        JSON.stringify({
          id: 88990011,
          login: 'Leonezz',
          name: 'Hanzhen Hong',
          avatar_url: 'https://avatars.githubusercontent.com/u/88990011',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response('not found', { status: 404 });
  };

  const server = await startTestServer({
    githubClientId: 'Iv23liTestClientId',
    fetchImpl: mockFetch,
  });

  try {
    // 1. Healthz reports githubAuthEnabled = true
    const health = await request(server.baseUrl, '/healthz');
    assert.equal(health.status, 200);
    assert.equal(health.json.githubAuthEnabled, true);

    // 2. Device 1 (MacBook Pro) starts Device Flow
    const start1 = await postJson(server.baseUrl, '/api/v1/auth/github/start', {
      deviceId: 'dev_macbook_pro',
      deviceName: 'MacBook Pro',
      platform: 'darwin-arm64',
    });
    assert.equal(start1.status, 200);
    assert.equal(start1.json.userCode, 'WDJB-MJHT');
    assert.equal(start1.json.verificationUri, 'https://github.com/login/device');
    assert.match(String(start1.json.sessionId), /^ghs_[0-9a-f]{32}$/);

    // First poll -> pending (interval 5)
    const poll1 = await postJson(server.baseUrl, '/api/v1/auth/github/poll', {
      sessionId: start1.json.sessionId,
    });
    assert.equal(poll1.status, 200);
    assert.equal(poll1.json.status, 'pending');
    assert.equal(poll1.json.interval, 5);

    // Second poll -> slow_down bumps interval to 10
    const poll2 = await postJson(server.baseUrl, '/api/v1/auth/github/poll', {
      sessionId: start1.json.sessionId,
    });
    assert.equal(poll2.status, 200);
    assert.equal(poll2.json.status, 'pending');
    assert.equal(poll2.json.interval, 10);

    // Third poll -> complete!
    const poll3 = await postJson(server.baseUrl, '/api/v1/auth/github/poll', {
      sessionId: start1.json.sessionId,
    });
    assert.equal(poll3.status, 200);
    assert.equal(poll3.json.status, 'complete');
    assert.equal(poll3.json.username, 'leonezz');
    assert.equal(poll3.json.displayName, 'Hanzhen Hong');
    assert.equal(poll3.json.deviceId, 'dev_macbook_pro');
    assert.match(String(poll3.json.apiKey), /^ti_dev_[0-9a-f]{32}$/);
    const macbookKey = String(poll3.json.apiKey);

    // Reusing consumed session fails cleanly with 404
    const replay = await postJson(server.baseUrl, '/api/v1/auth/github/poll', {
      sessionId: start1.json.sessionId,
    });
    assert.equal(replay.status, 404);

    // 3. Device 2 (Mac Studio) logs in with the SAME GitHub user -> same username, distinct key
    const start2 = await postJson(server.baseUrl, '/api/v1/auth/github/start', {
      deviceId: 'dev_mac_studio',
      deviceName: 'Mac Studio',
      platform: 'darwin-arm64',
    });
    const done2 = await postJson(server.baseUrl, '/api/v1/auth/github/poll', {
      sessionId: start2.json.sessionId,
    });
    assert.equal(done2.status, 200);
    assert.equal(done2.json.status, 'complete');
    assert.equal(done2.json.username, 'leonezz');
    assert.equal(done2.json.userId, poll3.json.userId);
    assert.notEqual(done2.json.apiKey, macbookKey);
    const studioKey = String(done2.json.apiKey);

    // 4. Multi-device additive sync on the same date (NO overwrite!)
    const day = todayKey();
    await postJson(
      server.baseUrl,
      '/api/v1/ingest',
      {
        days: [
          sampleDay(day, {
            inputTokens: 4000,
            outputTokens: 1000,
            cacheReadTokens: 5000,
            cacheWriteTokens: 0,
            costUsd: 0.25,
            messages: 5,
            models: { 'claude-sonnet-4-6': 10_000 },
          }),
        ],
      },
      bearer(macbookKey),
    );

    await postJson(
      server.baseUrl,
      '/api/v1/ingest',
      {
        days: [
          sampleDay(day, {
            inputTokens: 2000,
            outputTokens: 1000,
            cacheReadTokens: 3000,
            cacheWriteTokens: 0,
            costUsd: 0.15,
            messages: 3,
            models: { 'claude-sonnet-4-6': 4_000, 'gpt-5.2-codex': 2_000 },
          }),
        ],
      },
      bearer(studioKey),
    );

    const stats = await request(server.baseUrl, '/api/v1/u/leonezz');
    assert.equal(stats.status, 200);
    assert.equal(stats.json.totals.totalTokens, 16_000);
    assert.equal(stats.json.totals.messages, 8);
    assert.ok(Math.abs(stats.json.totals.costUsd - 0.4) < 1e-6);
    assert.equal(stats.json.models[0].model, 'claude-sonnet-4-6');
    assert.equal(stats.json.models[0].totalTokens, 14_000);
    assert.equal(stats.json.models[1].model, 'gpt-5.2-codex');
    assert.equal(stats.json.models[1].totalTokens, 2_000);

    // Re-syncing MacBook Pro with updated slice (12k instead of 10k) is idempotent for MacBook + keeps Studio's 6k = 18k!
    await postJson(
      server.baseUrl,
      '/api/v1/ingest',
      {
        days: [
          sampleDay(day, {
            inputTokens: 5000,
            outputTokens: 1000,
            cacheReadTokens: 6000,
            cacheWriteTokens: 0,
            costUsd: 0.3,
            messages: 6,
            models: { 'claude-sonnet-4-6': 12_000 },
          }),
        ],
      },
      bearer(macbookKey),
    );

    const me = await request(server.baseUrl, '/api/v1/me', { headers: bearer(macbookKey) });
    assert.equal(me.status, 200);
    assert.equal(me.json.githubConnected, true);
    assert.equal(me.json.devices.length, 2);
    assert.equal(me.json.totals.totalTokens, 18_000);
    assert.equal(me.json.totals.messages, 9);

    // 5. Privacy visibility tiers: unlisted & private
    const setUnlisted = await postJson(
      server.baseUrl,
      '/api/v1/me/settings',
      { visibility: 'unlisted' },
      bearer(macbookKey),
    );
    assert.equal(setUnlisted.status, 200);
    assert.equal(setUnlisted.json.visibility, 'unlisted');

    assert.equal((await request(server.baseUrl, '/u/leonezz')).status, 404);
    assert.equal((await request(server.baseUrl, '/api/v1/u/leonezz')).status, 404);
    assert.equal((await request(server.baseUrl, '/u/leonezz/badge.svg?metric=tokens')).status, 200);

    const setPrivate = await postJson(
      server.baseUrl,
      '/api/v1/me/settings',
      { visibility: 'private' },
      bearer(macbookKey),
    );
    assert.equal(setPrivate.status, 200);
    assert.equal((await request(server.baseUrl, '/u/leonezz/badge.svg?metric=tokens')).status, 404);

    // Owner can still fetch full Remote Mode summary via /api/v1/me/summary!
    const meSummary = await request(server.baseUrl, '/api/v1/me/summary', {
      headers: bearer(macbookKey),
    });
    assert.equal(meSummary.status, 200);
    assert.equal(meSummary.json.totals.totalTokens, 18_000);

    // 6. Revoking Mac Studio's token immediately locks out Studio without affecting MacBook Pro
    const revokeRes = await postJson(
      server.baseUrl,
      '/api/v1/me/devices/revoke',
      { deviceId: 'dev_mac_studio' },
      bearer(macbookKey),
    );
    assert.equal(revokeRes.status, 200);
    assert.equal(revokeRes.json.revoked, true);

    assert.equal((await request(server.baseUrl, '/api/v1/me', { headers: bearer(studioKey) })).status, 401);
    assert.equal((await request(server.baseUrl, '/api/v1/me', { headers: bearer(macbookKey) })).status, 200);
  } finally {
    await server.cleanup();
  }
});
