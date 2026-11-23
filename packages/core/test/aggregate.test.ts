import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dateKey,
  addDays,
  dateRangeKeys,
  rangeStartKey,
  EventAggregator,
  summarizeEvents,
  computeStreak,
  assembleSummary,
  buildCloudDays,
  mergeCloudDays,
  makeEvent,
  zeroDailyPoint,
  startOfLocalDay,
  localHour,
} from '../src/aggregate.js';
import type { RawAggregates, UsageEvent } from '../src/types.js';

const TZ = 'Asia/Singapore';

function event(ts: number, overrides: Partial<UsageEvent> = {}): UsageEvent {
  return makeEvent(
    {
      id: `e-${ts}-${Math.random().toString(36).slice(2, 8)}`,
      source: 'claude',
      sessionId: 's1',
      messageId: 'm1',
      ts,
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      agent: 'main',
      project: 'acme/app',
      cwd: '/code/acme/app',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 2000,
      cacheWriteTokens: 0,
      costUsd: 0.01,
      ...overrides,
    },
    TZ,
  );
}

test('dateKey respects timezone at day boundaries', () => {
  // 2026-03-01T17:30Z is 2026-03-02 01:30 in Singapore.
  const ts = Date.UTC(2026, 2, 1, 17, 30, 0);
  assert.equal(dateKey(ts, TZ), '2026-03-02');
  assert.equal(dateKey(ts, 'UTC'), '2026-03-01');
  assert.equal(localHour(ts, TZ), 1);
});

test('startOfLocalDay is local midnight', () => {
  const ts = Date.UTC(2026, 2, 1, 17, 30, 0); // 01:30 local
  const midnight = startOfLocalDay(ts, TZ);
  assert.equal(dateKey(midnight, TZ), '2026-03-02');
  assert.equal(localHour(midnight, TZ), 0);
  assert.equal(midnight, Date.UTC(2026, 2, 1, 16, 0, 0));
});

test('addDays / dateRangeKeys / rangeStartKey do pure calendar maths', () => {
  assert.equal(addDays('2026-03-01', 1), '2026-03-02');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09'); // US DST day
  assert.deepEqual(dateRangeKeys('2026-03-03', 3), ['2026-03-01', '2026-03-02', '2026-03-03']);
  assert.equal(rangeStartKey('today', '2026-03-10'), '2026-03-10');
  assert.equal(rangeStartKey('7d', '2026-03-10'), '2026-03-04');
  assert.equal(rangeStartKey('30d', '2026-03-10'), '2026-02-09');
  assert.equal(rangeStartKey('all', '2026-03-10'), '0000-01-01');
});

test('summarizeEvents aggregates totals, shares and zero-filled days', () => {
  const now = Date.UTC(2026, 2, 10, 4, 0, 0); // 12:00 SGT
  const today = dateKey(now, TZ);
  const events = [
    event(now - 3 * 3_600_000, { id: 'a' }),
    event(now - 2 * 3_600_000, { id: 'b', model: 'gpt-6.2-astra', source: 'codex', project: 'oss/lib' }),
    event(now - 26 * 3_600_000, { id: 'c' }), // yesterday
    event(now - 20 * 86_400_000, { id: 'd' }), // 20 days ago
  ];

  const summary = summarizeEvents(events, { range: 'today', now, timezone: TZ, dailyDays: 7 });
  assert.equal(summary.range, 'today');
  assert.equal(summary.totals.messages, 2);
  assert.equal(summary.totals.totalTokens, 2 * 3500);
  assert.equal(summary.daily.length, 7);
  assert.equal(summary.daily.at(-1)?.date, today);
  assert.equal(summary.hourly.length, 24);
  assert.equal(summary.sources.length, 2);
  assert.ok(Math.abs(summary.sources.reduce((sum, row) => sum + row.share, 0) - 1) < 1e-9);
  assert.equal(summary.models[0]?.key, 'claude-sonnet-4-6');
  assert.equal(summary.models[0]?.messages, 1);
});

test('range filtering excludes older events from totals but keeps streak history', () => {
  const now = Date.UTC(2026, 2, 10, 4, 0, 0);
  const events = [
    event(now - 1000, { id: 'today' }),
    event(now - 3 * 86_400_000, { id: '3d' }),
    event(now - 45 * 86_400_000, { id: '45d' }),
  ];
  const week = summarizeEvents(events, { range: '7d', now, timezone: TZ, dailyDays: 14 });
  assert.equal(week.totals.messages, 2);

  const all = summarizeEvents(events, { range: 'all', now, timezone: TZ, dailyDays: 14 });
  assert.equal(all.totals.messages, 3);
  assert.equal(all.streak.current, 1); // today active, yesterday empty
  assert.equal(all.streak.longest, 1);
  assert.equal(all.streak.todayActive, true);
});

