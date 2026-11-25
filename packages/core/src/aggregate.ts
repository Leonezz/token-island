/**
 * Pure aggregation: turn `UsageEvent`s into the `Summary` document and cloud
 * `CloudDay` rollups.  Timezone-aware date bucketing is centralised here so the
 * collector, the demo data generator and the tests all agree.
 */

import { SOURCE_IDS, SOURCE_META } from './types.js';
import type {
  Breakdown,
  BreakdownAgg,
  BreakdownDetail,
  CloudDay,
  CollectorMeta,
  DailyPoint,
  HourPoint,
  LiveSession,
  Range,
  RawAggregates,
  SourceStatus,
  Streak,
  Summary,
  TokenCounts,
  TokenTotals,
  UsageEvent,
} from './types.js';

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function resolveTimezone(timeZone?: string | null): string {
  const candidate = timeZone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: candidate });
    return candidate;
  } catch {
    return 'UTC';
  }
}

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function localParts(ts: number, timeZone: string): LocalParts {
  const parts = partsFormatter(resolveTimezone(timeZone)).formatToParts(new Date(ts));
  const out: LocalParts = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  for (const part of parts) {
    const value = Number(part.value);
    switch (part.type) {
      case 'year':
        out.year = value;
        break;
      case 'month':
        out.month = value;
        break;
      case 'day':
        out.day = value;
        break;
      case 'hour':
        // Some engines render midnight as "24" despite hourCycle.
        out.hour = value === 24 ? 0 : value;
        break;
      case 'minute':
        out.minute = value;
        break;
      case 'second':
        out.second = value;
        break;
      default:
        break;
    }
  }
  return out;
}

/** `YYYY-MM-DD` in the given timezone. */
export function dateKey(ts: number, timeZone: string): string {
  const p = localParts(ts, timeZone);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function localHour(ts: number, timeZone: string): number {
  return localParts(ts, timeZone).hour;
}

/** Offset of the timezone at `ts`, in ms (local = utc + offset). */
export function tzOffsetMs(ts: number, timeZone: string): number {
  const p = localParts(ts, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Epoch ms of local midnight for the day containing `ts`. */
export function startOfLocalDay(ts: number, timeZone: string): number {
  const p = localParts(ts, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day) - tzOffsetMs(ts, timeZone);
}

/** Pure calendar arithmetic on `YYYY-MM-DD` keys (DST-safe, no timezone maths). */
export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const next = new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000);
  return next.toISOString().slice(0, 10);
}

/** Ascending list of `days` date keys ending at `end` (inclusive). */
export function dateRangeKeys(end: string, days: number): string[] {
  const count = Math.max(1, Math.min(4000, Math.floor(days)));
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) keys.push(addDays(end, -i));
  return keys;
}

export function rangeStartKey(range: Range, today: string): string {
  switch (range) {
    case 'today':
      return today;
    case '7d':
      return addDays(today, -6);
    case '30d':
      return addDays(today, -29);
    case '90d':
      return addDays(today, -89);
    case 'all':
    default:
      return '0000-01-01';
  }
}

// ---------------------------------------------------------------------------
// Zero values
// ---------------------------------------------------------------------------

