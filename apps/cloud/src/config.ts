/**
 * Cloud configuration.  Everything is environment driven so the same code runs
 * locally (`pnpm --filter @token-island/cloud dev`) and in a container.
 */

import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (the Docker image preserves this layout under /app). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const DEFAULT_PORT = 47117;
export const DEFAULT_DB_PATH = 'data/cloud.db';

export interface CloudConfig {
  /** HTTP port. `0` asks the OS for a free port (used by tests). */
  port: number;
  /** Bind address. `0.0.0.0` by default so containers can reach it. */
  host: string;
  /** Absolute SQLite path. Directory is created on boot. */
  dbPath: string;
  /** When set, registration requires `Authorization: Bearer <admin token>`. */
  adminToken: string | null;
  /** `TOKEN_ISLAND_ALLOW_REGISTER=0` disables open registration. */
  allowRegister: boolean;
  /** Absolute base URL used in generated snippets (optional). */
  publicUrl: string | null;
}

function intFromEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function boolFromEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const normal = raw.trim().toLowerCase();
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normal)) return false;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normal)) return true;
  return fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig {
  const dbRaw = env.TOKEN_ISLAND_CLOUD_DB?.trim();
  const dbPath = dbRaw
    ? isAbsolute(dbRaw)
      ? dbRaw
      : resolve(REPO_ROOT, dbRaw)
    : resolve(REPO_ROOT, DEFAULT_DB_PATH);

  const adminToken = env.TOKEN_ISLAND_ADMIN_TOKEN?.trim() || null;
  const publicUrl = env.TOKEN_ISLAND_PUBLIC_URL?.trim().replace(/\/+$/, '') || null;

  return {
    port: intFromEnv(env.PORT, DEFAULT_PORT, 0, 65_535),
    host: env.HOST?.trim() || '0.0.0.0',
    dbPath,
    adminToken,
    allowRegister: boolFromEnv(env.TOKEN_ISLAND_ALLOW_REGISTER, true),
    publicUrl,
  };
}
