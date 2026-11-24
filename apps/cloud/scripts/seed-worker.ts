#!/usr/bin/env node
/**
 * Seed the Cloudflare Worker runtime over HTTP (no direct D1 access needed).
 *
 *   pnpm --filter @token-island/cloud worker:seed
 *   # or against another base URL / username:
 *   node --import tsx scripts/seed-worker.ts --url http://127.0.0.1:47131 --username demo
 *
 * Registers the profile (if it does not exist yet) and POSTs the same
 * deterministic demo days the Node seed uses.  Registration is the only moment
 * the API key can be read, so this script prints it for copy-paste.
 */

import { generateDemoCloudDays } from '@token-island/core';

interface Args {
  url: string;
  username: string;
  displayName: string;
  days: number;
  seed: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    url: process.env.TOKEN_ISLAND_WORKER_URL?.trim() || 'http://127.0.0.1:47131',
    username: 'demo',
    displayName: 'Demo Agent',
    days: 120,
    seed: 42,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case '--url':
        if (value) args.url = value.replace(/\/+$/, '');
        index += 1;
        break;
      case '--username':
        if (value) args.username = value;
        index += 1;
        break;
      case '--display-name':
        if (value) args.displayName = value;
        index += 1;
        break;
      case '--days':
        if (value) args.days = Math.min(400, Math.max(1, Number.parseInt(value, 10) || 120));
        index += 1;
        break;
      case '--seed':
        if (value) args.seed = Number.parseInt(value, 10) || 42;
        index += 1;
        break;
      default:
        break;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  process.stdout.write(`[worker-seed] target: ${args.url}\n`);

  const health = await fetch(`${args.url}/healthz`);
  if (!health.ok) {
    process.stderr.write(`[worker-seed] ${args.url}/healthz returned ${health.status}; is the worker running?\n`);
    process.exitCode = 1;
    return;
  }

  let apiKey: string | null = null;
  let username = args.username;
  const register = await fetch(`${args.url}/api/v1/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: args.username, displayName: args.displayName }),
  });
  if (register.status === 201) {
    const payload = (await register.json()) as { username: string; apiKey: string };
    username = payload.username;
    apiKey = payload.apiKey;
    process.stdout.write(`[worker-seed] registered @${username} — api key: ${apiKey}\n`);
  } else if (register.status === 409) {
    process.stdout.write(
      `[worker-seed] @${args.username} already exists; the API key is not recoverable. ` +
        `Re-run with --username <new-name> to seed another profile.\n`,
    );
    process.exitCode = 1;
    return;
  } else {
    const text = await register.text();
    process.stderr.write(`[worker-seed] register failed (${register.status}): ${text}\n`);
    process.exitCode = 1;
    return;
  }

  const days = generateDemoCloudDays({ days: args.days, seed: args.seed });
  const ingest = await fetch(`${args.url}/api/v1/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ version: '0.2.0', client: 'seed-worker', days }),
  });
  if (!ingest.ok) {
    process.stderr.write(`[worker-seed] ingest failed (${ingest.status}): ${await ingest.text()}\n`);
    process.exitCode = 1;
    return;
  }
  const result = (await ingest.json()) as { days: number; firstDate: string; lastDate: string; totalDays: number };
  process.stdout.write(
    `[worker-seed] @${username}: ${result.days} days ingested (${result.firstDate} → ${result.lastDate}, ${result.totalDays} stored)\n`,
  );
  process.stdout.write(
    `[worker-seed] URLs:\n  ${args.url}/u/${username}\n  ${args.url}/u/${username}/badge.svg\n` +
      `  ${args.url}/u/${username}/chart.svg?type=heatmap&days=365\n  ${args.url}/u/${username}/card.svg\n`,
  );
}

void main();
