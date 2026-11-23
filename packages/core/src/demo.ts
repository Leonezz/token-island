/**
 * Deterministic demo data.
 *
 * Used for: `tokenisland collect --demo`, cloud seeding (`demo` user), the
 * widget's snapshot mode, screenshots and tests.  Given the same `seed` + `now`
 * the output is byte-for-byte identical, which keeps visual regressions honest.
 */

import {
  EventAggregator,
  dateKey,
  resolveTimezone,
  startOfLocalDay,
  summarizeEvents,
} from './aggregate.js';
import { estimateCostUsd } from './pricing.js';
import type { CloudDay, SourceId, Summary, UsageEvent } from './types.js';

export interface DemoOptions {
  /** Length of the generated history, in days. Default 120. */
  days?: number;
  /** Reference "now" (epoch ms). Default Date.now(). */
  now?: number;
  /** PRNG seed. Default 42. */
  seed?: number;
  /** IANA timezone for date bucketing. Defaults to host timezone. */
  timezone?: string;
  /** Number of sessions that should look live right now. Default 2. */
  liveSessions?: number;
}

interface ModelSpec {
  source: SourceId;
  model: string;
  provider: string;
  /** Relative pick weight. */
  weight: number;
  /** Cache-read multiplier range applied to input tokens. */
  cacheRead: [number, number];
  /** Cache-write multiplier range applied to input tokens. */
  cacheWrite?: [number, number];
  /** Base output token range. */
  output: [number, number];
  /** Probability that the event is a long agentic answer. */
  longOutputChance?: number;
  reasoning?: boolean;
}

const MODEL_SPECS: ModelSpec[] = [
  {
    source: 'claude',
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    weight: 26,
    cacheRead: [1.2, 2.8],
    cacheWrite: [0.15, 0.9],
    output: [180, 1800],
    longOutputChance: 0.12,
  },
  {
    source: 'claude',
    model: 'claude-opus-4-6',
    provider: 'anthropic',
    weight: 12,
    cacheRead: [1.5, 3.2],
    cacheWrite: [0.2, 1.1],
    output: [220, 2400],
    longOutputChance: 0.16,
    reasoning: true,
  },
  {
    source: 'claude',
    model: 'claude-haiku-4-6',
    provider: 'anthropic',
    weight: 8,
    cacheRead: [0.8, 2.0],
    cacheWrite: [0.05, 0.4],
    output: [120, 900],
  },
  {
    source: 'codex',
    model: 'gpt-6.2-astra',
    provider: 'openai',
    weight: 20,
    cacheRead: [0.8, 2.2],
    cacheWrite: [0, 0],
    output: [200, 2200],
    longOutputChance: 0.14,
    reasoning: true,
  },
  {
    source: 'codex',
    model: 'gpt-5.2-codex',
    provider: 'openai',
    weight: 10,
    cacheRead: [0.6, 1.8],
    cacheWrite: [0, 0],
    output: [160, 1600],
    longOutputChance: 0.1,
    reasoning: true,
  },
  {
    source: 'dsh',
    model: 'deepseek-flash',
    provider: 'deepseek-official',
    weight: 12,
    cacheRead: [0.5, 1.6],
    cacheWrite: [0, 0],
    output: [150, 1400],
    longOutputChance: 0.08,
  },
  {
    source: 'dsh',
    model: 'deepseek-v4',
    provider: 'deepseek-official',
    weight: 6,
    cacheRead: [0.4, 1.4],
    cacheWrite: [0, 0],
    output: [200, 2000],
    longOutputChance: 0.12,
    reasoning: true,
  },
  {
    source: 'opencode',
    model: 'glm-4.7-free',
    provider: 'opencode',
    weight: 4,
    cacheRead: [0.2, 1.0],
    cacheWrite: [0, 0],
    output: [150, 1200],
  },
  {
    source: 'opencode',
    model: 'kimi-k2.5',
    provider: 'moonshot',
    weight: 3,
    cacheRead: [0.3, 1.2],
    cacheWrite: [0, 0],
    output: [180, 1500],
  },
];

const PROJECTS = [
  'acme/desktop-app',
  'acme/api-gateway',
  'personal/notes',
  'oss/token-island',
  'work/data-pipeline',
  'scratch/experiments',
  'acme/design-system',
  'personal/dotfiles',
];

