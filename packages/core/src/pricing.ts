/**
 * Model pricing table + cost estimation.
 *
 * Prices are public list prices in USD per 1,000,000 tokens, rounded and
 * collected for convenience only: they change often and some models in this
 * table are estimates.  Treat every number derived from this module as an
 * *estimate* and override it through `~/.token-island/config.json`:
 *
 *   "prices": [{ "match": "my-internal-model", "input": 0.5, "output": 1.5 }]
 *
 * Unknown models are reported as `null` (unpriced) instead of silently costing 0.
 */

export interface PriceRule {
  /** Stable rule id, also used in the UI tooltip. */
  id: string;
  /** Matched against the normalized (lowercased) model id. */
  match: RegExp;
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cache-read (prompt cache hit) tokens. Defaults to `input`. */
  cacheRead?: number;
  /** USD per 1M cache-write (prompt cache creation) tokens. Defaults to input * 1.25. */
  cacheWrite?: number;
  note?: string;
}

/** User-provided override; `match` is a case-insensitive substring of the model id. */
export interface PriceOverride {
  match: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  note?: string;
}

/**
 * Ordered rules, first match wins.  Keep broad family fallbacks last.
 * Prices: USD / 1M tokens.  cacheRead = prompt-cache hit price.
 */
export const DEFAULT_PRICE_RULES: PriceRule[] = [
  { id: 'free', match: /(?:^|[-/._])(?:free|trial)(?:$|[-/._])/, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, note: 'free tier' },

  // Anthropic
  { id: 'claude-opus', match: /claude.*(?:opus|fable)/, input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, note: 'list price' },
  { id: 'claude-sonnet', match: /claude.*sonnet/, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, note: 'list price' },
  { id: 'claude-haiku', match: /claude.*haiku/, input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1, note: 'list price' },
  { id: 'claude-family', match: /claude/, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, note: 'family estimate' },

  // OpenAI
  { id: 'gpt-nano', match: /gpt-5(?:\.\d+)?-nano/, input: 0.05, output: 0.4, cacheRead: 0.005, note: 'list price' },
  { id: 'gpt-mini', match: /gpt-5(?:\.\d+)?-mini/, input: 0.25, output: 2, cacheRead: 0.025, note: 'list price' },
  { id: 'gpt-codex', match: /(?:gpt-5(?:\.\d+)?-codex|codex-mini)/, input: 1.25, output: 10, cacheRead: 0.125, note: 'list price' },
  { id: 'gpt-5', match: /gpt-5/, input: 1.25, output: 10, cacheRead: 0.125, note: 'list price' },
  { id: 'gpt-6', match: /gpt-6/, input: 1.25, output: 10, cacheRead: 0.125, note: 'unreleased assumption, override me' },
  { id: 'gpt-4.1', match: /gpt-4\.1/, input: 2, output: 8, cacheRead: 0.5, note: 'list price' },
  { id: 'o4-mini', match: /^o4-mini/, input: 1.1, output: 4.4, cacheRead: 0.275 },
  { id: 'o3', match: /^o3(?:-|$)/, input: 2, output: 8, cacheRead: 0.5 },
  { id: 'gpt-4o', match: /gpt-4o/, input: 2.5, output: 10, cacheRead: 1.25 },
  { id: 'gpt-4', match: /gpt-4/, input: 2, output: 8, cacheRead: 1 },

  // DeepSeek
  { id: 'deepseek-chat', match: /deepseek-(?:chat|flash|v3)/, input: 0.28, output: 0.42, cacheRead: 0.028, note: 'estimate' },
  { id: 'deepseek-reasoner', match: /deepseek-(?:reasoner|r1)/, input: 0.28, output: 0.42, cacheRead: 0.028, note: 'estimate' },
  { id: 'deepseek', match: /deepseek/, input: 0.28, output: 0.42, cacheRead: 0.028, note: 'estimate' },

  // Chinese OSS models commonly used through coding agents
  { id: 'glm', match: /glm-?[45]/, input: 0.6, output: 2.2, note: 'estimate' },
  { id: 'kimi', match: /(?:kimi|moonshot)/, input: 0.6, output: 2.5, note: 'estimate' },
  { id: 'qwen', match: /qwen/, input: 0.4, output: 1.2, note: 'estimate' },
  { id: 'minimax', match: /minimax|abab/, input: 0.3, output: 1.2, note: 'estimate' },

  // Google
  { id: 'gemini-pro', match: /gemini.*pro/, input: 1.25, output: 10, note: 'estimate' },
  { id: 'gemini-flash', match: /gemini.*flash/, input: 0.3, output: 2.5, note: 'estimate' },
  { id: 'gemini', match: /gemini/, input: 0.3, output: 2.5, note: 'family estimate' },

  // Others
  { id: 'grok', match: /grok-?4/, input: 3, output: 15, note: 'estimate' },
  { id: 'mistral', match: /(?:mistral|magistral|codestral)/, input: 0.4, output: 2, note: 'estimate' },
];

/** Strips provider prefixes and date/version suffixes so `claude-sonnet-4-6-20260101` matches `claude-sonnet`. */
export function normalizeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^[a-z0-9_-]+\//, '')
    .replace(/[:@]latest$/, '')
    .replace(/[-_](?:20\d{2})[-_]?\d{2}[-_]?\d{2}$/, '')
    .replace(/[-_](?:20\d{6})$/, '');
}

export function resolvePrice(
  model: string,
  provider?: string,
  overrides: PriceOverride[] = [],
): PriceRule | null {
  const normalized = normalizeModelId(model);
  if (!normalized) return null;

  for (const override of overrides) {
    if (!override.match) continue;
    if (normalized.includes(override.match.trim().toLowerCase())) {
      return {
        id: `override:${override.match}`,
        match: new RegExp(escapeRegExp(override.match), 'i'),
        input: override.input,
        output: override.output,
        ...(override.cacheRead !== undefined ? { cacheRead: override.cacheRead } : {}),
        ...(override.cacheWrite !== undefined ? { cacheWrite: override.cacheWrite } : {}),
        note: override.note ?? 'config override',
      };
    }
  }

  const haystack = provider ? `${provider}/${normalized}` : normalized;
  for (const rule of DEFAULT_PRICE_RULES) {
    if (rule.match.test(normalized) || rule.match.test(haystack)) return rule;
  }
  return null;
}

export interface CostInput {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Estimated USD cost for one event, or null when the model is unpriced.
 * Cache reads fall back to the input price; cache writes fall back to 1.25x input
 * (Anthropic's cache-creation multiplier).
 */
export function estimateCostUsd(
  counts: CostInput,
  model: string,
  provider?: string,
  overrides: PriceOverride[] = [],
): number | null {
  const rule = resolvePrice(model, provider, overrides);
  if (!rule) return null;

  const cacheReadPrice = rule.cacheRead ?? rule.input;
  const cacheWritePrice = rule.cacheWrite ?? rule.input * 1.25;
  const perMillion =
    counts.inputTokens * rule.input +
    (counts.outputTokens ?? 0) * rule.output +
    (counts.cacheReadTokens ?? 0) * cacheReadPrice +
    (counts.cacheWriteTokens ?? 0) * cacheWritePrice;

  if (!Number.isFinite(perMillion)) return null;
  return Math.round((perMillion / 1_000_000) * 1e6) / 1e6;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
