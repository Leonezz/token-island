/**
 * Validation / normalisation for the ingest payload.
 *
 * The cloud only accepts small numeric daily aggregates; anything suspicious
 * (bad dates, negatives, non-numeric counters, absurd array sizes) is rejected
 * with a 400 before it reaches SQLite.  `totalTokens` is always recomputed from
 * the four buckets so the core invariant holds even if a client sends a stale
 * or inconsistent total.
 */

import type { CloudDay } from '@token-island/core';

export const MAX_DAYS_PER_INGEST = 400;
export const MAX_BODY_BYTES = 400 * 1024;
export const MAX_REGISTER_BODY_BYTES = 64 * 1024;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_MODEL_ENTRIES = 100;
const MAX_MODEL_ID_LENGTH = 160;

const NUMBER_KEYS = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
  'unpricedTokens',
  'messages',
] as const;

const TOKEN_KEYS = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
] as const;

export class CloudValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CloudValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asCount(value: unknown, field: string, index: number): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CloudValidationError('invalid_days', `days[${index}].${field} must be a finite number`);
  }
  if (value < 0) {
    throw new CloudValidationError('invalid_days', `days[${index}].${field} must not be negative`);
  }
  return Math.round(value);
}

function asCost(value: unknown, field: string, index: number): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CloudValidationError('invalid_days', `days[${index}].${field} must be a finite number`);
  }
  if (value < 0) {
    throw new CloudValidationError('invalid_days', `days[${index}].${field} must not be negative`);
  }
  return Math.round(value * 1e6) / 1e6;
}

function isValidDate(date: string): boolean {
  const match = DATE_PATTERN.exec(date);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
  );
}

function parseModels(value: unknown, index: number): Record<string, number> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new CloudValidationError('invalid_days', `days[${index}].models must be an object`);
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_MODEL_ENTRIES) {
    throw new CloudValidationError(
      'invalid_days',
      `days[${index}].models must contain at most ${MAX_MODEL_ENTRIES} entries`,
    );
  }
  const models: Record<string, number> = {};
  for (const [model, tokens] of entries) {
    const cleanModel = model.trim().slice(0, MAX_MODEL_ID_LENGTH);
    if (cleanModel === '') continue;
    if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0) {
      throw new CloudValidationError(
        'invalid_days',
        `days[${index}].models.${model} must be a non-negative number`,
      );
    }
    const rounded = Math.round(tokens);
    if (rounded > 0) models[cleanModel] = rounded;
  }
  return Object.keys(models).length > 0 ? models : undefined;
}

/** Parses one raw CloudDay object (unknown JSON). */
export function parseCloudDay(raw: unknown, index: number): CloudDay {
  if (!isRecord(raw)) {
    throw new CloudValidationError('invalid_days', `days[${index}] must be an object`);
  }
  const dateRaw = raw.date;
  if (typeof dateRaw !== 'string' || !isValidDate(dateRaw)) {
    throw new CloudValidationError(
      'invalid_days',
      `days[${index}].date must be a valid YYYY-MM-DD calendar date`,
    );
  }

  const counts: Record<(typeof TOKEN_KEYS)[number], number> = {
    inputTokens: asCount(raw.inputTokens, 'inputTokens', index),
    outputTokens: asCount(raw.outputTokens, 'outputTokens', index),
    cacheReadTokens: asCount(raw.cacheReadTokens, 'cacheReadTokens', index),
    cacheWriteTokens: asCount(raw.cacheWriteTokens, 'cacheWriteTokens', index),
    reasoningTokens: asCount(raw.reasoningTokens, 'reasoningTokens', index),
  };
  const totalTokens =
    counts.inputTokens + counts.outputTokens + counts.cacheReadTokens + counts.cacheWriteTokens;

  const unpricedTokens = Math.min(asCount(raw.unpricedTokens, 'unpricedTokens', index), totalTokens);
  const messages = asCount(raw.messages, 'messages', index);
  const costUsd = asCost(raw.costUsd, 'costUsd', index);
  const models = parseModels(raw.models, index);

  const day: CloudDay = {
    date: dateRaw,
    ...counts,
    totalTokens,
    unpricedTokens,
    costUsd,
    messages,
  };
  if (models) day.models = models;
  return day;
}

/** Parses the `days` field of an ingest payload. */
export function parseCloudDays(raw: unknown): CloudDay[] {
  if (!Array.isArray(raw)) {
    throw new CloudValidationError('invalid_days', 'days must be an array of daily aggregates');
  }
  if (raw.length > MAX_DAYS_PER_INGEST) {
    throw new CloudValidationError(
      'invalid_days',
      `days must contain at most ${MAX_DAYS_PER_INGEST} entries (got ${raw.length})`,
    );
  }
  return raw.map((entry, index) => parseCloudDay(entry, index));
}

/** Validates a register payload and returns the requested fields. */
export interface ParsedRegisterBody {
  username: string | undefined;
  displayName: string | undefined;
}

export function parseRegisterBody(raw: unknown): ParsedRegisterBody {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CloudValidationError('invalid_body', 'request body must be a JSON object');
  }
  const body = raw as Record<string, unknown>;
  let username: string | undefined;
  if (body.username !== undefined && body.username !== null) {
    if (typeof body.username !== 'string') {
      throw new CloudValidationError('invalid_username', 'username must be a string');
    }
    const trimmed = body.username.trim();
    if (trimmed !== '') username = trimmed;
  }
  let displayName: string | undefined;
  if (body.displayName !== undefined && body.displayName !== null) {
    if (typeof body.displayName !== 'string') {
      throw new CloudValidationError('invalid_display_name', 'displayName must be a string');
    }
    displayName = body.displayName;
  }
  return { username, displayName };
}
