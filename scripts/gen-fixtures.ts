/**
 * Regenerates the committed fixtures used by the widget's snapshot mode, the
 * cloud demo seeding and the e2e script.
 *
 * Usage: pnpm fixtures [--now <epoch-ms>] [--days <n>] [--seed <n>]
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  generateDemoCloudDays,
  generateDemoEvents,
  generateDemoSummary,
} from '@token-island/core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'fixtures');
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
function arg(name: string, fallback?: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const now = Number(arg('now') ?? Date.now());
const days = Number(arg('days') ?? 120);
const seed = Number(arg('seed') ?? 42);
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const options = { now, days, seed, timezone };

const summaryToday = generateDemoSummary({ ...options, range: 'today', dailyDays: 14 });
const summary30d = generateDemoSummary({ ...options, range: '30d', dailyDays: 30 });
const cloudDays = generateDemoCloudDays(options);
const events = generateDemoEvents(options);
const sampleEvents = events.slice(-120);

function writeJson(name: string, data: unknown): void {
  writeFileSync(resolve(outDir, name), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

writeJson('summary.example.json', summaryToday);
writeJson('summary.30d.example.json', summary30d);
writeJson('cloud-days.example.json', cloudDays);
writeJson('events.sample.json', sampleEvents);

console.log(
  [
    `fixtures written to ${outDir}`,
    `  now       ${new Date(now).toISOString()} (${timezone})`,
    `  events    ${events.length} generated, ${sampleEvents.length} sampled`,
    `  today     ${summaryToday.today.totalTokens} tokens, ${summaryToday.streak.current}d streak, ${summaryToday.live.length} live sessions`,
    `  30d       ${summary30d.totals.totalTokens} tokens, $${summary30d.totals.costUsd.toFixed(2)}`,
    `  cloudDays ${cloudDays.length} days`,
  ].join('\n'),
);
