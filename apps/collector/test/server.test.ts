import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EventAggregator,
  SOURCE_IDS,
  generateDemoEvents,
  makeEvent,
} from '@token-island/core';
import type { CloudSyncStatus, SourceStatus, UsageEvent } from '@token-island/core';
import { createCollectorServer, type CollectorServerContext } from '../src/server.js';
import type { SyncResult } from '../src/sync.js';

const FIXED_NOW = Date.parse('2026-11-24T12:00:00.000Z');
const EVENT_TS = Date.parse('2026-11-24T02:00:00.000Z');

function fixtureEvents(): UsageEvent[] {
  return [
    makeEvent(
      {
        id: 'test:1',
        source: 'claude',
        sessionId: 's1',
        messageId: 'm1',
        ts: EVENT_TS,
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        agent: 'main',
        project: 'demo',
        cwd: '/tmp/demo',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: null,
      },
      'UTC',
    ),
    makeEvent(
      {
        id: 'test:2',
        source: 'codex',
        sessionId: 's2',
        messageId: 'm2',
        ts: EVENT_TS + 1000,
        model: 'gpt-5.2-codex',
        provider: 'openai',
        agent: 'main',
        project: 'demo2',
        cwd: '/tmp/demo2',
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 300,
        cacheWriteTokens: 0,
        costUsd: null,
      },
      'UTC',
    ),
  ];
}

function statusesFromEvents(events: readonly UsageEvent[]): SourceStatus[] {
  return SOURCE_IDS.map((source) => {
    const matches = events.filter((event) => event.source === source);
    const supported = source === 'claude' || source === 'codex' || source === 'opencode' || source === 'dsh';
    return {
      source,
      enabled: supported,
      lastEventAt: matches.length > 0 ? Math.max(...matches.map((event) => event.ts)) : null,
      events: matches.length,
      error: null,
    };
  });
}

const disabledCloud: CloudSyncStatus = {
  enabled: false,
  lastSyncAt: null,
  lastError: null,
  username: null,
  endpoint: null,
};

function buildContext(events: UsageEvent[], overrides: Partial<CollectorServerContext> = {}): CollectorServerContext {
  const aggregator = new EventAggregator({ timezone: 'UTC' });
  aggregator.addMany(events);
  const lastEventAt = events.length > 0 ? Math.max(...events.map((event) => event.ts)) : null;
  return {
    version: '0.1.0',
    demo: false,
    dbPath: '/tmp/test-data.db',
    startedAt: FIXED_NOW - 5_000,
    timezone: 'UTC',
    liveWindowMs: 600_000,
    aggregator,
    sources: () => statusesFromEvents(events),
    watchRoots: () => ['/tmp/demo/projects'],
    cloudStatus: () => disabledCloud,
    stats: () => ({ events: events.length, lastEventAt }),
    scan: () => {},
    sync: null,
    now: () => FIXED_NOW,
    ...overrides,
  };
}

