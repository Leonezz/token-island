/**
 * Shared primitives for the hand-written SVG renderers (no libraries).
 *
 * Text is never measured with a DOM: widths come from a deliberately generous
 * Verdana-ish character table so GitHub's SVG renderer (Segoe UI / system
 * fonts) can never clip a label.  Everything is escaped for safe XML.
 */

import { formatCost, formatPercent, formatTokens } from '@token-island/core';

export type SvgTheme = 'dark' | 'light' | 'auto';

export function parseSvgTheme(value: unknown): SvgTheme {
  return value === 'light' || value === 'auto' ? value : 'dark';
}

/** Contract font stack: flat, no external fonts. */
export const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Ubuntu,'Helvetica Neue',sans-serif";

export interface Palette {
  background: string;
  panel: string;
  panelAlt: string;
  border: string;
  grid: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  accent2: string;
  token: string;
  cost: string;
  streak: string;
  blue: string;
  green: string;
  amber: string;
}

export const DARK_PALETTE: Palette = {
  background: '#0D1117',
  panel: '#161B22',
  panelAlt: '#1C2430',
  border: '#30363D',
  grid: '#21262D',
  text: '#E6EDF3',
  muted: '#8B949E',
  faint: '#6E7681',
  accent: '#5EEAD4',
  accent2: '#A78BFA',
  token: '#5EEAD4',
  cost: '#A78BFA',
  streak: '#FBBF24',
  blue: '#60A5FA',
  green: '#34D399',
  amber: '#FBBF24',
};

export const LIGHT_PALETTE: Palette = {
  background: '#FFFFFF',
  panel: '#F6F8FA',
  panelAlt: '#EAEEF2',
  border: '#D0D7DE',
  grid: '#E7ECF1',
  text: '#1F2328',
  muted: '#57606A',
  faint: '#6E7781',
  accent: '#0D9488',
  accent2: '#7C3AED',
  token: '#0F766E',
  cost: '#6D28D9',
  streak: '#B45309',
  blue: '#1D4ED8',
  green: '#059669',
  amber: '#B45309',
};

export function paletteFor(theme: SvgTheme): Palette {
  return theme === 'light' ? LIGHT_PALETTE : DARK_PALETTE;
}

export function isAutoTheme(theme: SvgTheme): boolean {
  return theme === 'auto';
}

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&apos;';
    }
  });
}

/** Wraps a fully rendered SVG document. */
export function svgDocument(attributes: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`;
}

/** Human readable relative time, e.g. "just now" / "3h ago" / "2d ago". */
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
// Text measurement
// ---------------------------------------------------------------------------

/**
 * Per-character advance widths in px for an 11px Verdana-ish font.  The table is
 * intentionally ~6% wider than the real font stack so text never clips.
 */
const CHAR_WIDTHS: Record<string, number> = {
  ' ': 3.6,
  '!': 4.0,
  '"': 5.0,
  '#': 7.4,
  $: 6.6,
  '%': 10.4,
  '&': 8.8,
  "'": 2.9,
  '(': 4.6,
  ')': 4.6,
  '*': 5.6,
  '+': 7.2,
  ',': 3.4,
  '-': 4.6,
  '.': 3.4,
  '/': 5.2,
  '0': 6.6,
  '1': 6.6,
  '2': 6.6,
  '3': 6.6,
  '4': 6.6,
  '5': 6.6,
  '6': 6.6,
  '7': 6.6,
  '8': 6.6,
  '9': 6.6,
  ':': 4.0,
  ';': 4.0,
  '<': 7.2,
  '=': 7.2,
  '>': 7.2,
  '?': 5.8,
  '@': 11.0,
  A: 7.8,
  B: 7.2,
  C: 7.6,
  D: 8.0,
  E: 6.6,
  F: 6.4,
  G: 8.4,
  H: 8.2,
  I: 4.6,
  J: 5.4,
  K: 7.4,
  L: 6.2,
  M: 10.2,
  N: 8.4,
  O: 8.6,
  P: 7.0,
  Q: 8.6,
  R: 7.4,
  S: 6.6,
  T: 6.6,
  U: 8.2,
  V: 7.6,
  W: 11.4,
  X: 7.4,
  Y: 7.2,
  Z: 6.8,
  '[': 4.6,
  '\\': 5.2,
  ']': 4.6,
  '^': 7.2,
  _: 6.6,
  '`': 4.2,
  a: 6.4,
  b: 6.8,
  c: 5.8,
  d: 6.8,
  e: 6.2,
  f: 4.2,
  g: 6.8,
  h: 6.8,
  i: 3.4,
  j: 3.4,
  k: 6.4,
  l: 3.4,
  m: 9.8,
  n: 6.8,
  o: 6.6,
  p: 6.8,
  q: 6.8,
  r: 4.6,
  s: 5.6,
  t: 4.4,
  u: 6.8,
  v: 6.2,
  w: 9.0,
  x: 6.0,
  y: 6.2,
  z: 5.6,
  '{': 4.8,
  '|': 3.8,
  '}': 4.8,
  '~': 7.2,
  '·': 4.6,
  '—': 10.0,
  '–': 10.0,
  '…': 10.0,
  '∞': 9.0,
  '≥': 7.2,
};

