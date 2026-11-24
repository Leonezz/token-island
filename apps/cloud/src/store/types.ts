/**
 * The storage contract shared by both cloud runtimes.
 *
 * `d1-store.ts` implements it on Cloudflare D1, `node-store.ts` on the built-in
 * `node:sqlite`.  Both use the exact same schema (migrations/0001_init.sql) and
 * semantics: latest-wins upsert per (username, date), one row per active day,
 * API keys stored as sha256 hex only.
 *
 * Every method is async so the Node implementation and the D1 implementation
 * are interchangeable from the request handlers' point of view.
 */

import type { CloudDay } from '@token-island/core';

export interface UserRecord {
  username: string;
  displayName: string;
  apiKeyHash: string;
  createdAt: number;
  updatedAt: number;
  lastSyncAt: number | null;
}

/** A stored cloud day (everything from `CloudDay` plus bookkeeping). */
export interface StoredDay extends CloudDay {
  updatedAt: number;
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  apiKeyHash: string;
  now: number;
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
  getUserByApiKeyHash(apiKeyHash: string): Promise<UserRecord | null>;
  createUser(input: CreateUserInput): Promise<UserRecord>;
  setApiKeyHash(username: string, apiKeyHash: string, now: number): Promise<void>;
  /** Marks `users.last_sync_at`; returns the timestamp for the response body. */
  touchLastSync(username: string, now: number): Promise<number>;
  /** Latest-wins upsert of daily aggregates (D1 batched, Node in one transaction). */
  upsertDays(username: string, days: CloudDay[], now: number): Promise<UpsertDaysResult>;
  listDays(username: string): Promise<StoredDay[]>;
  counts(): Promise<CloudCounts>;
  /** Releases runtime resources (Node only; D1 is managed by the platform). */
  close(): Promise<void> | void;
}
