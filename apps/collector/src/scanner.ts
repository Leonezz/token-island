/**
 * Scanner: incrementally walks the enabled source roots, feeds new events into
 * SQLite and the in-memory `EventAggregator`, and tracks per-source health for
 * `/api/health` and the widget's `collector` metadata.
 *
 * Scans are bounded (concurrency + per-file byte budget) so a 300 MB backlog is
 * consumed over several background passes instead of blocking the HTTP API.
 */

import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import type { EventAggregator, SourceId, SourceStatus, UsageEvent } from '@token-island/core';
import { SOURCE_IDS } from '@token-island/core';
import type { LoadedConfig } from './config.js';
import type { Store } from './db.js';
import {
  JSONL_SOURCES,
  discoverAntigravityFiles,
  opencodeDatabaseParser,
  resolveAntigravityRoots,
  scanAntigravityDbFile,
  scanAntigravityTranscriptFile,
  sourceTargets,
} from './sources/index.js';
import type {
  CollectorSourceId,
  DiscoveredFile,
  FileScanInput,
  SourceContext,
  StoredFileState,
} from './sources/types.js';

const MAX_ERROR_LENGTH = 300;
const MAX_WALK_DEPTH = 8;
const IMPLEMENTED_SOURCES: CollectorSourceId[] = ['claude', 'codex', 'opencode', 'dsh', 'antigravity'];

export interface ScannerOptions {
  /** Files parsed concurrently per source. */
  concurrency?: number;
  /** Per-file byte budget per scan pass (JSONL sources). */
  fileBudgetBytes?: number;
}

export interface SourceScanStats {
  source: CollectorSourceId;
  enabled: boolean;
  newEvents: number;
  filesScanned: number;
  filesPending: number;
  bytesRead: number;
  error: string | null;
  durationMs: number;
}

export interface ScanPassResult {
  startedAt: number;
  durationMs: number;
  newEvents: number;
  /** True when at least one file still has unread bytes (next pass needed). */
  pending: boolean;
  bytesRead: number;
  sources: SourceScanStats[];
  /** True when a scan was already running and this call was a no-op. */
  busy: boolean;
}

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message;
}

async function discoverFiles(dir: string, match: (fileName: string) => boolean): Promise<DiscoveredFile[]> {
  const files: DiscoveredFile[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries;
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < MAX_WALK_DEPTH) stack.push({ dir: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || !match(entry.name)) continue;
      try {
        const stat = await fs.stat(fullPath);
        files.push({ path: fullPath, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) });
      } catch {
        // File disappeared between readdir and stat: ignore.
      }
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

async function runPool<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item);
    }
  });
  await Promise.all(runners);
  return results;
}

export class Scanner {
  private readonly statuses: Map<SourceId, SourceStatus> = new Map();
  private running = false;

  constructor(
    private readonly store: Store,
    private readonly aggregator: EventAggregator,
    private readonly config: LoadedConfig,
    private readonly options: ScannerOptions = {},
  ) {
    for (const source of SOURCE_IDS) {
      this.statuses.set(source, {
        source,
        // Seed from configuration so /api/health is meaningful before the first
        // scan pass reaches this source (the pass then refines it to "root
        // exists and is enabled").
        enabled: (this.config.sources as Record<string, boolean | undefined>)[source] === true,
        lastEventAt: null,
        events: 0,
        error: null,
      });
    }
  }

  /** Seeds per-source counters from SQLite so health is correct before the first scan. */
  init(): void {
    const stats = this.store.sourceEventStats();
    for (const [source, sourceStats] of stats) {
      const status = this.statuses.get(source);
      if (!status) continue;
      status.events = sourceStats.events;
      status.lastEventAt = sourceStats.lastEventAt;
    }
  }

  getStatuses(): SourceStatus[] {
    return SOURCE_IDS.map((source) => ({ ...(this.statuses.get(source) as SourceStatus) }));
  }

  /** Existing watch roots, exposed in the collector metadata for debugging. */
  watchRoots(): string[] {
    const roots = sourceTargets(this.config.paths)
      .filter((target) => target.id !== 'antigravity' && existsSync(target.watchPath))
      .map((target) => target.watchPath);
    if (this.config.sources.antigravity) {
      for (const agyRoot of this.activeAntigravityRoots()) {
        if (!roots.includes(agyRoot)) roots.push(agyRoot);
      }
    }
    return roots;
  }

  private activeAntigravityRoots(): string[] {
    const explicit =
      typeof this.config.raw.paths?.antigravity === 'string' &&
      this.config.raw.paths.antigravity.trim().length > 0;
    return resolveAntigravityRoots(this.config.paths.antigravity, explicit).filter(
      (root) =>
        existsSync(path.join(root, 'conversations')) ||
        existsSync(path.join(root, 'brain')) ||
        path.basename(root) === 'conversations',
    );
  }

