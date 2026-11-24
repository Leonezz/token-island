/** Shared test harness: temp database under the repo + a server on port 0. */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dateKey, dateRangeKeys, resolveTimezone } from '@token-island/core';
import { createNodeApp, type CloudAppOptions, type NodeApp } from '../src/node.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const RUNTIME_DIR = join(REPO_ROOT, '.runtime', 'cloud');

export interface TestServer {
  app: NodeApp;
  baseUrl: string;
  dbPath: string;
  cleanup(): Promise<void>;
}

export async function startTestServer(options: Partial<CloudAppOptions> = {}): Promise<TestServer> {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const dir = mkdtempSync(join(RUNTIME_DIR, 'test-'));
  const dbPath = join(dir, 'cloud.db');
  const app = createNodeApp({ dbPath, host: '127.0.0.1', port: 0, ...options });
  const address = await app.listen();
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    dbPath,
    cleanup: async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface FetchResult {
  status: number;
  headers: Headers;
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

export async function request(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<FetchResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: options.headers,
    body: options.body,
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, text, json };
}

export function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', ...extra };
}

export async function postJson(
  baseUrl: string,
  path: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<FetchResult> {
  return request(baseUrl, path, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: jsonHeaders(headers),
  });
}

export function bearer(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

/** Registers a user and returns its API key. */
export async function registerUser(
  baseUrl: string,
  username: string,
  displayName?: string,
): Promise<{ username: string; apiKey: string; payload: Record<string, unknown> }> {
  const result = await postJson(baseUrl, '/api/v1/register', { username, displayName });
  if (result.status !== 201) {
    throw new Error(`register failed (${result.status}): ${result.text}`);
  }
  const payload = result.json as Record<string, unknown>;
  return { username: String(payload.username), apiKey: String(payload.apiKey), payload };
}

export function todayKey(now = Date.now()): string {
  return dateKey(now, resolveTimezone());
}

export function recentDateKeys(days: number, now = Date.now()): string[] {
  return dateRangeKeys(todayKey(now), days);
}

/** Sums a numeric field of the public stats JSON over the last `days` days. */
export function publicWindowSum(
  stats: { daily?: Array<Record<string, unknown>> },
  field: string,
  days: number,
  now = Date.now(),
): number {
  const keys = new Set(recentDateKeys(days, now));
  let sum = 0;
  for (const day of stats.daily ?? []) {
    const date = typeof day.date === 'string' ? day.date : '';
    if (!keys.has(date)) continue;
    const value = day[field];
    if (typeof value === 'number') sum += value;
  }
  return sum;
}

/** A minimal valid CloudDay used by validation tests. */
export function sampleDay(
  date: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    date,
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 2000,
    cacheWriteTokens: 100,
    reasoningTokens: 50,
    totalTokens: 3600,
    unpricedTokens: 0,
    costUsd: 0.05,
    messages: 3,
    models: { 'claude-sonnet-4-6': 3600 },
    ...overrides,
  };
}
