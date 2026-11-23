/**
 * Shared data model for Token Island.
 *
 * One `UsageEvent` represents a single billable LLM response (one assistant
 * turn / one API request).  Collectors normalize every supported agent into
 * this shape, everything else (local widget, cloud badges) is derived from it.
 */

export type SourceId = 'claude' | 'codex' | 'opencode' | 'dsh' | 'gemini' | 'other';

export interface SourceMeta {
  /** Human readable name, e.g. "Claude Code". */
  label: string;
  /** Compact name used in dense UI, e.g. "Claude". */
  short: string;
  /** Accent color used across the widget / SVG charts. */
  color: string;
}

export const SOURCE_META: Record<SourceId, SourceMeta> = {
  claude: { label: 'Claude Code', short: 'Claude', color: '#D97757' },
  codex: { label: 'OpenAI Codex', short: 'Codex', color: '#10A37F' },
  opencode: { label: 'OpenCode', short: 'OpenCode', color: '#6C7BFF' },
  dsh: { label: 'DeepSeek Harness', short: 'DSH', color: '#4D6BFE' },
  gemini: { label: 'Gemini CLI', short: 'Gemini', color: '#4285F4' },
  other: { label: 'Other', short: 'Other', color: '#8B8B8B' },
};

export const SOURCE_IDS: SourceId[] = ['claude', 'codex', 'opencode', 'dsh', 'gemini', 'other'];

/** Token counters.  `totalTokens` is always the sum of the four input/output buckets. */
export interface TokenCounts {
  /** Prompt tokens that were NOT served from / written to a prompt cache. */
  inputTokens: number;
  /** Completion tokens (includes hidden reasoning tokens where the provider bills them as output). */
  outputTokens: number;
  /** Prompt tokens served from a prompt cache. */
  cacheReadTokens: number;
  /** Prompt tokens written into a prompt cache. */
  cacheWriteTokens: number;
  /** Subset of outputTokens reported as reasoning tokens (informational only, never added on top). */
  reasoningTokens: number;
  /** inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens. */
  totalTokens: number;
}

export interface UsageEvent extends TokenCounts {
  /** Stable unique id, e.g. `claude:msg_01abc`. Re-ingesting the same id is a no-op. */
  id: string;
  source: SourceId;
  /** Provider-side session / thread id. */
  sessionId: string;
  /** Provider-side message id (may be empty when the provider has none). */
  messageId: string;
  /** Epoch milliseconds. */
  ts: number;
  /** Local calendar date the event belongs to, `YYYY-MM-DD` (computed with the configured timezone). */
  date: string;
  /** Local hour 0..23 of the event, used for the "today" sparkline. */
  hour: number;
  /** Model id exactly as reported by the agent. */
  model: string;
  /** Provider id (`anthropic`, `openai`, `deepseek`, ...). May be empty. */
  provider: string;
  /** `main` for the primary agent, otherwise a sub-agent label. */
  agent: string;
  /** Short project label, usually the basename of the working directory. */
  project: string;
  /** Full working directory, when known. */
  cwd: string;
  /** Estimated cost in USD, or null when the model has no known price. */
  costUsd: number | null;
}

export type Range = 'today' | '7d' | '30d' | '90d' | 'all';

export const RANGES: Range[] = ['today', '7d', '30d', '90d', 'all'];

export interface TokenTotals extends TokenCounts {
  /** Tokens whose model has no known price. `costUsd` ignores them. */
  unpricedTokens: number;
  /** Estimated spend in USD (may be 0 for unknown/free models). */
  costUsd: number;
  /** Number of billable events (assistant turns). */
  messages: number;
  /** Number of distinct sessions with at least one event. */
  sessions: number;
}

export interface Streak {
  /** Consecutive active days ending today (or yesterday when today is still empty). */
  current: number;
  /** Longest consecutive active-day run on record. */
  longest: number;
  /** Whether any tokens were consumed today (local time). */
  todayActive: boolean;
  /** Last calendar date with activity, `YYYY-MM-DD` or null. */
  lastActiveDate: string | null;
}