  stats(): { events: number; lastEventAt: number | null } {
    let events = 0;
    let lastEventAt: number | null = null;
    for (const status of this.statuses.values()) {
      events += status.events;
      if (status.lastEventAt !== null && (lastEventAt === null || status.lastEventAt > lastEventAt)) {
        lastEventAt = status.lastEventAt;
      }
    }
    return { events, lastEventAt };
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Repeated scan passes until the bounded backlog is fully consumed (`--once`). */
  async drain(maxPasses = 50): Promise<ScanPassResult[]> {
    const passes: ScanPassResult[] = [];
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const result = await this.scanAll();
      passes.push(result);
      if (!result.pending || result.bytesRead <= 0) break;
    }
    return passes;
  }

  async scanAll(only?: CollectorSourceId): Promise<ScanPassResult> {
    const startedAt = Date.now();
    if (this.running) {
      return {
        startedAt,
        durationMs: 0,
        newEvents: 0,
        pending: false,
        bytesRead: 0,
        sources: [],
        busy: true,
      };
    }
    this.running = true;
    try {
      const ctx: SourceContext = {
        timezone: this.config.timezone,
        prices: this.config.prices,
        now: startedAt,
      };
      const cutoff = startedAt - this.config.backfillDays * 86_400_000;
      const sources: SourceScanStats[] = [];
      for (const spec of JSONL_SOURCES) {
        if (only && spec.id !== only) continue;
        sources.push(await this.scanJsonlSource(spec, ctx, cutoff));
      }
      if ((!only || only === 'opencode') && this.config.sources.opencode) {
        sources.push(await this.scanOpencode(ctx));
      } else if (!only || only === 'opencode') {
        const status = this.statusFor('opencode');
        status.enabled = false;
        sources.push(this.emptyStats('opencode'));
      }
      if (!only || only === 'antigravity') {
        sources.push(await this.scanAntigravity(ctx, cutoff));
      }
      const newEvents = sources.reduce((sum, source) => sum + source.newEvents, 0);
      const pending = sources.some((source) => source.filesPending > 0);
      const bytesRead = sources.reduce((sum, source) => sum + source.bytesRead, 0);
      return { startedAt, durationMs: Date.now() - startedAt, newEvents, pending, bytesRead, sources, busy: false };
    } finally {
      this.running = false;
    }
  }

  private statusFor(source: CollectorSourceId): SourceStatus {
    const status = this.statuses.get(source);
    if (!status) throw new Error(`unknown source ${source}`);
    return status;
  }

  private emptyStats(source: CollectorSourceId): SourceScanStats {
    const status = this.statusFor(source);
    return {
      source,
      enabled: status.enabled,
      newEvents: 0,
      filesScanned: 0,
      filesPending: 0,
      bytesRead: 0,
      error: status.error,
      durationMs: 0,
    };
  }

