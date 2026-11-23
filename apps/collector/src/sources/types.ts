/** Shared contracts for the incremental source parsers. */

import type { PriceOverride, SourceId, UsageEvent } from '@token-island/core';

export type CollectorSourceId = 'claude' | 'codex' | 'opencode' | 'dsh';

/** Immutable per-scan context (timezone + pricing overrides). */
export interface SourceContext {
  timezone: string;
  prices: PriceOverride[];
  /** Scan start timestamp (epoch ms). */
  now: number;
}

export interface StoredFileState {
  offset: number;
  mtimeMs: number;
  size: number;
}

export interface DiscoveredFile {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface FileScanInput {
  file: DiscoveredFile;
  /** Persisted file state (null on first sight), already adjusted for truncation. */
  prior: StoredFileState | null;
  /** Persisted parser-specific state for this file (JSON string), if any. */
  priorParserState: string | null;
  ctx: SourceContext;
  /** Byte budget for this pass; parsers may read less and report `more`. */
  maxBytes: number;
}

export interface FileScanResult {
  events: UsageEvent[];
  /** Next persisted offset. For `whole` sources this is the consumed file size. */
  offset: number;
  size: number;
  mtimeMs: number;
  /** True when unread bytes remain after this pass. */
  more: boolean;
  /** Non-fatal parser warning surfaced through `SourceStatus.error` (e.g. zstd fallback). */
  warning?: string | null;
  /** Parser state to persist in the `kv` table (JSON string), if the source needs it. */
  parserState?: string | null;
}

export type FileParser = (input: FileScanInput) => Promise<FileScanResult>;

export interface JsonlSourceSpec {
  id: CollectorSourceId;
  /**
   * `append`: incremental byte offsets into a growing JSONL file.
   * `whole`: file is re-parsed as a whole when (size, mtime) changes (compressed logs).
   */
  mode: 'append' | 'whole';
  /** Directory that is walked recursively for candidate files. */
  watchDir: (root: string) => string;
  /** File-name filter applied by the recursive walk. */
  match: (fileName: string) => boolean;
  parseFile: FileParser;
}

export interface DatabaseScanContext extends SourceContext {
  dbPath: string;
}

export interface DatabaseScanResult {
  events: UsageEvent[];
  /** New watermark (provider-side `time_updated`, epoch ms). */
  watermark: number;
}

export type DatabaseParser = (
  ctx: DatabaseScanContext,
  watermark: number,
) => Promise<DatabaseScanResult>;
