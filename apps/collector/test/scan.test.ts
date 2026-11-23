import assert from 'node:assert/strict';
import { appendFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { EventAggregator } from '@token-island/core';
import { Store } from '../src/db.js';
import { Scanner } from '../src/scanner.js';
import {
  assistantLine,
  cleanupDir,
  createTestHome,
  loadTestHomeConfig,
  writeClaudeSession,
} from './helpers.js';

test('scanner: incremental claude scan persists offsets and never duplicates rows', async () => {
  const home = createTestHome();
  try {
    const file = writeClaudeSession(home.claudeDir, 'demo-project', 'session-1.jsonl', [
      assistantLine('msg_inc_1'),
      assistantLine('msg_inc_2'),
    ]);
    const config = loadTestHomeConfig(home.home);
    const store = new Store(config.dbPath);
    try {
      const aggregator = new EventAggregator({ timezone: config.timezone });
      const scanner = new Scanner(store, aggregator, config, { concurrency: 2, fileBudgetBytes: 1 << 20 });
      scanner.init();

      const pass1 = await scanner.scanAll();
      assert.equal(pass1.newEvents, 2);
      assert.equal(store.countEvents(), 2);
      assert.equal(aggregator.size, 2);
      const state1 = store.getFileState(file);
      assert.ok(state1);
      assert.equal(state1.offset, statSync(file).size);

      // Unchanged file: nothing re-read, nothing inserted.
      const pass2 = await scanner.scanAll();
      assert.equal(pass2.newEvents, 0);
      assert.equal(store.countEvents(), 2);

      // Appended complete line is consumed exactly once.
      appendFileSync(file, assistantLine('msg_inc_3') + '\n');
      const pass3 = await scanner.scanAll();
      assert.equal(pass3.newEvents, 1);
      assert.equal(store.countEvents(), 3);
      const state3 = store.getFileState(file);
      assert.ok(state3);
      assert.equal(state3.offset, statSync(file).size);

      // Duplicate provider id (re-logged message) is ignored by the primary key.
      appendFileSync(file, assistantLine('msg_inc_3') + '\n');
      const pass4 = await scanner.scanAll();
      assert.equal(pass4.newEvents, 0);
      assert.equal(store.countEvents(), 3);

      // Truncated/rotated file resets the offset and is safely re-read.
      writeFileSync(file, `${assistantLine('msg_inc_1')}\n${assistantLine('msg_inc_4')}\n`);
      const pass5 = await scanner.scanAll();
      assert.equal(pass5.newEvents, 1, 're-read msg_inc_1 deduped, msg_inc_4 is new');
      assert.equal(store.countEvents(), 4);
      assert.equal(store.getFileState(file)?.offset, statSync(file).size);

      const summary = aggregator.finalize({ range: 'all' });
      assert.equal(summary.totals.messages, 4);
      assert.equal(summary.totals.totalTokens, 4 * 15);

      const claude = scanner.getStatuses().find((status) => status.source === 'claude');
      assert.ok(claude);
      assert.equal(claude.enabled, true);
      assert.equal(claude.events, 4);
      assert.equal(claude.error, null);
      assert.ok(claude.lastEventAt && claude.lastEventAt > 0);
      const codex = scanner.getStatuses().find((status) => status.source === 'codex');
      assert.ok(codex);
      assert.equal(codex.enabled, false, 'missing root is disabled without error');
      assert.equal(codex.error, null);
    } finally {
      store.close();
    }
  } finally {
    cleanupDir(home.home);
  }
});

test('scanner: per-file byte budget drains in bounded passes without duplicates', async () => {
  const home = createTestHome();
  try {
    const lines = Array.from({ length: 10 }, (_, index) => assistantLine(`msg_budget_${index}`));
    const file = writeClaudeSession(home.claudeDir, 'budget-project', 'session.jsonl', lines);
    const config = loadTestHomeConfig(home.home);
    const store = new Store(config.dbPath);
    try {
      const aggregator = new EventAggregator({ timezone: config.timezone });
      const scanner = new Scanner(store, aggregator, config, { concurrency: 1, fileBudgetBytes: 250 });
      scanner.init();
      const passes = await scanner.drain(50);
      assert.ok(passes.length >= 2, `expected multiple bounded passes, got ${passes.length}`);
      assert.equal(passes.reduce((sum, pass) => sum + pass.newEvents, 0), 10);
      assert.equal(store.countEvents(), 10);
      assert.equal(aggregator.size, 10);
      const state = store.getFileState(file);
      assert.ok(state);
      assert.equal(state.offset, statSync(file).size);
    } finally {
      store.close();
    }
  } finally {
    cleanupDir(home.home);
  }
});

test('scanner: files older than backfillDays are skipped until they change', async () => {
  const home = createTestHome({ backfillDays: 30 });
  try {
    const file = writeClaudeSession(home.claudeDir, 'old-project', 'old.jsonl', [assistantLine('msg_old_1')]);
    const old = Date.now() - 60 * 24 * 60 * 60 * 1000;
    utimesSync(file, new Date(old), new Date(old));
    const config = loadTestHomeConfig(home.home);
    const store = new Store(config.dbPath);
    try {
      const aggregator = new EventAggregator({ timezone: config.timezone });
      const scanner = new Scanner(store, aggregator, config);
      scanner.init();
      const skipped = await scanner.scanAll();
      assert.equal(skipped.newEvents, 0);
      assert.equal(store.countEvents(), 0);
      assert.equal(store.getFileState(file), null, 'old out-of-backfill file is not tracked');

      const now = new Date();
      utimesSync(file, now, now);
      const scanned = await scanner.scanAll();
      assert.equal(scanned.newEvents, 1);
      assert.equal(store.countEvents(), 1);
    } finally {
      store.close();
    }
  } finally {
    cleanupDir(home.home);
  }
});

test('scanner: codex incremental scan continues the model/session state', async () => {
  const home = createTestHome();
  try {
    const dir = `${home.codexDir}/sessions/2026/11/20`;
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    const file = `${dir}/rollout-2026-11-20T09-00-00-01c0ffee-1111-2222-3333-444455556666.jsonl`;
    writeFileSync(file, '');
    const config = loadTestHomeConfig(home.home);
    const store = new Store(config.dbPath);
    try {
      const aggregator = new EventAggregator({ timezone: config.timezone });
      const scanner = new Scanner(store, aggregator, config);
      scanner.init();
      assert.equal((await scanner.scanAll()).newEvents, 0);
      appendFileSync(
        file,
        `${JSON.stringify({
          timestamp: '2026-11-20T09:00:00.000Z',
          ordinal: 0,
          type: 'session_meta',
          payload: {
            session_id: '01c0ffee-1111-2222-3333-444455556666',
            id: '01c0ffee-1111-2222-3333-444455556666',
            cwd: '/Users/fixture/projects/incremental-codex',
            model_provider: 'openai',
            thread_source: 'user',
          },
        })}\n${JSON.stringify({
          timestamp: '2026-11-20T09:00:01.000Z',
          ordinal: 1,
          type: 'turn_context',
          payload: { model: 'gpt-6.2-astra', cwd: '/Users/fixture/projects/incremental-codex' },
        })}\n`,
      );
      assert.equal((await scanner.scanAll()).newEvents, 0, 'no usage yet');
      appendFileSync(
        file,
        `${JSON.stringify({
          timestamp: '2026-11-20T09:00:05.000Z',
          ordinal: 2,
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: {
                input_tokens: 1000,
                cached_input_tokens: 400,
                cache_write_input_tokens: 0,
                output_tokens: 100,
                reasoning_output_tokens: 0,
                total_tokens: 1100,
              },
              last_token_usage: {
                input_tokens: 1000,
                cached_input_tokens: 400,
                cache_write_input_tokens: 0,
                output_tokens: 100,
                reasoning_output_tokens: 0,
                total_tokens: 1100,
              },
            },
          },
        })}\n`,
      );
      const pass = await scanner.scanAll();
      assert.equal(pass.newEvents, 1);
      const event = [...store.iterateEvents()][0];
      assert.ok(event);
      assert.equal(event.model, 'gpt-6.2-astra');
      assert.equal(event.sessionId, '01c0ffee-1111-2222-3333-444455556666');
      assert.equal(event.inputTokens, 600);
      assert.equal(event.cacheReadTokens, 400);
      assert.equal(event.totalTokens, 1100);
      assert.equal(event.project, 'incremental-codex');
    } finally {
      store.close();
    }
  } finally {
    cleanupDir(home.home);
  }
});