export function zeroTokenCounts(): TokenCounts {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

export function zeroTotals(): TokenTotals {
  return { ...zeroTokenCounts(), unpricedTokens: 0, costUsd: 0, messages: 0, sessions: 0 };
}

export function zeroDailyPoint(date: string): DailyPoint {
  return { date, ...zeroTokenCounts(), unpricedTokens: 0, costUsd: 0, messages: 0 };
}

export function zeroHourPoint(hour: number): HourPoint {
  return { hour, totalTokens: 0, costUsd: 0, messages: 0 };
}

function emptyCollectorMeta(): CollectorMeta {
  return {
    version: 'dev',
    uptimeSec: 0,
    dbPath: '',
    watchRoots: [],
    sources: SOURCE_IDS.map<SourceStatus>((source) => ({
      source,
      enabled: true,
      lastEventAt: null,
      events: 0,
      error: null,
    })),
    cloud: {
      enabled: false,
      lastSyncAt: null,
      lastError: null,
      username: null,
      endpoint: null,
    },
  };
}

function emptySessionStreak(): Streak {
  return { current: 0, longest: 0, todayActive: false, lastActiveDate: null };
}

// ---------------------------------------------------------------------------
// Accumulation helpers
// ---------------------------------------------------------------------------

interface MutableTotals extends TokenTotals {}

function applyToTotals(totals: MutableTotals, event: UsageEvent): void {
  totals.inputTokens += event.inputTokens;
  totals.outputTokens += event.outputTokens;
  totals.cacheReadTokens += event.cacheReadTokens;
  totals.cacheWriteTokens += event.cacheWriteTokens;
  totals.reasoningTokens += event.reasoningTokens;
  totals.totalTokens += event.totalTokens;
  totals.messages += 1;
  if (event.costUsd === null) totals.unpricedTokens += event.totalTokens;
  else totals.costUsd += event.costUsd;
}

function applyToDaily(point: DailyPoint, event: UsageEvent): void {
  point.inputTokens += event.inputTokens;
  point.outputTokens += event.outputTokens;
  point.cacheReadTokens += event.cacheReadTokens;
  point.cacheWriteTokens += event.cacheWriteTokens;
  point.reasoningTokens += event.reasoningTokens;
  point.totalTokens += event.totalTokens;
  point.messages += 1;
  if (event.costUsd === null) point.unpricedTokens += event.totalTokens;
  else point.costUsd += event.costUsd;
}

interface SessionAcc {
  source: UsageEvent['source'];
  sessionId: string;
  project: string;
  model: string;
  updatedAt: number;
  totalTokens: number;
  messages: number;
}

function breakdownMap(): Map<string, BreakdownAgg> {
  return new Map<string, BreakdownAgg>();
}

function bumpBreakdown(
  map: Map<string, BreakdownAgg>,
  key: string,
  label: string,
  color: string | undefined,
  event: UsageEvent,
): void {
  let row = map.get(key);
  if (!row) {
    row = { key, label, totalTokens: 0, costUsd: 0, messages: 0 };
    if (color) row.color = color;
    map.set(key, row);
  }
  row.totalTokens += event.totalTokens;
  row.messages += 1;
  if (event.costUsd !== null) row.costUsd += event.costUsd;
}

function modelColor(model: string): string | undefined {
  const normalized = model.toLowerCase();
  if (normalized.includes('claude')) return '#D97757';
  if (normalized.includes('gpt') || normalized.includes('o3') || normalized.includes('codex')) return '#10A37F';
  if (normalized.includes('deepseek')) return '#4D6BFE';
  if (normalized.includes('glm') || normalized.includes('kimi') || normalized.includes('qwen')) return '#8B5CF6';
  if (normalized.includes('gemini')) return '#4285F4';
  return undefined;
}

function sourceColor(source: string): string | undefined {
  return (SOURCE_META as Record<string, { color: string }>)[source]?.color;
}

function sourceLabel(source: string): string {
  return (SOURCE_META as Record<string, { label: string }>)[source]?.label ?? source;
}

// ---------------------------------------------------------------------------
// EventAggregator
// ---------------------------------------------------------------------------

export interface AggregatorOptions {
  timezone?: string;
  /** Sessions touched within this window are considered "active". */
  liveWindowMs?: number;
}

export interface FinalizeOptions {
  range: Range;
  now?: number;
  /** Number of daily points to include (default 14). */
  dailyDays?: number;
  liveWindowMs?: number;
  liveLimit?: number;
  collector?: Partial<CollectorMeta>;
}

export interface AssembleOptions {
  range: Range;
  now?: number;
  timezone?: string;
  dailyDays?: number;
  liveWindowMs?: number;
  liveLimit?: number;
}

const DEFAULT_LIVE_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_DAILY_DAYS = 14;

interface CubeCell {
  model: string;
  source: UsageEvent['source'];
  project: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  messages: number;
}

interface ChildAcc {
  key: string;
  label: string;
  color?: string;
  totalTokens: number;
  costUsd: number;
  messages: number;
}

interface ParentAcc {
  key: string;
  label: string;
  color?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  messages: number;
  models: Map<string, ChildAcc>;
  sources: Map<string, ChildAcc>;
  projects: Map<string, ChildAcc>;
}

function bumpChild(
  map: Map<string, ChildAcc>,
  key: string,
  label: string,
  color: string | undefined,
  cell: CubeCell,
): void {
  let child = map.get(key);
  if (!child) {
    child = { key, label, totalTokens: 0, costUsd: 0, messages: 0 };
    if (color) child.color = color;
    map.set(key, child);
  }
  child.totalTokens += cell.totalTokens;
  child.costUsd += cell.costUsd;
  child.messages += cell.messages;
}

function finalizeChildren(map: Map<string, ChildAcc>, parentTokens: number, limit = 6): BreakdownDetail[] {
  return [...map.values()]
    .filter((row) => row.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, limit)
    .map<BreakdownDetail>((row) => ({
      key: row.key,
      label: row.label,
      ...(row.color ? { color: row.color } : {}),
      totalTokens: row.totalTokens,
      costUsd: row.costUsd,
      messages: row.messages,
      share: parentTokens > 0 ? row.totalTokens / parentTokens : 0,
    }));
}

function getOrCreateParent(
  map: Map<string, ParentAcc>,
  key: string,
  label: string,
  color: string | undefined,
): ParentAcc {
  let acc = map.get(key);
  if (!acc) {
    acc = {
      key,
      label,
      ...(color ? { color } : {}),
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      messages: 0,
      models: new Map(),
      sources: new Map(),
      projects: new Map(),
    };
    map.set(key, acc);
  }
  return acc;
}

function addCellToParent(parent: ParentAcc, cell: CubeCell): void {
  parent.inputTokens += cell.inputTokens;
  parent.outputTokens += cell.outputTokens;
  parent.cacheReadTokens += cell.cacheReadTokens;
  parent.cacheWriteTokens += cell.cacheWriteTokens;
  parent.reasoningTokens += cell.reasoningTokens;
  parent.totalTokens += cell.totalTokens;
  parent.costUsd += cell.costUsd;
  parent.messages += cell.messages;
}

function parentToAgg(
  parent: ParentAcc,
  include: { models?: boolean; sources?: boolean; projects?: boolean },
): BreakdownAgg {
  return {
    key: parent.key,
    label: parent.label,
    ...(parent.color ? { color: parent.color } : {}),
    inputTokens: parent.inputTokens,
    outputTokens: parent.outputTokens,
    cacheReadTokens: parent.cacheReadTokens,
    cacheWriteTokens: parent.cacheWriteTokens,
    reasoningTokens: parent.reasoningTokens,
    totalTokens: parent.totalTokens,
    costUsd: parent.costUsd,
    messages: parent.messages,
    ...(include.models ? { models: finalizeChildren(parent.models, parent.totalTokens) } : {}),
    ...(include.sources ? { sources: finalizeChildren(parent.sources, parent.totalTokens) } : {}),
    ...(include.projects ? { projects: finalizeChildren(parent.projects, parent.totalTokens) } : {}),
  };
}

/**
 * Incremental, memory-light aggregator.  Keeps per-day token counters (plus
 * per-day model/source/project breakdowns), never the raw events themselves, so
 * a daemon can load months of history once and then answer polls in microseconds.
 */
export class EventAggregator {
  readonly timezone: string;

  private readonly daily = new Map<string, DailyPoint>();
  private readonly hourlyByDate = new Map<string, HourPoint[]>();
  private readonly modelsByDate = new Map<string, Map<string, BreakdownAgg>>();
  private readonly sourcesByDate = new Map<string, Map<string, BreakdownAgg>>();
  private readonly projectsByDate = new Map<string, Map<string, BreakdownAgg>>();
  private readonly cubesByDate = new Map<string, Map<string, CubeCell>>();
  private readonly sessionsByDate = new Map<string, Set<string>>();
  private readonly sessions = new Map<string, SessionAcc>();
  private readonly unpricedModels = new Map<string, number>();
  private lastEventAt: number | null = null;
  private eventCount = 0;

  constructor(options: AggregatorOptions = {}) {
    this.timezone = resolveTimezone(options.timezone);
  }

  get size(): number {
    return this.eventCount;
  }

  reset(): void {
    this.daily.clear();
    this.hourlyByDate.clear();
    this.modelsByDate.clear();
    this.sourcesByDate.clear();
    this.projectsByDate.clear();
    this.cubesByDate.clear();
    this.sessionsByDate.clear();
    this.sessions.clear();
    this.unpricedModels.clear();
    this.lastEventAt = null;
    this.eventCount = 0;
  }

  add(event: UsageEvent): void {
    const date = event.date || dateKey(event.ts, this.timezone);
    const hour = Number.isFinite(event.hour) ? Math.min(23, Math.max(0, Math.floor(event.hour))) : localHour(event.ts, this.timezone);

    let point = this.daily.get(date);
    if (!point) {
      point = zeroDailyPoint(date);
      this.daily.set(date, point);
    }
    applyToDaily(point, event);

    let hours = this.hourlyByDate.get(date);
    if (!hours) {
      hours = Array.from({ length: 24 }, (_, h) => zeroHourPoint(h));
      this.hourlyByDate.set(date, hours);
    }
    const bucket = hours[hour];
    if (bucket) {
      bucket.totalTokens += event.totalTokens;
      bucket.messages += 1;
      if (event.costUsd !== null) bucket.costUsd += event.costUsd;
    }

    const modelKey = event.model || 'unknown';
    const projectKey = event.project || 'unknown';
    this.bump(this.modelsByDate, date, modelKey, modelKey, modelColor(modelKey), event);
    this.bump(
      this.sourcesByDate,
      date,
      event.source,
      sourceLabel(event.source),
      sourceColor(event.source),
      event,
    );
    this.bump(this.projectsByDate, date, projectKey, projectKey, undefined, event);
    this.bumpCube(date, modelKey, event.source, projectKey, event);

    let sessionSet = this.sessionsByDate.get(date);
    if (!sessionSet) {
      sessionSet = new Set<string>();
      this.sessionsByDate.set(date, sessionSet);
    }
    const sessionKey = `${event.source}:${event.sessionId}`;
    sessionSet.add(sessionKey);

    const existing = this.sessions.get(sessionKey);
    if (existing) {
      const previousUpdatedAt = existing.updatedAt;
      existing.updatedAt = Math.max(previousUpdatedAt, event.ts);
      existing.totalTokens += event.totalTokens;
      existing.messages += 1;
      if (event.ts >= previousUpdatedAt) existing.model = event.model || existing.model;
      if (event.project) existing.project = event.project;
    } else {
      this.sessions.set(sessionKey, {
        source: event.source,
        sessionId: event.sessionId,
        project: event.project || 'unknown',
        model: event.model || 'unknown',
        updatedAt: event.ts,
        totalTokens: event.totalTokens,
        messages: 1,
      });
    }

    if (event.costUsd === null) {
      this.unpricedModels.set(modelKey, (this.unpricedModels.get(modelKey) ?? 0) + event.totalTokens);
    }

    this.lastEventAt = this.lastEventAt === null ? event.ts : Math.max(this.lastEventAt, event.ts);
    this.eventCount += 1;
  }

  addMany(events: Iterable<UsageEvent>): void {
    for (const event of events) this.add(event);
  }

  private bump(
    store: Map<string, Map<string, BreakdownAgg>>,
    date: string,
    key: string,
    label: string,
    color: string | undefined,
    event: UsageEvent,
  ): void {
    let map = store.get(date);
    if (!map) {
      map = breakdownMap();
      store.set(date, map);
    }
    bumpBreakdown(map, key, label, color, event);
  }

  private bumpCube(
    date: string,
    model: string,
    source: UsageEvent['source'],
    project: string,
    event: UsageEvent,
  ): void {
    let dayCube = this.cubesByDate.get(date);
    if (!dayCube) {
      dayCube = new Map<string, CubeCell>();
      this.cubesByDate.set(date, dayCube);
    }
    const cellKey = `${model}\u0000${source}\u0000${project}`;
    let cell = dayCube.get(cellKey);
    if (!cell) {
      cell = {
        model,
        source,
        project,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        messages: 0,
      };
      dayCube.set(cellKey, cell);
    }
    cell.inputTokens += event.inputTokens;
    cell.outputTokens += event.outputTokens;
    cell.cacheReadTokens += event.cacheReadTokens;
    cell.cacheWriteTokens += event.cacheWriteTokens;
    cell.reasoningTokens += event.reasoningTokens;
    cell.totalTokens += event.totalTokens;
    cell.messages += 1;
    if (event.costUsd !== null) cell.costUsd += event.costUsd;
  }

  private buildFacetBreakdowns(dates: Iterable<string>): {
    models: BreakdownAgg[];
    sources: BreakdownAgg[];
    projects: BreakdownAgg[];
  } {
    const modelMap = new Map<string, ParentAcc>();
    const sourceMap = new Map<string, ParentAcc>();
    const projectMap = new Map<string, ParentAcc>();

    for (const date of dates) {
      const dayCube = this.cubesByDate.get(date);
      if (!dayCube) continue;
      for (const cell of dayCube.values()) {
        const mColor = modelColor(cell.model);
        const sLabel = sourceLabel(cell.source);
        const sColor = sourceColor(cell.source);

        const modelParent = getOrCreateParent(modelMap, cell.model, cell.model, mColor);
        addCellToParent(modelParent, cell);
        bumpChild(modelParent.sources, cell.source, sLabel, sColor, cell);
        bumpChild(modelParent.projects, cell.project, cell.project, undefined, cell);

        const sourceParent = getOrCreateParent(sourceMap, cell.source, sLabel, sColor);
        addCellToParent(sourceParent, cell);
        bumpChild(sourceParent.models, cell.model, cell.model, mColor, cell);
        bumpChild(sourceParent.projects, cell.project, cell.project, undefined, cell);

        const projectParent = getOrCreateParent(projectMap, cell.project, cell.project, undefined);
        addCellToParent(projectParent, cell);
        bumpChild(projectParent.models, cell.model, cell.model, mColor, cell);
        bumpChild(projectParent.sources, cell.source, sLabel, sColor, cell);
      }
    }

    return {
      models: [...modelMap.values()].map((p) => parentToAgg(p, { sources: true, projects: true })),
      sources: [...sourceMap.values()].map((p) => parentToAgg(p, { models: true, projects: true })),
      projects: [...projectMap.values()].map((p) => parentToAgg(p, { models: true, sources: true })),
    };
  }

  /** Dates with activity, ascending. */
  activeDates(): string[] {
    return [...this.daily.keys()].sort();
  }

  dailyPoints(): DailyPoint[] {
    return this.activeDates().map((date) => this.daily.get(date) as DailyPoint);
  }

  finalize(options: FinalizeOptions): Summary {
    const now = options.now ?? Date.now();
    const today = dateKey(now, this.timezone);
    const start = rangeStartKey(options.range, today);
    const inRange = this.activeDates().filter((d) => d >= start);
    const rangeSet = new Set(inRange);
    const dailyDays = Math.max(1, Math.min(366, Math.floor(options.dailyDays ?? DEFAULT_DAILY_DAYS)));
    const windowDateSet = new Set(dateRangeKeys(today, dailyDays));

    const sessionUnion = new Set<string>();
    for (const date of inRange) {
      const set = this.sessionsByDate.get(date);
      if (set) for (const key of set) sessionUnion.add(key);
    }

    const { models, sources, projects } = this.buildFacetBreakdowns(rangeSet);

    const enrichedDaily = this.dailyPoints().map<DailyPoint>((point) => {
      if (!windowDateSet.has(point.date)) return point;
      const dayFacets = this.buildFacetBreakdowns([point.date]);
      return {
        ...point,
        models: toBreakdowns(dayFacets.models, point.totalTokens, 8),
        sources: toBreakdowns(dayFacets.sources, point.totalTokens, SOURCE_IDS.length),
        projects: toBreakdowns(dayFacets.projects, point.totalTokens, 8),
      };
    });

    const liveWindow = options.liveWindowMs ?? DEFAULT_LIVE_WINDOW_MS;
    const live = [...this.sessions.values()]
      .filter((session) => now - session.updatedAt <= Math.max(liveWindow, 6 * 60 * 60 * 1000))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, options.liveLimit ?? 6)
      .map<LiveSession>((session) => ({
        source: session.source,
        sessionId: session.sessionId,
        project: session.project,
        model: session.model,
        updatedAt: session.updatedAt,
        totalTokens: session.totalTokens,
        messages: session.messages,
        active: now - session.updatedAt <= liveWindow,
      }));

    const unpricedModels = [...this.unpricedModels.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([model]) => model);

    const raw: RawAggregates = {
      daily: enrichedDaily,
      models,
      sources,
      projects,
      hourly: this.hourlyByDate.get(today) ?? [],
      live,
      sessions: sessionUnion.size,
      lastEventAt: this.lastEventAt,
      unpricedModels,
      collector: options.collector,
    };

    return assembleSummary(raw, {
      range: options.range,
      now,
      timezone: this.timezone,
      dailyDays,
    });
  }

  /** Daily rollups for the cloud sync, ascending by date. */
  cloudDays(options: { maxDays?: number; includeModels?: boolean } = {}): CloudDay[] {
    const includeModels = options.includeModels ?? true;
    const dates = this.activeDates();
    const selected = options.maxDays ? dates.slice(-Math.max(1, options.maxDays)) : dates;
    return selected.map<CloudDay>((date) => {
      const point = this.daily.get(date) as DailyPoint;
      const models = this.modelsByDate.get(date);
      const day: CloudDay = {
        date,
        inputTokens: point.inputTokens,
        outputTokens: point.outputTokens,
        cacheReadTokens: point.cacheReadTokens,
        cacheWriteTokens: point.cacheWriteTokens,
        reasoningTokens: point.reasoningTokens,
        totalTokens: point.totalTokens,
        unpricedTokens: point.unpricedTokens,
        costUsd: point.costUsd,
        messages: point.messages,
      };
      if (includeModels && models && models.size > 0) {
        const modelMap: Record<string, number> = {};
        for (const [key, row] of models) modelMap[key] = row.totalTokens;
        day.models = modelMap;
      }
      return day;
    });
  }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function mergeCollectorMeta(partial?: Partial<CollectorMeta>): CollectorMeta {
  const base = emptyCollectorMeta();
  if (!partial) return base;
  return {
    ...base,
    ...partial,
    sources: partial.sources ?? base.sources,
    cloud: { ...base.cloud, ...(partial.cloud ?? {}) },
    watchRoots: partial.watchRoots ?? base.watchRoots,
  };
}

function totalsFromDaily(points: DailyPoint[], sessions: number): TokenTotals {
  const totals = zeroTotals();
  for (const point of points) {
    totals.inputTokens += point.inputTokens;
    totals.outputTokens += point.outputTokens;
    totals.cacheReadTokens += point.cacheReadTokens;
    totals.cacheWriteTokens += point.cacheWriteTokens;
    totals.reasoningTokens += point.reasoningTokens;
    totals.totalTokens += point.totalTokens;
    totals.unpricedTokens += point.unpricedTokens;
    totals.costUsd += point.costUsd;
    totals.messages += point.messages;
  }
  totals.sessions = sessions;
  return totals;
}

export function computeStreak(
  daily: ReadonlyMap<string, { totalTokens: number }>,
  today: string,
): Streak {
  const isActive = (date: string): boolean => (daily.get(date)?.totalTokens ?? 0) > 0;

  const todayActive = isActive(today);
  const yesterday = addDays(today, -1);
  const anchor = todayActive ? today : isActive(yesterday) ? yesterday : null;

  let current = 0;
  if (anchor) {
    let cursor = anchor;
    while (isActive(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
    }
  }

  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of [...daily.keys()].sort()) {
    if (!isActive(date)) continue;
    run = previous && addDays(previous, 1) === date ? run + 1 : 1;
    previous = date;
    if (run > longest) longest = run;
  }
  longest = Math.max(longest, current);

  let lastActiveDate: string | null = null;
  for (const date of [...daily.keys()].sort()) if (isActive(date)) lastActiveDate = date;

  return { current, longest, todayActive, lastActiveDate };
}

function toBreakdowns(
  rows: BreakdownAgg[],
  totalTokens: number,
  limit: number,
): Breakdown[] {
  return rows
    .slice()
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, Math.max(1, limit))
    .map<Breakdown>((row) => ({
      key: row.key,
      label: row.label,
      ...(row.color ? { color: row.color } : {}),
      ...(row.inputTokens !== undefined ? { inputTokens: row.inputTokens } : {}),
      ...(row.outputTokens !== undefined ? { outputTokens: row.outputTokens } : {}),
      ...(row.cacheReadTokens !== undefined ? { cacheReadTokens: row.cacheReadTokens } : {}),
      ...(row.cacheWriteTokens !== undefined ? { cacheWriteTokens: row.cacheWriteTokens } : {}),
      ...(row.reasoningTokens !== undefined ? { reasoningTokens: row.reasoningTokens } : {}),
      totalTokens: row.totalTokens,
      costUsd: row.costUsd,
      messages: row.messages,
      share: totalTokens > 0 ? row.totalTokens / totalTokens : 0,
      ...(row.models ? { models: row.models } : {}),
      ...(row.sources ? { sources: row.sources } : {}),
      ...(row.projects ? { projects: row.projects } : {}),
    }));
}