export function textWidth(text: string, fontSize = 11, bold = false): number {
  let units = 0;
  for (const char of text) {
    const known = CHAR_WIDTHS[char];
    if (known !== undefined) {
      units += known;
    } else {
      const code = char.codePointAt(0) ?? 0;
      units += code > 0x2e80 ? 13.5 : 8.4;
    }
  }
  const weight = bold ? 1.05 : 1;
  return Math.ceil(units * (fontSize / 11) * weight);
}

/** Truncates with an ellipsis until the string fits into `maxWidth` px. */
export function fitText(text: string, maxWidth: number, fontSize = 11, bold = false): string {
  if (textWidth(text, fontSize, bold) <= maxWidth) return text;
  if (maxWidth <= 0) return '';
  const chars = [...text];
  while (chars.length > 0) {
    chars.pop();
    const candidate = `${chars.join('')}…`;
    if (textWidth(candidate, fontSize, bold) <= maxWidth) return candidate;
  }
  return '';
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

/** Picks a text colour with >= 4.5:1 contrast against `background`. */
export function contrastText(background: string): string {
  return relativeLuminance(background) > 0.19 ? '#0B1220' : '#FFFFFF';
}

// ---------------------------------------------------------------------------
// Dates & numbers
// ---------------------------------------------------------------------------

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
  const name = MONTHS[(month - 1) % 12] ?? 'Jan';
  return `${name} ${day}`;
}

/** `2026-11-04` -> `Nov` */
export function monthShort(date: string): string {
  const { month } = dateParts(date);
  return MONTHS[(month - 1) % 12] ?? 'Jan';
}

/** `2026-11-04` -> `November 4, 2026` */
export function longDate(date: string): string {
  const { year, month, day } = dateParts(date);
  const name = MONTHS_LONG[(month - 1) % 12] ?? 'January';
  return `${name} ${day}, ${year}`;
}

/** `2026-11-04` -> `2026-11-04` safe for display */
export function isoDate(date: string): string {
  return date;
}

/** Epoch ms -> `Nov 4, 2026 · 14:02` (server-local time). */
export function dateTimeLabel(ts: number): string {
  const date = new Date(ts);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()} · ${String(
    date.getHours(),
  ).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Epoch ms -> `Nov 4, 2026` (server-local time). */
export function dateLabel(ts: number): string {
  const date = new Date(ts);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** UTC weekday of a `YYYY-MM-DD` key, 0 = Sunday. */
export function weekdayIndex(date: string): number {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

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

/** Compact token label used by badges / axis ticks. */
export function tokensLabel(value: number): string {
  return formatTokens(value);
}

/** `~$12.34` cost label. */
export function costLabel(value: number | null | undefined): string {
  return formatCost(value ?? 0, { approx: true });
}

export function percentLabel(ratio: number): string {
  return formatPercent(ratio);
}

/** "1 day" / "3 days" */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
