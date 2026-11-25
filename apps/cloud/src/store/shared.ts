/**
 * Shared row-mapping and multi-device additive rollup helpers used by both
 * `NodeStore` (`node:sqlite`) and `D1Store` (Cloudflare D1).
 */

import type { CloudDay } from '@token-island/core';
import type {
  DeviceRecord,
  OAuthDeviceSession,
  StoredDay,
  UserRecord,
  UserVisibility,
} from './types.js';

export const UPSERT_AGGREGATED_DAY_SQL = `
  INSERT INTO days (
    username, date, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    reasoning_tokens, total_tokens, unpriced_tokens, cost_usd, messages, models_json, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(username, date) DO UPDATE SET
    input_tokens = excluded.input_tokens,
    output_tokens = excluded.output_tokens,
    cache_read_tokens = excluded.cache_read_tokens,
    cache_write_tokens = excluded.cache_write_tokens,
    reasoning_tokens = excluded.reasoning_tokens,
    total_tokens = excluded.total_tokens,
    unpriced_tokens = excluded.unpriced_tokens,
    cost_usd = excluded.cost_usd,
    messages = excluded.messages,
    models_json = excluded.models_json,
    updated_at = excluded.updated_at
`;

export const UPSERT_DEVICE_DAY_SQL = `
  INSERT INTO device_days (
    username, device_id, date, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    reasoning_tokens, total_tokens, unpriced_tokens, cost_usd, messages, models_json, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(username, device_id, date) DO UPDATE SET
    input_tokens = excluded.input_tokens,
    output_tokens = excluded.output_tokens,
    cache_read_tokens = excluded.cache_read_tokens,
    cache_write_tokens = excluded.cache_write_tokens,
    reasoning_tokens = excluded.reasoning_tokens,
    total_tokens = excluded.total_tokens,
    unpriced_tokens = excluded.unpriced_tokens,
    cost_usd = excluded.cost_usd,
    messages = excluded.messages,
    models_json = excluded.models_json,
    updated_at = excluded.updated_at
`;

export const UPSERT_DEVICE_SQL = `
  INSERT INTO devices (
    device_id, user_id, username, device_name, platform, key_hash, created_at, last_sync_at, revoked_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  ON CONFLICT(device_id) DO UPDATE SET
    user_id = excluded.user_id,
    username = excluded.username,
    device_name = excluded.device_name,
    platform = excluded.platform,
    key_hash = excluded.key_hash,
    revoked_at = NULL
`;

export function toInt(value: unknown): number {
  if (typeof value === 'number') return Math.trunc(value);
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export function toNullableInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return toInt(value);
}

export function toReal(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function toVisibility(value: unknown): UserVisibility {
  if (value === 'unlisted' || value === 'private' || value === 'public') return value;
  return 'public';
}

export function parseModels(raw: unknown): Record<string, number> | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

export function serializeModels(day: CloudDay): string | null {
  if (!day.models) return null;
  const entries = Object.entries(day.models).filter(([, tokens]) => Number.isFinite(tokens) && tokens > 0);
  if (entries.length === 0) return null;
  return JSON.stringify(Object.fromEntries(entries));
}

export function rowToUser(row: Record<string, unknown>): UserRecord {
  const username = toText(row.username);
  const rawUserId = toText(row.user_id);
  return {
    userId: rawUserId || `usr_${username}`,
    username,
    displayName: toText(row.display_name),
    apiKeyHash: toText(row.api_key_hash),
    githubId: toNullableInt(row.github_id),
    avatarUrl: toText(row.avatar_url),
    visibility: toVisibility(row.visibility),
    createdAt: toInt(row.created_at),
    updatedAt: toInt(row.updated_at),
    lastSyncAt: toNullableInt(row.last_sync_at),
  };
}

export function rowToDevice(row: Record<string, unknown>): DeviceRecord {
  return {
    deviceId: toText(row.device_id),
    userId: toText(row.user_id),
    username: toText(row.username),
    deviceName: toText(row.device_name, 'Mac'),
    platform: toText(row.platform),
    keyHash: toText(row.key_hash),
    createdAt: toInt(row.created_at),
    lastSyncAt: toNullableInt(row.last_sync_at),
    revokedAt: toNullableInt(row.revoked_at),
  };
}

export function rowToOAuthSession(row: Record<string, unknown>): OAuthDeviceSession {
  return {
    sessionId: toText(row.session_id),
    githubDeviceCode: toText(row.github_device_code),
    userCode: toText(row.user_code),
    verificationUri: toText(row.verification_uri),
    intervalSec: Math.max(1, toInt(row.interval_sec) || 5),
    deviceId: toText(row.device_id),
    deviceName: toText(row.device_name, 'Mac'),
    platform: toText(row.platform),
    expiresAt: toInt(row.expires_at),
    createdAt: toInt(row.created_at),
  };
}

export function rowToDay(row: Record<string, unknown>): StoredDay {
  const day: StoredDay = {
    date: toText(row.date),
    inputTokens: toInt(row.input_tokens),
    outputTokens: toInt(row.output_tokens),
    cacheReadTokens: toInt(row.cache_read_tokens),
    cacheWriteTokens: toInt(row.cache_write_tokens),
    reasoningTokens: toInt(row.reasoning_tokens),
    totalTokens: toInt(row.total_tokens),
    unpricedTokens: toInt(row.unpriced_tokens),
    costUsd: toReal(row.cost_usd),
    messages: toInt(row.messages),
    updatedAt: toInt(row.updated_at),
  };
  const models = parseModels(row.models_json);
  if (models) day.models = models;
  return day;
}

/**
 * Sums `device_days` rows across all devices of a user per calendar date,
 * merging `models_json` maps additively so multi-Mac sync never overwrites.
 */
export function rollupDeviceDayRows(rows: readonly Record<string, unknown>[]): CloudDay[] {
  const byDate = new Map<string, CloudDay>();

  for (const row of rows) {
    const slice = rowToDay(row);
    let acc = byDate.get(slice.date);
    if (!acc) {
      acc = {
        date: slice.date,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        unpricedTokens: 0,
        costUsd: 0,
        messages: 0,
      };
      byDate.set(slice.date, acc);
    }
    acc.inputTokens += slice.inputTokens;
    acc.outputTokens += slice.outputTokens;
    acc.cacheReadTokens += slice.cacheReadTokens;
    acc.cacheWriteTokens += slice.cacheWriteTokens;
    acc.reasoningTokens += slice.reasoningTokens;
    acc.totalTokens += slice.totalTokens;
    acc.unpricedTokens += slice.unpricedTokens;
    acc.costUsd = Math.round((acc.costUsd + slice.costUsd) * 1e6) / 1e6;
    acc.messages += slice.messages;

    if (slice.models) {
      const merged = acc.models ?? {};
      for (const [model, count] of Object.entries(slice.models)) {
        merged[model] = (merged[model] ?? 0) + count;
      }
      acc.models = merged;
    }
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
