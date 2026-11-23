import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { scanClaudeFile } from '../src/sources/claude.js';
import { discoveredFile, fixturePath, makeContext } from './helpers.js';
import type { FileScanInput } from '../src/sources/types.js';

test('claude: parses assistant usage, dedupes message.id and skips synthetic/zero rows', async () => {
  const file = discoveredFile(fixturePath('claude.jsonl'));
  const input: FileScanInput = {
    file,
    prior: null,
    priorParserState: null,
    ctx: makeContext('UTC'),
    maxBytes: 1024 * 1024,
  };
  const result = await scanClaudeFile(input);
  assert.equal(result.events.length, 3, 'duplicate msg_fixture_1 collapsed, synthetic/zero skipped');
  assert.equal(result.offset, file.size, 'consumed every complete line');
  assert.equal(result.more, false);

  const first = result.events.find((event) => event.id === 'claude:msg_fixture_1');
  assert.ok(first, 'first message present');
  assert.equal(first.source, 'claude');
  assert.equal(first.sessionId, 'session-fixture-1');
  assert.equal(first.model, 'claude-sonnet-4-6');
  assert.equal(first.provider, 'anthropic');
  assert.equal(first.agent, 'main');
  assert.equal(first.project, 'demo-app');
  assert.equal(first.cwd, '/Users/fixture/projects/demo-app');
  assert.equal(first.inputTokens, 12);
  assert.equal(first.outputTokens, 250);
  assert.equal(first.cacheReadTokens, 2000);
  assert.equal(first.cacheWriteTokens, 1000);
  assert.equal(first.reasoningTokens, 100);
  assert.equal(first.totalTokens, 3262, 'total = input + output + cacheRead + cacheWrite');
  assert.equal(first.date, '2026-11-20');
  assert.equal(first.hour, 10);
  assert.equal(first.costUsd, 0.008136, 'core pricing: sonnet list price');

  const sidechain = result.events.find((event) => event.id === 'claude:msg_fixture_2');
  assert.ok(sidechain);
  assert.equal(sidechain.agent, 'subagent');
  assert.equal(sidechain.model, 'claude-opus-4-6');

  const pretty = result.events.find((event) => event.id === 'claude:msg_fixture_5');
  assert.ok(pretty, 'pretty-printed JSON line is parsed too');
  assert.equal(pretty.model, 'claude-haiku-4-5');
  assert.equal(pretty.totalTokens, 15);
});

test('claude: incremental rescan from the persisted offset emits nothing new', async () => {
  const file = discoveredFile(fixturePath('claude.jsonl'));
  const ctx = makeContext('UTC');
  const first = await scanClaudeFile({ file, prior: null, priorParserState: null, ctx, maxBytes: 1 << 20 });
  assert.equal(first.events.length, 3);
  const second = await scanClaudeFile({
    file,
    prior: { offset: first.offset, mtimeMs: file.mtimeMs, size: file.size },
    priorParserState: null,
    ctx,
    maxBytes: 1 << 20,
  });
  assert.equal(second.events.length, 0);
  assert.equal(second.offset, first.offset);
});

test('claude fixture file is hand-written JSONL (no user data)', () => {
  const lines = readFileSync(fixturePath('claude.jsonl'), 'utf8').trim().split('\n');
  assert.ok(lines.length >= 5);
  for (const line of lines) JSON.parse(line);
});
