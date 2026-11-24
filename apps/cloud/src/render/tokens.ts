/**
 * Precision Telemetry theme tokens + SVG typography helpers for all cloud surfaces.
 *
 * Dark is the default; `light` uses crisp alabaster surfaces and deepened accents;
 * `auto` renders dark defaults and embeds a `prefers-color-scheme: light` media
 * query so GitHub README badges, cards and charts follow the viewer's OS theme.
 */

import { MODEL_COLORS, MODEL_COLORS_LIGHT } from '../colors.js';
import {
  formatCost,
  formatPercent,
  formatTokens,
  formatTokensFull,
  measureTelemetryText,
  TELEMETRY_DARK,
  TELEMETRY_FONT_MONO,
  TELEMETRY_FONT_SANS,
  TELEMETRY_LIGHT,
  telemetryTextSvg,
  truncateTelemetryText,
} from '@token-island/core';

export type SvgTheme = 'dark' | 'light' | 'auto';

export function parseSvgTheme(raw: unknown): SvgTheme {
  return raw === 'light' || raw === 'auto' ? raw : 'dark';
}

export function isAutoTheme(theme: SvgTheme): boolean {
  return theme === 'auto';
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const PAINT_ROLES = [
  'bg',
  'bgRaised',
  'surface',
  'surfaceAlt',
  'inset',
  'border',
  'borderHi',
  'ink',
  'inkDim',
  'inkFaint',
  'teal',
  'blue',
  'purple',
  'amber',
  'red',
  'green',
  'mint',
  'shadow',
  'grid',
] as const;

export type PaintRole = (typeof PAINT_ROLES)[number];

export type TelemetryPaletteMap = Record<PaintRole, string>;

export const DARK_PALETTE: TelemetryPaletteMap = { ...TELEMETRY_DARK };

export const LIGHT_PALETTE: TelemetryPaletteMap = { ...TELEMETRY_LIGHT };

export function paletteFor(theme: SvgTheme): TelemetryPaletteMap {
  return theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
}

export type Paint = PaintRole | { color: string } | { class: string };

function isRole(paint: Paint): paint is PaintRole {
  return typeof paint === 'string';
}

function isClassPaint(paint: Paint): paint is { class: string } {
  return typeof paint === 'object' && 'class' in paint;
}

/** Dark heatmap ramp; level 0 (no activity) is `surfaceAlt`. */
const DARK_HEAT = ['#0e4f3b', '#0d7a59', '#0ea879', '#10b981'];

/** Light heatmap ramp on white/alabaster surfaces. */
const LIGHT_HEAT = ['#bbf7d0', '#6ee7b7', '#10b981', '#059669'];

/**
 * Embedded SVG `<style>` defining typography classes (`.ti-sans`, `.ti-mono`)
 * plus optional `prefers-color-scheme: light` rules when `theme === 'auto'`.
 */
export function svgStyleBlock(theme: SvgTheme): string {
  const baseFontCss =
    `.ti-sans{font-family:${TELEMETRY_FONT_SANS}}` +
    `.ti-mono{font-family:${TELEMETRY_FONT_MONO};font-variant-numeric:tabular-nums}`;

  if (theme !== 'auto') {
    return `<style>${baseFontCss}</style>`;
  }

  const fillRules: string[] = [];
  const strokeRules: string[] = [];
  const lightFill: string[] = [];
  const lightStroke: string[] = [];
  for (const role of PAINT_ROLES) {
    fillRules.push(`.ti-f-${role}{fill:${DARK_PALETTE[role]}}`);
    strokeRules.push(`.ti-s-${role}{stroke:${DARK_PALETTE[role]}}`);
    lightFill.push(`.ti-f-${role}{fill:${LIGHT_PALETTE[role]}}`);
    lightStroke.push(`.ti-s-${role}{stroke:${LIGHT_PALETTE[role]}}`);
  }
  const modelRules: string[] = [];
  const modelLightRules: string[] = [];
  for (let index = 0; index < MODEL_COLORS.length; index += 1) {
    modelRules.push(`.ti-f-model${index}{fill:${MODEL_COLORS[index]}}`);
    modelLightRules.push(`.ti-f-model${index}{fill:${MODEL_COLORS_LIGHT[index]}}`);
  }
  const heatRules: string[] = [];
  const heatLightRules: string[] = [];
  for (let level = 1; level <= 4; level += 1) {
    heatRules.push(`.ti-f-heat${level}{fill:${DARK_HEAT[level - 1]}}`);
    heatLightRules.push(`.ti-f-heat${level}{fill:${LIGHT_HEAT[level - 1]}}`);
  }
  return (
    `<style>${baseFontCss}${fillRules.join('')}${strokeRules.join('')}${modelRules.join('')}${heatRules.join('')}` +
    `.ti-accent-ink{fill:#04130d}` +
    `@media (prefers-color-scheme: light){${lightFill.join('')}${lightStroke.join('')}` +
    `${modelLightRules.join('')}${heatLightRules.join('')}` +
    `.ti-accent-ink{fill:#ffffff}}</style>`
  );
}

/** `fill` attribute for a paint role (class-based for the `auto` theme). */
export function paintFill(theme: SvgTheme, paint: Paint): string {
  if (isClassPaint(paint)) return `class="${paint.class}"`;
  if (!isRole(paint)) return `fill="${paint.color}"`;
  if (theme === 'auto') return `class="ti-f-${paint}"`;
  return `fill="${paletteFor(theme)[paint]}"`;
}

/** `stroke` attribute for a paint role (class-based for the `auto` theme). */
export function paintStroke(theme: SvgTheme, paint: Paint): string {
  if (isClassPaint(paint)) return `class="${paint.class}"`;
  if (!isRole(paint)) return `stroke="${paint.color}"`;
  if (theme === 'auto') return `class="ti-s-${paint}"`;
  return `stroke="${paletteFor(theme)[paint]}"`;
}

/** Resolved hex for a paint (dark value for `auto`; used in calculations). */
export function paintColor(theme: SvgTheme, paint: Paint): string {
  if (typeof paint === 'string') return paletteFor(theme)[paint];
  if ('color' in paint) return paint.color;
  return theme === 'light' ? '#ffffff' : '#090b0e';
}

export function accentInkPaint(theme: SvgTheme): Paint {
  if (theme === 'light') return { color: '#ffffff' };
  if (theme === 'auto') return { class: 'ti-accent-ink' };
  return { color: '#04130d' };
}

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

function channel(hex: string, index: number): number {
  const value = Number.parseInt(hex.slice(index, index + 2), 16);
  const normalized = value / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const normalized = hex.trim();
  const expanded =
    normalized.length === 4
      ? `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
      : normalized;
  if (!/^#[0-9a-f]{6}$/i.test(expanded)) return 0.5;
  return 0.2126 * channel(expanded, 1) + 0.7152 * channel(expanded, 3) + 0.0722 * channel(expanded, 5);
}

export function contrastInk(background: string): string {
  return relativeLuminance(background) > 0.24 ? '#090b0e' : '#ffffff';
}

// ---------------------------------------------------------------------------
// Crisp Vector SVG Typography
// ---------------------------------------------------------------------------

export interface SvgTextOptions {
  x: number;
  /** Baseline Y coordinate in px. */
  y: number;
  size?: number;
  weight?: 400 | 500 | 600 | 700;
  mono?: boolean;
  paint?: Paint;
  align?: 'left' | 'center' | 'right';
  letterSpacing?: number;
}

/** Renders a crisp `<text>` element themed via palette roles or auto classes. */
export function svgText(text: string, options: SvgTextOptions, theme: SvgTheme): string {
  if (!text) return '';
  const paint = options.paint ?? 'ink';
  const role = typeof paint === 'string' ? paint : undefined;
  const classPaint = typeof paint === 'object' && 'class' in paint ? paint.class : undefined;
  const colorPaint = typeof paint === 'object' && 'color' in paint ? paint.color : undefined;
  return telemetryTextSvg(text, {
    x: options.x,
    y: options.y,
    fontSize: options.size ?? 12,
    fontWeight: options.weight ?? 500,
    mono: options.mono ?? false,
    align: options.align,
    letterSpacing: options.letterSpacing,
    className: role && theme === 'auto' ? `ti-f-${role}` : classPaint,
    fill: role ? (theme === 'auto' ? undefined : paletteFor(theme)[role]) : colorPaint,
  });
}

export function measureText(
  text: string,
  size = 12,
  options: { mono?: boolean; letterSpacing?: number } = {},
): number {
  return measureTelemetryText(text, size, options);
}

export function fitSvgText(
  text: string,
  maxWidth: number,
  size = 12,
  options: { mono?: boolean; letterSpacing?: number; minChars?: number } = {},
): string {
  return truncateTelemetryText(text, maxWidth, size, options);
}

// ---------------------------------------------------------------------------
// Categorical chart paints (model series + heatmap levels)
// ---------------------------------------------------------------------------

export function modelPaint(theme: SvgTheme, index: number): Paint {
  if (theme === 'auto') return { class: `ti-f-model${index % MODEL_COLORS.length}` };
  const colors = theme === 'light' ? MODEL_COLORS_LIGHT : MODEL_COLORS;
  return { color: colors[index % colors.length] ?? colors[0]! };
}

export function heatPaintByRatio(theme: SvgTheme, ratio: number): Paint {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'surfaceAlt';
  const level = ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
  if (theme === 'auto') return { class: `ti-f-heat${level}` };
  const ramp = theme === 'light' ? LIGHT_HEAT : DARK_HEAT;
  return { color: ramp[level - 1] ?? (theme === 'light' ? '#059669' : '#10b981') };
}

// ---------------------------------------------------------------------------
// Numbers, dates, relative time
// ---------------------------------------------------------------------------

export function tokensLabel(value: number): string {
  return formatTokens(value);
}

export function tokensFullLabel(value: number): string {
  return formatTokensFull(value);
}

export function costLabel(value: number | null | undefined): string {
  return formatCost(value ?? 0, { approx: true });
}

export function percentLabel(ratio: number): string {
  return formatPercent(ratio);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function dateParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  return {
    year: Number.isFinite(year) ? (year as number) : 1970,
    month: Number.isFinite(month) ? (month as number) : 1,
    day: Number.isFinite(day) ? (day as number) : 1,
  };
}

/** `2026-11-04` -> `Nov 4` */
export function shortDate(date: string): string {
  const { month, day } = dateParts(date);
  return `${MONTHS[(month - 1) % 12] ?? 'Jan'} ${day}`;
}

/** `2026-11-04` -> `November 4, 2026` */
export function longDate(date: string): string {
  const { year, month, day } = dateParts(date);
  return `${MONTHS_LONG[(month - 1) % 12] ?? 'January'} ${day}, ${year}`;
}

/** `2026-11-04` -> `Nov` */
export function monthShort(date: string): string {
  const { month } = dateParts(date);
  return MONTHS[(month - 1) % 12] ?? 'Jan';
}

/** UTC weekday of a `YYYY-MM-DD` key, 0 = Sunday. */
export function weekdayIndex(date: string): number {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Epoch ms -> `Nov 4, 2026 · 14:02` */
export function dateTimeLabel(ts: number): string {
  const date = new Date(ts);
  const month = MONTHS[date.getMonth()] ?? 'Jan';
  return `${month} ${date.getDate()}, ${date.getFullYear()} · ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

/** Epoch ms -> `Nov 4, 2026` */
export function dateLabel(ts: number): string {
  const date = new Date(ts);
  return `${MONTHS[date.getMonth()] ?? 'Jan'} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Human relative time: `just now`, `3m ago`, `2h ago`, `4d ago`. */
export function relativeTime(ts: number | null | undefined, now: number): string {
  if (!ts) return 'never';
  const delta = Math.max(0, now - ts);
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  if (delta < 7 * 86_400_000) return `${Math.round(delta / 86_400_000)}d ago`;
  return `${Math.round(delta / (7 * 86_400_000))}w ago`;
}

// ---------------------------------------------------------------------------
// Chart / geometry helpers
// ---------------------------------------------------------------------------

export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const fraction = value / base;
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (fraction <= step) return step * base;
  }
  return 10 * base;
}

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function parseIntParam(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
