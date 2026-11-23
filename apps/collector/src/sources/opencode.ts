/**
 * OpenCode parser — `~/.local/share/opencode/opencode.db` (SQLite, read-only).
 *
 * Messages are rows in the `message` table with a JSON `data` column.  The
 * collector keeps a watermark on `time_updated` with a 10 minute overlap so
 * late edits are re-read; dedupe by message id makes that overlap free.
 */

import { DatabaseSync } from 'node:sqlite';
import type { UsageEvent } from '@token-island/core';
import type { DatabaseScanContext, DatabaseScanResult, DatabaseParser } from './types.js';
import {
  buildUsageEvent,
  isRecord,
  nonNegativeInt,
  parseTimestamp,
  stringValue,
  sumTokens,
} from './util.js';

/** Re-read messages updated in this window before the watermark. */
export const OPENCODE_OVERLAP_MS = 10 * 60 * 1000;

interface MessageRow {
  id?: unknown;
  session_id?: unknown;
  time_created?: unknown;
  time_updated?: unknown;
  data?: unknown;
}

interface OpencodeMessageData {
  role?: unknown;
  time?: unknown;
  modelID?: unknown;
  providerID?: unknown;
  mode?: unknown;
  agent?: unknown;
  cost?: unknown;
  tokens?: unknown;
  path?: unknown;
}

const MESSAGE_SELECT = 'SELECT id, session_id, time_created, time_updated, data FROM message';

function queryMessages(db: DatabaseSync, since: number): MessageRow[] {
  try {
    return db
      .prepare(
        `${MESSAGE_SELECT}
         WHERE time_updated >= ?
           AND json_extract(data, '$.role') = 'assistant'
           AND json_extract(data, '$.tokens') IS NOT NULL
         ORDER BY time_updated ASC`,
      )
      .all(since) as MessageRow[];
  } catch {
    // Very old SQLite builds may lack JSON1; filter in JS instead.
    const rows = db
      .prepare(`${MESSAGE_SELECT} WHERE time_updated >= ? ORDER BY time_updated ASC`)
      .all(since) as MessageRow[];
    return rows.filter((row) => {
      const data = parseData(row.data);
      return data.role === 'assistant' && isRecord(data.tokens);
    });
  }
}

function parseData(value: unknown): OpencodeMessageData {
  if (typeof value !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? (parsed as OpencodeMessageData) : {};
  } catch {
    return {};
  }
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function parseMessageRow(
  row: MessageRow,
  ctx: DatabaseScanContext,
): { event: UsageEvent | null; timeUpdated: number } {
  const id = stringValue(row.id);
  const sessionId = stringValue(row.session_id);
  const timeUpdated = nonNegativeInt(row.time_updated);
  const data = parseData(row.data);
  const tokens = nestedRecord(data.tokens);
  if (id.length === 0 || !tokens) return { event: null, timeUpdated };

  const cache = nestedRecord(tokens.cache) ?? {};
  const reasoning = nonNegativeInt(tokens.reasoning);
  const counts = {
    inputTokens: nonNegativeInt(tokens.input),
    outputTokens: nonNegativeInt(tokens.output) + reasoning,
    cacheReadTokens: nonNegativeInt(cache.read),
    cacheWriteTokens: nonNegativeInt(cache.write),
    reasoningTokens: reasoning,
  };
  if (sumTokens(counts) <= 0) return { event: null, timeUpdated };

  const time = nestedRecord(data.time);
  const ts =
    parseTimestamp(time?.created) ?? parseTimestamp(row.time_created) ?? (timeUpdated > 0 ? timeUpdated : null);
  if (ts === null) return { event: null, timeUpdated };

  const pathInfo = nestedRecord(data.path);
  const model = stringValue(data.modelID).trim() || 'unknown';
  const event = buildUsageEvent(
    {
      id: `opencode:${id}`,
      source: 'opencode',
      sessionId,
      messageId: id,
      ts,
      model,
      provider: stringValue(data.providerID),
      agent: stringValue(data.agent) || stringValue(data.mode) || 'main',
      cwd: stringValue(pathInfo?.cwd),
      counts,
    },
    ctx,
  );
  // OpenCode already computed the real cost; honour it when non-zero.
  const reportedCost = Number(data.cost);
  if (Number.isFinite(reportedCost) && reportedCost > 0) {
    event.costUsd = reportedCost;
  }
  return { event, timeUpdated };
}

export const scanOpencodeDatabase: DatabaseParser = async (
  ctx: DatabaseScanContext,
  watermark: number,
): Promise<DatabaseScanResult> => {
  const since = Math.max(0, Math.floor(watermark) - OPENCODE_OVERLAP_MS);
  const db = new DatabaseSync(ctx.dbPath, { readOnly: true });
  try {
    const rows = queryMessages(db, since);
    const events: UsageEvent[] = [];
    const seen = new Set<string>();
    let nextWatermark = Math.max(0, Math.floor(watermark));
    for (const row of rows) {
      const { event, timeUpdated } = parseMessageRow(row, ctx);
      if (timeUpdated > nextWatermark) nextWatermark = timeUpdated;
      if (!event || seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
    }
    return { events, watermark: nextWatermark };
  } finally {
    db.close();
  }
};