test('http: health, summary and version match the documented shapes', async () => {
  const events = fixtureEvents();
  const server = await createCollectorServer(buildContext(events, {
    sync: async (): Promise<SyncResult> => ({ ok: true, lastSyncAt: FIXED_NOW, error: null, disabled: false }),
  }), { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const healthResponse = await fetch(`${base}/api/health`);
    assert.equal(healthResponse.status, 200);
    assert.equal(healthResponse.headers.get('access-control-allow-origin'), '*');
    assert.equal(healthResponse.headers.get('cache-control'), 'no-store');
    const health = (await healthResponse.json()) as Record<string, unknown>;
    assert.equal(health.ok, true);
    assert.equal(health.version, '0.1.0');
    assert.equal(health.port, server.port);
    assert.equal(health.demo, false);
    assert.equal(health.dbPath, '/tmp/test-data.db');
    assert.equal(health.events, 2);
    assert.equal(health.lastEventAt, EVENT_TS + 1000);
    assert.equal(health.startedAt, FIXED_NOW - 5_000);
    assert.ok(Array.isArray(health.sources));
    assert.equal((health.sources as unknown[]).length, 6);
    assert.equal(typeof health.uptimeSec, 'number');

    const summaryResponse = await fetch(`${base}/api/summary?range=today&days=7`);
    assert.equal(summaryResponse.status, 200);
    const summary = (await summaryResponse.json()) as {
      version: number;
      range: string;
      timezone: string;
      generatedAt: number;
      totals: { totalTokens: number; messages: number; sessions: number; costUsd: number };
      today: { totalTokens: number; messages: number };
      daily: Array<{ date: string }>;
      hourly: Array<{ hour: number; totalTokens: number }>;
      models: Array<{ key: string }>;
      sources: Array<{ key: string }>;
      live: unknown[];
      streak: { lastActiveDate: string | null };
      collector: { version: string; sources: unknown[]; cloud: { enabled: boolean } };
    };
    assert.equal(summary.version, 1);
    assert.equal(summary.range, 'today');
    assert.equal(summary.timezone, 'UTC');
    assert.equal(summary.generatedAt, FIXED_NOW);
    assert.equal(summary.totals.totalTokens, 750);
    assert.equal(summary.totals.messages, 2);
    assert.equal(summary.totals.sessions, 2);
    assert.equal(summary.today.totalTokens, 750);
    assert.equal(summary.daily.length, 7);
    assert.equal(summary.hourly.length, 24);
    assert.equal(summary.hourly[2]?.totalTokens, 750, 'both events are 02:00 UTC');
    assert.ok(summary.sources.some((row) => row.key === 'claude'));
    assert.ok(summary.models.some((row) => row.key === 'gpt-5.2-codex'));
    assert.equal(summary.streak.lastActiveDate, '2026-11-24');
    assert.equal(summary.collector.version, '0.1.0');
    assert.equal(summary.collector.sources.length, 6);
    assert.equal(summary.collector.cloud.enabled, false);

    const versionResponse = await fetch(`${base}/api/version`);
    assert.deepEqual(await versionResponse.json(), { version: '0.1.0', demo: false });

    const dashboardResponse = await fetch(`${base}/`);
    assert.equal(dashboardResponse.status, 200);
    assert.match(String(dashboardResponse.headers.get('content-type')), /text\/html/);
    assert.match(await dashboardResponse.text(), /Token Island · Local Telemetry/);

    const invalidRange = await fetch(`${base}/api/summary?range=year`);
    assert.equal(invalidRange.status, 400);
    const invalidBody = (await invalidRange.json()) as { error: { code: string; message: string } };
    assert.equal(invalidBody.error.code, 'invalid_range');

    const invalidDays = await fetch(`${base}/api/summary?days=abc`);
    assert.equal(invalidDays.status, 400);
    assert.equal(((await invalidDays.json()) as { error: { code: string } }).error.code, 'invalid_days');

    const notFound = await fetch(`${base}/api/does-not-exist`);
    assert.equal(notFound.status, 404);
    assert.equal(((await notFound.json()) as { error: { code: string } }).error.code, 'not_found');

    const wrongMethod = await fetch(`${base}/api/health`, { method: 'POST' });
    assert.equal(wrongMethod.status, 405);
  } finally {
    await server.close();
  }
});

test('http: post routes trigger scan, cloud sync and validation', async () => {
  const events = fixtureEvents();
  const scans: Array<string | undefined> = [];
  const server = await createCollectorServer(
    buildContext(events, {
      scan: (source) => scans.push(source),
      sync: async (): Promise<SyncResult> => ({ ok: true, lastSyncAt: FIXED_NOW, error: null, disabled: false }),
    }),
    { port: 0 },
  );
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const rescan = await fetch(`${base}/api/rescan?source=claude`, { method: 'POST' });
    assert.equal(rescan.status, 202);
    assert.deepEqual(await rescan.json(), { ok: true });
    assert.deepEqual(scans, ['claude']);

    const badSource = await fetch(`${base}/api/rescan?source=gemini`, { method: 'POST' });
    assert.equal(badSource.status, 400);
    assert.equal(((await badSource.json()) as { error: { code: string } }).error.code, 'invalid_source');

    const syncResponse = await fetch(`${base}/api/cloud/sync`, { method: 'POST' });
    assert.equal(syncResponse.status, 200);
    assert.deepEqual(await syncResponse.json(), { ok: true, lastSyncAt: FIXED_NOW });
  } finally {
    await server.close();
  }
});

test('http: demo mode serves deterministic demo data on a random port', async () => {
  const events = generateDemoEvents({ days: 120, seed: 42, now: FIXED_NOW });
  const server = await createCollectorServer(buildContext(events, {
    demo: true,
    dbPath: '/tmp/demo.db',
    now: () => FIXED_NOW,
    watchRoots: () => ['/Users/demo/.claude/projects'],
  }), { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const health = (await (await fetch(`${base}/api/health`)).json()) as Record<string, unknown>;
    assert.equal(health.ok, true);
    assert.equal(health.demo, true);
    assert.ok((health.events as number) > 0);

    const summary = (await (await fetch(`${base}/api/summary?range=today&days=14`)).json()) as {
      version: number;
      range: string;
      today: { totalTokens: number; messages: number };
      daily: unknown[];
      hourly: unknown[];
      sources: Array<{ key: string }>;
      models: Array<{ key: string }>;
      collector: { sources: unknown[] };
    };
    assert.equal(summary.version, 1);
    assert.equal(summary.range, 'today');
    assert.ok(summary.today.totalTokens > 0, 'demo today totalTokens must be > 0');
    assert.ok(summary.today.messages > 0);
    assert.equal(summary.daily.length, 14);
    assert.equal(summary.hourly.length, 24);
    assert.ok(summary.sources.length > 0);
    assert.ok(summary.models.length > 0);
    assert.equal(summary.collector.sources.length, 6);

    const version = (await (await fetch(`${base}/api/version`)).json()) as { demo: boolean };
    assert.equal(version.demo, true);

    const syncResponse = await fetch(`${base}/api/cloud/sync`, { method: 'POST' });
    assert.equal(syncResponse.status, 200);
    const syncBody = (await syncResponse.json()) as { ok: boolean; disabled: boolean };
    assert.equal(syncBody.ok, false);
    assert.equal(syncBody.disabled, true);

    const summaryAgain = (await (await fetch(`${base}/api/summary?range=today&days=14`)).json()) as {
      today: { totalTokens: number };
    };
    assert.equal(summaryAgain.today.totalTokens, summary.today.totalTokens, 'demo data is deterministic');
  } finally {
    await server.close();
  }
});
