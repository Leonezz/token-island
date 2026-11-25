/**
 * Configuration loading for the collector.
 *
 * Reads `$TOKEN_ISLAND_HOME/config.json` (default `~/.token-island/config.json`).
 * Every key is optional; anything missing falls back to the documented defaults.
 * Environment overrides: `TOKEN_ISLAND_HOME` (state dir), `TOKEN_ISLAND_PORT`
 * and `TOKEN_ISLAND_DEMO_PORT` (default 47119).
 */

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTimezone } from '@token-island/core';
import type { PriceOverride } from '@token-island/core';

export const DEFAULT_PORT = 47118;
export const DEMO_PORT = 47119;
export const DEFAULT_BACKFILL_DAYS = 30;
export const DEFAULT_SCAN_INTERVAL_MS = 2_000;
export const DEFAULT_LIVE_WINDOW_MS = 600_000;

export type CollectorSourceKey = 'claude' | 'codex' | 'opencode' | 'dsh';

export interface CloudFileConfig {
  enabled?: boolean;
  url?: string;
  username?: string;
  apiKey?: string;
  autoSync?: boolean;
  intervalMinutes?: number;
}

export interface RawConfigFile {
  port?: number;
  /** Optional override for `collect --demo`; defaults to 47119. */
  demoPort?: number;
  timezone?: string;
  backfillDays?: number;
  scanIntervalMs?: number;
  liveWindowMs?: number;
  sources?: Record<string, boolean | undefined>;
  paths?: Record<string, string | undefined>;
  prices?: unknown;
  cloud?: CloudFileConfig;
}

export interface CollectorCloudConfig {
  enabled: boolean;
  url: string;
  username: string;
  apiKey: string;
  autoSync: boolean;
  intervalMinutes: number;
}

export interface CollectorPaths {
  claude: string;
  codex: string;
  opencode: string;
  dsh: string;
}

export interface LoadedConfig {
  /** Resolved state directory (no trailing slash). */
  home: string;
  configPath: string;
  dbPath: string;
  demoDbPath: string;
  port: number;
  demoPort: number;
  /** Configured timezone string, `auto` or an explicit IANA id. */
  timezoneSetting: string;
  /** Resolved IANA timezone. */
  timezone: string;
  backfillDays: number;
  scanIntervalMs: number;
  liveWindowMs: number;
  sources: Record<CollectorSourceKey | 'gemini', boolean>;
  paths: CollectorPaths;
  prices: PriceOverride[];
  cloud: CollectorCloudConfig;
  raw: RawConfigFile;
  configError: string | null;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  /** Override of the OS home directory (tests). */
  homeDir?: string;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/** Expands a leading `~` and resolves relative paths against `homeDir`. */
export function expandPath(value: string, homeDir: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return homeDir;
  if (trimmed === '~') return homeDir;
  if (trimmed.startsWith('~/')) return path.join(homeDir, trimmed.slice(2));
  if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
  return path.resolve(homeDir, trimmed);
}

/** Resolved state dir from the environment (default `~/.token-island`). */
export function resolveStateHome(env: NodeJS.ProcessEnv, homeDir: string): string {
  const override = typeof env.TOKEN_ISLAND_HOME === 'string' ? env.TOKEN_ISLAND_HOME.trim() : '';
  if (override.length > 0) return expandPath(override, homeDir);
  return path.join(homeDir, '.token-island');
}

function parsePort(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) return null;
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePrices(value: unknown): PriceOverride[] {
  if (!Array.isArray(value)) return [];
  const prices: PriceOverride[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const match = typeof entry.match === 'string' ? entry.match.trim() : '';
    const input = Number(entry.input);
    const output = Number(entry.output);
    if (!match || !Number.isFinite(input) || !Number.isFinite(output)) continue;
    const override: PriceOverride = { match, input, output };
    const cacheRead = Number(entry.cacheRead);
    if (Number.isFinite(cacheRead)) override.cacheRead = cacheRead;
    const cacheWrite = Number(entry.cacheWrite);
    if (Number.isFinite(cacheWrite)) override.cacheWrite = cacheWrite;
    if (typeof entry.note === 'string') override.note = entry.note;
    prices.push(override);
  }
  return prices;
}

/** Parses a cloud section with the documented defaults. */
export function normalizeCloudConfig(value: unknown, env: NodeJS.ProcessEnv = {}): CollectorCloudConfig {
  const raw = isRecord(value) ? value : {};
  const envKey = typeof env.TOKEN_ISLAND_API_KEY === 'string' ? env.TOKEN_ISLAND_API_KEY.trim() : '';
  const fileKey = typeof raw.apiKey === 'string' ? raw.apiKey : '';
  const apiKey = envKey || fileKey;
  return {
    enabled: raw.enabled === true || (envKey.length > 0 && typeof raw.url === 'string' && raw.url.trim().length > 0),
    url: typeof raw.url === 'string' ? raw.url.trim() : '',
    username: typeof raw.username === 'string' ? raw.username : '',
    apiKey,
    autoSync: raw.autoSync !== false,
    intervalMinutes: clampInt(raw.intervalMinutes, 15, 1, 1_440),
  };
}

export interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
  platform: string;
}

