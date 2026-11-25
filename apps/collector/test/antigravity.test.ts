import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { EventAggregator } from '@token-island/core';
import { loadConfig } from '../src/config.js';
import { Store } from '../src/db.js';
import { Scanner } from '../src/scanner.js';
import {
  modelFromEnumId,
  normalizeAntigravityModel,
  scanAntigravityDbFile,
} from '../src/sources/antigravity.js';
import { cleanupDir, createTestHome, loadTestHomeConfig, makeContext, tempDir } from './helpers.js';

// ---------------------------------------------------------------------------
// Minimal Protobuf wire-format encoder for building realistic test fixtures
// ---------------------------------------------------------------------------

function encodeVarint(value: number | bigint): Buffer {
  let v = typeof value === 'bigint' ? value : BigInt(Math.floor(value));
  const bytes: number[] = [];
  while (v >= 0x80n) {
    bytes.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  bytes.push(Number(v));
  return Buffer.from(bytes);
}

function pbVarint(fieldNumber: number, value: number | bigint): Buffer {
  return Buffer.concat([encodeVarint((BigInt(fieldNumber) << 3n) | 0n), encodeVarint(value)]);
}

function pbBytes(fieldNumber: number, payload: Buffer | string): Buffer {
  const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  return Buffer.concat([encodeVarint((BigInt(fieldNumber) << 3n) | 2n), encodeVarint(buf.length), buf]);
}

function pbTimestamp(epochMs: number): Buffer {
  const sec = Math.floor(epochMs / 1_000);
  const nanos = (epochMs % 1_000) * 1_000_000;
  return Buffer.concat([pbVarint(1, sec), pbVarint(2, nanos)]);
}

interface UsageFixtureInput {
  modelId?: number;
  inputTokens?: number;
  totalOutputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  provider?: number;
  messageId?: string;
  reasoningTokens?: number;
  visibleOutputTokens?: number;
  responseId?: string;
  providerAssignedMessageId?: string;
}

function pbModelUsage(u: UsageFixtureInput): Buffer {
  const parts: Buffer[] = [];
  if (u.modelId) parts.push(pbVarint(1, u.modelId));
  if (u.inputTokens) parts.push(pbVarint(2, u.inputTokens));
  if (u.totalOutputTokens) parts.push(pbVarint(3, u.totalOutputTokens));
  if (u.cacheCreationTokens) parts.push(pbVarint(4, u.cacheCreationTokens));
  if (u.cacheReadTokens) parts.push(pbVarint(5, u.cacheReadTokens));
  if (u.provider) parts.push(pbVarint(6, u.provider));
  if (u.messageId) parts.push(pbBytes(7, u.messageId));
  if (u.reasoningTokens) parts.push(pbVarint(9, u.reasoningTokens));
  if (u.visibleOutputTokens) parts.push(pbVarint(10, u.visibleOutputTokens));
  if (u.responseId) parts.push(pbBytes(11, u.responseId));
  if (u.providerAssignedMessageId) parts.push(pbBytes(12, u.providerAssignedMessageId));
  return Buffer.concat(parts);
}

function pbGenMetadata(opts: {
  modelId?: number;
  responseModel?: string;
  displayModel?: string;
  usage: UsageFixtureInput;
  retries?: UsageFixtureInput[];
  tsMs?: number;
  stepIndices?: number[];
  executionId?: string;
}): Buffer {
  const cm: Buffer[] = [];
  if (opts.modelId) cm.push(pbVarint(3, opts.modelId));
  cm.push(pbBytes(4, pbModelUsage(opts.usage)));
  if (opts.tsMs) {
    cm.push(pbBytes(9, pbBytes(4, pbTimestamp(opts.tsMs))));
  }
  for (const retry of opts.retries ?? []) {
    cm.push(pbBytes(17, pbBytes(2, pbModelUsage(retry))));
  }
  if (opts.responseModel) cm.push(pbBytes(19, opts.responseModel));
  if (opts.displayModel) cm.push(pbBytes(21, opts.displayModel));

  const root: Buffer[] = [pbBytes(1, Buffer.concat(cm))];
  for (const idx of opts.stepIndices ?? []) {
    root.push(pbVarint(2, idx));
  }
  if (opts.executionId) root.push(pbBytes(4, opts.executionId));
  return Buffer.concat(root);
}

function pbStepMetadata(opts: {
  tsMs?: number;
  usage?: UsageFixtureInput;
  model?: string;
  modelId?: number;
  provider?: number;
}): Buffer {
  const parts: Buffer[] = [];
  if (opts.tsMs) parts.push(pbBytes(8, pbTimestamp(opts.tsMs)));
  if (opts.usage) parts.push(pbBytes(9, pbModelUsage(opts.usage)));
  if (opts.model || opts.modelId || opts.provider) {
    const info: Buffer[] = [];
    if (opts.modelId) info.push(pbVarint(1, opts.modelId));
    if (opts.provider) info.push(pbVarint(7, opts.provider));
    if (opts.model) info.push(pbBytes(12, opts.model));
    parts.push(pbBytes(24, Buffer.concat(info)));
  }
  return Buffer.concat(parts);
}

test('antigravity: normalizes model display names, placeholders and numeric enums', () => {
  assert.equal(normalizeAntigravityModel('Gemini 3.8 Flash (High)'), 'gemini-3.8-flash-high');
  assert.equal(normalizeAntigravityModel('Gemini 3.8 Flash'), 'gemini-3.8-flash');
  assert.equal(normalizeAntigravityModel('MODEL_PLACEHOLDER_M318'), 'gemini-3.8-flash-high');
  assert.equal(normalizeAntigravityModel('MODEL_PLACEHOLDER_M417'), 'gemini-4-argon');
  assert.equal(normalizeAntigravityModel('Claude Sonnet 4.6'), 'claude-sonnet-4-6');
  assert.equal(modelFromEnumId(1318), 'gemini-3.8-flash-high');
  assert.equal(modelFromEnumId(1035), 'claude-sonnet-4-6');
  assert.equal(modelFromEnumId(246), 'gemini-2.5-pro');
});

test('antigravity: parses SQLite gen_metadata + steps, dedupes cross-table/mirror retries and extracts cwd/subagent', () => {
  const dir = tempDir('ti-agy-sqlite-');
  try {
    const dbPath = path.join(dir, 'sess-agy-1.db');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE steps (idx INTEGER PRIMARY KEY, metadata BLOB);
      CREATE TABLE trajectory_metadata_blob (data BLOB);
      CREATE TABLE parent_references (id TEXT);
    `);

    const ts1 = Date.parse('2026-11-24T10:15:00.000Z');
    const ts2 = Date.parse('2026-11-24T10:16:30.000Z');

    // Trajectory metadata carries fallback timestamp + workspace file:// URI
    const trajBlob = Buffer.concat([
      pbBytes(2, pbTimestamp(ts1 - 5_000)),
      pbBytes(5, 'file:///Users/fixture/code/token-island'),
    ]);
    db.prepare('INSERT INTO trajectory_metadata_blob (data) VALUES (?)').run(trajBlob);
    db.prepare('INSERT INTO parent_references (id) VALUES (?)').run('parent-uuid-0');

    // Step 3 mirrors gen_metadata row 0 (same step index + responseId -> must merge, not double count)
    const primaryUsage: UsageFixtureInput = {
      modelId: 1318, // gemini-3.8-flash-high
      inputTokens: 4_000,
      totalOutputTokens: 900,
      visibleOutputTokens: 600,
      reasoningTokens: 300,
      cacheReadTokens: 80_000,
      cacheCreationTokens: 0,
      provider: 24,
      responseId: 'resp_agy_turn_1',
    };
    db.prepare('INSERT INTO steps (idx, metadata) VALUES (?, ?)').run(
      3,
      pbStepMetadata({
        tsMs: ts1,
        usage: primaryUsage,
        model: 'MODEL_PLACEHOLDER_M318',
        modelId: 1318,
        provider: 24,
      }),
    );

    // gen_metadata row 0 includes a primary mirror in retry_infos (must be dropped) + one genuine retry
    const genuineRetry: UsageFixtureInput = {
      modelId: 1035, // claude-sonnet-4-6
      inputTokens: 1_500,
      totalOutputTokens: 400,
      cacheReadTokens: 10_000,
      cacheCreationTokens: 2_000,
      responseId: 'resp_agy_turn_2',
    };
    db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)').run(
      0,
      pbGenMetadata({
        modelId: 1318,
        displayModel: 'Gemini 3.8 Flash (High)',
        usage: primaryUsage,
        retries: [primaryUsage, genuineRetry],
        tsMs: ts1,
        stepIndices: [3],
        executionId: 'exec_1',
      }),
      0,
    );

    // Second generation without its own timestamp inherits trajectory/step timestamp
    db.prepare('INSERT INTO steps (idx, metadata) VALUES (?, ?)').run(
      7,
      pbStepMetadata({ tsMs: ts2 }),
    );
    db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)').run(
      1,
      pbGenMetadata({
        responseModel: 'gemini-4-argon',
        usage: {
          inputTokens: 2_000,
          totalOutputTokens: 500,
          cacheReadTokens: 50_000,
        },
        stepIndices: [7],
      }),
      0,
    );
    db.close();

    const result = scanAntigravityDbFile(dbPath, 'sess-agy-1', makeContext('UTC'));
    assert.equal(result.hasGenTable, true);
    assert.equal(result.events.length, 3, 'primary + genuine retry + second generation');

    const first = result.events.find((e) => e.id === 'antigravity:resp_agy_turn_1');
    assert.ok(first);
    assert.equal(first.source, 'antigravity');
    assert.equal(first.sessionId, 'sess-agy-1');
    assert.equal(first.model, 'gemini-3.8-flash-high');
    assert.equal(first.provider, 'google');
    assert.equal(first.agent, 'subagent');
    assert.equal(first.project, 'token-island');
    assert.equal(first.cwd, '/Users/fixture/code/token-island');
    assert.equal(first.inputTokens, 4_000);
    assert.equal(first.outputTokens, 900);
    assert.equal(first.reasoningTokens, 300);
    assert.equal(first.cacheReadTokens, 80_000);
    assert.equal(first.totalTokens, 84_900);
    assert.ok(first.costUsd !== null && first.costUsd > 0);

    const retry = result.events.find((e) => e.id === 'antigravity:resp_agy_turn_2');
    assert.ok(retry);
    assert.equal(retry.model, 'claude-sonnet-4-6');
    assert.equal(retry.provider, 'anthropic');
    assert.equal(retry.totalTokens, 13_900);

    const third = result.events.find((e) => e.id === 'antigravity:sess-agy-1:step:7');
    assert.ok(third);
    assert.equal(third.model, 'gemini-4-argon');
    assert.equal(third.ts, ts2, 'linked timestamp from step 7');
    assert.equal(third.totalTokens, 52_500);
  } finally {
    cleanupDir(dir);
  }
});

test('antigravity: scanner detects live WAL appends, skips idle DBs and avoids transcript double-counting', async () => {
  const home = createTestHome();
  try {
    const convDir = path.join(home.antigravityDir, 'conversations');
    const brainSession1Logs = path.join(
      home.antigravityDir,
      'brain',
      'sess-wal-1',
      '.system_generated',
      'logs',
    );
    const brainSession2Logs = path.join(
      home.antigravityDir,
      'brain',
      'sess-jsonl-only',
      '.system_generated',
      'logs',
    );
    mkdirSync(convDir, { recursive: true });
    mkdirSync(brainSession1Logs, { recursive: true });
    mkdirSync(brainSession2Logs, { recursive: true });

    const dbPath = path.join(convDir, 'sess-wal-1.db');
    const writer = new DatabaseSync(dbPath);
    writer.exec('PRAGMA journal_mode = WAL;');
    writer.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);');

    const tsBase = Date.now() - 60_000;
    writer.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(
      0,
      pbGenMetadata({
        responseModel: 'gemini-3.8-flash',
        tsMs: tsBase,
        usage: { inputTokens: 1_000, totalOutputTokens: 200, cacheReadTokens: 5_000, responseId: 'wal_r1' },
      }),
    );

    // Mirroring transcript for sess-wal-1 (must NOT be double-counted because sess-wal-1.db exists!)
    writeFileSync(
      path.join(brainSession1Logs, 'transcript.jsonl'),
      `${JSON.stringify({
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: new Date(tsBase).toISOString(),
        model: 'gemini-3.8-flash',
        input_tokens: 1_000,
        cache_read_tokens: 5_000,
        output_tokens: 200,
      })}\n`,
    );

    // Brain-only session without a SQLite database (MUST be collected via transcript.jsonl fallback!)
    const transcriptOnlyFile = path.join(brainSession2Logs, 'transcript.jsonl');
    writeFileSync(
      transcriptOnlyFile,
      `${JSON.stringify({
        step_index: 2,
        type: 'PLANNER_RESPONSE',
        created_at: new Date(tsBase + 1_000).toISOString(),
        model: 'gemini-3.8-flash',
        input_tokens: 500,
        cache_read_tokens: 2_000,
        output_tokens: 100,
        thinking_tokens: 40,
      })}\n`,
    );

    const config = loadTestHomeConfig(home.home);
    const store = new Store(config.dbPath);
    try {
      const aggregator = new EventAggregator({ timezone: config.timezone });
      const scanner = new Scanner(store, aggregator, config);
      scanner.init();

      const pass1 = await scanner.scanAll('antigravity');
      assert.equal(pass1.newEvents, 2, '1 from sess-wal-1.db + 1 from sess-jsonl-only transcript');
      assert.equal(store.countEvents(), 2);

      // Unchanged pass: zero files re-scanned, zero duplicates.
      const pass2 = await scanner.scanAll('antigravity');
      assert.equal(pass2.newEvents, 0);
      assert.equal(pass2.sources[0]?.filesScanned, 0);

      // Append a new turn into SQLite WAL (while writer stays open!) AND a new line to transcript-only session.
      writer.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(
        1,
        pbGenMetadata({
          responseModel: 'gemini-3.8-flash',
          tsMs: tsBase + 5_000,
          usage: { inputTokens: 800, totalOutputTokens: 150, cacheReadTokens: 6_000, responseId: 'wal_r2' },
        }),
      );
      appendFileSync(
        transcriptOnlyFile,
        `${JSON.stringify({
          step_index: 5,
          type: 'PLANNER_RESPONSE',
          created_at: new Date(tsBase + 6_000).toISOString(),
          input_tokens: 300,
          cache_read_tokens: 2_500,
          output_tokens: 80,
        })}\n`,
      );

      const pass3 = await scanner.scanAll('antigravity');
      assert.equal(pass3.newEvents, 2, 'WAL append + incremental transcript append picked up');
      assert.equal(store.countEvents(), 4);

      const summary = aggregator.finalize({ range: 'all' });
      const agySource = summary.sources.find((s) => s.key === 'antigravity');
      assert.ok(agySource);
      assert.equal(agySource.messages, 4);
      assert.equal(agySource.totalTokens, 6_200 + 2_600 + 6_950 + 2_880);
    } finally {
      store.close();
      writer.close();
    }
  } finally {
    cleanupDir(home.home);
  }
});

test('antigravity: default config discovers antigravity, antigravity-cli and antigravity-ide and dedupes backups', async () => {
  const homeDir = tempDir('ti-agy-surfaces-');
  try {
    const cliConv = path.join(homeDir, '.gemini', 'antigravity-cli', 'conversations');
    const ideConv = path.join(homeDir, '.gemini', 'antigravity-ide', 'conversations');
    const backupConv = path.join(homeDir, '.gemini', 'antigravity-backup', 'conversations');
    mkdirSync(cliConv, { recursive: true });
    mkdirSync(ideConv, { recursive: true });
    mkdirSync(backupConv, { recursive: true });

    const ts = Date.now() - 10_000;
    const writeDb = (targetPath: string, responseId: string, model: string): void => {
      const db = new DatabaseSync(targetPath);
      db.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);');
      db.prepare('INSERT INTO gen_metadata (idx, data) VALUES (?, ?)').run(
        0,
        pbGenMetadata({
          responseModel: model,
          tsMs: ts,
          usage: { inputTokens: 1_000, totalOutputTokens: 250, responseId },
        }),
      );
      db.close();
    };

    writeDb(path.join(cliConv, 'cli-sess.db'), 'shared_resp_1', 'gemini-3.8-flash');
    writeDb(path.join(backupConv, 'cli-sess-copy.db'), 'shared_resp_1', 'gemini-3.8-flash');
    writeDb(path.join(ideConv, 'ide-sess.db'), 'ide_resp_2', 'claude-sonnet-4-6');

    const config = loadConfig({ env: {}, homeDir });
    const store = new Store(':memory:');
    try {
      const aggregator = new EventAggregator({ timezone: 'UTC' });
      const scanner = new Scanner(store, aggregator, config);
      scanner.init();

      const pass = await scanner.scanAll('antigravity');
      assert.equal(pass.newEvents, 2, 'backup copy with shared responseId is deduped');
      assert.ok(scanner.watchRoots().includes(path.join(homeDir, '.gemini', 'antigravity-cli')));
      assert.ok(scanner.watchRoots().includes(path.join(homeDir, '.gemini', 'antigravity-ide')));
    } finally {
      store.close();
    }
  } finally {
    cleanupDir(homeDir);
  }
});
