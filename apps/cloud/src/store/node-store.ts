/**
 * Node + SQLite storage for the cloud service (built-in `node:sqlite`, no ORM).
 *
 * Keeps the v1 behaviour identically: forward-only migration on boot, WAL mode,
 * one transaction per ingest and latest-wins day upserts.  Implements the async
 * `CloudStore` interface so `api.ts` is shared with the Cloudflare D1 runtime.
 *
 * Only daily aggregates are stored: no prompts, no paths, no session ids.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

interface Migration {
  version: number;
  up: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        api_key_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_sync_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_key ON users(api_key_hash);

      CREATE TABLE IF NOT EXISTS days (
        username TEXT NOT NULL,
        date TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        unpriced_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        messages INTEGER NOT NULL DEFAULT 0,
        models_json TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (username, date)
      );
      CREATE INDEX IF NOT EXISTS idx_days_date ON days(date);

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO meta (key, value, updated_at) VALUES ('schema_version', '1', 0)
        ON CONFLICT(key) DO NOTHING;
    `,
  },
];

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

export class NodeStore implements CloudStore {
  readonly path: string;

  private readonly db: DatabaseSync;
  private readonly upsertDayStmt;
  private readonly userByNameStmt;
  private readonly userByKeyStmt;
  private readonly insertUserStmt;
  private readonly setLastSyncStmt;
  private readonly setApiKeyStmt;
  private readonly listDaysStmt;
  private readonly countUsersStmt;
  private readonly countAllDaysStmt;
  private readonly dayRangeStmt;

  constructor(path: string) {
    this.path = path;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();

    this.upsertDayStmt = this.db.prepare(UPSERT_DAY_SQL);
    this.userByNameStmt = this.db.prepare('SELECT * FROM users WHERE username = ?');
    this.userByKeyStmt = this.db.prepare('SELECT * FROM users WHERE api_key_hash = ?');
    this.insertUserStmt = this.db.prepare(
      'INSERT INTO users (username, display_name, api_key_hash, created_at, updated_at, last_sync_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    this.setLastSyncStmt = this.db.prepare(
      'UPDATE users SET last_sync_at = ?, updated_at = ? WHERE username = ?',
    );
    this.setApiKeyStmt = this.db.prepare('UPDATE users SET api_key_hash = ?, updated_at = ? WHERE username = ?');
    this.listDaysStmt = this.db.prepare('SELECT * FROM days WHERE username = ? ORDER BY date ASC');
    this.countUsersStmt = this.db.prepare('SELECT COUNT(*) AS n FROM users');
    this.countAllDaysStmt = this.db.prepare('SELECT COUNT(*) AS n FROM days');
    this.dayRangeStmt = this.db.prepare(
      'SELECT COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last FROM days WHERE username = ?',
    );
  }

  // -- schema ---------------------------------------------------------------

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version?: unknown } | undefined;
    let version = toInt(row?.user_version);
    for (const migration of MIGRATIONS) {
      if (version >= migration.version) continue;
      this.transaction(() => {
        this.db.exec(migration.up);
        this.db.exec(`PRAGMA user_version = ${migration.version}`);
      });
      version = migration.version;
    }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // rollback on a closed/broken connection is best effort
      }
      throw error;
    }
  }

  // -- users ----------------------------------------------------------------

  async getUser(username: string): Promise<UserRecord | null> {
    const row = this.userByNameStmt.get(username);
    return row ? rowToUser(row as Record<string, unknown>) : null;
  }

  async getUserByApiKeyHash(apiKeyHash: string): Promise<UserRecord | null> {
    const row = this.userByKeyStmt.get(apiKeyHash);
    return row ? rowToUser(row as Record<string, unknown>) : null;
  }

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    try {
      this.insertUserStmt.run(
        input.username,
        input.displayName,
        input.apiKeyHash,
        input.now,
        input.now,
        null,
      );
    } catch (error) {
      if (error instanceof Error && /UNIQUE|PRIMARY KEY/i.test(error.message)) {
        throw new DuplicateUsernameError(input.username);
      }
      throw error;
    }
    const created = await this.getUser(input.username);
    if (!created) throw new Error(`user disappeared after insert: ${input.username}`);
    return created;
  }

  async setApiKeyHash(username: string, apiKeyHash: string, now: number): Promise<void> {
    this.setApiKeyStmt.run(apiKeyHash, now, username);
  }

  async touchLastSync(username: string, now: number): Promise<number> {
    this.setLastSyncStmt.run(now, now, username);
    return now;
  }

  // -- days -----------------------------------------------------------------

  /** Latest-wins upsert of daily aggregates.  Returns updated range metadata. */
  async upsertDays(username: string, days: CloudDay[], now: number): Promise<UpsertDaysResult> {
    this.transaction(() => {
      for (const day of days) {
        this.upsertDayStmt.run(
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
        );
      }
    });
    const range = this.getDayRange(username);
    return { written: days.length, ...range };
  }

  async listDays(username: string): Promise<StoredDay[]> {
    const rows = this.listDaysStmt.all(username) as Record<string, unknown>[];
    return rows.map(rowToDay);
  }

  // -- stats ----------------------------------------------------------------

  async counts(): Promise<CloudCounts> {
    const users = this.countUsersStmt.get() as { n?: unknown } | undefined;
    const days = this.countAllDaysStmt.get() as { n?: unknown } | undefined;
    return { users: toInt(users?.n), days: toInt(days?.n) };
  }

  close(): void {
    this.db.close();
  }

  private getDayRange(username: string): { totalDays: number; firstDate: string | null; lastDate: string | null } {
    const row = this.dayRangeStmt.get(username) as { n?: unknown; first?: unknown; last?: unknown } | undefined;
    return {
      totalDays: toInt(row?.n),
      firstDate: typeof row?.first === 'string' ? row.first : null,
      lastDate: typeof row?.last === 'string' ? row.last : null,
    };
  }
}