  private async scanAntigravity(ctx: SourceContext, cutoff: number): Promise<SourceScanStats> {
    const startedAt = Date.now();
    const status = this.statusFor('antigravity');
    if (!this.config.sources.antigravity) {
      status.enabled = false;
      status.error = null;
      return this.emptyStats('antigravity');
    }
    const explicit =
      typeof this.config.raw.paths?.antigravity === 'string' &&
      this.config.raw.paths.antigravity.trim().length > 0;
    const candidateRoots = resolveAntigravityRoots(this.config.paths.antigravity, explicit);
    const { dbFiles, transcriptFiles } = await discoverAntigravityFiles(candidateRoots);
    const hasActiveSurface =
      dbFiles.length > 0 ||
      transcriptFiles.length > 0 ||
      candidateRoots.some(
        (root) => existsSync(path.join(root, 'conversations')) || existsSync(path.join(root, 'brain')),
      );
    if (!hasActiveSurface) {
      status.enabled = false;
      status.error = null;
      return this.emptyStats('antigravity');
    }
    status.enabled = true;

    const concurrency = this.options.concurrency ?? 4;
    const fileBudgetBytes = this.options.fileBudgetBytes ?? 64 * 1024 * 1024;
    let newEvents = 0;
    let filesScanned = 0;
    let filesPending = 0;
    let bytesRead = 0;
    let lastError: string | null = null;

    const recordEvents = (events: readonly UsageEvent[]): void => {
      const inserted = this.store.insertEvents(events);
      if (inserted.inserted.length > 0) {
        this.aggregator.addMany(inserted.inserted);
        newEvents += inserted.inserted.length;
        const latest = inserted.inserted.reduce((max, event) => Math.max(max, event.ts), 0);
        status.events += inserted.inserted.length;
        status.lastEventAt = status.lastEventAt === null ? latest : Math.max(status.lastEventAt, latest);
      }
    };

    // 1. Authoritative SQLite conversation databases (`conversations/<id>.db`).
    const dbSessionsWithEvents = new Set<string>();
    const dbJobs = dbFiles.filter((file) => {
      if (file.rawDbSize <= 0) return false;
      const prior = this.store.getFileState(file.path);
      if (prior) {
        if (prior.mtimeMs === file.mtimeMs && prior.size === file.size) {
          if (prior.offset > 0) dbSessionsWithEvents.add(file.sessionId);
          return false;
        }
        return true;
      }
      if (file.mtimeMs < cutoff) {
        dbSessionsWithEvents.add(file.sessionId);
        return false;
      }
      return true;
    });

    await runPool(dbJobs, concurrency, async (file) => {
      try {
        const result = scanAntigravityDbFile(file.path, file.sessionId, ctx);
        bytesRead += file.size;
        recordEvents(result.events);
        const hasEvents = result.events.length > 0;
        if (hasEvents) dbSessionsWithEvents.add(file.sessionId);
        this.store.setFileState(file.path, {
          offset: hasEvents ? file.size : 0,
          mtimeMs: file.mtimeMs,
          size: file.size,
        });
        filesScanned += 1;
      } catch (caught) {
        lastError = truncateError(caught);
        filesScanned += 1;
      }
    });

    // 2. Fallback brain `transcript.jsonl` only for sessions without SQLite events.
    const transcriptJobs: Array<{
      file: (typeof transcriptFiles)[number];
      prior: StoredFileState | null;
    }> = [];
    for (const file of transcriptFiles) {
      if (dbSessionsWithEvents.has(file.sessionId)) continue;
      const prior = this.store.getFileState(file.path);
      if (prior) {
        const fullyConsumed = prior.offset >= file.size;
        if (fullyConsumed && prior.mtimeMs === file.mtimeMs && prior.size === file.size) continue;
      } else if (file.mtimeMs < cutoff) {
        continue;
      }
      transcriptJobs.push({ file, prior });
    }

    await runPool(transcriptJobs, concurrency, async (job) => {
      const truncated = job.prior !== null && job.file.size < job.prior.offset;
      const effectivePrior = truncated ? null : job.prior;
      const parserStateKey = `parser:antigravity:${job.file.path}`;
      const priorParserState = truncated ? null : this.store.getKv(parserStateKey);
      try {
        const result = await scanAntigravityTranscriptFile(
          {
            file: job.file,
            prior: effectivePrior,
            priorParserState,
            ctx,
            maxBytes: fileBudgetBytes,
          } satisfies FileScanInput,
          job.file.sessionId,
        );
        const startOffset = effectivePrior?.offset ?? 0;
        bytesRead += Math.max(0, result.offset - startOffset);
        recordEvents(result.events);
        this.store.setFileState(job.file.path, {
          offset: result.offset,
          mtimeMs: result.mtimeMs,
          size: result.size,
        });
        if (result.parserState !== undefined && result.parserState !== null) {
          this.store.setKv(parserStateKey, result.parserState);
        }
        if (result.more) filesPending += 1;
        filesScanned += 1;
      } catch (caught) {
        lastError = truncateError(caught);
        filesScanned += 1;
      }
    });

    status.error = lastError;
    return {
      source: 'antigravity',
      enabled: true,
      newEvents,
      filesScanned,
      filesPending,
      bytesRead,
      error: lastError,
      durationMs: Date.now() - startedAt,
    };
  }

  private async scanOpencode(ctx: SourceContext): Promise<SourceScanStats> {
    const startedAt = Date.now();
    const status = this.statusFor('opencode');
    const watchPath = path.join(this.config.paths.opencode, 'opencode.db');
    if (!existsSync(watchPath)) {
      status.enabled = false;
      status.error = null;
      return this.emptyStats('opencode');
    }
    status.enabled = true;
    const watermarkRaw = this.store.getKv('opencode.watermark');
    const watermark = watermarkRaw ? Number.parseInt(watermarkRaw, 10) : 0;
    let newEvents = 0;
    let error: string | null = null;
    try {
      const result = await opencodeDatabaseParser(
        { ...ctx, dbPath: watchPath },
        Number.isFinite(watermark) ? watermark : 0,
      );
      const inserted = this.store.insertEvents(result.events);
      if (inserted.inserted.length > 0) {
        this.aggregator.addMany(inserted.inserted);
        newEvents = inserted.inserted.length;
        const latest = inserted.inserted.reduce((max, event) => Math.max(max, event.ts), 0);
        status.events += newEvents;
        status.lastEventAt = status.lastEventAt === null ? latest : Math.max(status.lastEventAt, latest);
      }
      this.store.setKv('opencode.watermark', String(result.watermark));
      status.error = null;
    } catch (caught) {
      error = truncateError(caught);
      status.error = error;
    }
    return {
      source: 'opencode',
      enabled: true,
      newEvents,
      filesScanned: 1,
      filesPending: 0,
      bytesRead: 0,
      error,
      durationMs: Date.now() - startedAt,
    };
  }

