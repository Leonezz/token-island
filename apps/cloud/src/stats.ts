/**
 * Derives public statistics for a user from the stored daily aggregates.
 *
 * Everything here is pure: the server, the SVG renderers and the HTML pages all
 * consume the same `UserStats` snapshot so the dashboard, badges and API can
 * never disagree.  Number formatting always goes through `@token-island/core`.
 */

import {
  computeStreak,
  dateKey,
  dateRangeKeys,
  resolveTimezone,
  SOURCE_IDS,
  SOURCE_META,
} from '@token-island/core';
import type { CloudDay, SourceId, Streak, TokenCounts } from '@token-island/core';
import { modelColor } from './colors.js';
import type { StoredDay, UserRecord } from './store/types.js';

export interface Totals extends TokenCounts {
  unpricedTokens: number;
  costUsd: number;
  messages: number;
}

export interface DayTotals {
  date: string;
  totalTokens: number;
  costUsd: number;
  messages: number;
}

export interface ModelStat {
  model: string;
  totalTokens: number;
  share: number;
  color: string;
}

export interface SourceStat {
  source: SourceId;
  label: string;
  short: string;
  color: string;
  totalTokens: number;
  share: number;
}

export interface UserStats {
  username: string;
  displayName: string;
  createdAt: number;
  lastSyncAt: number | null;
  firstDate: string | null;
  lastDate: string | null;
  totalDays: number;
  activeDays: number;
  today: DayTotals;
  totals: Totals;
  streak: Streak;
  /** Ascending stored days (only active days are stored). */
  daily: CloudDay[];
  models: ModelStat[];
  sources: SourceStat[];
}

export interface ChartSeries {
  /** Zero-filled daily points, ascending, length === requested days. */
  daily: CloudDay[];
  models: ModelStat[];
  totalTokens: number;
  totalCost: number;
}

export interface StatsOptions {
  now?: number;
  timezone?: string;
}

const SOURCE_ORDER: SourceId[] = [...SOURCE_IDS];

export function emptyTotals(): Totals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    unpricedTokens: 0,
    costUsd: 0,
    messages: 0,
  };
}

export function emptyDay(date: string): CloudDay {
  return {
    date,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    unpricedTokens: 0,
    costUsd: 0,
    messages: 0,
  };
}

export function addDay(totals: Totals, day: CloudDay): Totals {
  totals.inputTokens += day.inputTokens;
  totals.outputTokens += day.outputTokens;
  totals.cacheReadTokens += day.cacheReadTokens;
  totals.cacheWriteTokens += day.cacheWriteTokens;
  totals.reasoningTokens += day.reasoningTokens;
  totals.totalTokens += day.totalTokens;
  totals.unpricedTokens += day.unpricedTokens;
  totals.costUsd += day.costUsd;
  totals.messages += day.messages;
  return totals;
}

export function sumDays(days: Iterable<CloudDay>): Totals {
  const totals = emptyTotals();
  for (const day of days) addDay(totals, day);
  return totals;
}

/**
 * Daily aggregates do not carry a per-source counter (only per-model tokens), so
 * the dashboard's "agents" panel maps well-known model families back to the
 * agent that usually produced them.  Labelled as inferred in the UI.
 */
export function inferSource(model: string): SourceId {
  const id = model.toLowerCase();
  if (
    id.includes('antigravity') ||
    /gemini-4-(?:argon|carbon|neon|hydrogen)/.test(id) ||
    /gemini-3\.[5-8]-flash-(?:high|medium|low|extra-low)/.test(id)
  ) {
    return 'antigravity';
  }
  if (id.includes('claude') || id.includes('anthropic')) return 'claude';
  if (id.includes('codex') || id.includes('gpt') || /^o[34](?:-|$)/.test(id)) return 'codex';
  if (id.includes('deepseek') || id.includes('dsh')) return 'dsh';
  if (/glm|kimi|moonshot|qwen|minimax/.test(id)) return 'opencode';
  if (id.includes('gemini') || id.includes('google')) return 'gemini';
  return 'other';
}

