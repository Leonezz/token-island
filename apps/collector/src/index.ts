#!/usr/bin/env node
/**
 * Token Island collector CLI.
 *
 *   tokenisland collect [--foreground] [--once] [--demo] [--reset] [--backfill-days N]
 *   tokenisland sync
 *   tokenisland status
 */

import { runCollect, runStatus, runSyncOnce } from './collector.js';
import { VERSION } from './version.js';
import type { CollectOptions } from './collector.js';

const USAGE = `Token Island collector ${VERSION}

Usage:
  tokenisland collect [--foreground] [--once] [--demo] [--reset] [--backfill-days N]
      Run the collector daemon (foreground). --once scans once, prints counts and exits.
      --demo serves deterministic demo data on port 47119 without SQLite writes.
      --reset deletes the local SQLite database and file-offset state, then rescans.
      --backfill-days N overrides config.backfillDays for this run.
  tokenisland sync       Push current daily rollups to the cloud once.
  tokenisland status     Print the running collector /api/health JSON (or "offline").
`;

interface ParsedCollectArgs {
  options?: CollectOptions;
  error?: string;
  help?: boolean;
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
}

function parseCollectArgs(args: string[]): ParsedCollectArgs {
  const options: CollectOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--foreground') {
      options.foreground = true;
      continue;
    }
    if (arg === '--once') {
      options.once = true;
      continue;
    }
    if (arg === '--demo') {
      options.demo = true;
      continue;
    }
    if (arg === '--reset') {
      options.reset = true;
      continue;
    }
    if (arg === '--backfill-days') {
      const value = parsePositiveInteger(args[index + 1]);
      if (value === null) return { error: '--backfill-days requires a positive integer' };
      options.backfillDays = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--backfill-days=')) {
      const value = parsePositiveInteger(arg.slice('--backfill-days='.length));
      if (value === null) return { error: '--backfill-days requires a positive integer' };
      options.backfillDays = value;
      continue;
    }
    return { error: `unknown option: ${arg}` };
  }
  return { options };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }
  switch (command) {
    case 'collect': {
      const parsed = parseCollectArgs(argv.slice(1));
      if (parsed.error) {
        console.error(parsed.error);
        console.error(USAGE);
        return 2;
      }
      if (parsed.help) {
        console.log(USAGE);
        return 0;
      }
      return await runCollect(parsed.options ?? {});
    }
    case 'sync':
      return await runSyncOnce();
    case 'status':
      return await runStatus();
    default:
      console.error(`unknown command: ${command}`);
      console.error(USAGE);
      return 2;
  }
}

try {
  const code = await main();
  if (code !== 0) process.exitCode = code;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
