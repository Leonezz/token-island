/**
 * Pixel SVG + HTML rendering contract tests (docs/CONTRACT-V2.md §2.2).
 *
 * All output is generated from a real server + temp SQLite database seeded with
 * deterministic demo days.  Because pixel art never uses `<text>`, the readable
 * value lives in the accessible `<title>`/`<desc>` metadata — the tests assert
 * both that metadata and the pixel structure (crisp edges, integer geometry,
 * 2px borders, staircase corners, dither patterns, no webfonts).
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

function assertPixelSvg(svg: string, label: string): void {
  assert.match(svg, /^<svg /, `${label}: must start with <svg`);
  assert.match(svg, /<\/svg>$/, `${label}: must end with </svg>`);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${label}: namespace missing`);
  assert.match(svg, /role="img"/, `${label}: role="img" missing`);
  assert.match(svg, /<title[ >]/, `${label}: <title> missing`);
  assert.match(svg, /<desc[ >]/, `${label}: <desc> missing`);
  // Pixel law: only bitmap paths, never <text> or a webfont stack.
  assert.doesNotMatch(svg, /<text[ >]/, `${label}: pixel SVGs must not use <text>`);
  assert.doesNotMatch(svg, /font-family=/, `${label}: pixel SVGs must not reference fonts`);
  assert.match(svg, /shape-rendering="crispEdges"/, `${label}: crispEdges missing`);
  assert.doesNotMatch(svg, /<script/i, `${label}: must not contain scripts`);
  assert.doesNotMatch(svg, /(?:href|src)="https?:/, `${label}: must not reference external assets`);
  assert.doesNotMatch(
    svg,
    /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/,
    `${label}: unescaped ampersand (invalid XML)`,
  );
  // No curves / gradients / blur anywhere (only M/h/v/z path commands).
  for (const match of svg.matchAll(/ d="([^"]*)"/g)) {
    const data = match[1] ?? '';
    assert.doesNotMatch(data, /[QqCcAaSsTt]/, `${label}: path contains a curve/arc command`);
  }
  assert.doesNotMatch(svg, /Gradient|filter=/i, `${label}: no gradients or filters`);
  assert.doesNotMatch(svg, /rx="|ry="/, `${label}: no rounded corners`);
}

function countRects(svg: string): number {
  return (svg.match(/<rect /g) ?? []).length;
}

function countCircles(svg: string): number {
  return (svg.match(/<circle /g) ?? []).length;
}

function countMatches(svg: string, pattern: RegExp): number {
  return (svg.match(pattern) ?? []).length;
}

/**
 * V3 data marks are dots: every chart/badge SVG must stay well-formed XML.
 * A tiny stack parser is enough here — the renderers only emit SVG elements,
 * `<style>` with no markup and escaped `<title>`/`<desc>` text.
 */
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

function blendHex(foreground: string, background: string, alpha: number): string {
  const channels = (hex: string): number[] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const fg = channels(foreground);
  const bg = channels(background);
  const mixed = fg.map((value, index) => Math.round(value * alpha + (bg[index] ?? 0) * (1 - alpha)));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
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
      return `${stats.streak.current}D`;
    case 'messages':
      return formatTokens(stats.totals.messages);
    case 'day':
      return formatTokens(stats.today.totalTokens);
    case 'model': {
      const top = String(stats.models[0].model);
      return truncateLabel(normalizeModelId(top), 22).toUpperCase();
    }
    case 'status':
    default:
      return 'LIVE';
  }
}

test('every badge metric × theme renders a well-formed pixel SVG', async () => {
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
      assertPixelSvg(result.text, `${metric}/${theme}`);
      assert.match(result.text, /stroke-width="2"/, `${metric}/${theme}: needs a 2px border`);
      assert.match(result.text, /v2h2v/, `${metric}/${theme}: staircase corners missing`);

      const expected = expectedBadgeValue(metric);
      const meta = metadata(result.text);
      assert.ok(meta.includes(expected), `${metric}/${theme}: expected value ${JSON.stringify(expected)} in metadata`);
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
  const square = await request(server.baseUrl, '/u/svguser/badge.svg?style=flat-square&theme=dark');
  assert.match(square.text, /^<svg [^>]*height="22"/);
  assert.doesNotMatch(square.text, /v2h2v/, 'flat-square uses square corners');

  const label = await request(server.baseUrl, '/u/svguser/badge.svg?label=my%20tokens&theme=dark');
  assert.equal(label.status, 200);
  assert.match(metadata(label.text), /MY TOKENS/i);

  const week = await request(server.baseUrl, '/u/svguser/badge.svg?metric=tokens&days=7');
  const expected = formatTokens(publicWindowSum(stats, 'totalTokens', 7));
  assert.ok(metadata(week.text).includes(expected), `7-day window should be ${expected}`);

  const light = await request(server.baseUrl, '/u/svguser/badge.svg?theme=light');
  assert.match(light.text, /fill="#f4f2ff"/, 'light theme page background');
});

