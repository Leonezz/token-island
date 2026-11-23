/**
 * Claude Code parser — `~/.claude/projects/**\/*.jsonl`.
 *
 * Only `{"type":"assistant"}` lines carry usage.  The same `message.id` is
 * logged roughly twice (identical usage), so the parser dedupes per file and
 * the SQLite primary key makes it idempotent across scans.  Files can exceed
 * 300 MB and are streamed from a persisted byte offset.
 */

import path from 'node:path';
import type { UsageEvent } from '@token-island/core';
import { readLinesFromOffset } from '../stream.js';
import type { FileScanInput, FileScanResult, JsonlSourceSpec, SourceContext } from './types.js';
import {
  buildUsageEvent,
  isRecord,
  nonNegativeInt,
  parseTimestamp,
  startOffsetFor,
  stringValue,
  sumTokens,
} from './util.js';

const ASSISTANT_MARKER = Buffer.from('"type":"assistant"');
const ASSISTANT_MARKER_PRETTY = Buffer.from('"type": "assistant"');
const SYNTHETIC_MODEL = '<synthetic>';

/** Accepts both minified and pretty-printed JSONL (`"type":"assistant"` / `"type": "assistant"`). */
function looksLikeAssistantLine(line: Buffer): boolean {
  return line.indexOf(ASSISTANT_MARKER) !== -1 || line.indexOf(ASSISTANT_MARKER_PRETTY) !== -1;
}

export function parseClaudeLine(
  line: Buffer,
  filePath: string,
  offsetAfter: number,
  ctx: SourceContext,
): UsageEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.type !== 'assistant') return null;

  const message = isRecord(parsed.message) ? parsed.message : null;
  const usage = message && isRecord(message.usage) ? message.usage : null;
  if (!message || !usage) return null;

  const model = stringValue(message.model).trim();
  if (model.length === 0 || model === SYNTHETIC_MODEL) return null;

  const counts = {
    inputTokens: nonNegativeInt(usage.input_tokens),
    outputTokens: nonNegativeInt(usage.output_tokens),
    cacheReadTokens: nonNegativeInt(usage.cache_read_input_tokens),
    cacheWriteTokens: nonNegativeInt(usage.cache_creation_input_tokens),
  };
  if (sumTokens(counts) <= 0) return null;

  const details = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : null;
  const ts = parseTimestamp(parsed.timestamp);
  if (ts === null) return null;

  const fileName = path.basename(filePath);
  const sessionId = stringValue(parsed.sessionId).trim() || path.basename(filePath, path.extname(filePath));
  const messageId = stringValue(message.id).trim();
  const id = messageId.length > 0 ? `claude:${messageId}` : `claude:${fileName}:${offsetAfter}`;

  return buildUsageEvent(
    {
      id,
      source: 'claude',
      sessionId,
      messageId,
      ts,
      model,
      provider: 'anthropic',
      agent: parsed.isSidechain === true ? 'subagent' : 'main',
      cwd: stringValue(parsed.cwd),
      counts: {
        ...counts,
        reasoningTokens: details ? nonNegativeInt(details.thinking_tokens) : 0,
      },
    },
    ctx,
  );
}

export async function scanClaudeFile(input: FileScanInput): Promise<FileScanResult> {
  const { file, ctx } = input;
  const events: UsageEvent[] = [];
  const seen = new Set<string>();
  const read = await readLinesFromOffset(file.path, {
    start: startOffsetFor(file, input.prior),
    maxBytes: input.maxBytes,
    sizeHint: file.size,
    onLine: (line, nextOffset) => {
      if (!looksLikeAssistantLine(line)) return;
      const event = parseClaudeLine(line, file.path, nextOffset, ctx);
      if (!event) return;
      if (seen.has(event.id)) return;
      seen.add(event.id);
      events.push(event);
    },
  });
  return {
    events,
    offset: read.nextOffset,
    size: file.size,
    mtimeMs: file.mtimeMs,
    more: read.more,
  };
}

export const claudeSource: JsonlSourceSpec = {
  id: 'claude',
  mode: 'append',
  watchDir: (root) => path.join(root, 'projects'),
  match: (fileName) => fileName.endsWith('.jsonl'),
  parseFile: scanClaudeFile,
};
