/** Helpers shared by the normalizing source parsers. */

import path from 'node:path';
import { dateKey, estimateCostUsd, localHour } from '@token-island/core';
import type { SourceId, UsageEvent } from '@token-island/core';
import type { DiscoveredFile, SourceContext, StoredFileState } from './types.js';

export interface CountsInput {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export interface BuildEventInput {
  id: string;
  source: SourceId;
  sessionId: string;
  messageId?: string;
  ts: number;
  model: string;
  provider?: string;
  agent?: string;
  cwd?: string;
  counts: CountsInput;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Token counters are non-negative integers; anything else becomes 0. */
export function nonNegativeInt(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Epoch-ms from a number or an ISO-8601 string; null when unparseable. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function sumTokens(counts: CountsInput): number {
  return (
    nonNegativeInt(counts.inputTokens) +
    nonNegativeInt(counts.outputTokens) +
    nonNegativeInt(counts.cacheReadTokens) +
    nonNegativeInt(counts.cacheWriteTokens)
  );
}

/** Project label: basename of the working directory, `unknown` when absent. */
export function projectFromCwd(cwd: string): string {
  const trimmed = cwd.trim();
  if (trimmed.length === 0) return 'unknown';
  const base = path.basename(trimmed);
  return base.length > 0 && base !== '.' ? base : 'unknown';
}

/**
 * Builds a fully normalized `UsageEvent`: local date/hour, computed total and
 * estimated cost from the shared core pricing table + user overrides.
 */
export function buildUsageEvent(input: BuildEventInput, ctx: SourceContext): UsageEvent {
  const inputTokens = nonNegativeInt(input.counts.inputTokens);
  const outputTokens = nonNegativeInt(input.counts.outputTokens);
  const cacheReadTokens = nonNegativeInt(input.counts.cacheReadTokens);
  const cacheWriteTokens = nonNegativeInt(input.counts.cacheWriteTokens);
  const reasoningTokens = nonNegativeInt(input.counts.reasoningTokens);
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const cwd = stringValue(input.cwd).trim();
  const model = input.model.length > 0 ? input.model : 'unknown';
  const provider = input.provider ?? '';
  const costUsd = estimateCostUsd(
    { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
    model,
    provider,
    ctx.prices,
  );
  return {
    id: input.id,
    source: input.source,
    sessionId: input.sessionId,
    messageId: input.messageId ?? '',
    ts: input.ts,
    date: dateKey(input.ts, ctx.timezone),
    hour: localHour(input.ts, ctx.timezone),
    model,
    provider,
    agent: input.agent && input.agent.length > 0 ? input.agent : 'main',
    project: projectFromCwd(cwd),
    cwd,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
    costUsd,
  };
}

/** Byte offset to resume reading from, resetting to 0 if the file shrank. */
export function startOffsetFor(file: DiscoveredFile, prior: StoredFileState | null): number {
  if (!prior) return 0;
  if (file.size < prior.offset) return 0;
  return Math.max(0, prior.offset);
}