test('line and bar charts draw dot-matrix data marks over pixel geometry', async () => {
  for (const type of ['line', 'bar']) {
    const result = await request(server.baseUrl, `/u/svguser/chart.svg?type=${type}&days=30&theme=dark`);
    assert.equal(result.status, 200);
    assert.match(String(result.headers.get('content-type')), SVG_CONTENT_TYPE);
    assertPixelSvg(result.text, type);
    assert.doesNotMatch(result.text, /<polyline /, `${type}: pixel charts never use polyline`);
    assert.doesNotMatch(result.text, /<line /, `${type}: pixel charts never use <line>`);
    assert.ok(countCircles(result.text) > 30, `${type}: expected many dot marks, got ${countCircles(result.text)}`);
    assert.ok(countRects(result.text) < 5, `${type}: data marks must not be pixel rects`);
    const meta = metadata(result.text);
    assert.match(meta, /daily tokens/i);
    assert.ok(meta.includes(formatTokens(publicWindowSum(stats, 'totalTokens', 30))), `${type}: header total`);
    assertWellFormedXml(result.text, type);
  }

  const line = await request(server.baseUrl, '/u/svguser/chart.svg?type=line&theme=dark');
  assert.match(line.text, /fill="url\(#ti-chart-area\)"/, 'line chart keeps its filled area');
  assert.match(
    line.text,
    /<pattern id="ti-chart-area"[^>]*>[\s\S]*?<circle /,
    'line area fill is a faint dot texture, not a checkerboard',
  );
  assert.match(line.text, /stroke-width="1"/, 'line connector must stay 1px');
  assert.match(line.text, /opacity="0.45"/, 'line connector must be low-opacity');
  assert.match(line.text, /r="2\.2"/, 'line data points are 1.8-2.4px dots');

  const bar = await request(server.baseUrl, '/u/svguser/chart.svg?type=bar&theme=dark');
  assert.match(bar.text, /opacity="0\.55"/, 'bar dot columns keep a faint track');
  assert.match(bar.text, /fill="#a39fc4"/, 'bar lit dots use the inkDim paint role');
});

test('heatmap chart renders a 7-row pixel calendar with month/weekday labels', async () => {
  const result = await request(server.baseUrl, '/u/svguser/chart.svg?type=heatmap&days=365&theme=dark');
  assert.equal(result.status, 200);
  assertPixelSvg(result.text, 'heatmap');
  assert.ok(countRects(result.text) >= 360, `expected >= 360 heatmap cells, got ${countRects(result.text)}`);
  // Weekday/legend labels are bitmap glyph paths; 4 intensity levels are plain fills.
  assert.ok(countRects(result.text) >= 365, 'one cell per day');
  assert.equal(countMatches(result.text, /r="2\.1"/g), 16, 'heatmap legend swatches are 4 dot clusters');
  const meta = metadata(result.text);
  assert.match(meta, /heatmap of daily token usage/i);
  assertWellFormedXml(result.text, 'heatmap');
});

test('models chart renders top-5 horizontal dot-segment bars', async () => {
  const result = await request(server.baseUrl, '/u/svguser/chart.svg?type=models&days=90&theme=dark');
  assert.equal(result.status, 200);
  assertPixelSvg(result.text, 'models');
  assert.ok(countCircles(result.text) >= 40, 'models chart needs dot segments');
  assert.ok(countMatches(result.text, /r="2\.2"/g) >= 5, 'each model row has lit dots');
  const meta = metadata(result.text);
  assert.match(meta, /top models/i);
  assert.ok(meta.includes(String(stats.models[0].model)), 'top model named in metadata');
  assertWellFormedXml(result.text, 'models');
});