export interface DailyPoint extends TokenCounts {
  /** `YYYY-MM-DD`, local timezone. */
  date: string;
  unpricedTokens: number;
  costUsd: number;
  messages: number;
}

export interface HourPoint {
  /** 0..23 local hour. */
  hour: number;
  totalTokens: number;
  costUsd: number;
  messages: number;
}

export interface Breakdown {
  /** Stable key: model id, source id or project label. */
  key: string;
  /** Display label. */
  label: string;
  /** Accent color when known (sources/models). */
  color?: string;
  totalTokens: number;
  costUsd: number;
  messages: number;
  /** Share of the range's total tokens, 0..1. */
  share: number;
}

export interface LiveSession {
  source: SourceId;
  sessionId: string;
  project: string;
  model: string;
  /** Epoch ms of the most recent event of this session. */
  updatedAt: number;
  /** Total tokens consumed by this session so far (all time). */
  totalTokens: number;
  messages: number;
  /** True when the session emitted an event within the live window. */
  active: boolean;
}

export interface SourceStatus {
  source: SourceId;
  enabled: boolean;
  lastEventAt: number | null;
  events: number;
  /** Last parser error, null when healthy. */
  error: string | null;
}

export interface CloudSyncStatus {
  enabled: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  username: string | null;
  endpoint: string | null;
}

export interface CollectorMeta {
  version: string;
  uptimeSec: number;
  dbPath: string;
  /** Absolute paths that are being watched (for debugging). */
  watchRoots: string[];
  sources: SourceStatus[];
  cloud: CloudSyncStatus;
}

/** The single JSON document consumed by the macOS widget and any other local UI. */
export interface Summary {
  version: 1;
  generatedAt: number;
  range: Range;
  timezone: string;
  totals: TokenTotals;
  today: TokenTotals;
  streak: Streak;
  /** Ascending, always exactly `dailyDays` entries, ending today (zero-filled). */
  daily: DailyPoint[];
  /** Exactly 24 entries, index === local hour, for today only. */
  hourly: HourPoint[];
  models: Breakdown[];
  sources: Breakdown[];
  projects: Breakdown[];
  /** Recently active sessions, newest first (max 6). */
  live: LiveSession[];
  lastEventAt: number | null;
  /** Models without a known price (max 5), so UIs can be honest about cost estimates. */
  unpricedModels: string[];
  collector: CollectorMeta;
}

/** Daily aggregate as uploaded to the cloud.  No prompts, no paths, no session ids. */
export interface CloudDay extends TokenCounts {
  date: string;
  unpricedTokens: number;
  costUsd: number;
  messages: number;
  /** model id -> total tokens (optional, used by the "top model" badge). */
  models?: Record<string, number>;
}

/** Aggregated breakdown row as produced by a storage layer before shares are computed. */
export interface BreakdownAgg {
  key: string;
  label: string;
  color?: string;
  totalTokens: number;
  costUsd: number;
  messages: number;
}

/**
 * Storage-agnostic aggregate input for `assembleSummary`.  The local collector
 * builds this from SQLite; the pure `EventAggregator` builds it from events.
 */
export interface RawAggregates {
  /** All known days (used for streak + range slicing); zero-filled days are optional. */
  daily: DailyPoint[];
  /** Already filtered to the requested range. */
  models: BreakdownAgg[];
  /** Already filtered to the requested range. */
  sources: BreakdownAgg[];
  /** Already filtered to the requested range. */
  projects: BreakdownAgg[];
  /** 24 buckets for today (missing buckets are zero-filled by the assembler). */
  hourly: HourPoint[];
  /** Distinct sessions with events in the requested range. */
  sessions: number;
  live: LiveSession[];
  lastEventAt: number | null;
  unpricedModels: string[];
  /** Collector metadata; missing fields fall back to defaults. */
  collector?: Partial<CollectorMeta>;
}
