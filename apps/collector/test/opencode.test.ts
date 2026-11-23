import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Store } from '../src/db.js';
import { scanOpencodeDatabase } from '../src/sources/opencode.js';
import { cleanupDir, fixturePath, makeContext, tempDir } from './helpers.js';

interface FixtureMessage {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: Record<string, unknown>;
}

function buildOpencodeDb(): string {
  const dir = tempDir('ti-opencode-db-');
  const dbPath = path.join(dir, 'opencode.db');
  const fixture = JSON.parse(readFileSync(fixturePath('opencode-messages.json'), 'utf8')) as {
    messages: FixtureMessage[];
  };
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(
      'CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL)',
    );
    const insert = db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)');
    for (const message of fixture.messages) {
      insert.run(message.id, message.session_id, message.time_created, message.time_updated, JSON.stringify(message.data));
    }
  } finally {
    db.close();
  }
  return dbPath;
}

test('opencode: parses assistant messages, reasoning folded into output, reported cost honoured', async () => {
  const dbPath = buildOpencodeDb();
  try {
    const ctx = { ...makeContext('UTC'), dbPath };
    const result = await scanOpencodeDatabase(ctx, 0);
    assert.equal(result.events.length, 2, 'user message and zero-token message skipped');
    assert.equal(result.watermark, 1795400301000, 'watermark is max(time_updated) of scanned rows');

    const first = result.events.find((event) => event.id === 'opencode:msg_oc_1');
    assert.ok(first);
    assert.equal(first.source, 'opencode');
    assert.equal(first.sessionId, 'sess_oc_1');
    assert.equal(first.messageId, 'msg_oc_1');
    assert.equal(first.model, 'glm-4.7-free');
    assert.equal(first.provider, 'opencode');
    assert.equal(first.agent, 'build');
    assert.equal(first.project, 'demo-oc');
    assert.equal(first.inputTokens, 1000);
    assert.equal(first.outputTokens, 250, 'output = output + reasoning');
    assert.equal(first.reasoningTokens, 50);
    assert.equal(first.cacheReadTokens, 300);
    assert.equal(first.totalTokens, 1550);
    assert.equal(first.date, '2026-11-23');
    assert.equal(first.hour, 2);
    assert.equal(first.costUsd, 0, 'glm-4.7-free matches the free price rule');

    const second = result.events.find((event) => event.id === 'opencode:msg_oc_2');
    assert.ok(second);
    assert.equal(second.costUsd, 0.0123, 'OpenCode-reported positive cost wins over the estimate');
    assert.equal(second.model, 'kimi-k2.5');
    assert.equal(second.totalTokens, 120);
  } finally {
    cleanupDir(path.dirname(dbPath));
  }
});

test('opencode: 10 minute overlap re-reads rows but SQLite dedupe keeps them idempotent', async () => {
  const dbPath = buildOpencodeDb();
  const storeDir = tempDir('ti-opencode-store-');
  const store = new Store(path.join(storeDir, 'data.db'));
  try {
    const ctx = { ...makeContext('UTC'), dbPath };
    const first = await scanOpencodeDatabase(ctx, 0);
    const insertedFirst = store.insertEvents(first.events);
    assert.equal(insertedFirst.inserted.length, 2);
    const second = await scanOpencodeDatabase(ctx, first.watermark);
    assert.ok(second.events.length >= 2, 'overlap window re-reads recent rows');
    const insertedSecond = store.insertEvents(second.events);
    assert.equal(insertedSecond.inserted.length, 0, 'same message ids are skipped');
    assert.equal(store.countEvents(), 2);
  } finally {
    store.close();
    cleanupDir(storeDir);
    cleanupDir(path.dirname(dbPath));
  }
});
