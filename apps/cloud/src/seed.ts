#!/usr/bin/env node
/**
 * Idempotent demo seed.
 *
 *   TOKEN_ISLAND_CLOUD_DB=./data/cloud.db pnpm --filter @token-island/cloud seed
 *
 * Creates two deterministic profiles:
 *   demo  — 120 days of demo data, seed 42, display name "Demo Agent"
 *   alice —  60 days of demo data, seed 7
 *
 * Re-running refreshes the day rows, keeps the existing API key (only its hash
 * is stored) and prints how to rotate it: `seed --rotate`.
 */

import { generateDemoCloudDays } from '@token-island/core';
import { generateApiKey, hashApiKey } from './auth.js';
import { loadConfig } from './config.js';
import { CloudDb, type UserRecord } from './db.js';

interface SeedProfile {
  username: string;
  displayName: string;
  days: number;
  seed: number;
}

const PROFILES: SeedProfile[] = [
  { username: 'demo', displayName: 'Demo Agent', days: 120, seed: 42 },
  { username: 'alice', displayName: 'Alice', days: 60, seed: 7 },
];

interface SeedResult {
  profile: SeedProfile;
  user: UserRecord;
  apiKey: string | null;
  rotated: boolean;
  totalDays: number;
  firstDate: string | null;
  lastDate: string | null;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function printUrls(username: string, port: number): string[] {
  const base = `http://127.0.0.1:${port}`;
  return [
    `  dashboard  ${base}/u/${username}`,
    `  badge      ${base}/u/${username}/badge.svg`,
    `  cost       ${base}/u/${username}/badge.svg?metric=cost`,
    `  heatmap    ${base}/u/${username}/chart.svg?type=heatmap&days=365`,
    `  chart      ${base}/u/${username}/chart.svg`,
    `  card       ${base}/u/${username}/card.svg`,
  ];
}

function seedProfile(db: CloudDb, profile: SeedProfile, rotate: boolean, now: number): SeedResult {
  const existing = db.getUser(profile.username);
  let apiKey: string | null = null;
  let rotated = false;
  let user: UserRecord;

  if (!existing) {
    apiKey = generateApiKey();
    user = db.createUser({
      username: profile.username,
      displayName: profile.displayName,
      apiKeyHash: hashApiKey(apiKey),
      now,
    });
  } else if (rotate) {
    apiKey = generateApiKey();
    db.setApiKeyHash(profile.username, hashApiKey(apiKey), now);
    rotated = true;
    user = db.getUser(profile.username) ?? existing;
  } else {
    user = existing;
  }

  const days = generateDemoCloudDays({ days: profile.days, seed: profile.seed, now });
  const result = db.upsertDays(profile.username, days, now);
  db.touchLastSync(profile.username, now);

  return {
    profile,
    user: db.getUser(profile.username) ?? user,
    apiKey,
    rotated,
    totalDays: result.totalDays,
    firstDate: result.firstDate,
    lastDate: result.lastDate,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const rotate = args.includes('--rotate');
  const config = loadConfig();
  const now = Date.now();
  const port = config.port || 47117;

  log('');
  log('Token Island · cloud seed');
  log(`database: ${config.dbPath}`);
  log('');

  let db: CloudDb;
  try {
    db = new CloudDb(config.dbPath);
  } catch (error) {
    process.stderr.write(
      `[seed] failed to open database ${config.dbPath}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const results: SeedResult[] = [];
  try {
    for (const profile of PROFILES) {
      results.push(seedProfile(db, profile, rotate, now));
    }
  } finally {
    db.close();
  }

  for (const result of results) {
    const name = result.profile.username.padEnd(6);
    if (result.apiKey) {
      const note = result.rotated ? 'rotated — the old key no longer works' : 'store it now, only its hash is kept';
      log(`✔ ${name} ${String(result.totalDays).padStart(3)} days  ${result.firstDate} → ${result.lastDate}`);
      log(`  api key    ${result.apiKey}  (${note})`);
    } else {
      log(`✔ ${name} ${String(result.totalDays).padStart(3)} days  ${result.firstDate} → ${result.lastDate}`);
      log('  api key    (already seeded — key hidden; re-run with --rotate to issue a new one)');
    }
    log(`  display    ${result.user.displayName}`);
    log('');
  }

  log('Copy-paste URLs (start the server first if it is not running):');
  for (const result of results) {
    log('');
    log(`@${result.profile.username}`);
    for (const line of printUrls(result.profile.username, port)) log(line);
  }
  log('');
  log('Start the server:');
  log('  pnpm --filter @token-island/cloud start');
  log('');
  log('README markdown (swap in your own username):');
  const first = results[0]?.profile.username ?? 'demo';
  log(`  [![tokens](http://127.0.0.1:${port}/u/${first}/badge.svg?metric=tokens&theme=dark)](http://127.0.0.1:${port}/u/${first})`);
  log(`  [![cost](http://127.0.0.1:${port}/u/${first}/badge.svg?metric=cost&theme=dark)](http://127.0.0.1:${port}/u/${first})`);
  log(`  [![streak](http://127.0.0.1:${port}/u/${first}/badge.svg?metric=streak&theme=dark)](http://127.0.0.1:${port}/u/${first})`);
  log('');
}

main();
