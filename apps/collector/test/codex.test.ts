import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { scanCodexFile } from '../src/sources/codex.js';
import { discoveredFile, fixturePath, makeContext } from './helpers.js';
import type { FileScanInput } from '../src/sources/types.js';

test('codex: per-turn deltas, cached-token subtraction and model switches', async () => {
  const file = discoveredFile(fixturePath('codex.jsonl'));
  const ctx = makeContext('UTC');
  const input: FileScanInput = { file, prior: null, priorParserState: null, ctx, maxBytes: 1 << 20 };
  const result = await scanCodexFile(input);
  assert.equal(result.events.length, 4, 'zero delta token_count is skipped');

  const first = result.events.find((event) => event.id === 'codex:01aaaabbbb-1111-2222-3333-444455556666:3');
  assert.ok(first, 'ordinal 3 event uses the session_meta session id');
  assert.equal(first.source, 'codex');
  assert.equal(first.sessionId, '01aaaabbbb-1111-2222-3333-444455556666');
  assert.equal(first.model, 'gpt-5.2-codex');
  assert.equal(first.provider, 'openai');
  assert.equal(first.agent, 'main');
  assert.equal(first.project, 'demo-api');
  assert.equal(first.inputTokens, 2000, 'input_tokens - cached_input_tokens');
  assert.equal(first.cacheReadTokens, 8000);
  assert.equal(first.cacheWriteTokens, 0);
  assert.equal(first.outputTokens, 400);
  assert.equal(first.reasoningTokens, 150);
  assert.equal(first.totalTokens, 10400);
  assert.equal(first.date, '2026-11-20');
  assert.equal(first.hour, 9);

  const second = result.events.find((event) => event.id === 'codex:01aaaabbbb-1111-2222-3333-444455556666:4');
  assert.ok(second);
  assert.equal(second.inputTokens, 1000);
  assert.equal(second.cacheReadTokens, 4000);
  assert.equal(second.cacheWriteTokens, 100);
  assert.equal(second.outputTokens, 300);
  assert.equal(second.totalTokens, 5400);

  // ordinal 5 has no last_token_usage: delta of total_token_usage (15800 -> 19000).
  const third = result.events.find((event) => event.id === 'codex:01aaaabbbb-1111-2222-3333-444455556666:5');
  assert.ok(third, 'total_token_usage delta fallback works');
  assert.equal(third.inputTokens, 1000);
  assert.equal(third.cacheReadTokens, 2000);
  assert.equal(third.outputTokens, 200);
  assert.equal(third.reasoningTokens, 0, 'reasoning did not grow in the usage delta');
  assert.equal(third.totalTokens, 3200);

  const last = result.events.find((event) => event.id === 'codex:01aaaabbbb-1111-2222-3333-444455556666:8');
  assert.ok(last, 'delta event after a model switch');
  assert.equal(last.model, 'gpt-6.2-astra', 'latest turn_context model wins');
  assert.equal(last.totalTokens, 550);
});

test('codex: incremental rescan keeps parser state and only emits appended turns', async () => {
  const file = discoveredFile(fixturePath('codex.jsonl'));
  const ctx = makeContext('UTC');
  const first = await scanCodexFile({ file, prior: null, priorParserState: null, ctx, maxBytes: 1 << 20 });
  assert.equal(first.events.length, 4);
  assert.ok(first.parserState, 'parser state (model/cwd/session) persisted');

  const second = await scanCodexFile({
    file,
    prior: { offset: first.offset, mtimeMs: file.mtimeMs, size: file.size },
    priorParserState: first.parserState ?? null,
    ctx,
    maxBytes: 1 << 20,
  });
  assert.equal(second.events.length, 0);
  assert.equal(second.offset, first.offset);

  const state = JSON.parse(first.parserState ?? '{}') as { model?: string; sessionId?: string };
  assert.equal(state.model, 'gpt-6.2-astra');
  assert.equal(state.sessionId, '01aaaabbbb-1111-2222-3333-444455556666');
});

test('codex: subagent rollouts use their own thread id and agent_role', async () => {
  const file = discoveredFile(fixturePath('codex-subagent.jsonl'));
  const ctx = makeContext('UTC');
  const result = await scanCodexFile({ file, prior: null, priorParserState: null, ctx, maxBytes: 1 << 20 });
  assert.equal(result.events.length, 1);
  const event = result.events[0];
  assert.ok(event);
  assert.equal(event.sessionId, '01subagent-aaaa-bbbb-cccc-dddddddddddd', 'own thread id, not the parent session id');
  assert.equal(event.agent, 'worker', 'agent_role when present');
  assert.equal(event.model, 'gpt-6.2-astra');
  assert.equal(event.totalTokens, 550);
});

test('codex fixture file is hand-written JSONL (no user data)', () => {
  for (const name of ['codex.jsonl', 'codex-subagent.jsonl']) {
    const lines = readFileSync(fixturePath(name), 'utf8').trim().split('\n');
    assert.ok(lines.length >= 3);
    for (const line of lines) JSON.parse(line);
  }
});