export function computeUserStats(user: UserRecord, days: StoredDay[], options: StatsOptions = {}): UserStats {
  const timezone = resolveTimezone(options.timezone);
  const now = options.now ?? Date.now();
  const todayKey = dateKey(now, timezone);
  const byDate = new Map<string, CloudDay>();
  for (const day of days) byDate.set(day.date, day);

  const totals = sumDays(days);
  const todayPoint = byDate.get(todayKey) ?? emptyDay(todayKey);

  const streakMap = new Map<string, { totalTokens: number }>();
  for (const day of days) streakMap.set(day.date, { totalTokens: day.totalTokens });
  const streak = computeStreak(streakMap, todayKey);

  // Models: sum the per-model token maps of every stored day.
  const modelTokens = new Map<string, number>();
  for (const day of days) {
    if (!day.models) continue;
    for (const [model, tokens] of Object.entries(day.models)) {
      modelTokens.set(model, (modelTokens.get(model) ?? 0) + tokens);
    }
  }
  const models: ModelStat[] = [...modelTokens.entries()]
    .filter(([, tokens]) => tokens > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([model, tokens], index) => ({
      model,
      totalTokens: tokens,
      share: totals.totalTokens > 0 ? tokens / totals.totalTokens : 0,
      color: modelColor(index),
    }));

  // Sources: inferred from model families.
  const sourceTokens = new Map<SourceId, number>();
  for (const model of models) {
    const source = inferSource(model.model);
    sourceTokens.set(source, (sourceTokens.get(source) ?? 0) + model.totalTokens);
  }
  const sourceTotal = [...sourceTokens.values()].reduce((sum, value) => sum + value, 0);
  const sources: SourceStat[] = [...sourceTokens.entries()]
    .filter(([, tokens]) => tokens > 0)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return SOURCE_ORDER.indexOf(a[0]) - SOURCE_ORDER.indexOf(b[0]);
    })
    .map(([source, tokens]) => {
      const meta = SOURCE_META[source];
      return {
        source,
        label: meta.label,
        short: meta.short,
        color: meta.color,
        totalTokens: tokens,
        share: sourceTotal > 0 ? tokens / sourceTotal : 0,
      };
    });

  const activeDays = days.filter((day) => day.totalTokens > 0 || day.messages > 0).length;

  return {
    username: user.username,
    displayName: user.displayName || user.username,
    createdAt: user.createdAt,
    lastSyncAt: user.lastSyncAt,
    firstDate: days[0]?.date ?? null,
    lastDate: days[days.length - 1]?.date ?? null,
    totalDays: days.length,
    activeDays,
    today: {
      date: todayKey,
      totalTokens: todayPoint.totalTokens,
      costUsd: todayPoint.costUsd,
      messages: todayPoint.messages,
    },
    totals,
    streak,
    daily: days.map((day) => {
      const plain: CloudDay = { ...day };
      delete (plain as Partial<StoredDay>).updatedAt;
      return plain;
    }),
    models,
    sources,
  };
}

/** Zero-filled rolling window ending today (inclusive). */
export function dailyWindow(stats: UserStats, days: number, options: StatsOptions = {}): CloudDay[] {
  const timezone = resolveTimezone(options.timezone);
  const now = options.now ?? Date.now();
  const count = Math.max(1, Math.min(400, Math.trunc(days)));
  const today = dateKey(now, timezone);
  const byDate = new Map<string, CloudDay>();
  for (const day of stats.daily) byDate.set(day.date, day);
  return dateRangeKeys(today, count).map((date) => byDate.get(date) ?? emptyDay(date));
}

export function windowTotals(stats: UserStats, days: number, options: StatsOptions = {}): Totals {
  return sumDays(dailyWindow(stats, days, options));
}

/** Per-model tokens inside a rolling window, sorted descending. */
export function windowModels(stats: UserStats, days: number, options: StatsOptions = {}): ModelStat[] {
  const window = dailyWindow(stats, days, options);
  const total = window.reduce((sum, day) => sum + day.totalTokens, 0);
  const map = new Map<string, number>();
  for (const day of window) {
    if (!day.models) continue;
    for (const [model, tokens] of Object.entries(day.models)) {
      map.set(model, (map.get(model) ?? 0) + tokens);
    }
  }
  return [...map.entries()]
    .filter(([, tokens]) => tokens > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([model, tokens], index) => ({
      model,
      totalTokens: tokens,
      share: total > 0 ? tokens / total : 0,
      color: modelColor(index),
    }));
}

/** Everything a chart needs, computed once per request. */
export function chartSeries(stats: UserStats, days: number, options: StatsOptions = {}): ChartSeries {
  const daily = dailyWindow(stats, days, options);
  const models = windowModels(stats, days, options);
  let totalTokens = 0;
  let totalCost = 0;
  for (const day of daily) {
    totalTokens += day.totalTokens;
    totalCost += day.costUsd;
  }
  return { daily, models, totalTokens, totalCost };
}

/** Public JSON shape served by `GET /api/v1/u/:user`. */
export function publicStatsJson(stats: UserStats, options: StatsOptions = {}): Record<string, unknown> {
  const windows: Record<string, Totals> = {
    '7d': windowTotals(stats, 7, options),
    '30d': windowTotals(stats, 30, options),
    '90d': windowTotals(stats, 90, options),
  };
  return {
    username: stats.username,
    displayName: stats.displayName,
    createdAt: stats.createdAt,
    lastSyncAt: stats.lastSyncAt,
    firstDate: stats.firstDate,
    lastDate: stats.lastDate,
    totalDays: stats.totalDays,
    activeDays: stats.activeDays,
    today: stats.today,
    totals: stats.totals,
    streak: stats.streak,
    windows,
    daily: stats.daily,
    models: stats.models.map((row) => ({
      model: row.model,
      totalTokens: row.totalTokens,
      share: row.share,
      color: row.color,
    })),
    sources: stats.sources,
  };
}

/** Average tokens per active day (whole history), safe for empty users. */
export function averagePerActiveDay(stats: UserStats): number {
  if (stats.activeDays <= 0) return 0;
  return stats.totals.totalTokens / stats.activeDays;
}
