/**
 * Collector lifecycle: CLI-backed modes.
 *
 *   collect [--once] [--demo] [--reset] [--backfill-days N] [--foreground]
 *   sync      one cloud push
 *   status    print the running collector's /api/health JSON (or "offline")
 */

import {
  EventAggregator,
  SOURCE_IDS,
  SOURCE_META,
  formatCost,
  formatPercent,
  formatTokens,
  generateDemoEvents,
} from '@token-island/core';
import type { CloudSyncStatus, SourceStatus, Summary, UsageEvent } from '@token-island/core';
import { loadConfig, type LoadedConfig } from './config.js';
import { Store } from './db.js';
import { Scanner, type ScanPassResult } from './scanner.js';
import { createCollectorServer } from './server.js';
import type { CollectorServerContext } from './server.js';
import { CloudSync } from './sync.js';
import { sourceTargets } from './sources/index.js';
import type { CollectorSourceId } from './sources/types.js';
import { VERSION } from './version.js';

export interface CollectOptions {
  once?: boolean;
  demo?: boolean;
  reset?: boolean;
  backfillDays?: number;
  port?: number;
  parentPid?: number;
  /** Accepted for supervisor compatibility; the collector always runs in the foreground. */
  foreground?: boolean;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function clock(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

function applyBackfillOverride(config: LoadedConfig, backfillDays?: number): void {
  if (backfillDays === undefined) return;
  if (!Number.isFinite(backfillDays) || backfillDays < 1) return;
  config.backfillDays = Math.min(3_650, Math.floor(backfillDays));
}

function sourceStatusesFromEvents(events: readonly UsageEvent[]): SourceStatus[] {
  const counts = new Map<string, { events: number; lastEventAt: number | null }>();
  for (const event of events) {
    const current = counts.get(event.source) ?? { events: 0, lastEventAt: null };
    current.events += 1;
    current.lastEventAt = current.lastEventAt === null ? event.ts : Math.max(current.lastEventAt, event.ts);
    counts.set(event.source, current);
  }
  return SOURCE_IDS.map<SourceStatus>((source) => {
    const found = counts.get(source);
    return {
      source,
      enabled: source === 'claude' || source === 'codex' || source === 'opencode' || source === 'dsh',
      lastEventAt: found?.lastEventAt ?? null,
      events: found?.events ?? 0,
      error: null,
    };
  });
}

function eventsFromStore(store: Store, config: LoadedConfig): { aggregator: EventAggregator; count: number } {
  const aggregator = new EventAggregator({ timezone: config.timezone, liveWindowMs: config.liveWindowMs });
  let count = 0;
  for (const event of store.iterateEvents()) {
    aggregator.add(event);
    count += 1;
  }
  return { aggregator, count };
}

function logScanPass(pass: ScanPassResult, totalEvents: number): void {
  const changed = pass.sources.filter((source) => source.newEvents > 0);
  if (pass.newEvents > 0) {
    const parts = changed.map((source) => `${source.source} +${source.newEvents}`).join(', ');
    console.log(
      `[${clock()}] +${pass.newEvents} events (${parts}) · ${formatTokens(totalEvents)} events total · ${pass.durationMs}ms`,
    );
    return;
  }
  if (pass.pending) {
    console.log(`[${clock()}] backfill continues (${pass.durationMs}ms)`);
  }
}

function printOnceSummary(summary: Summary, label: string): void {
  const totals = summary.totals;
  console.log(
    `totals (${label}): ${formatTokens(totals.totalTokens)} tokens · ${formatCost(totals.costUsd, { approx: true })} · ${totals.messages} messages · ${totals.sessions} sessions`,
  );
  const sources = summary.sources
    .filter((row) => row.totalTokens > 0)
    .slice(0, 4)
    .map((row) => `${row.label} ${formatPercent(row.share)}`)
    .join(' · ');
  if (sources.length > 0) console.log(`top sources: ${sources}`);
  const models = summary.models
    .filter((row) => row.totalTokens > 0)
    .slice(0, 5)
    .map((row) => `${row.key} ${formatPercent(row.share)}`)
    .join(' · ');
  if (models.length > 0) console.log(`top models: ${models}`);
}

async function runOnce(config: LoadedConfig, store: Store): Promise<number> {
  const startedAt = Date.now();
  const aggregator = new EventAggregator({ timezone: config.timezone, liveWindowMs: config.liveWindowMs });
  let bootEvents = 0;
  for (const event of store.iterateEvents()) {
    aggregator.add(event);
    bootEvents += 1;
  }
  const scanner = new Scanner(store, aggregator, config, {
    concurrency: 4,
    fileBudgetBytes: 128 * 1024 * 1024,
  });
  scanner.init();

  console.log(
    `token-island collector ${VERSION} · once scan (backfillDays=${config.backfillDays}, db ${store.path}, ${bootEvents} existing events)`,
  );
  const passes = await scanner.drain();
  const elapsedMs = Date.now() - startedAt;
  const newEvents = passes.reduce((sum, pass) => sum + pass.newEvents, 0);
  const statuses = scanner.getStatuses();
  const total = scanner.stats();

  for (const status of statuses) {
    const meta = SOURCE_META[status.source];
    const sourcePasses = passes.flatMap((pass) => pass.sources).filter((source) => source.source === status.source);
    const files = sourcePasses.reduce((sum, source) => sum + source.filesScanned, 0);
    const newForSource = sourcePasses.reduce((sum, source) => sum + source.newEvents, 0);
    const enabledLabel = status.enabled ? `+${newForSource} new · ${files} files` : 'disabled';
    console.log(`  ${meta.short.padEnd(9)} ${enabledLabel} · total ${status.events}`);
    if (status.error) console.log(`  ${''.padEnd(9)} warning: ${status.error}`);
  }

  const cloud = new CloudSync({
    configPath: config.configPath,
    cloud: config.cloud,
    store,
    getDays: () => aggregator.cloudDays({ maxDays: 400 }),
    timezone: () => config.timezone,
  });
  const windowSummary = aggregator.finalize({
    range: config.backfillDays <= 7 ? '7d' : '30d',
    now: Date.now(),
    dailyDays: 30,
    collector: {
      version: VERSION,
      dbPath: config.dbPath,
      watchRoots: scanner.watchRoots(),
      sources: statuses,
      cloud: cloud.status(),
    },
  });
  const allSummary = aggregator.finalize({
    range: 'all',
    now: Date.now(),
    dailyDays: 30,
    collector: {
      version: VERSION,
      dbPath: config.dbPath,
      watchRoots: scanner.watchRoots(),
      sources: statuses,
      cloud: cloud.status(),
    },
  });

  console.log(
    `scan: ${newEvents} new events in ${(elapsedMs / 1_000).toFixed(2)}s · ${total.events} events in db · ${passes.length} pass(es)`,
  );
  if (passes.some((pass) => pass.pending)) {
    console.log('warning: scan budget reached before EOF; run again to finish the backfill');
  }
  printOnceSummary(windowSummary, config.backfillDays <= 7 ? '7d' : '30d');
  printOnceSummary(allSummary, 'all-time');
  console.log(`db: ${store.path}`);
  return 0;
}

function createSync(config: LoadedConfig, store: Store, aggregator: EventAggregator): CloudSync {
  return new CloudSync({
    configPath: config.configPath,
    cloud: config.cloud,
    store,
    getDays: () => aggregator.cloudDays({ maxDays: 400 }),
    timezone: () => config.timezone,
  });
}

async function runDaemon(config: LoadedConfig, store: Store, parentPid?: number): Promise<number> {
  const startedAt = Date.now();
  const { aggregator, count: bootEvents } = eventsFromStore(store, config);
  const scanner = new Scanner(store, aggregator, config, {
    concurrency: 4,
    fileBudgetBytes: 32 * 1024 * 1024,
  });
  scanner.init();
  const cloud = createSync(config, store, aggregator);

  let shuttingDown = false;
  let scanTimer: NodeJS.Timeout | null = null;
  let parentWatchTimer: NodeJS.Timeout | null = null;
  const notifiedError = new Map<string, string | null>();

  const scanNow = async (source?: CollectorSourceId): Promise<void> => {
    if (scanner.isRunning) return;
    try {
      const pass = await scanner.scanAll(source);
      if (pass.busy) return;
      logScanPass(pass, scanner.stats().events);
      if (pass.newEvents > 0) cloud.onNewEvents();
      for (const sourceStat of pass.sources) {
        const previous = notifiedError.get(sourceStat.source) ?? null;
        if (sourceStat.error && sourceStat.error !== previous) {
          console.error(`[${clock()}] ${sourceStat.source} parser error: ${sourceStat.error}`);
        }
        notifiedError.set(sourceStat.source, sourceStat.error);
      }
    } catch (error) {
      if (shuttingDown) return;
      console.error(`[${clock()}] scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const context: CollectorServerContext = {
    version: VERSION,
    demo: false,
    dbPath: config.dbPath,
    startedAt,
    timezone: config.timezone,
    liveWindowMs: config.liveWindowMs,
    aggregator,
    sources: () => scanner.getStatuses(),
    watchRoots: () => scanner.watchRoots(),
    cloudStatus: () => cloud.status(),
    stats: () => scanner.stats(),
    scan: (source) => {
      void scanNow(source);
    },
    sync: () => cloud.syncNow(),
  };
  const server = await createCollectorServer(context, { port: config.port });

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[${clock()}] ${signal} received, shutting down`);
    if (scanTimer) clearInterval(scanTimer);
    if (parentWatchTimer) clearInterval(parentWatchTimer);
    cloud.stop();
    try {
      await server.close();
      const deadline = Date.now() + 3_000;
      while (scanner.isRunning && Date.now() < deadline) {
        await new Promise((done) => setTimeout(done, 25));
      }
    } finally {
      store.close();
    }
  };

  return await new Promise<number>((resolve) => {
    const onSignal = (signal: string): void => {
      void shutdown(signal).then(() => resolve(0));
    };
    process.once('SIGINT', () => onSignal('SIGINT'));
    process.once('SIGTERM', () => onSignal('SIGTERM'));

    if (parentPid && parentPid > 1) {
      parentWatchTimer = setInterval(() => {
        if (!isProcessAlive(parentPid)) {
          onSignal('PARENT_EXIT');
        }
      }, 2_500);
      parentWatchTimer.unref?.();
    }

    console.log(
      `token-island collector ${VERSION} listening on http://127.0.0.1:${server.port} (db ${config.dbPath}, ${bootEvents} events, tz ${config.timezone})`,
    );
    cloud.start();
    scanTimer = setInterval(() => {
      void scanNow();
    }, config.scanIntervalMs);
    scanTimer.unref?.();
    void scanNow();
  });
}

async function runDemoServer(config: LoadedConfig): Promise<number> {
  const startedAt = Date.now();
  const events = generateDemoEvents({ days: 120, timezone: config.timezone });
  const aggregator = new EventAggregator({ timezone: config.timezone, liveWindowMs: config.liveWindowMs });
  aggregator.addMany(events);
  const statuses = sourceStatusesFromEvents(events);
  const lastEventAt = events.reduce((max, event) => Math.max(max, event.ts), 0);
  const watchRoots = sourceTargets(config.paths).map((target) => target.watchPath);
  const demoCloud: CloudSyncStatus = {
    enabled: false,
    lastSyncAt: null,
    lastError: null,
    username: config.cloud.username || null,
    endpoint: config.cloud.url || null,
  };

  const context: CollectorServerContext = {
    version: VERSION,
    demo: true,
    dbPath: config.demoDbPath,
    startedAt,
    timezone: config.timezone,
    liveWindowMs: config.liveWindowMs,
    aggregator,
    sources: () => statuses,
    watchRoots: () => watchRoots,
    cloudStatus: () => demoCloud,
    stats: () => ({ events: events.length, lastEventAt }),
    scan: () => {
      // Demo mode has no on-disk sources to rescan.
    },
    sync: null,
  };
  const server = await createCollectorServer(context, { port: config.demoPort });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[${clock()}] ${signal} received, shutting down`);
    await server.close();
  };

  return await new Promise<number>((resolve) => {
    process.once('SIGINT', () => {
      void shutdown('SIGINT').then(() => resolve(0));
    });
    process.once('SIGTERM', () => {
      void shutdown('SIGTERM').then(() => resolve(0));
    });
    console.log(
      `token-island collector ${VERSION} demo mode on http://127.0.0.1:${server.port} (${events.length} demo events, no SQLite writes)`,
    );
  });
}

