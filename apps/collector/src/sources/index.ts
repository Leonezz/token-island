/** Registry for the five supported agent log sources. */

import path from 'node:path';
import type { CollectorPaths } from '../config.js';
import {
  discoverAntigravityFiles,
  resolveAntigravityRoots,
  scanAntigravityDbFile,
  scanAntigravityTranscriptFile,
} from './antigravity.js';
import { claudeSource } from './claude.js';
import { codexSource } from './codex.js';
import { dshSource } from './dsh.js';
import { scanOpencodeDatabase } from './opencode.js';
import type { CollectorSourceId, DatabaseParser, JsonlSourceSpec } from './types.js';

export {
  discoverAntigravityFiles,
  resolveAntigravityRoots,
  scanAntigravityDbFile,
  scanAntigravityTranscriptFile,
};

export const JSONL_SOURCES: JsonlSourceSpec[] = [claudeSource, codexSource, dshSource];

const JSONL_BY_ID = new Map<CollectorSourceId, JsonlSourceSpec>(
  JSONL_SOURCES.map((spec) => [spec.id, spec]),
);

export function jsonlSource(id: CollectorSourceId): JsonlSourceSpec | undefined {
  return JSONL_BY_ID.get(id);
}

export const opencodeDatabaseParser: DatabaseParser = scanOpencodeDatabase;

export interface SourceTarget {
  id: CollectorSourceId;
  /** Configured root, e.g. `/Users/me/.claude`. */
  root: string;
  /** Directory walked (`claude`/`codex`/`dsh`/`antigravity`) or database file (`opencode`). */
  watchPath: string;
}

export function sourceTargets(paths: CollectorPaths): SourceTarget[] {
  return [
    { id: 'claude', root: paths.claude, watchPath: path.join(paths.claude, 'projects') },
    { id: 'codex', root: paths.codex, watchPath: path.join(paths.codex, 'sessions') },
    { id: 'opencode', root: paths.opencode, watchPath: path.join(paths.opencode, 'opencode.db') },
    { id: 'dsh', root: paths.dsh, watchPath: path.join(paths.dsh, 'sessions') },
    { id: 'antigravity', root: paths.antigravity, watchPath: paths.antigravity },
  ];
}
