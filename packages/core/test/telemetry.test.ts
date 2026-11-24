import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  measureTelemetryText,
  TELEMETRY_DARK,
  TELEMETRY_LIGHT,
  TELEMETRY_SERIES,
  TELEMETRY_SERIES_LIGHT,
  telemetryTextSvg,
  truncateTelemetryText,
} from '../src/index.js';

function channel(hex: string, index: number): number {
  const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test('telemetry palettes meet WCAG AA/AAA contrast thresholds on surfaces', () => {
  assert.ok(contrast(TELEMETRY_DARK.ink, TELEMETRY_DARK.surface) >= 12, 'dark primary ink >= 12:1');
  assert.ok(contrast(TELEMETRY_DARK.inkDim, TELEMETRY_DARK.surface) >= 6.5, 'dark secondary ink >= 6.5:1');
  assert.ok(contrast(TELEMETRY_DARK.inkFaint, TELEMETRY_DARK.surface) >= 4.5, 'dark faint ink >= 4.5:1');

  assert.ok(contrast(TELEMETRY_LIGHT.ink, TELEMETRY_LIGHT.surface) >= 12, 'light primary ink >= 12:1');
  assert.ok(contrast(TELEMETRY_LIGHT.inkDim, TELEMETRY_LIGHT.surface) >= 6.5, 'light secondary ink >= 6.5:1');
  assert.ok(contrast(TELEMETRY_LIGHT.inkFaint, TELEMETRY_LIGHT.surface) >= 4.5, 'light faint ink >= 4.5:1');

  assert.equal(TELEMETRY_SERIES.length, TELEMETRY_SERIES_LIGHT.length);
});

test('measureTelemetryText and truncateTelemetryText bound widths deterministically', () => {
  const full = 'claude-sonnet-4-6-20261022';
  const fullWidth = measureTelemetryText(full, 12, { mono: true });
  assert.ok(fullWidth > 120);

  const clamped = truncateTelemetryText(full, 95, 12, { mono: true });
  assert.ok(clamped.endsWith('…'));
  assert.ok(measureTelemetryText(clamped, 12, { mono: true }) <= 95);
});

test('telemetryTextSvg escapes XML entities and applies alignment + font classes', () => {
  const svg = telemetryTextSvg('A & B <tag>', {
    x: 24,
    y: 18,
    fontSize: 13,
    fontWeight: 600,
    mono: true,
    align: 'right',
    className: 'ti-f-ink',
  });
  assert.match(svg, /^<text /);
  assert.match(svg, /text-anchor="end"/);
  assert.match(svg, /class="ti-mono ti-f-ink"/);
  assert.match(svg, /A &amp; B &lt;tag&gt;/);
});
