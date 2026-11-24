/**
 * Pixel theme tokens + typography helpers for every cloud SVG surface.
 *
 * One palette (`@token-island/core`), one bitmap font (`pixelTextSvg`), one set
 * of integer helpers.  Dark is the default; `light` uses lighter surfaces and
 * darker accents; `auto` renders the dark values and ships a
 * `prefers-color-scheme: light` stylesheet so README badges follow the reader's
 * system theme (the same trick as v1, now on classed pixel fills).
 */

import { MODEL_COLORS, MODEL_COLORS_LIGHT } from '../colors.js';
import {
  formatCost,
  formatPercent,
  formatTokens,
  formatTokensFull,
  PIXEL,
  pixelTextSvg,
  pixelTextWidth,
  sanitizePixelText,
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

export type PixelPalette = Record<PaintRole, string>;

export const DARK_PALETTE: PixelPalette = {
  bg: PIXEL.bg,
  bgRaised: PIXEL.bgRaised,
  surface: PIXEL.surface,
  surfaceAlt: PIXEL.surfaceAlt,
  inset: PIXEL.inset,
  border: PIXEL.border,
  borderHi: PIXEL.borderHi,
  ink: PIXEL.ink,
  inkDim: PIXEL.inkDim,
  inkFaint: PIXEL.inkFaint,
  teal: PIXEL.teal,
  blue: PIXEL.blue,
  purple: PIXEL.purple,
  amber: PIXEL.amber,
  red: PIXEL.red,
  green: PIXEL.green,
  mint: PIXEL.mint,
  shadow: '#05050c',
  grid: '#241f38',
};

/** Light theme: same accents, one step darker where `#f4f2ff` needs contrast. */
export const LIGHT_PALETTE: PixelPalette = {
  bg: '#f4f2ff',
  bgRaised: '#ece9f8',
  surface: '#ffffff',
  surfaceAlt: '#f0edfb',
  inset: '#e5e1f2',
  border: '#c9c3dc',
  borderHi: '#b9b3d0',
  ink: '#1b1928',
  inkDim: '#4b4560',
  inkFaint: '#6f6a86',
  teal: '#076b54',
  blue: '#2456c4',
  purple: '#6c40c8',
  amber: '#7a5200',
  red: '#ad3333',
  green: '#17864a',
  mint: '#0b7a61',
  shadow: '#c9c3dc',
  grid: '#ded9ef',
};

export function paletteFor(theme: SvgTheme): PixelPalette {
  return theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
}

/** A paint is a palette role (themeable), a raw hex colour or a CSS class. */
export type Paint = PaintRole | { color: string } | { class: string };

function isRole(paint: Paint): paint is PaintRole {
  return typeof paint === 'string';
}

function isClassPaint(paint: Paint): paint is { class: string } {
  return typeof paint === 'object' && 'class' in paint;
}

/**
 * CSS for the `auto` theme.  Dark values define the defaults on `.ti-f-*` /
 * `.ti-s-*` classes, and a media query swaps in the light palette.  Presentation
 * attributes lose against stylesheet rules, so this overrides the inline
 * fallback attr painted by `paintFill()`.
 */
export function autoThemeStyle(): string {
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
    `<style>${fillRules.join('')}${strokeRules.join('')}${modelRules.join('')}${heatRules.join('')}` +
    `.ti-accent-ink{fill:#0b0b12}` +
    `@media (prefers-color-scheme: light){${lightFill.join('')}${lightStroke.join('')}` +
    `${modelLightRules.join('')}${heatLightRules.join('')}` +
    `.ti-accent-ink{fill:#f4f2ff}}</style>`
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
  return theme === 'light' ? '#f4f2ff' : '#0b0b12';
}

/** Text colour for text sitting on an accent-filled block (>= 4.5:1). */
export function accentInkPaint(theme: SvgTheme): Paint {
  if (theme === 'light') return { color: '#f4f2ff' };
  if (theme === 'auto') return { class: 'ti-accent-ink' };
  return { color: '#0b0b12' };
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

/** Picks ink (`#0b0b12`) or paper (`#f4f2ff`) for >= 4.5:1 contrast on a fill. */
export function contrastInk(background: string): string {
  return relativeLuminance(background) > 0.22 ? '#0b0b12' : '#f4f2ff';
}

// ---------------------------------------------------------------------------
// Pixel typography
// ---------------------------------------------------------------------------

/** Pixel text is always uppercase and sanitised through the shared fallbacks. */
export function pixelTextClean(text: string): string {
  return sanitizePixelText(text.toUpperCase());
}

export interface PixelTextOptions {
  x: number;
  /** Top of the capital letters. */
  y: number;
  scale?: number;
  paint?: Paint;
  align?: 'left' | 'center' | 'right';
  letterSpacing?: number;
  /** Set to false for values that must keep their case (rare). */
  uppercase?: boolean;
}

/** One line of bitmap text, theme-aware. */
export function pixelText(text: string, options: PixelTextOptions, theme: SvgTheme): string {
  const clean = options.uppercase === false ? sanitizePixelText(text) : pixelTextClean(text);
  if (clean === '') return '';
  const paint = options.paint ?? 'ink';
  const role = typeof paint === 'string' ? paint : undefined;
  const classPaint = typeof paint === 'object' && 'class' in paint ? paint.class : undefined;
  const colorPaint = typeof paint === 'object' && 'color' in paint ? paint.color : undefined;
  return pixelTextSvg(clean, {
    x: options.x,
    y: options.y,
    scale: options.scale ?? 1,
    align: options.align,
    letterSpacing: options.letterSpacing,
    className: role && theme === 'auto' ? `ti-f-${role}` : classPaint,
    color: role ? (theme === 'auto' ? undefined : paletteFor(theme)[role]) : colorPaint,
  });
}

/** Width in device px of one line at `scale` (matches `pixelText`). */
export function textWidth(text: string, scale = 1, letterSpacing = 0): number {
  return pixelTextWidth(pixelTextClean(text), scale, letterSpacing);
}

/**
 * Truncates pixel text so it fits `maxWidth`; keeps at least `minChars`.
 * The bitmap font is monospace-ish, so a simple char loop is exact.
 */
export function fitText(text: string, maxWidth: number, scale = 1, minChars = 1): string {
  const clean = pixelTextClean(text);
  if (textWidth(clean, scale) <= maxWidth) return clean;
  const chars = [...clean];
  while (chars.length > minChars) {
    chars.pop();
    if (textWidth(chars.join(''), scale) <= maxWidth) return chars.join('');
  }
  return chars.join('');
}

// ---------------------------------------------------------------------------
// Categorical chart paints (model series + heatmap levels)
// ---------------------------------------------------------------------------

/** Dark heatmap ramp; level 0 (no activity) is `surfaceAlt`. */
const DARK_HEAT = ['#1f6f5b', '#239b7c', '#2bc79e', '#3be8b0'];

/** Light heatmap ramp, darker but still soft on `#f4f2ff`. */
const LIGHT_HEAT = ['#b7ead9', '#63cfa8', '#24a985', '#0b7a61'];

/** Paint for the i-th model series colour (teal / purple / blue / amber / ...). */
export function modelPaint(theme: SvgTheme, index: number): Paint {
  if (theme === 'auto') return { class: `ti-f-model${index % MODEL_COLORS.length}` };
  const colors = theme === 'light' ? MODEL_COLORS_LIGHT : MODEL_COLORS;
  return { color: colors[index % colors.length] ?? colors[0] };
}

/** Heatmap colour for a 0..1 intensity ratio, using the palette stops. */
export function heatPaintByRatio(theme: SvgTheme, ratio: number): Paint {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'surfaceAlt';
  const level = ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
  if (theme === 'auto') return { class: `ti-f-heat${level}` };
  const ramp = theme === 'light' ? LIGHT_HEAT : DARK_HEAT;
  return { color: ramp[level - 1] ?? (theme === 'light' ? '#0b7a61' : '#3be8b0') };
}

// ---------------------------------------------------------------------------
// Numbers, dates, relative time (always through @token-island/core format.ts)
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

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTHS_LONG = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];

function dateParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  return {
    year: Number.isFinite(year) ? (year as number) : 1970,
    month: Number.isFinite(month) ? (month as number) : 1,
    day: Number.isFinite(day) ? (day as number) : 1,
  };
}

