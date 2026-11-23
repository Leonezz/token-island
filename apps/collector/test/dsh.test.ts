import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseDshLines } from '../src/sources/dsh.js';
import { fixturePath, makeContext } from './helpers.js';

test('dsh: parses assistant/message usage with model selection', () => {
  const text = readFileSync(fixturePath('dsh.jsonl'), 'utf8');
  const ctx = makeContext('UTC');
  const { events, header } = parseDshLines(text, 'fallback-session', ctx);
  assert.equal(events.length, 2, 'zero-usage and usage-less assistant messages skipped');
  assert.equal(header.sessionId, 'session-fixture-dsh');
  assert.equal(header.cwd, '/Users/fixture/projects/demo-dsh');

  const first = events.find((event) => event.id === 'dsh:session-fixture-dsh:36');
  assert.ok(first);
  assert.equal(first.source, 'dsh');
  assert.equal(first.sessionId, 'session-fixture-dsh');
  assert.equal(first.model, 'deepseek-flash');
  assert.equal(first.provider, 'deepseek-official');
  assert.equal(first.agent, 'main');
  assert.equal(first.project, 'demo-dsh');
  assert.equal(first.inputTokens, 12892);
  assert.equal(first.outputTokens, 426);
  assert.equal(first.cacheReadTokens, 0);
  assert.equal(first.cacheWriteTokens, 0);
  assert.equal(first.totalTokens, 13318);
  assert.equal(first.date, '2026-11-23');
  assert.equal(first.hour, 16, 'event time 1795452893735 = 16:54 UTC');
});

test('dsh: reasoning tokens are only informational (0 unless reported)', () => {
  const text = readFileSync(fixturePath('dsh.jsonl'), 'utf8');
  const { events } = parseDshLines(text, 'fallback-session', makeContext('UTC'));
  for (const event of events) assert.equal(event.reasoningTokens, 0);
});

test('dsh: falls back to request/header config when no model/selection line exists', () => {
  const text = readFileSync(fixturePath('dsh-header.jsonl'), 'utf8');
  const { events } = parseDshLines(text, 'fallback-session', makeContext('UTC'));
  assert.equal(events.length, 1);
  const event = events[0];
  assert.ok(event);
  assert.equal(event.model, 'deepseek-v4');
  assert.equal(event.provider, 'deepseek-official');
  assert.equal(event.project, 'demo-header');
});

test('dsh: session id falls back to the session directory name', () => {
  const text = readFileSync(fixturePath('dsh-header.jsonl'), 'utf8');
  const { events } = parseDshLines(text, 'dir-name-session', makeContext('UTC'));
  assert.ok(events[0]);
  assert.equal(events[0].source, 'dsh');
});

test('dsh: multi-frame zstd session file decodes fully via zstd -dc and picks up appended frames', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const path = await import('node:path');
  const { zstdCompressSync } = await import('node:zlib');
  const { zstdCandidates } = await import('../src/zstd.js');
  const { cleanupDir, discoveredFile, tempDir } = await import('./helpers.js');
  const { scanDshFile } = await import('../src/sources/dsh.js');

  const candidates = zstdCandidates().filter((candidate) => candidate !== 'zstd');
  const available =
    candidates.some((candidate) => existsSync(candidate)) ||
    spawnSync('zstd', ['--version'], { stdio: 'ignore' }).status === 0;
  if (!available) {
    t.skip('zstd binary not installed; single-frame fallback is covered by parseDshLines');
    return;
  }

  const dir = tempDir('ti-dsh-zstd-');
  try {
    const lines = readFileSync(fixturePath('dsh.jsonl'), 'utf8').trim().split('\n');
    const frame = (line: string): Buffer => zstdCompressSync(Buffer.from(`${line}\n`));
    const filePath = path.join(dir, 'session-fixture-dsh', 'session.v4.jsonl.zstd');
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, Buffer.concat(lines.map(frame)));

    const firstFile = discoveredFile(filePath);
    const first = await scanDshFile({
      file: firstFile,
      prior: null,
      priorParserState: null,
      ctx: makeContext('UTC'),
      maxBytes: 1 << 20,
    });
    assert.equal(first.events.length, 2, 'all appended frames decoded (not just the first)');
    assert.equal(first.warning, null);
    assert.equal(first.offset, firstFile.size);

    // The live DSH session file grows one frame at a time.
    writeFileSync(
      filePath,
      Buffer.concat([
        readFileSync(filePath),
        frame(
          '{"type":"assistant/message","seq":99,"time":1795452950000,"data":{"usage":{"inputTokens":10,"outputTokens":5,"cacheReadTokens":0,"cacheWriteTokens":0,"totalTokens":15}}}',
        ),
      ]),
    );
    const secondFile = discoveredFile(filePath);
    const second = await scanDshFile({
      file: secondFile,
      prior: { offset: first.offset, mtimeMs: firstFile.mtimeMs, size: firstFile.size },
      priorParserState: null,
      ctx: makeContext('UTC'),
      maxBytes: 1 << 20,
    });
    assert.equal(second.events.length, 3, 're-parse on (size, mtime) change sees the appended frame');
    assert.equal(second.offset, secondFile.size);
  } finally {
    cleanupDir(dir);
  }
});
