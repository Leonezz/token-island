import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  estimateCostUsd,
  normalizeModelId,
  resolvePrice,
  DEFAULT_PRICE_RULES,
} from '../src/pricing.js';
import {
  formatTokens,
  formatTokensFull,
  formatCost,
  formatCostApprox,
  formatPercent,
  formatDuration,
  formatRelative,
  truncateLabel,
  share,
} from '../src/format.js';

test('normalizeModelId strips provider prefixes and dates', () => {
  assert.equal(normalizeModelId('anthropic/claude-sonnet-4-6-20260301'), 'claude-sonnet-4-6');
  assert.equal(normalizeModelId('Claude-Sonnet-4-6'), 'claude-sonnet-4-6');
  assert.equal(normalizeModelId('gpt-5.2-codex:latest'), 'gpt-5.2-codex');
});

test('pricing resolves specific families before broad ones', () => {
  assert.equal(resolvePrice('claude-sonnet-4-6')?.id, 'claude-sonnet');
  assert.equal(resolvePrice('claude-opus-4-6')?.id, 'claude-opus');
  assert.equal(resolvePrice('gpt-5.2-codex')?.id, 'gpt-codex');
  assert.equal(resolvePrice('deepseek-flash')?.id, 'deepseek-chat');
  assert.equal(resolvePrice('glm-4.7-free')?.id, 'free');
  assert.equal(resolvePrice('totally-unknown'), null);
});

test('cost math: 1M input + 1M output of sonnet is $18', () => {
  const cost = estimateCostUsd(
    { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    'claude-sonnet-4-6',
    'anthropic',
  );
  assert.equal(cost, 18);
});

test('cost math accounts for cache reads and writes', () => {
  const cost = estimateCostUsd(
    {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
    },
    'claude-sonnet-4-6',
  );
  // 3 + 0.3 + 3.75 = 7.05
  assert.equal(cost, 7.05);
});

test('unknown models are unpriced, free models cost 0', () => {
  assert.equal(estimateCostUsd({ inputTokens: 1000, outputTokens: 1000 }, 'mystery-model'), null);
  assert.equal(estimateCostUsd({ inputTokens: 1000, outputTokens: 1000 }, 'glm-4.7-free'), 0);
});

test('config overrides win over the built-in table', () => {
  const cost = estimateCostUsd(
    { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    'my-internal-model',
    undefined,
    [{ match: 'my-internal', input: 1, output: 2 }],
  );
  assert.equal(cost, 3);
});

test('all default rules are ordered by precedence and compile', () => {
  assert.ok(DEFAULT_PRICE_RULES.length > 10);
  for (const rule of DEFAULT_PRICE_RULES) {
    assert.ok(rule.match instanceof RegExp, rule.id);
    assert.ok(rule.input >= 0 && rule.output >= 0, rule.id);
  }
});

test('formatTokens compacts with two decimals for small mantissas', () => {
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(942), '942');
  assert.equal(formatTokens(12_400), '12.4K');
  assert.equal(formatTokens(1_240_000), '1.24M');
  assert.equal(formatTokens(3_100_000_000), '3.1B');
  assert.equal(formatTokens(1_000_000), '1M');
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1_500_000_000_000), '1.5T');
  assert.equal(formatTokensFull(1_234_567), '1,234,567');
});

test('formatCost switches precision by magnitude', () => {
  assert.equal(formatCost(null), '—');
  assert.equal(formatCost(0), '$0');
  assert.equal(formatCost(0.0042), '<$0.01');
  assert.equal(formatCost(0.42), '$0.42');
  assert.equal(formatCost(4.125), '$4.13');
  assert.equal(formatCost(412.3), '$412');
  assert.equal(formatCost(12_400), '$12.4K');
  assert.equal(formatCostApprox(1.2), '~$1.2');
});

test('formatPercent / duration / relative / truncate', () => {
  assert.equal(formatPercent(0.42), '42%');
  assert.equal(formatPercent(0.004), '<1%');
  assert.equal(formatPercent(0.123), '12%');
  assert.equal(formatPercent(0.123, 1), '12.3%');
  assert.equal(formatDuration(850), '850ms');
  assert.equal(formatDuration(9_500), '9.5s');
  assert.equal(formatDuration(125_000), '2.1m');
  const now = 1_000_000_000_000;
  assert.equal(formatRelative(now - 5_000, now), 'just now');
  assert.equal(formatRelative(now - 3 * 60_000, now), '3m ago');
  assert.equal(formatRelative(null, now), 'never');
  assert.equal(truncateLabel('acme/desktop-app', 8), 'acme/de…');
  assert.equal(share(5, 10), 0.5);
  assert.equal(share(5, 0), 0);
});