/** `collect` command. Returns the process exit code. */
export async function runCollect(options: CollectOptions): Promise<number> {
  const config = loadConfig();
  applyBackfillOverride(config, options.backfillDays);
  if (options.port && Number.isInteger(options.port) && options.port >= 1 && options.port <= 65_535) {
    if (options.demo) config.demoPort = options.port;
    else config.port = options.port;
  }
  if (options.demo) return runDemoServer(config);
  if (config.configError) console.error(`config: ${config.configError}`);
  if (options.reset) {
    Store.removeDatabaseFiles(config.dbPath);
    console.log(`reset: removed ${config.dbPath}`);
  }
  const store = new Store(config.dbPath);
  try {
    if (options.once) return await runOnce(config, store);
    return await runDaemon(config, store, options.parentPid);
  } finally {
    store.close();
  }
}

/** `sync` command: one manual cloud push. */
export async function runSyncOnce(): Promise<number> {
  const config = loadConfig();
  if (config.configError) console.error(`config: ${config.configError}`);
  const store = new Store(config.dbPath);
  try {
    const { aggregator } = eventsFromStore(store, config);
    const cloud = createSync(config, store, aggregator);
    const result = await cloud.syncNow();
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          disabled: result.disabled,
          lastSyncAt: result.lastSyncAt,
          error: result.error,
        },
        null,
        2,
      ),
    );
    if (result.ok || result.disabled) return 0;
    return 1;
  } finally {
    store.close();
  }
}

/** `status` command: print the running collector's health JSON, or "offline". */
export async function runStatus(): Promise<number> {
  const config = loadConfig();
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health: unknown = await response.json();
    console.log(JSON.stringify(health, null, 2));
    return 0;
  } catch {
    console.log('offline');
    return 0;
  }
}