const CWD_BY_PROJECT: Record<string, string> = {
  'acme/desktop-app': '/Users/demo/code/acme/desktop-app',
  'acme/api-gateway': '/Users/demo/code/acme/api-gateway',
  'personal/notes': '/Users/demo/notes',
  'oss/token-island': '/Users/demo/code/token-island',
  'work/data-pipeline': '/Users/demo/work/data-pipeline',
  'scratch/experiments': '/Users/demo/scratch/experiments',
  'acme/design-system': '/Users/demo/code/acme/design-system',
  'personal/dotfiles': '/Users/demo/dotfiles',
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T extends { weight: number }>(rand: () => number, items: T[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = rand() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1] as T;
}

function between(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}

function round(value: number): number {
  return Math.max(0, Math.round(value));
}

/** Hour-of-day weights for past days: morning and evening agent sessions. */
const HOUR_WEIGHTS = [
  1, 0.6, 0.4, 0.2, 0.2, 0.4, 1, 2, 3.5, 5, 6, 6.5, 4, 4.5, 6, 6.5, 6, 5.5, 4.5, 4, 3.5, 3, 2.4, 1.6,
];

function pickHour(rand: () => number): number {
  const total = HOUR_WEIGHTS.reduce((sum, w) => sum + w, 0);
  let roll = rand() * total;
  for (let hour = 0; hour < 24; hour += 1) {
    roll -= HOUR_WEIGHTS[hour] as number;
    if (roll <= 0) return hour;
  }
  return 22;
}

function buildEvent(
  rand: () => number,
  params: {
    ts: number;
    timezone: string;
    sessionId: string;
    project: string;
    spec: ModelSpec;
    index: number;
    agent: string;
  },
): UsageEvent {
  const { spec } = params;
  const baseInput = 900 + Math.pow(rand(), 1.7) * 34_000;
  const inputTokens = round(baseInput);
  const cacheFactor = between(rand, spec.cacheRead[0], spec.cacheRead[1]);
  const cacheReadTokens = rand() < 0.08 ? 0 : round(inputTokens * cacheFactor);
  const cacheWriteTokens = spec.cacheWrite
    ? rand() < 0.35
      ? round(inputTokens * between(rand, spec.cacheWrite[0], spec.cacheWrite[1]))
      : 0
    : 0;

  const long = rand() < (spec.longOutputChance ?? 0);
  const outputTokens = round(
    long ? between(rand, 4200, 12_000) : between(rand, spec.output[0], spec.output[1]),
  );
  const reasoningTokens = spec.reasoning ? round(outputTokens * between(rand, 0.15, 0.75)) : 0;

  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const localDate = dateKey(params.ts, params.timezone);
  const hour = Number(new Intl.DateTimeFormat('en-CA', { timeZone: params.timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(params.ts)));

  return {
    id: `demo:${spec.source}:${params.sessionId}:${params.index}`,
    source: spec.source,
    sessionId: params.sessionId,
    messageId: `demo-msg-${params.sessionId}-${params.index}`,
    ts: params.ts,
    date: localDate,
    hour,
    model: spec.model,
    provider: spec.provider,
    agent: params.agent,
    project: params.project,
    cwd: CWD_BY_PROJECT[params.project] ?? `/Users/demo/code/${params.project}`,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
    costUsd: estimateCostUsd(
      { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
      spec.model,
      spec.provider,
    ),
  };
}

/**
 * Generate a realistic history of agent usage.  Today's events are generated
 * inside the already-elapsed part of today (never in the future), and the last
 * `liveSessions` sessions always have a very recent event so the widget shows
 * a live indicator.
 */
export function generateDemoEvents(options: DemoOptions = {}): UsageEvent[] {
  const now = options.now ?? Date.now();
  const timezone = resolveTimezone(options.timezone);
  const days = Math.max(1, Math.min(365, Math.floor(options.days ?? 120)));
  const seed = options.seed ?? 42;
  const liveSessions = Math.max(0, Math.min(3, options.liveSessions ?? 2));
  const rand = mulberry32(seed);

  const events: UsageEvent[] = [];
  const todayKey = dateKey(now, timezone);
  const todayStart = startOfLocalDay(now, timezone);
  const todayKeyFromNow = todayKey;

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const dayStart = startOfLocalDay(todayStart - offset * 86_400_000 + 12 * 3_600_000, timezone);
    const dayKey = dateKey(dayStart + 12 * 3_600_000, timezone);
    const isToday = dayKey === todayKeyFromNow;
    const weekday = new Date(dayStart + 12 * 3_600_000).getDay();
    const weekend = weekday === 0 || weekday === 6;

    // Recent six days are always active so the demo shows a live streak.
    const recent = offset <= 5;
    const activeProbability = isToday ? 1 : recent ? 1 : weekend ? 0.55 : 0.82;
    if (!isToday && offset > 5 && rand() > activeProbability) continue;

    const sessionCount = 2 + Math.floor(rand() * (weekend ? 3 : 5));
    for (let s = 0; s < sessionCount; s += 1) {
      const project = PROJECTS[Math.floor(rand() * PROJECTS.length)] as string;
      const sessionId = `demo-${dayKey}-${s}-${Math.floor(rand() * 1e6).toString(36)}`;
      const eventCount = 3 + Math.floor(rand() * 13);

      for (let e = 0; e < eventCount; e += 1) {
        const spec = pickWeighted(rand, MODEL_SPECS);
        let ts: number;
        if (isToday) {
          const elapsed = Math.max(1, now - todayStart);
          // Bias today's events towards the most recent hours so the day looks alive.
          const skew = Math.pow(rand(), 1.6);
          ts = todayStart + Math.floor(elapsed * skew);
        } else {
          const hour = pickHour(rand);
          const minute = Math.floor(rand() * 60);
          const second = Math.floor(rand() * 60);
          ts = dayStart + hour * 3_600_000 + minute * 60_000 + second * 1000;
        }
        if (ts > now) ts = now - Math.floor(rand() * 60_000);

        events.push(
          buildEvent(rand, {
            ts,
            timezone,
            sessionId,
            project,
            spec,
            index: e,
            agent: rand() < 0.16 ? 'subagent' : 'main',
          }),
        );
      }
    }
  }

  // Make sure a couple of sessions look live *right now*.
  const recentPool = events.filter((event) => event.date === todayKey);
  if (liveSessions > 0 && recentPool.length > 0) {
    for (let i = 0; i < liveSessions; i += 1) {
      const candidate = recentPool[recentPool.length - 1 - i];
      if (!candidate) continue;
      candidate.ts = now - (20_000 + i * 45_000 + Math.floor(rand() * 20_000));
      candidate.date = dateKey(candidate.ts, timezone);
    }
    events.sort((a, b) => a.ts - b.ts);
  }

  return events;
}

export interface DemoSummaryOptions extends DemoOptions {
  /** Range for the `totals` fields. Default: today. */
  range?: Summary['range'];
  /** Daily sparkline length. Default 14. */
  dailyDays?: number;
}

/** Summary shaped exactly like the collector's `/api/summary` response. */
export function generateDemoSummary(options: DemoSummaryOptions = {}): Summary {
  const now = options.now ?? Date.now();
  const events = generateDemoEvents({ ...options, now });
  const summary = summarizeEvents(events, {
    range: options.range ?? 'today',
    now,
    timezone: options.timezone,
    dailyDays: options.dailyDays ?? 14,
    collector: {
      version: '0.1.0-demo',
      uptimeSec: 3_725,
      dbPath: '~/ .token-island/demo.db',
      watchRoots: ['~/.claude/projects', '~/.codex/sessions', '~/.local/share/opencode', '~/.dsh/sessions'],
      cloud: {
        enabled: true,
        lastSyncAt: now - 96_000,
        lastError: null,
        username: 'demo',
        endpoint: 'https://token-island.example.com',
      },
    },
  });

  // Give the widget a couple of visibly distinct sources/projects for the demo.
  return summary;
}

/** Daily rollups for the cloud demo user. */
export function generateDemoCloudDays(options: DemoOptions = {}): CloudDay[] {
  const events = generateDemoEvents(options);
  const aggregator = new EventAggregator({ timezone: options.timezone });
  aggregator.addMany(events);
  return aggregator.cloudDays();
}