/** Turn storage-agnostic aggregates into the widget-ready `Summary`. */
export function assembleSummary(raw: RawAggregates, options: AssembleOptions): Summary {
  const timezone = resolveTimezone(options.timezone);
  const now = options.now ?? Date.now();
  const today = dateKey(now, timezone);
  const start = rangeStartKey(options.range, today);
  const dailyDays = Math.max(1, Math.min(366, Math.floor(options.dailyDays ?? DEFAULT_DAILY_DAYS)));

  const dailyMap = new Map<string, DailyPoint>();
  for (const point of raw.daily) dailyMap.set(point.date, point);

  const rangeDays = [...dailyMap.values()].filter((d) => d.date >= start);
  const totals = totalsFromDaily(rangeDays, raw.sessions);
  const todayPoint = dailyMap.get(today) ?? zeroDailyPoint(today);
  const todayTotals: TokenTotals = {
    inputTokens: todayPoint.inputTokens,
    outputTokens: todayPoint.outputTokens,
    cacheReadTokens: todayPoint.cacheReadTokens,
    cacheWriteTokens: todayPoint.cacheWriteTokens,
    reasoningTokens: todayPoint.reasoningTokens,
    totalTokens: todayPoint.totalTokens,
    unpricedTokens: todayPoint.unpricedTokens,
    costUsd: todayPoint.costUsd,
    messages: todayPoint.messages,
    sessions: 0,
  };

  const daily = dateRangeKeys(today, dailyDays).map(
    (date) => dailyMap.get(date) ?? zeroDailyPoint(date),
  );

  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const found = raw.hourly.find((h) => h.hour === hour);
    return found ?? zeroHourPoint(hour);
  });

  return {
    version: 1,
    generatedAt: now,
    range: options.range,
    timezone,
    totals,
    today: todayTotals,
    streak: computeStreak(dailyMap, today),
    daily,
    hourly,
    models: toBreakdowns(raw.models, totals.totalTokens, 8),
    sources: toBreakdowns(raw.sources, totals.totalTokens, SOURCE_IDS.length),
    projects: toBreakdowns(raw.projects, totals.totalTokens, 8),
    live: raw.live.slice(0, options.liveLimit ?? 6),
    lastEventAt: raw.lastEventAt,
    unpricedModels: raw.unpricedModels.slice(0, 5),
    collector: mergeCollectorMeta(raw.collector),
  };
}

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