/** Re-reads only `cloud` from disk (registration/login can happen while the daemon runs). */
export function readCloudSettings(
  configPath: string,
  env: NodeJS.ProcessEnv = process.env,
): { cloud: CollectorCloudConfig; error: string | null } {
  const { raw, error } = readRawConfigFile(configPath);
  return { cloud: normalizeCloudConfig(raw.cloud, env), error };
}

interface RawConfigReadResult {
  raw: RawConfigFile;
  error: string | null;
}

export function readRawConfigFile(configPath: string): RawConfigReadResult {
  let text: string;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { raw: {}, error: null };
    return { raw: {}, error: `cannot read config: ${(error as Error).message}` };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return { raw: {}, error: 'config is not a JSON object' };
    return { raw: parsed as RawConfigFile, error: null };
  } catch (error) {
    return { raw: {}, error: `invalid config JSON: ${(error as Error).message}` };
  }
}

export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const home = resolveStateHome(env, homeDir);
  const configPath = path.join(home, 'config.json');
  const { raw, error } = readRawConfigFile(configPath);

  const envPort = parsePort(env.TOKEN_ISLAND_PORT);
  const filePort = parsePort(raw.port);
  const port = envPort ?? filePort ?? DEFAULT_PORT;
  // Demo mode listens on its own port so it can run next to the real collector.
  const demoPort = parsePort(env.TOKEN_ISLAND_DEMO_PORT) ?? parsePort(raw.demoPort) ?? DEMO_PORT;

  const timezoneSetting =
    typeof raw.timezone === 'string' && raw.timezone.trim().length > 0 ? raw.timezone.trim() : 'auto';
  const timezone = resolveTimezone(timezoneSetting === 'auto' ? undefined : timezoneSetting);

  const defaultPaths: CollectorPaths = {
    claude: path.join(homeDir, '.claude'),
    codex: path.join(homeDir, '.codex'),
    opencode: path.join(homeDir, '.local', 'share', 'opencode'),
    dsh: path.join(homeDir, '.dsh'),
  };
  const filePaths = isRecord(raw.paths) ? raw.paths : {};
  const paths: CollectorPaths = {
    claude: expandPath(filePaths.claude ?? defaultPaths.claude, homeDir),
    codex: expandPath(filePaths.codex ?? defaultPaths.codex, homeDir),
    opencode: expandPath(filePaths.opencode ?? defaultPaths.opencode, homeDir),
    dsh: expandPath(filePaths.dsh ?? defaultPaths.dsh, homeDir),
  };

  const fileSources = isRecord(raw.sources) ? raw.sources : {};
  const sources: LoadedConfig['sources'] = {
    claude: fileSources.claude !== false,
    codex: fileSources.codex !== false,
    opencode: fileSources.opencode !== false,
    dsh: fileSources.dsh !== false,
    gemini: fileSources.gemini === true,
  };

  return {
    home,
    configPath,
    dbPath: path.join(home, 'data.db'),
    demoDbPath: path.join(home, 'demo.db'),
    port,
    demoPort,
    timezoneSetting,
    timezone,
    backfillDays: clampInt(raw.backfillDays, DEFAULT_BACKFILL_DAYS, 1, 3_650),
    scanIntervalMs: clampInt(raw.scanIntervalMs, DEFAULT_SCAN_INTERVAL_MS, 250, 3_600_000),
    liveWindowMs: clampInt(raw.liveWindowMs, DEFAULT_LIVE_WINDOW_MS, 60_000, 86_400_000),
    sources,
    paths,
    prices: normalizePrices(raw.prices),
    cloud: normalizeCloudConfig(raw.cloud, env),
    raw,
    configError: error,
  };
}
