/**
 * SQLite persistence for the collector (Node 22 `node:sqlite`, synchronous API).
 *
 * One row per billable LLM response.  Event ids are deterministic per source, so
 * `INSERT ... ON CONFLICT(id) DO NOTHING` makes every scan idempotent.
 */

import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SourceId, UsageEvent } from '@token-island/core';

export interface StoredFileState {
  offset: number;
  mtimeMs: number;
  size: number;
}

export interface SourceEventStats {
  events: number;
  lastEventAt: number | null;
}

interface EventRow {
  id: string;
  source: SourceId;
  session_id: string;
  message_id: string;
  ts: number;
  date: string;
  hour: number;
  model: string;
  provider: string;
  agent: string;
  project: string;
  cwd: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  ingested_at: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,
  date TEXT NOT NULL,
  hour INTEGER NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  agent TEXT NOT NULL DEFAULT 'main',
  project TEXT NOT NULL DEFAULT '',
  cwd TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  ingested_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(source, session_id);
CREATE TABLE IF NOT EXISTS file_state (
  path TEXT PRIMARY KEY, offset INTEGER NOT NULL DEFAULT 0,
  mtime_ms INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const INSERT_EVENT = `
INSERT INTO events (
  id, source, session_id, message_id, ts, date, hour, model, provider, agent, project, cwd,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
  total_tokens, cost_usd, ingested_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO NOTHING
`;

function toNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rowToEvent(row: EventRow): UsageEvent {
  return {
    id: String(row.id),
    source: row.source,
    sessionId: String(row.session_id),
    messageId: String(row.message_id ?? ''),
    ts: toNumber(row.ts),
    date: String(row.date),
    hour: toNumber(row.hour),
    model: String(row.model ?? ''),
    provider: String(row.provider ?? ''),
    agent: String(row.agent ?? 'main'),
    project: String(row.project ?? ''),
    cwd: String(row.cwd ?? ''),
    inputTokens: toNumber(row.input_tokens),
    outputTokens: toNumber(row.output_tokens),
    cacheReadTokens: toNumber(row.cache_read_tokens),
    cacheWriteTokens: toNumber(row.cache_write_tokens),
    reasoningTokens: toNumber(row.reasoning_tokens),
    totalTokens: toNumber(row.total_tokens),
    costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : toNumber(row.cost_usd),
  };
}

export interface InsertResult {
  /** Events written to SQLite (duplicates skipped). */
  inserted: UsageEvent[];
  /** Number of events skipped because their id already existed. */
  duplicates: number;
}

export class Store {
  readonly path: string;
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(dbPath: string) {
    this.path = dbPath;
    if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec(SCHEMA);
  }

  /**
   * Inserts a batch of events in a single transaction.  Returns only the
   * events that were actually written so the in-memory aggregator stays exact.
   */
  insertEvents(events: readonly UsageEvent[]): InsertResult {
    if (events.length === 0) return { inserted: [], duplicates: 0 };
    const inserted: UsageEvent[] = [];
    let duplicates = 0;
    const statement = this.db.prepare(INSERT_EVENT);
    this.db.exec('BEGIN');
    try {
      const ingestedAt = Date.now();
      for (const event of events) {
        const result = statement.run(
          event.id,
          event.source,
          event.sessionId,
          event.messageId,
          event.ts,
          event.date,
          event.hour,
          event.model,
          event.provider,
          event.agent,
          event.project,
          event.cwd,
          event.inputTokens,
          event.outputTokens,
          event.cacheReadTokens,
          event.cacheWriteTokens,
          event.reasoningTokens,
          event.totalTokens,
          event.costUsd,
          ingestedAt,
        );
        if (Number(result.changes) > 0) inserted.push(event);
        else duplicates += 1;
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failures; the original error is more useful.
      }
      throw error;
    }
    return { inserted, duplicates };
  }

  getFileState(filePath: string): StoredFileState | null {
    const row = this.db
      .prepare('SELECT offset, mtime_ms, size FROM file_state WHERE path = ?')
      .get(filePath) as { offset?: unknown; mtime_ms?: unknown; size?: unknown } | undefined;
    if (!row) return null;
    return { offset: toNumber(row.offset), mtimeMs: toNumber(row.mtime_ms), size: toNumber(row.size) };
  }

  setFileState(filePath: string, state: StoredFileState): void {
    this.db
      .prepare(
        `INSERT INTO file_state (path, offset, mtime_ms, size, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           offset = excluded.offset, mtime_ms = excluded.mtime_ms,
           size = excluded.size, updated_at = excluded.updated_at`,
      )
      .run(
        filePath,
        Math.max(0, Math.floor(state.offset)),
        Math.max(0, Math.floor(state.mtimeMs)),
        Math.max(0, Math.floor(state.size)),
        Date.now(),
      );
  }

  getKv(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
      | { value?: unknown }
      | undefined;
    return row && row.value !== undefined && row.value !== null ? String(row.value) : null;
  }

  setKv(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO kv (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  deleteKv(key: string): void {
    this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
  }

  /** Streams all persisted events in time order (used to warm the aggregator on boot). */
  *iterateEvents(): Iterable<UsageEvent> {
    const statement = this.db.prepare('SELECT * FROM events ORDER BY ts');
    for (const row of statement.iterate()) {
      yield rowToEvent(row as unknown as EventRow);
    }
  }

  countEvents(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS events FROM events').get() as
      | { events?: unknown }
      | undefined;
    return toNumber(row?.events);
  }

  lastEventAt(): number | null {
    const row = this.db.prepare('SELECT MAX(ts) AS last_event_at FROM events').get() as
      | { last_event_at?: unknown }
      | undefined;
    const value = row?.last_event_at;
    return value === null || value === undefined ? null : toNumber(value);
  }

  sourceEventStats(): Map<SourceId, SourceEventStats> {
    const rows = this.db
      .prepare('SELECT source, COUNT(*) AS events, MAX(ts) AS last_event_at FROM events GROUP BY source')
      .all() as Array<{ source?: unknown; events?: unknown; last_event_at?: unknown }>;
    const stats = new Map<SourceId, SourceEventStats>();
    for (const row of rows) {
      if (typeof row.source !== 'string') continue;
      stats.set(row.source as SourceId, {
        events: toNumber(row.events),
        lastEventAt: row.last_event_at === null || row.last_event_at === undefined ? null : toNumber(row.last_event_at),
      });
    }
    return stats;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  /** Best-effort deletion of the SQLite database and its WAL side files (`--reset`). */
  static removeDatabaseFiles(dbPath: string): void {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        rmSync(`${dbPath}${suffix}`, { force: true });
      } catch {
        // Best effort only.
      }
    }
  }
}
