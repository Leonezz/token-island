/**
 * Precision Telemetry SVG + HTML rendering contract tests (v4).
 *
 * All output is generated from a real server + temp SQLite database seeded with
 * deterministic demo days. Verifies:
 *  - Well-formed self-contained XML with `<title>` + `<desc>` metadata
 *  - Crisp system sans + tabular-mono `<text>` elements (zero external assets/scripts)
 *  - WCAG AA/AAA contrast ratios (>= 4.5:1 across dark and light palettes)
 *  - Rounded vector geometry (`rx=`), ETag stability, `auto` media query theming
 *  - Redesigned Dashboard (7D/30D/90D/All timeframe panes, solid KPI figures, single theme switch)
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
import { paletteFor, relativeLuminance } from '../src/render/tokens.js';

let server: TestServer;
let stats: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const SVG_CONTENT_TYPE = /image\/svg\+xml/;

function metadata(svg: string): string {
  const titles = [...svg.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/g)].map((match) => match[1] ?? '');
  const descs = [...svg.matchAll(/<desc[^>]*>([\s\S]*?)<\/desc>/g)].map((match) => match[1] ?? '');
  return [...titles, ...descs].join('\n');
}

function assertTelemetrySvg(svg: string, label: string): void {
  assert.match(svg, /^<svg /, `${label}: must start with <svg`);
  assert.match(svg, /<\/svg>$/, `${label}: must end with </svg>`);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${label}: namespace missing`);
  assert.match(svg, /role="img"/, `${label}: role="img" missing`);
  assert.match(svg, /<title[ >]/, `${label}: <title> missing`);
  assert.match(svg, /<desc[ >]/, `${label}: <desc> missing`);
  assert.match(svg, /<text /, `${label}: telemetry SVGs must render crisp <text>`);
  assert.match(svg, /\.ti-sans\{/, `${label}: embedded system sans class missing`);
  assert.match(svg, /\.ti-mono\{[^}]*tabular-nums/, `${label}: embedded tabular-mono class missing`);
  assert.match(svg, /rx="/, `${label}: rounded architectural geometry missing`);
  assert.doesNotMatch(svg, /<script/i, `${label}: must not contain scripts`);
  assert.doesNotMatch(svg, /(?:href|src)="https?:/, `${label}: must not reference external assets`);
  assert.doesNotMatch(
    svg,
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/,
    `${label}: unescaped ampersand (invalid XML)`,
  );
}

function assertWellFormedXml(svg: string, label: string): void {
  const tagPattern = /<(\/?)([a-zA-Z][\w:.-]*)((?:\s+[a-zA-Z][\w:.-]*="[^"]*")*)\s*(\/?)>/g;
  const stack: string[] = [];
  let cursor = 0;
  let roots = 0;
  for (let match = tagPattern.exec(svg); match; match = tagPattern.exec(svg)) {
    const between = svg.slice(cursor, match.index);
    assert.doesNotMatch(between, /[<>]/, `${label}: markup not parsed near ${JSON.stringify(between.slice(-40))}`);
    const raw = match[0] ?? '';
    const closing = match[1] ?? '';
    const name = match[2] ?? '';
    const selfClosing = match[4] ?? '';
    cursor = match.index + raw.length;
    if (closing === '/') {
      assert.equal(stack.pop(), name, `${label}: mismatched closing </${name}>`);
      continue;
    }
    if (stack.length === 0) roots += 1;
    if (selfClosing !== '/') stack.push(name);
  }
  const trailing = svg.slice(cursor);
  assert.doesNotMatch(trailing, /[<>]/, `${label}: trailing markup not parsed`);
  assert.equal(roots, 1, `${label}: exactly one document root`);
  assert.equal(stack.length, 0, `${label}: unclosed elements remain`);
}

function countRects(svg: string): number {
  return (svg.match(/<rect /g) ?? []).length;
}

function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
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
      return truncateLabel(normalizeModelId(top), 24);
    }
    case 'status':
    default:
      return 'live';
  }
}

test('every badge metric × theme renders a well-formed telemetry SVG', async () => {
  for (const metric of BADGE_METRICS) {
    for (const theme of THEMES) {
      const result = await request(server.baseUrl, `/u/svguser/badge.svg?metric=${metric}&theme=${theme}`);
      assert.equal(result.status, 200, `${metric}/${theme}`);
      assert.match(String(result.headers.get('content-type')), SVG_CONTENT_TYPE);
      assert.match(
        String(result.headers.get('cache-control')),
        /public, max-age=300, s-maxage=300/,
        'badges are README-cacheable',
      );
      assertTelemetrySvg(result.text, `${metric}/${theme}`);
      assertWellFormedXml(result.text, `${metric}/${theme}`);

      const expected = expectedBadgeValue(metric);
      const meta = metadata(result.text);
      assert.ok(meta.includes(expected), `${metric}/${theme}: expected value ${JSON.stringify(expected)} in metadata`);
      assert.ok(result.text.includes(`>${expected.replace(/&/g, '&amp;')}<`), `${metric}/${theme}: visible <text> value`);
      assert.ok(meta.includes('@svguser'), `${metric}/${theme}: username missing from metadata`);

      if (theme === 'auto') {
        assert.match(result.text, /prefers-color-scheme/, 'auto theme must ship a media query');
      } else {
        assert.doesNotMatch(result.text, /prefers-color-scheme/);
      }
    }
  }
});

test('badge geometry: 24px flat / 22px flat-square, label override, days window', async () => {
  const flat = await request(server.baseUrl, '/u/svguser/badge.svg?style=flat&theme=dark');
  assert.match(flat.text, /^<svg [^>]*height="24"/);
  assert.match(flat.text, /rx="6"/);
  const square = await request(server.baseUrl, '/u/svguser/badge.svg?style=flat-square&theme=dark');
  assert.match(square.text, /^<svg [^>]*height="22"/);
  assert.match(square.text, /rx="2"/);

  const label = await request(server.baseUrl, '/u/svguser/badge.svg?label=my%20tokens&theme=dark');
  assert.equal(label.status, 200);
  assert.match(metadata(label.text), /my tokens/i);
  assert.match(label.text, />my tokens</i);

  const week = await request(server.baseUrl, '/u/svguser/badge.svg?metric=tokens&days=7');
  const expected = formatTokens(publicWindowSum(stats, 'totalTokens', 7));
  assert.ok(metadata(week.text).includes(expected), `7-day window should be ${expected}`);
});

test('line and bar charts render crisp vector series and readable axis labels', async () => {
  const line = await request(server.baseUrl, '/u/svguser/chart.svg?type=line&days=30&theme=dark');
  assert.equal(line.status, 200);
  assertTelemetrySvg(line.text, 'line');
  assertWellFormedXml(line.text, 'line');
  assert.match(line.text, /stroke-width="2"/, 'line chart uses a crisp 2px primary series stroke');
  assert.match(line.text, /opacity="0\.13"/, 'line chart includes translucent area fill');
  assert.match(metadata(line.text), /daily tokens/i);

  const bar = await request(server.baseUrl, '/u/svguser/chart.svg?type=bar&days=30&theme=dark');
  assert.equal(bar.status, 200);
  assertTelemetrySvg(bar.text, 'bar');
  assertWellFormedXml(bar.text, 'bar');
  assert.ok(countRects(bar.text) >= 30, 'bar chart draws rounded bars for daily window');
});

test('heatmap chart renders a 7-row calendar with month/weekday labels', async () => {
  const result = await request(server.baseUrl, '/u/svguser/chart.svg?type=heatmap&days=365&theme=dark');
  assert.equal(result.status, 200);
  assertTelemetrySvg(result.text, 'heatmap');
  assertWellFormedXml(result.text, 'heatmap');
  assert.ok(countRects(result.text) >= 365, `expected >= 365 heatmap cells, got ${countRects(result.text)}`);
  assert.match(result.text, />Less</);
  assert.match(result.text, />More</);
  assert.match(metadata(result.text), /heatmap of daily token usage/i);
});

test('models chart renders top-5 horizontal bars with natural lowercase model ids', async () => {
  const result = await request(server.baseUrl, '/u/svguser/chart.svg?type=models&days=90&theme=dark');
  assert.equal(result.status, 200);
  assertTelemetrySvg(result.text, 'models');
  assertWellFormedXml(result.text, 'models');
  const topModel = normalizeModelId(String(stats.models[0].model));
  assert.ok(metadata(result.text).includes(String(stats.models[0].model)), 'top model named in metadata');
  assert.ok(result.text.includes(topModel.slice(0, 10)), 'lowercase model id rendered in SVG text');
});

test('chart themes, size clamps and unknown-type fallback', async () => {
  const light = await request(server.baseUrl, '/u/svguser/chart.svg?type=bar&theme=light');
  assert.equal(light.status, 200);
  assertTelemetrySvg(light.text, 'light chart');
  assert.doesNotMatch(light.text, /prefers-color-scheme/);

  const auto = await request(server.baseUrl, '/u/svguser/chart.svg?type=line&theme=auto');
  assert.match(auto.text, /prefers-color-scheme/);

  const clamped = await request(server.baseUrl, '/u/svguser/chart.svg?type=line&width=99999&height=1');
  assert.match(clamped.text, /^<svg [^>]*width="1200"/);
  assert.match(clamped.text, /height="120"/);

  const tiny = await request(server.baseUrl, '/u/svguser/chart.svg?type=line&width=1&height=9999');
  assert.match(tiny.text, /^<svg [^>]*width="320"/);
  assert.match(tiny.text, /height="400"/);

  const invalidType = await request(server.baseUrl, '/u/svguser/chart.svg?type=radar');
  assert.equal(invalidType.status, 200);
  assert.match(metadata(invalidType.text), /daily tokens/i, 'invalid type falls back to line');
});

test('profile card is a 520x240 telemetry panel with non-colliding 30d trend inset', async () => {
  const result = await request(server.baseUrl, '/u/svguser/card.svg?theme=dark');
  assert.equal(result.status, 200);
  assertTelemetrySvg(result.text, 'card');
  assertWellFormedXml(result.text, 'card');
  assert.match(result.text, /^<svg [^>]*width="520" height="240"/);
  assert.match(result.text, />30d Trend</);
  const meta = metadata(result.text);
  assert.match(meta, /@svguser/);
  assert.match(meta, /token island profile card/i);
  assert.ok(meta.includes(formatTokens(stats.totals.totalTokens)), 'card total in metadata');

  const narrow = await request(server.baseUrl, '/u/svguser/card.svg?width=100');
  assert.match(narrow.text, /^<svg [^>]*width="420"/);
  const wide = await request(server.baseUrl, '/u/svguser/card.svg?width=99999');
  assert.match(wide.text, /^<svg [^>]*width="800"/);

  const auto = await request(server.baseUrl, '/u/svguser/card.svg?theme=auto');
  assert.match(auto.text, /prefers-color-scheme/);
});

test('empty profiles render clean empty states and escaped display names', async () => {
  const badge = await request(server.baseUrl, '/u/emptyuser/badge.svg?metric=tokens');
  assert.equal(badge.status, 200);
  assert.match(metadata(badge.text), /\b0\b/);

  for (const type of ['line', 'bar', 'heatmap', 'models']) {
    const chart = await request(server.baseUrl, `/u/emptyuser/chart.svg?type=${type}`);
    assert.equal(chart.status, 200, type);
    assertTelemetrySvg(chart.text, `empty ${type}`);
    assertWellFormedXml(chart.text, `empty ${type}`);
  }

  const card = await request(server.baseUrl, '/u/emptyuser/card.svg');
  assert.equal(card.status, 200);
  assert.match(metadata(card.text), /@emptyuser/);

  const dashboard = await request(server.baseUrl, '/u/emptyuser');
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /No model data synced yet/);
  assert.match(dashboard.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'display name must be escaped');
  assert.doesNotMatch(dashboard.text, /<script>alert\(1\)<\/script>/);
});

test('dashboard page serves crisp telemetry UI, timeframe tabs, single theme switch and copyable snippets', async () => {
  const result = await request(server.baseUrl, '/u/svguser');
  assert.equal(result.status, 200);
  assert.match(String(result.headers.get('content-type')), /text\/html/);
  assert.match(String(result.headers.get('content-security-policy')), /default-src 'none'/);
  const html = result.text;
  assert.match(html, /font-variant-numeric:\s*tabular-nums/);
  assert.doesNotMatch(html, /-webkit-font-smoothing:\s*none/, 'antialiased font smoothing must stay enabled');
  assert.equal((html.match(/class="theme-switch"/g) ?? []).length, 1, 'exactly one global theme switcher');
  assert.equal((html.match(/data-range-btn="/g) ?? []).length, 4, '7D/30D/90D/All timeframe buttons');
  assert.match(html, /@svguser/);
  assert.match(html, /Embed in your README/);
  assert.match(html, /badge\.svg/);
  assert.match(html, /chart\.svg/);
  assert.match(html, /card\.svg/);
  assert.match(html, /data-copy=/);
  assert.match(html, /navigator\.clipboard/);
  assert.ok((html.match(/<svg /g) ?? []).length >= 8);
  assert.match(html, /data-theme="dark"/);

  const light = await request(server.baseUrl, '/u/svguser?theme=light');
  assert.match(light.text, /data-theme="light"/);
  const auto = await request(server.baseUrl, '/u/svguser?theme=auto');
  assert.match(auto.text, /data-theme="auto"/);
});

test('landing page renders telemetry layout and degrades gracefully without demo data', async () => {
  const result = await request(server.baseUrl, '/');
  assert.equal(result.status, 200);
  assert.match(String(result.headers.get('content-type')), /text\/html/);
  assert.match(result.text, /Token Island/);
  assert.match(result.text, /Demo data missing/);
  assert.match(result.text, /seed/, 'landing should hint at the seed script');
  assert.match(result.text, /\/api\/v1\/register/);
  assert.match(result.text, /\/healthz/);

  await registerUser(server.baseUrl, 'demo', 'Demo Agent');
  const refreshed = await request(server.baseUrl, '/');
  assert.match(refreshed.text, /Live from @demo/);
  assert.match(refreshed.text, /landing-card/);
});

test('chart SVGs stay self-contained, XML-valid, themeable and ETag-cacheable', async () => {
  for (const type of ['line', 'bar', 'heatmap', 'models']) {
    for (const theme of THEMES) {
      const result = await request(server.baseUrl, `/u/svguser/chart.svg?type=${type}&theme=${theme}&days=30`);
      assert.equal(result.status, 200, `${type}/${theme}`);
      assert.match(String(result.headers.get('content-type')), SVG_CONTENT_TYPE);
      assert.match(String(result.headers.get('cache-control')), /public, max-age=300, s-maxage=300/);
      assert.match(String(result.headers.get('etag')), /^"[0-9a-f]{64}"$/, `${type}/${theme}: ETag semantics`);
      assertTelemetrySvg(result.text, `${type}/${theme}`);
      assertWellFormedXml(result.text, `${type}/${theme}`);
      if (theme === 'auto') {
        assert.match(result.text, /prefers-color-scheme/, `${type}/${theme}: auto theme media query`);
        assert.match(result.text, /ti-f-/, `${type}/${theme}: auto theme needs class paints`);
      } else {
        assert.doesNotMatch(result.text, /prefers-color-scheme/, `${type}/${theme}: fixed theme`);
      }
    }
    const first = await request(server.baseUrl, `/u/svguser/chart.svg?type=${type}&theme=dark&days=30`);
    const second = await request(server.baseUrl, `/u/svguser/chart.svg?type=${type}&theme=dark&days=30`);
    assert.equal(second.headers.get('etag'), first.headers.get('etag'), `${type}: ETag is content-derived and stable`);
  }
});

test('all ink and accent roles meet >= 4.5:1 WCAG AA contrast on dark and light surfaces', async () => {
  for (const theme of ['dark', 'light'] as const) {
    const palette = paletteFor(theme);
    assert.ok(contrastRatio(palette.ink, palette.surface) >= 12, `${theme}: ink contrast`);
    assert.ok(contrastRatio(palette.inkDim, palette.surfaceAlt) >= 5.5, `${theme}: badge label contrast`);
    assert.ok(contrastRatio(palette.inkFaint, palette.surface) >= 4.5, `${theme}: faint label contrast`);
    assert.ok(contrastRatio(palette.teal, palette.surface) >= 4.5, `${theme}: teal accent contrast`);
    assert.ok(contrastRatio(palette.amber, palette.surface) >= 4.5, `${theme}: amber accent contrast`);
    assert.ok(contrastRatio(palette.blue, palette.surface) >= 4.5, `${theme}: blue accent contrast`);
  }
  const unknown = await request(server.baseUrl, '/u/no-such-user/badge.svg');
  assert.equal(unknown.status, 404);
  assert.match(unknown.text, /no data/i);
  assertWellFormedXml(unknown.text, 'unknown badge');
});

test('robots.txt keeps public instances out of search engines', async () => {
  const result = await request(server.baseUrl, '/robots.txt');
  assert.equal(result.status, 200);
  assert.match(result.text, /Disallow: \//);
});
