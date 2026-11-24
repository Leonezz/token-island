/**
 * Token Island Precision Telemetry design system (v4).
 *
 * Replaces low-contrast 8pt bitmap/pixel text and purple-on-dark surfaces with:
 *  - High-contrast neutral carbon (dark) and crisp alabaster (light) palettes
 *    meeting WCAG AA/AAA contrast ratios (>= 4.5:1 for tertiary labels, >= 7:1
 *    for secondary labels, >= 15:1 for primary values).
 *  - Crisp system sans-serif for labels/prose and tabular monospace for numbers,
 *    model identifiers, costs and code — zero runtime or external font dependencies.
 *  - Deterministic character-advance width estimation so server-rendered SVGs
 *    (Cloudflare Workers + Node) compute clean layouts without a DOM.
 */

import { escapeXml } from './pixel.js';

export const TELEMETRY_FONT_SANS =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Segoe UI', system-ui, sans-serif";

export const TELEMETRY_FONT_MONO =
  "'SF Mono', ui-monospace, Menlo, Monaco, 'Cascadia Mono', 'Segoe UI Mono', Consolas, monospace";

export interface TelemetryPalette {
  bg: string;
  bgRaised: string;
  surface: string;
  surfaceAlt: string;
  inset: string;
  border: string;
  borderHi: string;
  ink: string;
  inkDim: string;
  inkFaint: string;
  teal: string;
  blue: string;
  purple: string;
  amber: string;
  red: string;
  green: string;
  mint: string;
  shadow: string;
  grid: string;
}

/**
 * Dark Precision Telemetry palette.
 * Neutral carbon surfaces + emerald, sky and warm amber accents (no purple on dark).
 * Note: the legacy `purple` key is intentionally mapped to warm amber (`#f59e0b`)
 * for backwards compatibility with callers while eliminating low-contrast violet.
 */
export const TELEMETRY_DARK: TelemetryPalette = {
  bg: '#090b0e',
  bgRaised: '#0d1015',
  surface: '#13171f',
  surfaceAlt: '#191e28',
  inset: '#0a0d12',
  border: '#252c3a',
  borderHi: '#343e52',
  ink: '#f3f5f8',
  inkDim: '#9ba4b5',
  inkFaint: '#7e889b',
  teal: '#10b981',
  blue: '#38bdf8',
  purple: '#f59e0b',
  amber: '#f59e0b',
  red: '#f43f5e',
  green: '#34d399',
  mint: '#6ee7b7',
  shadow: '#040608',
  grid: '#1e2532',
};

/**
 * Light Precision Telemetry palette.
 * Crisp alabaster surfaces with deepened emerald, cobalt and amber accents
 * maintaining >= 4.5:1 contrast on white.
 */
export const TELEMETRY_LIGHT: TelemetryPalette = {
  bg: '#f3f5f8',
  bgRaised: '#eef2f6',
  surface: '#ffffff',
  surfaceAlt: '#f1f5f9',
  inset: '#e8eef5',
  border: '#dde3ec',
  borderHi: '#cbd5e1',
  ink: '#0f172a',
  inkDim: '#475569',
  inkFaint: '#64748b',
  teal: '#047857',
  blue: '#0369a1',
  purple: '#b45309',
  amber: '#b45309',
  red: '#be123c',
  green: '#15803d',
  mint: '#0f766e',
  shadow: '#cbd5e1',
  grid: '#e2e8f0',
};

/** Categorical series for dark charts & model breakdowns (emerald, sky, amber, rose, mint, cyan, lime, slate). */
export const TELEMETRY_SERIES: readonly string[] = [
  '#10b981',
  '#38bdf8',
  '#f59e0b',
  '#fb7185',
  '#34d399',
  '#22d3ee',
  '#a3e635',
  '#94a3b8',
];

/** Categorical series for light charts & model breakdowns. */
export const TELEMETRY_SERIES_LIGHT: readonly string[] = [
  '#059669',
  '#0284c7',
  '#d97706',
  '#e11d48',
  '#0d9488',
  '#0891b2',
  '#65a30d',
  '#64748b',
];

/**
 * Deterministic width estimator (in SVG px) for system sans and monospace strings.
 * Avoids any DOM/canvas measurement so Node and Cloudflare Workers produce identical geometry.
 */
export function measureTelemetryText(
  text: string,
  fontSize: number,
  options: { mono?: boolean; letterSpacing?: number } = {},
): number {
  if (!text) return 0;
  const mono = options.mono ?? false;
  const letterSpacing = options.letterSpacing ?? 0;
  let units = 0;
  for (const ch of text) {
    if (mono) {
      units += ch.charCodeAt(0) > 0x7f ? 1.0 : 0.61;
      continue;
    }
    if ('ilI1|.,:;\'!` '.includes(ch)) units += 0.32;
    else if ('MW@#%&QODG'.includes(ch)) units += 0.76;
    else if (ch >= 'A' && ch <= 'Z') units += 0.66;
    else if (ch >= '0' && ch <= '9') units += 0.58;
    else if ('mw+-=~<>'.includes(ch)) units += 0.68;
    else if (ch.charCodeAt(0) > 0x7f) units += 0.95;
    else units += 0.54;
  }
  const spacingTotal = Math.max(0, [...text].length - 1) * letterSpacing;
  return Math.ceil(units * fontSize + spacingTotal);
}

/**
 * Truncates `text` with `…` (or `..` in ASCII-strict mode) so its estimated
 * pixel width stays within `maxWidth`.
 */
export function truncateTelemetryText(
  text: string,
  maxWidth: number,
  fontSize: number,
  options: { mono?: boolean; letterSpacing?: number; minChars?: number } = {},
): string {
  if (measureTelemetryText(text, fontSize, options) <= maxWidth) return text;
  const chars = [...text];
  const minChars = Math.max(1, options.minChars ?? 3);
  while (chars.length > minChars) {
    chars.pop();
    const candidate = `${chars.join('')}…`;
    if (measureTelemetryText(candidate, fontSize, options) <= maxWidth) return candidate;
  }
  return chars.join('');
}

export interface TelemetrySvgTextOptions {
  x: number;
  /** Baseline Y coordinate in SVG user units. */
  y: number;
  fontSize?: number;
  fontWeight?: 400 | 500 | 600 | 700;
  mono?: boolean;
  align?: 'left' | 'center' | 'right';
  fill?: string;
  className?: string;
  letterSpacing?: number;
}

/**
 * Emits a clean, self-contained `<text>` element using system sans or tabular
 * monospace stacks (100% compatible with GitHub's SVG image proxy CSP).
 */
export function telemetryTextSvg(text: string, options: TelemetrySvgTextOptions): string {
  if (!text) return '';
  const x = Math.round(options.x * 10) / 10;
  const y = Math.round(options.y * 10) / 10;
  const size = options.fontSize ?? 12;
  const weight = options.fontWeight ?? 500;
  const anchor =
    options.align === 'center' ? ' text-anchor="middle"' : options.align === 'right' ? ' text-anchor="end"' : '';
  const familyClass = options.mono ? 'ti-mono' : 'ti-sans';
  const classes = options.className ? `${familyClass} ${options.className}` : familyClass;
  const fillAttr = options.fill ? ` fill="${escapeXml(options.fill)}"` : '';
  const spacingAttr =
    options.letterSpacing && options.letterSpacing !== 0 ? ` letter-spacing="${options.letterSpacing}"` : '';
  return (
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}"` +
    `${anchor}${spacingAttr} class="${classes}"${fillAttr}>${escapeXml(text)}</text>`
  );
}