  private async scanJsonlSource(
    spec: (typeof JSONL_SOURCES)[number],
    ctx: SourceContext,
    cutoff: number,
  ): Promise<SourceScanStats> {
    const startedAt = Date.now();
    const status = this.statusFor(spec.id);
    const root = this.config.paths[spec.id];
    const watchPath = spec.watchDir(root);
    if (!this.config.sources[spec.id] || !existsSync(watchPath)) {
      status.enabled = false;
      status.error = null;
      return this.emptyStats(spec.id);
    }
    status.enabled = true;

    const files = await discoverFiles(watchPath, spec.match);
    const jobs: Array<{ file: DiscoveredFile; prior: StoredFileState | null }> = [];
    for (const file of files) {
      const prior = this.store.getFileState(file.path);
      if (prior) {
        // A partially consumed file (byte budget) still has offset < size and
        // must be picked up again even when (size, mtime) look unchanged.
        const fullyConsumed =
          spec.mode === 'append' ? prior.offset >= file.size : true;
        if (fullyConsumed && prior.mtimeMs === file.mtimeMs && prior.size === file.size) continue;
      } else if (file.mtimeMs < cutoff) {
        continue;
      }
      jobs.push({ file, prior });
    }

    const concurrency = this.options.concurrency ?? 4;
    const fileBudgetBytes = this.options.fileBudgetBytes ?? 64 * 1024 * 1024;
    let newEvents = 0;
    let filesScanned = 0;
    let filesPending = 0;
    let bytesRead = 0;
    let lastError: string | null = null;

    await runPool(jobs, concurrency, async (job) => {
      const truncated = job.prior !== null && job.file.size < job.prior.offset;
      const effectivePrior = truncated ? null : job.prior;
      const parserStateKey = `parser:${spec.id}:${job.file.path}`;
      const priorParserState = truncated ? null : this.store.getKv(parserStateKey);
      try {
        const result = await spec.parseFile({
          file: job.file,
          prior: effectivePrior,
          priorParserState,
          ctx,
          maxBytes: fileBudgetBytes,
        } satisfies FileScanInput);
        const startOffset = effectivePrior?.offset ?? 0;
        if (spec.mode === 'append') bytesRead += Math.max(0, result.offset - startOffset);
        else bytesRead += job.file.size;
        const inserted = this.store.insertEvents(result.events);
        if (inserted.inserted.length > 0) {
          this.aggregator.addMany(inserted.inserted);
          newEvents += inserted.inserted.length;
          const latest = inserted.inserted.reduce((max, event) => Math.max(max, event.ts), 0);
          status.events += inserted.inserted.length;
          status.lastEventAt = status.lastEventAt === null ? latest : Math.max(status.lastEventAt, latest);
        }
        this.store.setFileState(job.file.path, {
          offset: result.offset,
          mtimeMs: result.mtimeMs,
          size: result.size,
        });
        if (result.parserState !== undefined && result.parserState !== null) {
          this.store.setKv(parserStateKey, result.parserState);
        }
        if (result.more) filesPending += 1;
        if (result.warning) lastError = result.warning;
        filesScanned += 1;
      } catch (caught) {
        lastError = truncateError(caught);
        filesScanned += 1;
      }
    });

    status.error = lastError;
    return {
      source: spec.id,
      enabled: true,
      newEvents,
      filesScanned,
      filesPending,
      bytesRead,
      error: lastError,
      durationMs: Date.now() - startedAt,
    };
  }
}

/** Convenience: total events added by a list of scan passes. */
export function totalNewEvents(passes: readonly ScanPassResult[]): number {
  return passes.reduce((sum, pass) => sum + pass.newEvents, 0);
}

/** Convenience: flatten events' source/model counts for CLI reporting. */
export function summarizePassSources(passes: readonly ScanPassResult[]): Map<CollectorSourceId, number> {
  const counts = new Map<CollectorSourceId, number>();
  for (const pass of passes) {
    for (const source of pass.sources) {
      counts.set(source.source, (counts.get(source.source) ?? 0) + source.newEvents);
    }
  }
  return counts;
}

/** Re-exported so tests can construct events without importing core directly. */
export type { UsageEvent };