test('computeStreak counts consecutive active days including yesterday', () => {
  const daily = new Map<string, { totalTokens: number }>();
  for (const date of ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']) {
    daily.set(date, { totalTokens: 10 });
  }
  assert.equal(computeStreak(daily, '2026-03-04').current, 4);
  // Today empty but yesterday active: streak keeps counting.
  assert.equal(computeStreak(daily, '2026-03-05').current, 4);
  assert.equal(computeStreak(daily, '2026-03-06').current, 0);
  assert.equal(computeStreak(daily, '2026-03-04').longest, 4);
});

test('unpriced models are tracked separately from cost', () => {
  const now = Date.UTC(2026, 2, 10, 4, 0, 0);
  const events = [event(now - 1000, { model: 'totally-unknown-model', costUsd: null })];
  const summary = summarizeEvents(events, { range: 'today', now, timezone: TZ });
  assert.equal(summary.totals.costUsd, 0);
  assert.equal(summary.totals.unpricedTokens, 3500);
  assert.deepEqual(summary.unpricedModels, ['totally-unknown-model']);
});

test('live sessions are ordered and flagged active', () => {
  const now = Date.UTC(2026, 2, 10, 4, 0, 0);
  const events = [
    event(now - 30_000, { id: 'live1', sessionId: 's-live', project: 'acme/app' }),
    event(now - 5 * 60_000, { id: 'live2', sessionId: 's-warm', project: 'acme/api' }),
    event(now - 3 * 3_600_000, { id: 'old', sessionId: 's-old' }),
  ];
  const summary = summarizeEvents(events, { range: 'today', now, timezone: TZ, liveWindowMs: 10 * 60_000 });
  assert.equal(summary.live.length, 3);
  assert.equal(summary.live[0]?.sessionId, 's-live');
  assert.equal(summary.live[0]?.active, true);
  assert.equal(summary.live[1]?.active, true);
  assert.equal(summary.live[2]?.active, false);
  assert.equal(summary.totals.sessions, 3);
});

test('assembleSummary handles an empty store', () => {
  const raw: RawAggregates = {
    daily: [],
    models: [],
    sources: [],
    projects: [],
    hourly: [],
    sessions: 0,
    live: [],
    lastEventAt: null,
    unpricedModels: [],
    collector: { version: 'test' },
  };
  const summary = assembleSummary(raw, { range: '30d', now: Date.UTC(2026, 2, 10), timezone: TZ, dailyDays: 14 });
  assert.equal(summary.totals.totalTokens, 0);
  assert.equal(summary.daily.length, 14);
  assert.equal(summary.hourly.length, 24);
  assert.equal(summary.streak.current, 0);
  assert.equal(summary.models.length, 0);
});

test('cloud days round-trip and merge latest-wins', () => {
  const now = Date.UTC(2026, 2, 10, 4, 0, 0);
  const days = buildCloudDays([event(now - 1000, { id: 'x' })], { timezone: TZ });
  assert.equal(days.length, 1);
  assert.equal(days[0]?.date, dateKey(now, TZ));
  assert.equal(days[0]?.totalTokens, 3500);
  assert.ok(days[0]?.models);

  const merged = mergeCloudDays(days, [{ ...(days[0] as NonNullable<(typeof days)[0]>), totalTokens: 9999 }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.totalTokens, 9999);
});

test('aggregator is incremental and dailyPoints matches manual accumulation', () => {
  const now = Date.UTC(2026, 2, 10, 4, 0, 0);
  const agg = new EventAggregator({ timezone: TZ });
  agg.add(event(now - 1000, { id: 'i1' }));
  agg.add(event(now - 2000, { id: 'i2' }));
  assert.equal(agg.size, 2);
  const points = agg.dailyPoints();
  assert.equal(points.length, 1);
  assert.equal(points[0]?.totalTokens, 7000);
  const day = zeroDailyPoint(dateKey(now, TZ));
  day.totalTokens = 9999;
  assert.equal(day.totalTokens, 9999);
});
