/**
 * The storage contract shared by both cloud runtimes (`node-store.ts` and `d1-store.ts`).
 *
 * Schema v2 adds:
 *  - immutable `userId`, optional `githubId`, `avatarUrl`, and `visibility` on `users`
 *  - per-machine `devices` with revocable SHA-256 `keyHash`
 *  - `device_days (username, device_id, date)` rolled up additively into `days (username, date)`
 *  - `oauth_device_sessions` for stateless GitHub OAuth Device Flow (`RFC 8628`)
 */

import type { CloudDay } from '@token-island/core';

export type UserVisibility = 'public' | 'unlisted' | 'private';

export interface UserRecord {
  userId: string;
  username: string;
  displayName: string;
  apiKeyHash: string;
  githubId: number | null;
  avatarUrl: string;
  visibility: UserVisibility;
  createdAt: number;
  updatedAt: number;
  lastSyncAt: number | null;
}

export interface DeviceRecord {
  deviceId: string;
  userId: string;
  username: string;
  deviceName: string;
  platform: string;
  keyHash: string;
  createdAt: number;
  lastSyncAt: number | null;
  revokedAt: number | null;
}

export interface AuthenticatedPrincipal {
  user: UserRecord;
  device: DeviceRecord | null;
}

export interface OAuthDeviceSession {
  sessionId: string;
  githubDeviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSec: number;
  deviceId: string;
  deviceName: string;
  platform: string;
  expiresAt: number;
  createdAt: number;
}

/** A stored cloud day (everything from `CloudDay` plus bookkeeping). */
export interface StoredDay extends CloudDay {
  updatedAt: number;
}

export interface CreateUserInput {
  userId?: string;
  username: string;
  displayName: string;
  apiKeyHash: string;
  githubId?: number | null;
  avatarUrl?: string;
  visibility?: UserVisibility;
  now: number;
}

export interface UpsertDeviceInput {
  deviceId: string;
  userId: string;
  username: string;
  deviceName: string;
  platform: string;
  keyHash: string;
  now: number;
}

export interface UpsertDaysOptions {
  deviceId?: string;
  deviceName?: string;
  platform?: string;
}

export interface UpsertDaysResult {
  /** Number of day rows written by this call. */
  written: number;
  /** Day rows currently stored for the user. */
  totalDays: number;
  firstDate: string | null;
  lastDate: string | null;
}

export interface CloudCounts {
  users: number;
  days: number;
}

export class DuplicateUsernameError extends Error {
  constructor(username: string) {
    super(`username already taken: ${username}`);
    this.name = 'DuplicateUsernameError';
  }
}

export interface CloudStore {
  getUser(username: string): Promise<UserRecord | null>;
  getUserByGithubId(githubId: number): Promise<UserRecord | null>;
  getUserByApiKeyHash(apiKeyHash: string): Promise<UserRecord | null>;
  /** Resolves either a per-device key (`devices.key_hash`) or legacy `users.api_key_hash`. */
  authenticateByKeyHash(keyHash: string): Promise<AuthenticatedPrincipal | null>;
  createUser(input: CreateUserInput): Promise<UserRecord>;
  updateUserProfile(
    username: string,
    patch: { displayName?: string; avatarUrl?: string; visibility?: UserVisibility; githubId?: number },
    now: number,
  ): Promise<UserRecord | null>;
  setApiKeyHash(username: string, apiKeyHash: string, now: number): Promise<void>;
  upsertDevice(input: UpsertDeviceInput): Promise<DeviceRecord>;
  listDevices(username: string): Promise<DeviceRecord[]>;
  revokeDevice(username: string, deviceId: string, now: number): Promise<boolean>;
  /** Marks `users.last_sync_at` (and optional `devices.last_sync_at`); returns timestamp. */
  touchLastSync(username: string, now: number, deviceId?: string | null): Promise<number>;
  /** Per-device upsert into `device_days` followed by additive rollup into `days`. */
  upsertDays(
    username: string,
    days: CloudDay[],
    now: number,
    options?: UpsertDaysOptions,
  ): Promise<UpsertDaysResult>;
  listDays(username: string): Promise<StoredDay[]>;
  saveOAuthSession(session: OAuthDeviceSession): Promise<void>;
  getOAuthSession(sessionId: string, now: number): Promise<OAuthDeviceSession | null>;
  updateOAuthSessionInterval(sessionId: string, intervalSec: number): Promise<void>;
  deleteOAuthSession(sessionId: string): Promise<void>;
  counts(): Promise<CloudCounts>;
  /** Releases runtime resources (Node only; D1 is managed by the platform). */
  close(): Promise<void> | void;
}