export interface SummarizeOptions extends FinalizeOptions {
  /** IANA timezone; defaults to the host timezone. */
  timezone?: string;
}

/** One-shot aggregation over an in-memory event list (demo data, tests, small tools). */
export function summarizeEvents(events: Iterable<UsageEvent>, options: SummarizeOptions): Summary {
  const aggregator = new EventAggregator({ timezone: options.timezone });
  aggregator.addMany(events);
  return aggregator.finalize(options);
}

const EMPTY_COLLECTOR: CollectorMeta = mergeCollectorMeta({ version: 'core' });

export function emptySummary(range: Range, now = Date.now(), timezone?: string): Summary {
  const tz = resolveTimezone(timezone);
  return assembleSummary(
    {
      daily: [],
      models: [],
      sources: [],
      projects: [],
      hourly: [],
      live: [],
      sessions: 0,
      lastEventAt: null,
      unpricedModels: [],
      collector: EMPTY_COLLECTOR,
    },
    { range, now, timezone: tz },
  );
}

/** Build cloud rollups directly from events. */
export function buildCloudDays(
  events: Iterable<UsageEvent>,
  options: { timezone?: string; maxDays?: number; includeModels?: boolean } = {},
): CloudDay[] {
  const aggregator = new EventAggregator({ timezone: options.timezone });
  aggregator.addMany(events);
  return aggregator.cloudDays({ maxDays: options.maxDays, includeModels: options.includeModels });
}

/** Latest-wins merge of cloud day rollups (local collector is the source of truth). */
export function mergeCloudDays(existing: CloudDay[], incoming: CloudDay[]): CloudDay[] {
  const merged = new Map<string, CloudDay>();
  for (const day of existing) merged.set(day.date, day);
  for (const day of incoming) merged.set(day.date, day);
  return [...merged.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Utility used by tests / collectors: build a minimal event from raw counters. */
export function makeEvent(
  partial: Omit<UsageEvent, 'totalTokens' | 'date' | 'hour' | 'reasoningTokens'> &
    Partial<Pick<UsageEvent, 'date' | 'hour' | 'reasoningTokens'>>,
  timezone?: string,
): UsageEvent {
  const tz = resolveTimezone(timezone);
  const totals =
    partial.inputTokens + partial.outputTokens + partial.cacheReadTokens + partial.cacheWriteTokens;
  return {
    ...partial,
    reasoningTokens: partial.reasoningTokens ?? 0,
    totalTokens: totals,
    date: partial.date ?? dateKey(partial.ts, tz),
    hour: partial.hour ?? localHour(partial.ts, tz),
  };
}
