import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { EventAggregator, makeEvent } from '@token-island/core';
import type { CloudDay, UsageEvent } from '@token-island/core';
import { loadConfig } from '../src/config.js';
import { Store } from '../src/db.js';
import { CloudSync } from '../src/sync.js';
import { cleanupDir, tempDir } from './helpers.js';

interface CapturedRequest {
  method?: string;
  path?: string;
  authorization?: string;
  body: unknown;
}

interface MockCloud {
  url: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

async function startMockCloud(status = 200, responseBody: unknown = { ok: true, username: 'tester' }): Promise<MockCloud> {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = null;
      try {
        body = raw.length > 0 ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
      requests.push({
        method: request.method,
        path: request.url,
        authorization: request.headers.authorization,
        body,
      });
      const payload = JSON.stringify(responseBody);
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(payload);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

function fixtureEvents(): UsageEvent[] {
  return [
    makeEvent(
      {
        id: 'cloud:1',
        source: 'claude',
        sessionId: 's1',
        messageId: 'm1',
        ts: Date.parse('2026-11-22T10:00:00.000Z'),
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        agent: 'main',
        project: 'demo',
        cwd: '/tmp/demo',
        inputTokens: 1000,
        outputTokens: 100,
        cacheReadTokens: 2000,
        cacheWriteTokens: 0,
        costUsd: null,
      },
      'UTC',
    ),
    makeEvent(
      {
        id: 'cloud:2',
        source: 'codex',
        sessionId: 's2',
        messageId: 'm2',
        ts: Date.parse('2026-11-23T10:00:00.000Z'),
        model: 'gpt-5.2-codex',
        provider: 'openai',
        agent: 'main',
        project: 'demo2',
        cwd: '/tmp/demo2',
        inputTokens: 111,
        outputTokens: 11,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: null,
      },
      'UTC',
    ),
  ];
}

interface SyncHarness {
  stateDir: string;
  store: Store;
  aggregator: EventAggregator;
  sync: CloudSync;
  configPath: string;
  close: () => void;
}

function createHarness(stateDir: string, storeDir: string): SyncHarness {
  const config = loadConfig({ env: { TOKEN_ISLAND_HOME: stateDir }, homeDir: stateDir });
  const store = new Store(path.join(storeDir, 'data.db'));
  const aggregator = new EventAggregator({ timezone: 'UTC' });
  aggregator.addMany(fixtureEvents());
  const sync = new CloudSync({
    configPath: config.configPath,
    cloud: config.cloud,
    store,
    getDays: (): CloudDay[] => aggregator.cloudDays({ maxDays: 400 }),
    timezone: () => 'UTC',
    version: '0.1.0',
    now: () => Date.parse('2026-11-24T12:00:00.000Z'),
  });
  return {
    stateDir,
    store,
    aggregator,
    sync,
    configPath: config.configPath,
    close: () => store.close(),
  };
}

function writeConfig(stateDir: string, cloud: Record<string, unknown>): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, 'config.json'), JSON.stringify({ cloud }));
}

test('sync: pushes cloud days with Bearer auth and records lastSyncAt', async () => {
  const stateDir = tempDir('ti-sync-state-');
  const storeDir = tempDir('ti-sync-store-');
  const cloud = await startMockCloud();
  let harness: SyncHarness | null = null;
  try {
    writeConfig(stateDir, {
      enabled: true,
      url: cloud.url,
      apiKey: 'ti_test_key',
      username: 'demo',
      autoSync: false,
      intervalMinutes: 30,
    });
    harness = createHarness(stateDir, storeDir);
    const result = await harness.sync.syncNow();
    assert.equal(result.ok, true);
    assert.equal(result.disabled, false);
    assert.equal(result.lastSyncAt, Date.parse('2026-11-24T12:00:00.000Z'));
    assert.equal(cloud.requests.length, 1);

    const request = cloud.requests[0];
    assert.ok(request);
    assert.equal(request.method, 'POST');
    assert.equal(request.path, '/api/v1/ingest');
    assert.equal(request.authorization, 'Bearer ti_test_key');
    const body = request.body as {
      version: string;
      client: string;
      days: CloudDay[];
      meta: { timezone: string; rangeStart: string };
    };
    assert.equal(body.version, '0.1.0');
    assert.equal(body.client, 'collector');
    assert.equal(body.days.length, 2);
    assert.equal(body.days[0]?.date, '2026-11-22');
    assert.equal(body.days[0]?.totalTokens, 3100);
    assert.equal(body.days[1]?.date, '2026-11-23');
    assert.equal(body.days[1]?.totalTokens, 122);
    assert.equal(body.meta.timezone, 'UTC');
    assert.equal(body.meta.rangeStart, '2026-11-22');

    const status = harness.sync.status();
    assert.equal(status.enabled, true);
    assert.equal(status.username, 'demo', 'config username wins over the ingest response');
    assert.equal(harness.store.getKv('cloud.username'), 'tester');
    assert.equal(status.endpoint, cloud.url);
    assert.equal(status.lastSyncAt, result.lastSyncAt);
    assert.equal(status.lastError, null);
    assert.equal(harness.store.getKv('cloud.lastSyncAt'), String(result.lastSyncAt));
  } finally {
    harness?.close();
    await cloud.close();
    cleanupDir(stateDir);
    cleanupDir(storeDir);
  }
});

test('sync: failures are captured (truncated) and never throw', async () => {
  const stateDir = tempDir('ti-sync-fail-state-');
  const storeDir = tempDir('ti-sync-fail-store-');
  const cloud = await startMockCloud(500, { error: { code: 'boom', message: 'cloud exploded' } });
  let harness: SyncHarness | null = null;
  try {
    writeConfig(stateDir, { enabled: true, url: cloud.url, apiKey: 'ti_bad_key', autoSync: false });
    harness = createHarness(stateDir, storeDir);
    const result = await harness.sync.syncNow();
    assert.equal(result.ok, false);
    assert.equal(result.disabled, false);
    assert.ok(result.error?.includes('500'));
    assert.ok(result.error && result.error.length <= 301);
    const status = harness.sync.status();
    assert.ok(status.lastError?.includes('500'));
    assert.equal(status.lastSyncAt, null);
    assert.equal(harness.store.getKv('cloud.lastError'), status.lastError);
  } finally {
    harness?.close();
    await cloud.close();
    cleanupDir(stateDir);
    cleanupDir(storeDir);
  }
});

test('sync: cloud config is re-read on every sync (register while daemon runs)', async () => {
  const stateDir = tempDir('ti-sync-reload-state-');
  const storeDir = tempDir('ti-sync-reload-store-');
  const cloud = await startMockCloud();
  let harness: SyncHarness | null = null;
  try {
    writeConfig(stateDir, { enabled: false });
    harness = createHarness(stateDir, storeDir);
    const disabled = await harness.sync.syncNow();
    assert.equal(disabled.ok, false);
    assert.equal(disabled.disabled, true);
    assert.equal(cloud.requests.length, 0);

    writeConfig(stateDir, { enabled: true, url: cloud.url, apiKey: 'ti_new_key', autoSync: false });
    const enabled = await harness.sync.syncNow();
    assert.equal(enabled.ok, true);
    assert.equal(enabled.disabled, false);
    assert.equal(cloud.requests.length, 1);
    assert.equal(cloud.requests[0]?.authorization, 'Bearer ti_new_key');
    assert.equal(harness.sync.status().enabled, true);
  } finally {
    harness?.close();
    await cloud.close();
    cleanupDir(stateDir);
    cleanupDir(storeDir);
  }
});
