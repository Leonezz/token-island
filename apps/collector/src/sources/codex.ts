/**
 * OpenAI Codex parser — `~/.codex/sessions/**\/rollout-*.jsonl`.
 *
 * Usage lives in `event_msg` / `token_count` events and is a per-turn delta
 * (`payload.info.last_token_usage`); OpenAI reports cached prompt tokens inside
 * `input_tokens`, so we subtract them to follow the shared normalized shape.
 * Model/cwd/session identity come from the first `session_meta` and the latest
 * `turn_context`; that small amount of cross-line state is persisted in `kv`
 * so incremental scans and daemon restarts continue correctly.
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

const SESSION_META_MARKER = Buffer.from('"session_meta"');
const TURN_CONTEXT_MARKER = Buffer.from('"turn_context"');
const TOKEN_COUNT_MARKER = Buffer.from('"token_count"');
const UUID_FILE_PATTERN =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

interface RawUsage {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

interface CodexParserState {
  version: 1;
  /** Session identity used in the dedupe id (per-file unique). */
  sessionId: string;
  cwd: string;
  model: string;
  provider: string;
  agent: string;
  /** Identity/agent are fixed by the first `session_meta` line only. */
  hasSessionMeta: boolean;
  /** Previous cumulative `total_token_usage`, for delta fallback. */
  lastTotal: RawUsage | null;
}

function emptyState(): CodexParserState {
  return {
    version: 1,
    sessionId: '',
    cwd: '',
    model: '',
    provider: '',
    agent: 'main',
    hasSessionMeta: false,
    lastTotal: null,
  };
}

function readRawUsage(value: Record<string, unknown>): RawUsage {
  return {
    input_tokens: nonNegativeInt(value.input_tokens),
    cached_input_tokens: nonNegativeInt(value.cached_input_tokens),
    cache_write_input_tokens: nonNegativeInt(value.cache_write_input_tokens),
    output_tokens: nonNegativeInt(value.output_tokens),
    reasoning_output_tokens: nonNegativeInt(value.reasoning_output_tokens),
    total_tokens: nonNegativeInt(value.total_tokens),
  };
}

function subtractUsage(total: RawUsage, previous: RawUsage): RawUsage {
  return {
    input_tokens: Math.max(0, total.input_tokens - previous.input_tokens),
    cached_input_tokens: Math.max(0, total.cached_input_tokens - previous.cached_input_tokens),
    cache_write_input_tokens: Math.max(0, total.cache_write_input_tokens - previous.cache_write_input_tokens),
    output_tokens: Math.max(0, total.output_tokens - previous.output_tokens),
    reasoning_output_tokens: Math.max(0, total.reasoning_output_tokens - previous.reasoning_output_tokens),
    total_tokens: Math.max(0, total.total_tokens - previous.total_tokens),
  };
}

/** OpenAI reports cached prompt tokens *inside* input tokens. */
function normalizeUsage(raw: RawUsage): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
} {
  return {
    inputTokens: Math.max(0, raw.input_tokens - raw.cached_input_tokens),
    outputTokens: raw.output_tokens,
    cacheReadTokens: raw.cached_input_tokens,
    cacheWriteTokens: raw.cache_write_input_tokens,
    reasoningTokens: raw.reasoning_output_tokens,
  };
}

function fileUuid(filePath: string): string {
  const match = UUID_FILE_PATTERN.exec(path.basename(filePath));
  return match && match[1] ? match[1] : path.basename(filePath, '.jsonl');
}

function loadParserState(raw: string | null): CodexParserState {
  if (!raw) return emptyState();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return emptyState();
    const state = emptyState();
    state.sessionId = stringValue(parsed.sessionId);
    state.cwd = stringValue(parsed.cwd);
    state.model = stringValue(parsed.model);
    state.provider = stringValue(parsed.provider);
    state.agent = stringValue(parsed.agent) || 'main';
    state.hasSessionMeta = parsed.hasSessionMeta === true;
    if (isRecord(parsed.lastTotal)) state.lastTotal = readRawUsage(parsed.lastTotal);
    return state;
  } catch {
    return emptyState();
  }
}

function isSubagentSource(payload: Record<string, unknown>): boolean {
  const source = payload.source;
  if (isRecord(source)) {
    if (source.subagent !== undefined && source.subagent !== null) {
      return source.subagent !== false;
    }
    return false;
  }
  if (typeof source === 'string') return source === 'subagent';
  return stringValue(payload.thread_source) === 'subagent';
}