/** `2026-11-04` -> `NOV 4` (pixel surfaces). */
export function shortDate(date: string): string {
  const { month, day } = dateParts(date);
  return `${MONTHS[(month - 1) % 12] ?? 'JAN'} ${day}`;
}

/** `2026-11-04` -> `NOVEMBER 4, 2026` (HTML can lower-case via CSS). */
export function longDate(date: string): string {
  const { year, month, day } = dateParts(date);
  return `${MONTHS_LONG[(month - 1) % 12] ?? 'JANUARY'} ${day}, ${year}`;
}

/** `2026-11-04` -> `NOV` */
export function monthShort(date: string): string {
  const { month } = dateParts(date);
  return MONTHS[(month - 1) % 12] ?? 'JAN';
}

/** UTC weekday of a `YYYY-MM-DD` key, 0 = Sunday. */
export function weekdayIndex(date: string): number {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Epoch ms -> `NOV 4, 2026 · 14:02` (server-local time). */
export function dateTimeLabel(ts: number): string {
  const date = new Date(ts);
  const month = MONTHS[date.getMonth()] ?? 'JAN';
  return `${month} ${date.getDate()}, ${date.getFullYear()} · ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

/** Epoch ms -> `NOV 4, 2026` (server-local time). */
export function dateLabel(ts: number): string {
  const date = new Date(ts);
  return `${MONTHS[date.getMonth()] ?? 'JAN'} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Human relative time, pixel-label friendly: `JUST NOW`, `3 MIN AGO`, `2D AGO`. */
export function relativeTime(ts: number | null | undefined, now: number): string {
  if (!ts) return 'NEVER';
  const delta = Math.max(0, now - ts);
  if (delta < 60_000) return 'JUST NOW';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)} MIN AGO`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}H AGO`;
  if (delta < 7 * 86_400_000) return `${Math.round(delta / 86_400_000)}D AGO`;
  return `${Math.round(delta / (7 * 86_400_000))}W AGO`;
}

// ---------------------------------------------------------------------------
// Chart / geometry helpers
// ---------------------------------------------------------------------------

/** Rounds an axis maximum up to a friendly value (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 * 10^n). */
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
