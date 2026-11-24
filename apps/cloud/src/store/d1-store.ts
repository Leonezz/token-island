/**
 * Cloudflare D1 storage for the cloud service.
 *
 * Same schema and semantics as `node-store.ts`, but every call goes through the
 * `DB` binding with prepared statements; ingest uses chunked `env.DB.batch()`
 * so a 400-day sync is a handful of round trips instead of 400.
 *
 * The D1 types below are declared locally so the bundle stays dependency-free
 * (no @cloudflare/workers-types needed at runtime or typecheck time).
 */

import type { CloudDay } from '@token-island/core';
import {
  DuplicateUsernameError,
  type CloudCounts,
  type CloudStore,
  type CreateUserInput,
  type StoredDay,
  type UpsertDaysResult,
  type UserRecord,
} from './types.js';

// -- minimal structural D1 typings ------------------------------------------

export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number; last_row_id?: number; duration?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

const UPSERT_DAY_SQL = `
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

/** D1 caps an individual batch; stay well under it and chunk larger syncs. */
const BATCH_SIZE = 100;

const TOUCH_LAST_SYNC_SQL = 'UPDATE users SET last_sync_at = ?, updated_at = ? WHERE username = ?';

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function toInt(value: unknown): number {
  if (typeof value === 'number') return Math.trunc(value);
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function toReal(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseModels(raw: unknown): Record<string, number> | undefined {
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

function serializeModels(day: CloudDay): string | null {
  if (!day.models) return null;
  const entries = Object.entries(day.models).filter(([, tokens]) => Number.isFinite(tokens) && tokens > 0);
  if (entries.length === 0) return null;
  return JSON.stringify(Object.fromEntries(entries));
}

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    username: toText(row.username),
    displayName: toText(row.display_name),
    apiKeyHash: toText(row.api_key_hash),
    createdAt: toInt(row.created_at),
    updatedAt: toInt(row.updated_at),
    lastSyncAt: row.last_sync_at === null || row.last_sync_at === undefined ? null : toInt(row.last_sync_at),
  };
}

function rowToDay(row: Record<string, unknown>): StoredDay {
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

// -- store -------------------------------------------------------------------

export class D1Store implements CloudStore {
  constructor(private readonly db: D1Database) {}

  async getUser(username: string): Promise<UserRecord | null> {
    const row = await this.db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
    return row ? rowToUser(row) : null;
  }

  async getUserByApiKeyHash(apiKeyHash: string): Promise<UserRecord | null> {
    const row = await this.db
      .prepare('SELECT * FROM users WHERE api_key_hash = ?')
      .bind(apiKeyHash)
      .first();
    return row ? rowToUser(row) : null;
  }

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    try {
      await this.db
        .prepare(
          'INSERT INTO users (username, display_name, api_key_hash, created_at, updated_at, last_sync_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(input.username, input.displayName, input.apiKeyHash, input.now, input.now, null)
        .run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE|PRIMARY KEY|constraint/i.test(message)) {
        throw new DuplicateUsernameError(input.username);
      }
      throw error;
    }
    const created = await this.getUser(input.username);
    if (!created) throw new Error(`user disappeared after insert: ${input.username}`);
    return created;
  }

  async setApiKeyHash(username: string, apiKeyHash: string, now: number): Promise<void> {
    await this.db
      .prepare('UPDATE users SET api_key_hash = ?, updated_at = ? WHERE username = ?')
      .bind(apiKeyHash, now, username)
      .run();
  }

  async touchLastSync(username: string, now: number): Promise<number> {
    await this.db.prepare(TOUCH_LAST_SYNC_SQL).bind(now, now, username).run();
    return now;
  }

  async upsertDays(username: string, days: CloudDay[], now: number): Promise<UpsertDaysResult> {
    const statements = days.map((day) =>
      this.db
        .prepare(UPSERT_DAY_SQL)
        .bind(
          username,
          day.date,
          day.inputTokens,
          day.outputTokens,
          day.cacheReadTokens,
          day.cacheWriteTokens,
          day.reasoningTokens,
          day.totalTokens,
          day.unpricedTokens,
          day.costUsd,
          day.messages,
          serializeModels(day),
          now,
        ),
    );
    for (const batch of chunk(statements, BATCH_SIZE)) {
      await this.db.batch(batch);
    }
    const range = await this.getDayRange(username);
    return { written: days.length, ...range };
  }

  async listDays(username: string): Promise<StoredDay[]> {
    const result = await this.db
      .prepare('SELECT * FROM days WHERE username = ? ORDER BY date ASC')
      .bind(username)
      .all();
    return (result.results ?? []).map(rowToDay);
  }

  async counts(): Promise<CloudCounts> {
    const [users, days] = await this.db.batch([
      this.db.prepare('SELECT COUNT(*) AS n FROM users'),
      this.db.prepare('SELECT COUNT(*) AS n FROM days'),
    ]);
    return {
      users: toInt(users?.results?.[0]?.n),
      days: toInt(days?.results?.[0]?.n),
    };
  }

  async close(): Promise<void> {
    // D1 connections are managed by the platform.
  }

  private async getDayRange(
    username: string,
  ): Promise<{ totalDays: number; firstDate: string | null; lastDate: string | null }> {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last FROM days WHERE username = ?')
      .bind(username)
      .first<{ n?: unknown; first?: unknown; last?: unknown }>();
    return {
      totalDays: toInt(row?.n),
      firstDate: typeof row?.first === 'string' ? row.first : null,
      lastDate: typeof row?.last === 'string' ? row.last : null,
    };
  }
}