function applySessionMeta(state: CodexParserState, payload: Record<string, unknown>, filePath: string): void {
  if (state.hasSessionMeta) return; // Identity is fixed by the first session_meta line.
  state.hasSessionMeta = true;
  const sessionId = stringValue(payload.session_id).trim();
  const ownId = stringValue(payload.id).trim();
  const subagent = isSubagentSource(payload);
  // Sub-agent rollouts log the *parent* thread as `session_id`; use the
  // rollout's own thread id so ids stay unique per file (ordinals repeat).
  state.sessionId = subagent ? ownId || sessionId || fileUuid(filePath) : sessionId || ownId || fileUuid(filePath);
  const agentRole = stringValue(payload.agent_role).trim();
  state.agent = subagent ? agentRole || 'subagent' : 'main';
  const cwd = stringValue(payload.cwd);
  if (cwd) state.cwd = cwd;
  const provider = stringValue(payload.model_provider);
  if (provider) state.provider = provider;
  const model = stringValue(payload.model);
  if (model) state.model = model;
}

function applyTurnContext(state: CodexParserState, payload: Record<string, unknown>): void {
  const model = stringValue(payload.model).trim();
  if (model) state.model = model;
  const cwd = stringValue(payload.cwd);
  if (cwd) state.cwd = cwd;
  const agentRole = stringValue(payload.agent_role).trim();
  if (agentRole) state.agent = agentRole;
}

function handleLine(
  line: Buffer,
  state: CodexParserState,
  filePath: string,
  offsetAfter: number,
  ctx: SourceContext,
  events: UsageEvent[],
): void {
  const hasMeta = line.indexOf(SESSION_META_MARKER) !== -1;
  const hasTurn = !hasMeta && line.indexOf(TURN_CONTEXT_MARKER) !== -1;
  const hasTokenCount = !hasMeta && !hasTurn && line.indexOf(TOKEN_COUNT_MARKER) !== -1;
  if (!hasMeta && !hasTurn && !hasTokenCount) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(line.toString('utf8'));
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  const payload = isRecord(parsed.payload) ? parsed.payload : null;
  if (!payload) return;
  const type = stringValue(parsed.type);

  if (hasMeta && type === 'session_meta') {
    applySessionMeta(state, payload, filePath);
    return;
  }
  if (hasTurn && type === 'turn_context') {
    applyTurnContext(state, payload);
    return;
  }
  if (!hasTokenCount || type !== 'event_msg' || payload.type !== 'token_count') return;

  const info = isRecord(payload.info) ? payload.info : null;
  if (!info) return;
  const lastUsage = isRecord(info.last_token_usage) ? info.last_token_usage : null;
  const totalUsage = isRecord(info.total_token_usage) ? info.total_token_usage : null;
  const totalRaw = totalUsage ? readRawUsage(totalUsage) : null;
  let raw: RawUsage | null = lastUsage ? readRawUsage(lastUsage) : null;
  if (!raw && totalRaw) {
    raw = state.lastTotal ? subtractUsage(totalRaw, state.lastTotal) : totalRaw;
  }
  if (totalRaw) state.lastTotal = totalRaw;
  if (!raw) return;

  const counts = normalizeUsage(raw);
  if (sumTokens(counts) <= 0) return;
  const ts = parseTimestamp(parsed.timestamp);
  if (ts === null) return;

  const ordinal = Number(parsed.ordinal);
  const ordinalKey = Number.isFinite(ordinal) ? String(Math.floor(ordinal)) : `offset${offsetAfter}`;
  const sessionId = state.sessionId || fileUuid(filePath);
  events.push(
    buildUsageEvent(
      {
        id: `codex:${sessionId}:${ordinalKey}`,
        source: 'codex',
        sessionId,
        ts,
        model: state.model || 'unknown',
        provider: state.provider,
        agent: state.agent,
        cwd: state.cwd,
        counts,
      },
      ctx,
    ),
  );
}

export async function scanCodexFile(input: FileScanInput): Promise<FileScanResult> {
  const { file, ctx } = input;
  const state = loadParserState(input.priorParserState);
  const events: UsageEvent[] = [];
  const seen = new Set<string>();
  const read = await readLinesFromOffset(file.path, {
    start: startOffsetFor(file, input.prior),
    maxBytes: input.maxBytes,
    sizeHint: file.size,
    onLine: (line, nextOffset) => {
      const before = events.length;
      handleLine(line, state, file.path, nextOffset, ctx, events);
      if (events.length === before) return;
      // Cheap per-file dedupe guard for rewritten duplicate lines.
      const event = events[events.length - 1];
      if (!event) return;
      if (seen.has(event.id)) events.pop();
      else seen.add(event.id);
    },
  });
  return {
    events,
    offset: read.nextOffset,
    size: file.size,
    mtimeMs: file.mtimeMs,
    more: read.more,
    parserState: JSON.stringify(state),
  };
}

export const codexSource: JsonlSourceSpec = {
  id: 'codex',
  mode: 'append',
  watchDir: (root) => path.join(root, 'sessions'),
  match: (fileName) => fileName.startsWith('rollout-') && fileName.endsWith('.jsonl'),
  parseFile: scanCodexFile,
};
