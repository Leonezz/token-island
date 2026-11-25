/**
 * Node + SQLite storage for the cloud service (built-in `node:sqlite`, no ORM).
 *
 * Implements schema v1 + v2 migrations:
 *  - multi-device `device_days (username, device_id, date)` rolled up additively into `days (username, date)`
 *  - per-device revocable tokens (`devices.key_hash`) + legacy `users.api_key_hash` compatibility
 *  - GitHub user identity (`github_id`, `avatar_url`, `visibility`) and OAuth Device Flow sessions
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CloudDay } from '@token-island/core';
import { generateUserId, sanitizeDeviceId } from '../auth.js';
import {
  rollupDeviceDayRows,
  rowToDay,
  rowToDevice,
  rowToOAuthSession,
  rowToUser,
  serializeModels,
  toInt,
  UPSERT_AGGREGATED_DAY_SQL,
  UPSERT_DEVICE_DAY_SQL,
  UPSERT_DEVICE_SQL,
} from './shared.js';
import {
  DuplicateUsernameError,
  type AuthenticatedPrincipal,
  type CloudCounts,
  type CloudStore,
  type CreateUserInput,
  type DeviceRecord,
  type OAuthDeviceSession,
  type StoredDay,
  type UpsertDaysOptions,
  type UpsertDaysResult,
  type UpsertDeviceInput,
  type UserRecord,
  type UserVisibility,
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
  {
    version: 2,
    up: `
      ALTER TABLE users ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN github_id INTEGER;
      ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';
      UPDATE users SET user_id = 'usr_' || username WHERE user_id = '';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id) WHERE github_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        device_name TEXT NOT NULL DEFAULT 'Mac',
        platform TEXT NOT NULL DEFAULT '',
        key_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_sync_at INTEGER,
        revoked_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_key_hash ON devices(key_hash);
      CREATE INDEX IF NOT EXISTS idx_devices_username ON devices(username);

      CREATE TABLE IF NOT EXISTS device_days (
        username TEXT NOT NULL,
        device_id TEXT NOT NULL,
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
        PRIMARY KEY (username, device_id, date)
      );
      CREATE INDEX IF NOT EXISTS idx_device_days_user_date ON device_days(username, date);

      INSERT OR IGNORE INTO device_days (
        username, device_id, date, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, total_tokens, unpriced_tokens,
        cost_usd, messages, models_json, updated_at
      )
      SELECT
        username, 'legacy', date, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, total_tokens, unpriced_tokens,
        cost_usd, messages, models_json, updated_at
      FROM days;

      CREATE TABLE IF NOT EXISTS oauth_device_sessions (
        session_id TEXT PRIMARY KEY,
        github_device_code TEXT NOT NULL,
        user_code TEXT NOT NULL,
        verification_uri TEXT NOT NULL,
        interval_sec INTEGER NOT NULL DEFAULT 5,
        device_id TEXT NOT NULL DEFAULT '',
        device_name TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT '',
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      UPDATE meta SET value = '2', updated_at = 0 WHERE key = 'schema_version';
    `,
  },
];

export class NodeStore implements CloudStore {
  readonly path: string;

  private readonly db: DatabaseSync;
  private readonly upsertDayStmt;
  private readonly upsertDeviceDayStmt;
  private readonly upsertDeviceStmt;
  private readonly userByNameStmt;
  private readonly userByGithubStmt;
  private readonly userByKeyStmt;
  private readonly deviceByKeyStmt;
  private readonly insertUserStmt;
  private readonly setLastSyncStmt;
  private readonly setDeviceSyncStmt;
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

    this.upsertDayStmt = this.db.prepare(UPSERT_AGGREGATED_DAY_SQL);
    this.upsertDeviceDayStmt = this.db.prepare(UPSERT_DEVICE_DAY_SQL);
    this.upsertDeviceStmt = this.db.prepare(UPSERT_DEVICE_SQL);
    this.userByNameStmt = this.db.prepare('SELECT * FROM users WHERE username = ?');
    this.userByGithubStmt = this.db.prepare('SELECT * FROM users WHERE github_id = ?');
    this.userByKeyStmt = this.db.prepare('SELECT * FROM users WHERE api_key_hash = ?');
    this.deviceByKeyStmt = this.db.prepare('SELECT * FROM devices WHERE key_hash = ? AND revoked_at IS NULL');
    this.insertUserStmt = this.db.prepare(
      `INSERT INTO users (
        user_id, username, display_name, api_key_hash, github_id, avatar_url, visibility, created_at, updated_at, last_sync_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.setLastSyncStmt = this.db.prepare(
      'UPDATE users SET last_sync_at = ?, updated_at = ? WHERE username = ?',
    );
    this.setDeviceSyncStmt = this.db.prepare(
      'UPDATE devices SET last_sync_at = ? WHERE device_id = ? AND username = ?',
    );
    this.setApiKeyStmt = this.db.prepare('UPDATE users SET api_key_hash = ?, updated_at = ? WHERE username = ?');
    this.listDaysStmt = this.db.prepare('SELECT * FROM days WHERE username = ? ORDER BY date ASC');
    this.countUsersStmt = this.db.prepare('SELECT COUNT(*) AS n FROM users');
    this.countAllDaysStmt = this.db.prepare('SELECT COUNT(*) AS n FROM days');
    this.dayRangeStmt = this.db.prepare(
      'SELECT COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last FROM days WHERE username = ?',
    );
  }

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
        // best effort
      }
      throw error;
    }
  }

  // -- users & auth ---------------------------------------------------------

  async getUser(username: string): Promise<UserRecord | null> {
    const row = this.userByNameStmt.get(username);
    return row ? rowToUser(row as Record<string, unknown>) : null;
  }

  async getUserByGithubId(githubId: number): Promise<UserRecord | null> {
    const row = this.userByGithubStmt.get(githubId);
    return row ? rowToUser(row as Record<string, unknown>) : null;
  }

  async getUserByApiKeyHash(apiKeyHash: string): Promise<UserRecord | null> {
    const principal = await this.authenticateByKeyHash(apiKeyHash);
    return principal?.user ?? null;
  }

  async authenticateByKeyHash(keyHash: string): Promise<AuthenticatedPrincipal | null> {
    const deviceRow = this.deviceByKeyStmt.get(keyHash);
    if (deviceRow) {
      const device = rowToDevice(deviceRow as Record<string, unknown>);
      const user = await this.getUser(device.username);
      if (user) return { user, device };
    }
    const userRow = this.userByKeyStmt.get(keyHash);
    if (!userRow) return null;
    return { user: rowToUser(userRow as Record<string, unknown>), device: null };
  }

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const userId = input.userId || generateUserId();
    try {
      this.insertUserStmt.run(
        userId,
        input.username,
        input.displayName,
        input.apiKeyHash,
        input.githubId ?? null,
        input.avatarUrl ?? '',
        input.visibility ?? 'public',
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

  async updateUserProfile(
    username: string,
    patch: { displayName?: string; avatarUrl?: string; visibility?: UserVisibility; githubId?: number },
    now: number,
  ): Promise<UserRecord | null> {
    const existing = await this.getUser(username);
    if (!existing) return null;
    this.db
      .prepare(
        `UPDATE users SET
          display_name = ?,
          avatar_url = ?,
          visibility = ?,
          github_id = ?,
          updated_at = ?
        WHERE username = ?`,
      )
      .run(
        patch.displayName ?? existing.displayName,
        patch.avatarUrl ?? existing.avatarUrl,
        patch.visibility ?? existing.visibility,
        patch.githubId !== undefined ? patch.githubId : existing.githubId,
        now,
        username,
      );
    return this.getUser(username);
  }

  async setApiKeyHash(username: string, apiKeyHash: string, now: number): Promise<void> {
    this.setApiKeyStmt.run(apiKeyHash, now, username);
  }

  async upsertDevice(input: UpsertDeviceInput): Promise<DeviceRecord> {
    this.upsertDeviceStmt.run(
      input.deviceId,
      input.userId,
      input.username,
      input.deviceName,
      input.platform,
      input.keyHash,
      input.now,
      input.now,
    );
    const row = this.db.prepare('SELECT * FROM devices WHERE device_id = ?').get(input.deviceId);
    if (!row) throw new Error(`device missing after upsert: ${input.deviceId}`);
    return rowToDevice(row as Record<string, unknown>);
  }

  async listDevices(username: string): Promise<DeviceRecord[]> {
    const rows = this.db
      .prepare('SELECT * FROM devices WHERE username = ? AND revoked_at IS NULL ORDER BY COALESCE(last_sync_at, created_at) DESC')
      .all(username) as Record<string, unknown>[];
    return rows.map(rowToDevice);
  }

  async revokeDevice(username: string, deviceId: string, now: number): Promise<boolean> {
    const result = this.db
      .prepare('UPDATE devices SET revoked_at = ? WHERE username = ? AND device_id = ? AND revoked_at IS NULL')
      .run(now, username, deviceId);
    return Number(result.changes) > 0;
  }

  async touchLastSync(username: string, now: number, deviceId?: string | null): Promise<number> {
    this.setLastSyncStmt.run(now, now, username);
    if (deviceId) {
      this.setDeviceSyncStmt.run(now, deviceId, username);
    }
    return now;
  }

  // -- days (per-device slice -> additive user rollup) ----------------------

  async upsertDays(
    username: string,
    days: CloudDay[],
    now: number,
    options: UpsertDaysOptions = {},
  ): Promise<UpsertDaysResult> {
    if (days.length === 0) {
      return { written: 0, ...this.getDayRange(username) };
    }
    const effectiveDeviceId = sanitizeDeviceId(options.deviceId) ?? 'legacy';
    const uniqueDates = [...new Set(days.map((d) => d.date))];

    this.transaction(() => {
      for (const day of days) {
        this.upsertDeviceDayStmt.run(
          username,
          effectiveDeviceId,
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

      const placeholders = uniqueDates.map(() => '?').join(', ');
      const deviceRows = this.db
        .prepare(`SELECT * FROM device_days WHERE username = ? AND date IN (${placeholders})`)
        .all(username, ...uniqueDates) as Record<string, unknown>[];

      const rolledUp = rollupDeviceDayRows(deviceRows);
      for (const day of rolledUp) {
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

  // -- OAuth Device Flow sessions -------------------------------------------

  async saveOAuthSession(session: OAuthDeviceSession): Promise<void> {
    this.db.prepare('DELETE FROM oauth_device_sessions WHERE expires_at <= ?').run(session.createdAt);
    this.db
      .prepare(
        `INSERT INTO oauth_device_sessions (
          session_id, github_device_code, user_code, verification_uri, interval_sec,
          device_id, device_name, platform, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.sessionId,
        session.githubDeviceCode,
        session.userCode,
        session.verificationUri,
        session.intervalSec,
        session.deviceId,
        session.deviceName,
        session.platform,
        session.expiresAt,
        session.createdAt,
      );
  }

  async getOAuthSession(sessionId: string, now: number): Promise<OAuthDeviceSession | null> {
    const row = this.db
      .prepare('SELECT * FROM oauth_device_sessions WHERE session_id = ?')
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const session = rowToOAuthSession(row);
    if (session.expiresAt <= now) {
      await this.deleteOAuthSession(sessionId);
      return null;
    }
    return session;
  }

  async updateOAuthSessionInterval(sessionId: string, intervalSec: number): Promise<void> {
    this.db
      .prepare('UPDATE oauth_device_sessions SET interval_sec = ? WHERE session_id = ?')
      .run(intervalSec, sessionId);
  }

  async deleteOAuthSession(sessionId: string): Promise<void> {
    this.db.prepare('DELETE FROM oauth_device_sessions WHERE session_id = ?').run(sessionId);
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
