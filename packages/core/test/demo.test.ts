import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateDemoEvents, generateDemoSummary, generateDemoCloudDays } from '../src/demo.js';

const NOW = Date.UTC(2026, 2, 10, 4, 30, 0); // 12:30 Asia/Singapore

test('demo events are deterministic for a fixed seed and now', () => {
  const a = generateDemoEvents({ days: 30, now: NOW, seed: 7, timezone: 'Asia/Singapore' });
  const b = generateDemoEvents({ days: 30, now: NOW, seed: 7, timezone: 'Asia/Singapore' });
  assert.equal(a.length, b.length);
  assert.ok(a.length > 50, `expected a decent amount of demo events, got ${a.length}`);
  assert.deepEqual(
    a.map((e) => [e.id, e.ts, e.totalTokens]),
    b.map((e) => [e.id, e.ts, e.totalTokens]),
  );
});

test('demo events never land in the future', () => {
  const events = generateDemoEvents({ days: 10, now: NOW, seed: 3, timezone: 'Asia/Singapore' });
  for (const event of events) assert.ok(event.ts <= NOW, `event in the future: ${event.ts} > ${NOW}`);
});

test('demo summary has the shape the widget needs', () => {
  const summary = generateDemoSummary({ days: 60, now: NOW, seed: 11, timezone: 'Asia/Singapore' });
  assert.equal(summary.version, 1);
  assert.equal(summary.daily.length, 14);
  assert.equal(summary.hourly.length, 24);
  assert.ok(summary.today.totalTokens > 0, 'today should have tokens');
  assert.ok(summary.totals.costUsd > 0, 'demo usage should have a cost estimate');
  assert.ok(summary.streak.current >= 6, `expected a streak, got ${summary.streak.current}`);
  assert.ok(summary.models.length >= 3);
  assert.ok(summary.sources.length >= 3);
  assert.ok(summary.live.length >= 1);
  assert.ok(summary.live.some((session) => session.active), 'expected an active session');
  assert.equal(summary.collector.cloud.username, 'demo');
  assert.equal(summary.unpricedModels.length, 0);
});

test('demo cloud days are ascending and cost positive', () => {
  const days = generateDemoCloudDays({ days: 30, now: NOW, seed: 5, timezone: 'Asia/Singapore' });
  assert.ok(days.length > 10);
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  assert.deepEqual(days.map((d) => d.date), sorted.map((d) => d.date));
  assert.ok(days.some((d) => d.costUsd > 0));
  assert.ok(days.every((d) => d.models && Object.keys(d.models).length > 0));
});