test('chart themes, size clamps and unknown-type fallback', async () => {
  const light = await request(server.baseUrl, '/u/svguser/chart.svg?type=bar&theme=light');
  assert.equal(light.status, 200);
  assertPixelSvg(light.text, 'light chart');
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

test('profile card is a 520x240 pixel panel and clamps width', async () => {
  const result = await request(server.baseUrl, '/u/svguser/card.svg?theme=dark');
  assert.equal(result.status, 200);
  assertPixelSvg(result.text, 'card');
  assert.match(result.text, /^<svg [^>]*width="520" height="240"/);
  assert.match(result.text, /stroke-width="2"/);
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

test('empty profiles render the pixel empty state and escaped display names', async () => {
  const badge = await request(server.baseUrl, '/u/emptyuser/badge.svg?metric=tokens');
  assert.equal(badge.status, 200);
  assert.match(metadata(badge.text), /\b0\b/);

  for (const type of ['line', 'bar', 'heatmap', 'models']) {
    const chart = await request(server.baseUrl, `/u/emptyuser/chart.svg?type=${type}`);
    assert.equal(chart.status, 200, type);
    assertPixelSvg(chart.text, `empty ${type}`);
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

test('dashboard page serves pixel fonts, inline SVGs and copyable embed snippets', async () => {
  const result = await request(server.baseUrl, '/u/svguser');
  assert.equal(result.status, 200);
  assert.match(String(result.headers.get('content-type')), /text\/html/);
  assert.match(String(result.headers.get('content-security-policy')), /default-src 'none'/);
  assert.match(String(result.headers.get('content-security-policy')), /font-src 'self'/);
  const html = result.text;
  assert.match(html, /@font-face/);
  assert.match(html, /url\('\/fonts\/Silkscreen-Regular\.ttf'\)/);
  assert.match(html, /url\('\/fonts\/Silkscreen-Bold\.ttf'\)/);
  assert.match(html, /url\('\/fonts\/VT323-Regular\.ttf'\)/);
  assert.match(html, /font-family: 'Silkscreen'/);
  assert.match(html, /@svguser/);
  assert.match(html, /Embed in your README/);
  assert.match(html, /badge\.svg/);
  assert.match(html, /chart\.svg/);
  assert.match(html, /card\.svg/);
  assert.match(html, /<svg /, 'dashboard should embed inline SVG');
  assert.match(html, /data-copy=/, 'copy buttons present');
  assert.match(html, /navigator\.clipboard/, 'working clipboard JS present');
  assert.ok((html.match(/<svg /g) ?? []).length >= 8, 'dashboard should inline several SVGs');
  assert.match(html, /data-theme="dark"/);
  assert.doesNotMatch(html, /border-radius:\s*[1-9]/, 'no rounded corners in the pixel CSS');

  const light = await request(server.baseUrl, '/u/svguser?theme=light');
  assert.match(light.text, /data-theme="light"/);
  const auto = await request(server.baseUrl, '/u/svguser?theme=auto');
  assert.match(auto.text, /data-theme="auto"/);
});

test('landing page is pixel-styled and degrades gracefully without demo data', async () => {
  const result = await request(server.baseUrl, '/');
  assert.equal(result.status, 200);
  assert.match(String(result.headers.get('content-type')), /text\/html/);
  assert.match(result.text, /Token Island/);
  assert.match(result.text, /Demo data missing/);
  assert.match(result.text, /seed/, 'landing should hint at the seed script');
  assert.match(result.text, /\/api\/v1\/register/);
  assert.match(result.text, /\/healthz/);
  assert.match(result.text, /@font-face/);

  // Once seeded, the landing page shows live demo assets.
  await registerUser(server.baseUrl, 'demo', 'Demo Agent');
  const refreshed = await request(server.baseUrl, '/');
  assert.match(refreshed.text, /Live from @demo/);
  assert.match(refreshed.text, /landing-card/);
});

test('chart SVGs stay self-contained, XML-valid, themeable and cacheable', async () => {
  for (const type of ['line', 'bar', 'heatmap', 'models']) {
    for (const theme of THEMES) {
      const result = await request(server.baseUrl, `/u/svguser/chart.svg?type=${type}&theme=${theme}&days=30`);
      assert.equal(result.status, 200, `${type}/${theme}`);
      assert.match(String(result.headers.get('content-type')), SVG_CONTENT_TYPE);
      assert.match(String(result.headers.get('cache-control')), /public, max-age=300, s-maxage=300/);
      assert.match(String(result.headers.get('etag')), /^"[0-9a-f]{64}"$/, `${type}/${theme}: ETag semantics`);
      assertPixelSvg(result.text, `${type}/${theme}`);
      assertWellFormedXml(result.text, `${type}/${theme}`);
      assert.ok(countCircles(result.text) > 0, `${type}/${theme}: data marks must be dots`);
      if (theme === 'auto') {
        assert.match(result.text, /prefers-color-scheme/, `${type}/${theme}: auto theme media query`);
        assert.match(result.text, /class="ti-f-/, `${type}/${theme}: auto theme needs class paints`);
      } else {
        assert.doesNotMatch(result.text, /prefers-color-scheme/, `${type}/${theme}: fixed theme`);
      }
    }
    const first = await request(server.baseUrl, `/u/svguser/chart.svg?type=${type}&theme=dark&days=30`);
    const second = await request(server.baseUrl, `/u/svguser/chart.svg?type=${type}&theme=dark&days=30`);
    assert.equal(second.headers.get('etag'), first.headers.get('etag'), `${type}: ETag is content-derived and stable`);
  }
});

test('badges use dot-matrix metric icons and a faint label dot texture', async () => {
  for (const metric of BADGE_METRICS) {
    for (const theme of THEMES) {
      const result = await request(server.baseUrl, `/u/svguser/badge.svg?metric=${metric}&theme=${theme}`);
      assert.equal(result.status, 200, `${metric}/${theme}`);
      assertWellFormedXml(result.text, `badge ${metric}/${theme}`);
      // Label text stays crisp bitmap paths (V3: never dot-rendered small text).
      assert.match(result.text, /shape-rendering="crispEdges"/, `${metric}/${theme}: bitmap paths present`);
      assert.ok(countMatches(result.text, /<path /g) >= 4, `${metric}/${theme}: bitmap label/value paths`);
      // Label-area dot texture at ~0.10 opacity, behind the label only.
      assert.match(
        result.text,
        /<pattern id="ti-badge-label-dots"[^>]*>[\s\S]*?<circle [^>]*opacity="0\.1"/,
        `${metric}/${theme}: faint label dot texture`,
      );
      assert.match(result.text, /fill="url\(#ti-badge-label-dots\)"/, `${metric}/${theme}: texture painted`);
      if (metric === 'status') {
        // The only halo allowed in the badge: a <=8px LED status point.
        assert.match(result.text, /opacity="0\.1"/, 'status LED outer halo');
        assert.match(result.text, /opacity="0\.18"/, 'status LED inner halo');
        assert.match(result.text, /r="2\.2"/, 'status LED core dot');
        assert.ok(countCircles(result.text) >= 4, 'status LED + texture dot');
      } else {
        assert.ok(
          countCircles(result.text) >= 10,
          `${metric}/${theme}: dot icon needs a dot matrix, got ${countCircles(result.text)}`,
        );
      }
    }
  }
  const unknown = await request(server.baseUrl, '/u/no-such-user/badge.svg');
  assert.equal(unknown.status, 404);
  assert.match(unknown.text, /NO DATA/);
  assert.ok(countCircles(unknown.text) >= 9, 'unknown badge gets the dot cross icon');
  assertWellFormedXml(unknown.text, 'unknown badge');
});

test('badge label contrast stays >= 4.5:1 with the 0.10 dot texture (dark/light)', async () => {
  for (const theme of ['dark', 'light'] as const) {
    const palette = paletteFor(theme);
    const base = contrastRatio(palette.inkDim, palette.surface);
    const textured = contrastRatio(palette.inkDim, blendHex(palette.ink, palette.surface, 0.1));
    assert.ok(base >= 4.5, `${theme}: V2 label contrast baseline ${base.toFixed(2)}`);
    assert.ok(textured >= 4.5, `${theme}: textured label contrast ${textured.toFixed(2)}`);
    assert.ok(
      textured >= base * 0.7,
      `${theme}: dot texture must not erode label contrast (${textured.toFixed(2)} vs ${base.toFixed(2)})`,
    );
    const badge = await request(server.baseUrl, `/u/svguser/badge.svg?metric=tokens&theme=${theme}`);
    assert.match(badge.text, /shape-rendering="crispEdges"/);
    assert.doesNotMatch(badge.text, /<text[ >]/, `${theme}: badge text stays bitmap`);
  }
});

test('dashboard stat cards use dot figures >=40px tall and the footer shows v0.3.0', async () => {
  const result = await request(server.baseUrl, '/u/svguser');
  assert.equal(result.status, 200);
  const figures = [...result.text.matchAll(/<svg class="stat-figure" width="(\d+)" height="(\d+)"/g)];
  assert.ok(figures.length >= 4, `expected 4 dot stat figures, got ${figures.length}`);
  for (const figure of figures) {
    assert.ok(Number(figure[2]) >= 40, `stat figure must be >=40px tall, got ${figure[2]}`);
  }
  assert.match(result.text, /fill="currentColor"/, 'dot figures follow the page theme via currentColor');
  // Text labels around the dot figures are untouched bitmap/HTML text.
  for (const label of ['Total tokens', 'Est. spend', 'Current streak', 'Messages']) {
    assert.ok(result.text.includes(label), `stat label "${label}" must stay as text`);
  }
  assert.match(result.text, /v0\.3\.0/, 'footer shows the 0.3.0 release');
  assert.doesNotMatch(result.text, /<text[ >]/, 'inline SVGs never use <text>');

  const landing = await request(server.baseUrl, '/');
  assert.match(landing.text, /v0\.3\.0/, 'landing footer shows the 0.3.0 release');
});

test('robots.txt keeps public instances out of search engines', async () => {
  const result = await request(server.baseUrl, '/robots.txt');
  assert.equal(result.status, 200);
  assert.match(result.text, /Disallow: \//);
});
