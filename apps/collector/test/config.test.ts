import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { resolveTimezone } from '@token-island/core';
import { loadConfig, readCloudSettings } from '../src/config.js';
import { cleanupDir, tempDir } from './helpers.js';

test('config: documented defaults when no config file exists', () => {
  const homeDir = tempDir('ti-config-home-');
  try {
    const config = loadConfig({ env: {}, homeDir });
    assert.equal(config.home, path.join(homeDir, '.token-island'));
    assert.equal(config.configPath, path.join(homeDir, '.token-island', 'config.json'));
    assert.equal(config.dbPath, path.join(homeDir, '.token-island', 'data.db'));
    assert.equal(config.port, 47118);
    assert.equal(config.demoPort, 47119);
    assert.equal(config.timezone, resolveTimezone());
    assert.equal(config.backfillDays, 30);
    assert.equal(config.scanIntervalMs, 2000);
    assert.equal(config.liveWindowMs, 600000);
    assert.deepEqual(config.sources, {
      claude: true,
      codex: true,
      opencode: true,
      dsh: true,
      antigravity: true,
      gemini: false,
    });
    assert.equal(config.paths.claude, path.join(homeDir, '.claude'));
    assert.equal(config.paths.codex, path.join(homeDir, '.codex'));
    assert.equal(config.paths.opencode, path.join(homeDir, '.local', 'share', 'opencode'));
    assert.equal(config.paths.dsh, path.join(homeDir, '.dsh'));
    assert.equal(config.paths.antigravity, path.join(homeDir, '.gemini', 'antigravity'));
    assert.deepEqual(config.prices, []);
    assert.deepEqual(config.cloud, {
      enabled: false,
      url: '',
      username: '',
      apiKey: '',
      autoSync: true,
      intervalMinutes: 15,
    });
    assert.equal(config.configError, null);
  } finally {
    cleanupDir(homeDir);
  }
});

test('config: TOKEN_ISLAND_HOME and TOKEN_ISLAND_PORT env overrides', () => {
  const homeDir = tempDir('ti-config-env-');
  try {
    const stateDir = path.join(homeDir, 'custom-state');
    const config = loadConfig({
      env: { TOKEN_ISLAND_HOME: stateDir, TOKEN_ISLAND_PORT: '47200' },
      homeDir,
    });
    assert.equal(config.home, stateDir);
    assert.equal(config.configPath, path.join(stateDir, 'config.json'));
    assert.equal(config.dbPath, path.join(stateDir, 'data.db'));
    assert.equal(config.port, 47200);
  } finally {
    cleanupDir(homeDir);
  }
});

test('config: file values, ~ expansion, source flags, prices and cloud', () => {
  const homeDir = tempDir('ti-config-full-');
  const stateDir = path.join(homeDir, 'state');
  mkdirSync(stateDir, { recursive: true });
  try {
    writeFileSync(
      path.join(stateDir, 'config.json'),
      JSON.stringify({
        port: 47120,
        timezone: 'UTC',
        backfillDays: 3,
        scanIntervalMs: 500,
        liveWindowMs: 60_000,
        sources: { claude: false, gemini: true, codex: true },
        paths: {
          claude: '~/custom/claude',
          codex: 'relative/codex',
          opencode: '/tmp/opencode-state',
        },
        prices: [
          { match: 'my-internal-model', input: 0.5, output: 1.5, cacheRead: 0.1, note: 'test' },
          { match: '', input: 1, output: 1 },
          'not-an-object',
        ],
        cloud: {
          enabled: true,
          url: 'http://127.0.0.1:47117',
          username: 'demo',
          apiKey: 'ti_abcdef',
          autoSync: false,
          intervalMinutes: 5,
        },
      }),
    );
    const config = loadConfig({ env: { TOKEN_ISLAND_HOME: stateDir }, homeDir });
    assert.equal(config.port, 47120);
    assert.equal(config.timezone, 'UTC');
    assert.equal(config.backfillDays, 3);
    assert.equal(config.scanIntervalMs, 500);
    assert.equal(config.liveWindowMs, 60_000);
    assert.equal(config.sources.claude, false);
    assert.equal(config.sources.codex, true);
    assert.equal(config.sources.gemini, true);
    assert.equal(config.paths.claude, path.join(homeDir, 'custom', 'claude'));
    assert.equal(config.paths.codex, path.join(homeDir, 'relative', 'codex'));
    assert.equal(config.paths.opencode, '/tmp/opencode-state');
    assert.deepEqual(config.prices, [
      { match: 'my-internal-model', input: 0.5, output: 1.5, cacheRead: 0.1, note: 'test' },
    ]);
    assert.deepEqual(config.cloud, {
      enabled: true,
      url: 'http://127.0.0.1:47117',
      username: 'demo',
      apiKey: 'ti_abcdef',
      autoSync: false,
      intervalMinutes: 5,
    });

    // Env port wins over the file port.
    const overridden = loadConfig({
      env: { TOKEN_ISLAND_HOME: stateDir, TOKEN_ISLAND_PORT: '47001' },
      homeDir,
    });
    assert.equal(overridden.port, 47001);

    // Runtime cloud re-read (tokenisland register writes the file while running).
    const cloudRead = readCloudSettings(config.configPath);
    assert.equal(cloudRead.error, null);
    assert.equal(cloudRead.cloud.enabled, true);
    assert.equal(cloudRead.cloud.apiKey, 'ti_abcdef');
  } finally {
    cleanupDir(homeDir);
  }
});

test('config: invalid JSON is reported but never throws', () => {
  const homeDir = tempDir('ti-config-bad-');
  const stateDir = path.join(homeDir, 'state');
  mkdirSync(stateDir, { recursive: true });
  try {
    writeFileSync(path.join(stateDir, 'config.json'), '{ not json');
    const config = loadConfig({ env: { TOKEN_ISLAND_HOME: stateDir }, homeDir });
    assert.ok(config.configError);
    assert.match(config.configError ?? '', /invalid config JSON/);
    assert.equal(config.port, 47118, 'defaults still apply');
  } finally {
    cleanupDir(homeDir);
  }
});

test('config: readCloudSettings picks up a registration written after boot', () => {
  const homeDir = tempDir('ti-config-reload-');
  const stateDir = path.join(homeDir, 'state');
  mkdirSync(stateDir, { recursive: true });
  const configPath = path.join(stateDir, 'config.json');
  try {
    assert.equal(readCloudSettings(configPath).cloud.enabled, false);
    writeFileSync(
      configPath,
      JSON.stringify({
        cloud: { enabled: true, url: 'http://127.0.0.1:47117', apiKey: 'ti_live', username: 'live' },
      }),
    );
    const reloaded = readCloudSettings(configPath);
    assert.equal(reloaded.error, null);
    assert.equal(reloaded.cloud.enabled, true);
    assert.equal(reloaded.cloud.url, 'http://127.0.0.1:47117');
    assert.equal(reloaded.cloud.apiKey, 'ti_live');
    assert.equal(reloaded.cloud.intervalMinutes, 15, 'defaults fill missing keys');
  } finally {
    cleanupDir(homeDir);
  }
});
