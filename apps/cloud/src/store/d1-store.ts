/**
 * Cloudflare D1 storage for the cloud service (schema v2).
 *
 * Mirrors `node-store.ts` semantics identically on Cloudflare D1 (`env.DB`):
 *  - chunked `env.DB.batch()` writes into `device_days` + additive rollup into `days`
 *  - per-device revocable tokens (`devices.key_hash`) + legacy `users.api_key_hash`
 *  - GitHub OAuth Device Flow sessions (`oauth_device_sessions`)
 */

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

const BATCH_SIZE = 80;
const DATE_IN_CHUNK = 75;
const TOUCH_LAST_SYNC_SQL = 'UPDATE users SET last_sync_at = ?, updated_at = ? WHERE username = ?';

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export class D1Store implements CloudStore {
  constructor(private readonly db: D1Database) {}

  async getUser(username: string): Promise<UserRecord | null> {
    const row = await this.db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
    return row ? rowToUser(row) : null;
  }

  async getUserByGithubId(githubId: number): Promise<UserRecord | null> {
    const row = await this.db.prepare('SELECT * FROM users WHERE github_id = ?').bind(githubId).first();
    return row ? rowToUser(row) : null;
  }

  async getUserByApiKeyHash(apiKeyHash: string): Promise<UserRecord | null> {
    const principal = await this.authenticateByKeyHash(apiKeyHash);
    return principal?.user ?? null;
  }

  async authenticateByKeyHash(keyHash: string): Promise<AuthenticatedPrincipal | null> {
    const deviceRow = await this.db
      .prepare('SELECT * FROM devices WHERE key_hash = ? AND revoked_at IS NULL')
      .bind(keyHash)
      .first();
    if (deviceRow) {
      const device = rowToDevice(deviceRow);
      const user = await this.getUser(device.username);
      if (user) return { user, device };
    }
    const userRow = await this.db
      .prepare('SELECT * FROM users WHERE api_key_hash = ?')
      .bind(keyHash)
      .first();
    if (!userRow) return null;
    return { user: rowToUser(userRow), device: null };
  }

  async createUser(input: CreateUserInput): Promise<UserRecord> {
    const userId = input.userId || generateUserId();
    try {
      await this.db
        .prepare(
          `INSERT INTO users (
            user_id, username, display_name, api_key_hash, github_id, avatar_url, visibility, created_at, updated_at, last_sync_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
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
        )
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

  async updateUserProfile(
    username: string,
    patch: { displayName?: string; avatarUrl?: string; visibility?: UserVisibility; githubId?: number },
    now: number,
  ): Promise<UserRecord | null> {
    const existing = await this.getUser(username);
    if (!existing) return null;
    await this.db
      .prepare(
        `UPDATE users SET
          display_name = ?,
          avatar_url = ?,
          visibility = ?,
          github_id = ?,
          updated_at = ?
        WHERE username = ?`,
      )
      .bind(
        patch.displayName ?? existing.displayName,
        patch.avatarUrl ?? existing.avatarUrl,
        patch.visibility ?? existing.visibility,
        patch.githubId !== undefined ? patch.githubId : existing.githubId,
        now,
        username,
      )
      .run();
    return this.getUser(username);
  }

  async setApiKeyHash(username: string, apiKeyHash: string, now: number): Promise<void> {
    await this.db
      .prepare('UPDATE users SET api_key_hash = ?, updated_at = ? WHERE username = ?')
      .bind(apiKeyHash, now, username)
      .run();
  }

  async upsertDevice(input: UpsertDeviceInput): Promise<DeviceRecord> {
    await this.db
      .prepare(UPSERT_DEVICE_SQL)
      .bind(
        input.deviceId,
        input.userId,
        input.username,
        input.deviceName,
        input.platform,
        input.keyHash,
        input.now,
        input.now,
      )
      .run();
    const row = await this.db
      .prepare('SELECT * FROM devices WHERE device_id = ?')
      .bind(input.deviceId)
      .first();
    if (!row) throw new Error(`device missing after upsert: ${input.deviceId}`);
    return rowToDevice(row);
  }

  async listDevices(username: string): Promise<DeviceRecord[]> {
    const result = await this.db
      .prepare('SELECT * FROM devices WHERE username = ? AND revoked_at IS NULL ORDER BY COALESCE(last_sync_at, created_at) DESC')
      .bind(username)
      .all();
    return (result.results ?? []).map(rowToDevice);
  }

  async revokeDevice(username: string, deviceId: string, now: number): Promise<boolean> {
    const result = await this.db
      .prepare('UPDATE devices SET revoked_at = ? WHERE username = ? AND device_id = ? AND revoked_at IS NULL')
      .bind(now, username, deviceId)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }

  async touchLastSync(username: string, now: number, deviceId?: string | null): Promise<number> {
    const statements: D1PreparedStatement[] = [
      this.db.prepare(TOUCH_LAST_SYNC_SQL).bind(now, now, username),
    ];
    if (deviceId) {
      statements.push(
        this.db
          .prepare('UPDATE devices SET last_sync_at = ? WHERE device_id = ? AND username = ?')
          .bind(now, deviceId, username),
      );
    }
    await this.db.batch(statements);
    return now;
  }

  async upsertDays(
    username: string,
    days: CloudDay[],
    now: number,
    options: UpsertDaysOptions = {},
  ): Promise<UpsertDaysResult> {
    if (days.length === 0) {
      return { written: 0, ...(await this.getDayRange(username)) };
    }
    const effectiveDeviceId = sanitizeDeviceId(options.deviceId) ?? 'legacy';

    const deviceStatements = days.map((day) =>
      this.db
        .prepare(UPSERT_DEVICE_DAY_SQL)
        .bind(
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
        ),
    );
    for (const batch of chunk(deviceStatements, BATCH_SIZE)) {
      await this.db.batch(batch);
    }

    const uniqueDates = [...new Set(days.map((d) => d.date))];
    const allDeviceRows: Record<string, unknown>[] = [];
    for (const dateChunk of chunk(uniqueDates, DATE_IN_CHUNK)) {
      const placeholders = dateChunk.map(() => '?').join(', ');
      const result = await this.db
        .prepare(`SELECT * FROM device_days WHERE username = ? AND date IN (${placeholders})`)
        .bind(username, ...dateChunk)
        .all();
      for (const row of result.results ?? []) allDeviceRows.push(row);
    }

    const rolledUp = rollupDeviceDayRows(allDeviceRows);
    const aggStatements = rolledUp.map((day) =>
      this.db
        .prepare(UPSERT_AGGREGATED_DAY_SQL)
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
    for (const batch of chunk(aggStatements, BATCH_SIZE)) {
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

  async saveOAuthSession(session: OAuthDeviceSession): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM oauth_device_sessions WHERE expires_at <= ?').bind(session.createdAt),
      this.db
        .prepare(
          `INSERT INTO oauth_device_sessions (
            session_id, github_device_code, user_code, verification_uri, interval_sec,
            device_id, device_name, platform, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
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
        ),
    ]);
  }

  async getOAuthSession(sessionId: string, now: number): Promise<OAuthDeviceSession | null> {
    const row = await this.db
      .prepare('SELECT * FROM oauth_device_sessions WHERE session_id = ?')
      .bind(sessionId)
      .first();
    if (!row) return null;
    const session = rowToOAuthSession(row);
    if (session.expiresAt <= now) {
      await this.deleteOAuthSession(sessionId);
      return null;
    }
    return session;
  }

  async updateOAuthSessionInterval(sessionId: string, intervalSec: number): Promise<void> {
    await this.db
      .prepare('UPDATE oauth_device_sessions SET interval_sec = ? WHERE session_id = ?')
      .bind(intervalSec, sessionId)
      .run();
  }

  async deleteOAuthSession(sessionId: string): Promise<void> {
    await this.db.prepare('DELETE FROM oauth_device_sessions WHERE session_id = ?').bind(sessionId).run();
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
