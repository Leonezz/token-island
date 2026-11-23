/**
 * SVG + HTML rendering contract tests.
 *
 * Everything is generated from a real server + temp SQLite database seeded with
 * deterministic demo days; expected values are derived from the public stats
 * JSON so formatting always goes through @token-island/core.
 */

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  formatCost,
  formatTokens,
  generateDemoCloudDays,
  normalizeModelId,
  truncateLabel,
} from '@token-island/core';
import {
  bearer,
  postJson,
  publicWindowSum,
  registerUser,
  request,
  startTestServer,
  type TestServer,
} from './helpers.js';

let server: TestServer;
let stats: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const SVG_CONTENT_TYPE = /image\/svg\+xml/;

function assertWellFormedSvg(svg: string, label: string): void {
  assert.match(svg, /^<svg /, `${label}: must start with <svg`);
  assert.match(svg, /<\/svg>$/, `${label}: must end with </svg>`);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${label}: namespace missing`);
  assert.match(svg, /role="img"/, `${label}: role="img" missing`);
  assert.match(svg, /<title[ >]/, `${label}: <title> missing`);
  assert.match(svg, /<desc[ >]/, `${label}: <desc> missing`);
  assert.match(svg, /font-family="/, `${label}: font-family missing`);
  assert.doesNotMatch(
    svg,
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/,
    `${label}: unescaped ampersand (invalid XML)`,
  );
  assert.doesNotMatch(svg, /<script/i, `${label}: must not contain scripts`);
  assert.doesNotMatch(svg, /(?:href|src)="https?:/, `${label}: must not reference external assets`);
}

function countRects(svg: string): number {
  return (svg.match(/<rect /g) ?? []).length;
}

before(async () => {
  server = await startTestServer();
  const user = await registerUser(server.baseUrl, 'svguser', 'SVG User');
  const days = generateDemoCloudDays({ days: 120, seed: 42 });
  const ingest = await postJson(server.baseUrl, '/api/v1/ingest', { days }, bearer(user.apiKey));
  assert.equal(ingest.status, 200, ingest.text);
  const publicStats = await request(server.baseUrl, '/api/v1/u/svguser');
  assert.equal(publicStats.status, 200);
  stats = publicStats.json;

  const empty = await registerUser(server.baseUrl, 'emptyuser', '<script>alert(1)</script>');
  assert.match(empty.apiKey, /^ti_/);
});

after(async () => {
  await server.cleanup();
});

const BADGE_METRICS = ['tokens', 'cost', 'streak', 'messages', 'day', 'model', 'status'] as const;
const THEMES = ['dark', 'light', 'auto'] as const;

function expectedBadgeValue(metric: string): string {
  switch (metric) {
    case 'tokens':
      return formatTokens(publicWindowSum(stats, 'totalTokens', 30));
    case 'cost':
      return formatCost(publicWindowSum(stats, 'costUsd', 30), { approx: true });
    case 'streak':
      return `${stats.streak.current}d`;
    case 'messages':
      return formatTokens(stats.totals.messages);
    case 'day':
      return formatTokens(stats.today.totalTokens);
    case 'model': {
      const top = String(stats.models[0].model);
      return truncateLabel(normalizeModelId(top), 22);
    }
    case 'status':
    default:
      return 'live';
  }
}

test('every badge metric × theme renders well-formed SVG with the formatted value', async () => {
  for (const metric of BADGE_METRICS) {
    for (const theme of THEMES) {
      const result = await request(
        server.baseUrl,
        `/u/svguser/badge.svg?metric=${metric}&theme=${theme}`,
      );
      assert.equal(result.status, 200, `${metric}/${theme}`);
      assert.match(String(result.headers.get('content-type')), SVG_CONTENT_TYPE);
      assert.match(
        String(result.headers.get('cache-control')),
        /public, max-age=300, s-maxage=300/,
        'badges are README-cacheable',
      );
      assertWellFormedSvg(result.text, `${metric}/${theme}`);

      const expected = expectedBadgeValue(metric);
      assert.ok(
        result.text.includes(expected),
        `${metric}/${theme}: expected formatted value ${JSON.stringify(expected)} in badge`,
      );
      const escaped = expected.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      assert.ok(result.text.includes(escaped), `${metric}/${theme}: value not XML-escaped`);

      if (theme === 'auto') {
        assert.match(result.text, /prefers-color-scheme/, 'auto theme must ship a media query');
      } else {
        assert.doesNotMatch(result.text, /prefers-color-scheme/);
      }
    }
  }
});

test('badge options: label override, days window and flat-square style', async () => {
  const label = await request(server.baseUrl, '/u/svguser/badge.svg?label=my%20tokens&theme=dark');
  assert.equal(label.status, 200);
  assert.match(label.text, /my tokens/);

  const week = await request(server.baseUrl, '/u/svguser/badge.svg?metric=tokens&days=7');
  const expected = formatTokens(publicWindowSum(stats, 'totalTokens', 7));
  assert.ok(week.text.includes(expected), `7-day window should be ${expected}`);

  const flat = await request(server.baseUrl, '/u/svguser/badge.svg?style=flat');
  assert.match(flat.text, /height="20"/);
  const square = await request(server.baseUrl, '/u/svguser/badge.svg?style=flat-square');
  assert.match(square.text, /height="18"/);
  assert.match(square.text, /rx="0"/);

  const invalid = await request(server.baseUrl, '/u/svguser/badge.svg?metric=nope&theme=nope');
  assert.equal(invalid.status, 200);
  assert.match(invalid.text, /tokens/);
});

test('line and bar charts render paths/bars with axes and empty state handled elsewhere', async () => {
  for (const type of ['line', 'bar']) {
    const result = await request(server.baseUrl, `/u/svguser/chart.svg?type=${type}&days=30&theme=dark`);
    assert.equal(result.status, 200);
    assert.match(String(result.headers.get('content-type')), SVG_CONTENT_TYPE);
    assertWellFormedSvg(result.text, type);
    if (type === 'line') {
      assert.match(result.text, /<polyline /, 'line chart needs a polyline');
      assert.match(result.text, /<path /, 'line chart needs an area path');
      assert.match(result.text, /linearGradient/);
    } else {
      assert.ok(countRects(result.text) > 20, 'bar chart should draw many bars');
      assert.match(result.text, /linearGradient/);
    }
    assert.match(result.text, /Daily tokens/);
    assert.ok(result.text.includes(formatTokens(publicWindowSum(stats, 'totalTokens', 30))), 'chart header total');
  }
});

test('heatmap chart renders a GitHub-style grid', async () => {
  const result = await request(server.baseUrl, '/u/svguser/chart.svg?type=heatmap&days=365&theme=dark');
  assert.equal(result.status, 200);
  assertWellFormedSvg(result.text, 'heatmap');
  assert.ok(countRects(result.text) >= 360, `expected >= 360 heatmap rects, got ${countRects(result.text)}`);
  assert.match(result.text, /Daily activity/);
  for (const weekday of ['Mon', 'Wed', 'Fri']) assert.match(result.text, new RegExp(weekday));
  assert.match(result.text, /Less/);
  assert.match(result.text, /More/);
});

test('models chart renders top-5 horizontal bars with percentages', async () => {
  const result = await request(server.baseUrl, '/u/svguser/chart.svg?type=models&days=90&theme=dark');
  assert.equal(result.status, 200);
  assertWellFormedSvg(result.text, 'models');
  assert.match(result.text, /Top models/);
  assert.ok(countRects(result.text) >= 10, 'models chart needs bar tracks + values');
  assert.match(result.text, /%/, 'models chart shows shares');
  const windowModels = (stats.daily as Array<{ date: string }>).length > 0;
  assert.ok(windowModels);
});

test('chart themes, clamps and unknown fallbacks', async () => {
  const light = await request(server.baseUrl, '/u/svguser/chart.svg?type=bar&theme=light');
  assert.equal(light.status, 200);
  assertWellFormedSvg(light.text, 'light chart');
  assert.doesNotMatch(light.text, /prefers-color-scheme/);

  const auto = await request(server.baseUrl, '/u/svguser/chart.svg?type=line&theme=auto');
  assert.match(auto.text, /prefers-color-scheme/);

  const clamped = await request(server.baseUrl, '/u/svguser/chart.svg?type=line&width=99999&height=1');
  assert.match(clamped.text, /^<svg [^>]*width="1400"/);
  assert.match(clamped.text, /height="140"/);

  const invalidType = await request(server.baseUrl, '/u/svguser/chart.svg?type=radar');
  assert.equal(invalidType.status, 200);
  assert.match(invalidType.text, /<polyline /, 'invalid type falls back to line');
});

test('profile card renders identity, totals and clamps width', async () => {
  const result = await request(server.baseUrl, '/u/svguser/card.svg?theme=dark');
  assert.equal(result.status, 200);
  assertWellFormedSvg(result.text, 'card');
  assert.match(result.text, /@svguser/);
  assert.match(result.text, /SVG User|AI agent token usage/);
  assert.match(result.text, /TOTAL TOKENS/);
  assert.match(result.text, /token-island/);
  assert.match(result.text, /width="495"/);
  assert.ok(result.text.includes(formatTokens(stats.totals.totalTokens)));
  assert.match(result.text, /LAST 30 DAYS/);

  const narrow = await request(server.baseUrl, '/u/svguser/card.svg?width=100');
  assert.match(narrow.text, /^<svg [^>]*width="380"/);
  const wide = await request(server.baseUrl, '/u/svguser/card.svg?width=99999');
  assert.match(wide.text, /^<svg [^>]*width="800"/);

  const auto = await request(server.baseUrl, '/u/svguser/card.svg?theme=auto');
  assert.match(auto.text, /prefers-color-scheme/);
});

test('empty profiles render the empty state and escaped display names', async () => {
  const badge = await request(server.baseUrl, '/u/emptyuser/badge.svg?metric=tokens');
  assert.equal(badge.status, 200);
  assert.match(badge.text, />0</);

  for (const type of ['line', 'bar', 'heatmap', 'models']) {
    const chart = await request(server.baseUrl, `/u/emptyuser/chart.svg?type=${type}`);
    assert.equal(chart.status, 200, type);
    assertWellFormedSvg(chart.text, `empty ${type}`);
    assert.match(chart.text, /no data yet/, `${type} needs an empty state`);
  }

  const card = await request(server.baseUrl, '/u/emptyuser/card.svg');
  assert.equal(card.status, 200);
  assert.match(card.text, /@emptyuser/);
  assert.match(card.text, /no data yet/);

  const dashboard = await request(server.baseUrl, '/u/emptyuser');
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /no data yet/);
  assert.match(dashboard.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'display name must be escaped');
  assert.doesNotMatch(dashboard.text, /<script>alert\(1\)<\/script>/);
});

test('dashboard page renders inline SVG charts, tables and embed snippets', async () => {
  const result = await request(server.baseUrl, '/u/svguser');
  assert.equal(result.status, 200);
  assert.match(String(result.headers.get('content-type')), /text\/html/);
  assert.match(String(result.headers.get('content-security-policy')), /default-src 'none'/);
  const html = result.text;
  assert.match(html, /@svguser/);
  assert.match(html, /Embed in your README/);
  assert.match(html, /badge\.svg/);
  assert.match(html, /chart\.svg/);
  assert.match(html, /card\.svg/);
  assert.match(html, /<svg /, 'dashboard should embed inline SVG');
  assert.match(html, /copy/, 'copy buttons present');
  assert.ok((html.match(/<svg /g) ?? []).length >= 8, 'dashboard should inline several SVGs');
  assert.match(html, /data-theme="dark"/);

  const light = await request(server.baseUrl, '/u/svguser?theme=light');
  assert.match(light.text, /data-theme="light"/);
  const auto = await request(server.baseUrl, '/u/svguser?theme=auto');
  assert.match(auto.text, /data-theme="auto"/);
});

test('landing page degrades gracefully when the demo user is missing', async () => {
  const result = await request(server.baseUrl, '/');
  assert.equal(result.status, 200);
  assert.match(String(result.headers.get('content-type')), /text\/html/);
  assert.match(result.text, /Token Island/);
  assert.match(result.text, /Demo data missing/);
  assert.match(result.text, /seed/, 'landing should hint at the seed script');
  assert.match(result.text, /\/api\/v1\/register/);
  assert.match(result.text, /\/healthz/);

  // Once seeded, the landing page shows live demo assets.
  await registerUser(server.baseUrl, 'demo', 'Demo Agent');
  const refreshed = await request(server.baseUrl, '/');
  assert.match(refreshed.text, /Live from @demo/);
  assert.match(refreshed.text, /landing-card/);
});

test('robots.txt keeps public instances out of search engines', async () => {
  const result = await request(server.baseUrl, '/robots.txt');
  assert.equal(result.status, 200);
  assert.match(result.text, /Disallow: \//);
});
