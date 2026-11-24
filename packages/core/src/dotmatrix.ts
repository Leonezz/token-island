/**
 * Dot-matrix accents for Token Island (V3).
 *
 * Design rule: **readable text stays crisp bitmap/Silkscreen; dot-matrix is
 * used only for data marks** — hero figures, charts, sparklines, progress
 * strips and status LEDs.  Dots never replace labels, body copy, tables or
 * model names, and they never carry small type.
 *
 * Every helper emits SVG circles on an integer grid, with optional subtle
 * glow (halo rings, no filters) so GitHub-safe SVGs stay self-contained.
 */

import { PIXEL, PIXEL_GLYPHS, sanitizePixelText } from './pixel.js';

export interface DotTextOptions {
  x: number;
  /** Top of capital letters. */
  y: number;
  /** Dot pitch in px (distance between dot centres). */
  pitch: number;
  /** Dots per font pixel (1 = fine, 2 = chunky). */
  scale?: number;
  color?: string;
  /** CSS class instead of fill color. */
  className?: string;
  opacity?: number;
  /** Extra px between glyphs. */
  letterSpacing?: number;
}

export type Dot = readonly [number, number];

/** Lays a string out as dots using the Silkscreen glyph bitmaps. */
export function dotTextDots(text: string, options: DotTextOptions): Dot[] {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const pitch = Math.max(1, Math.round(options.pitch));
  const spacing = Math.round(options.letterSpacing ?? 0);
  const clean = sanitizePixelText(text);
  const dots: Dot[] = [];
  let pen = Math.round(options.x);
  for (const char of clean) {
    const glyph = PIXEL_GLYPHS[char] ?? PIXEL_GLYPHS[' ']!;
    glyph.rows.forEach((row, rowIndex) => {
      for (let col = 0; col < row.length; col += 1) {
        if (row[col] !== '#') continue;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            const cx = pen + (col * scale + sx) * pitch + pitch / 2;
            const cy =
              Math.round(options.y) +
              (5 + glyph.top + rowIndex) * scale * pitch +
              sy * pitch +
              pitch / 2;
            dots.push([cx, cy]);
          }
        }
      }
    });
    pen += glyph.advance * scale * pitch + spacing;
  }
  return dots;
}

export function dotTextWidth(text: string, options: Omit<DotTextOptions, 'x' | 'y'>): number {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const pitch = Math.max(1, Math.round(options.pitch));
  const spacing = Math.round(options.letterSpacing ?? 0);
  let width = 0;
  for (const char of sanitizePixelText(text)) {
    width += (PIXEL_GLYPHS[char] ?? PIXEL_GLYPHS[' ']!).advance * scale * pitch + spacing;
  }
  return Math.max(0, width - spacing);
}

/** Height of one dot-text line (cap top to baseline row) in px. */
export function dotTextHeight(options: Omit<DotTextOptions, 'x' | 'y' | 'color'>): number {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  return 6 * scale * Math.max(1, Math.round(options.pitch));
}

export interface DotRenderStyle {
  /** dot radius in px */
  radius: number;
  color?: string;
  className?: string;
  opacity?: number;
  /** Optional halo: [radius, opacity] rings drawn behind the dot. */
  halo?: readonly (readonly [number, number])[];
}

function circles(dots: readonly Dot[], style: DotRenderStyle): string {
  const radius = Math.max(0.4, style.radius);
  const paint = style.className ? ` class="${style.className}"` : ` fill="${style.color ?? PIXEL.ink}"`;
  const opacity = style.opacity !== undefined ? ` opacity="${style.opacity}"` : '';
  const body = dots
    .map(([cx, cy]) => `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}"/>`)
    .join('');
  const halos = (style.halo ?? [])
    .map(([haloRadius, haloOpacity]) => {
      const haloBody = dots
        .map(([cx, cy]) => `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${haloRadius.toFixed(2)}"/>`)
        .join('');
      return `<g${paint} opacity="${haloOpacity}">${haloBody}</g>`;
    })
    .join('');
  return `<g${paint}${opacity}>${halos}${body}</g>`;
}

/** Dot-rendered text (figures / short labels only — never body copy). */
export function dotTextSvg(text: string, options: DotTextOptions & Partial<DotRenderStyle>): string {
  const dots = dotTextDots(text, options);
  if (dots.length === 0) return '';
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  return circles(dots, {
    radius: options.radius ?? Math.max(0.7, options.pitch * 0.42 * scale),
    color: options.color,
    className: options.className,
    opacity: options.opacity,
    halo: options.halo,
  });
}

/** Dot-rendered hero figure with a soft LED halo. */
export function dotFigureSvg(text: string, options: DotTextOptions & { halo?: boolean }): string {
  const dots = dotTextDots(text, options);
  const pitch = Math.max(1, Math.round(options.pitch));
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const radius = Math.max(1, pitch * 0.4 * scale);
  const halo = options.halo === false ? [] : ([[radius * 2.6, 0.1], [radius * 1.7, 0.18]] as const);
  return circles(dots, {
    radius,
    color: options.color ?? PIXEL.ink,
    opacity: options.opacity,
    halo,
  });
}

export interface DotColumnsOptions {
  x: number;
  y: number;
  width: number;
  /** Height available for the tallest column. */
  height: number;
  values: readonly number[];
  pitch: number;
  color: string;
  /** Color for the last column (today), if any. */
  highlightColor?: string;
  /** Dots per column width. Default 2. */
  dotsPerColumn?: number;
  /** Draw faint unlit dots behind each column (matrix feel). Default true. */
  track?: boolean;
  trackColor?: string;
  trackOpacity?: number;
  radius?: number;
}

/**
 * Dot-matrix column chart.  Each column is built from square-ish dot clusters;
 * today's column can be highlighted.  Returns `{ svg, maxDots }`.
 */
export function dotColumnsSvg(options: DotColumnsOptions): string {
  const pitch = Math.max(2, Math.round(options.pitch));
  const radius = options.radius ?? Math.max(0.8, pitch * 0.36);
  const dotsPerColumn = Math.max(1, Math.round(options.dotsPerColumn ?? 2));
  const columns = options.values.length;
  if (columns === 0) return '';
  const maxValue = Math.max(...options.values, 1);
  const rows = Math.max(1, Math.floor(options.height / pitch));
  const colGap = options.width / columns;
  const trackDots: Dot[] = [];
  const parts: string[] = [];

  if (options.track !== false) {
    for (let c = 0; c < columns; c += 1) {
      const cx = options.x + c * colGap + colGap / 2;
      for (let r = 0; r < rows; r += 1) {
        for (let w = 0; w < dotsPerColumn; w += 1) {
          trackDots.push([cx + w * pitch, options.y + options.height - r * pitch - pitch / 2]);
        }
      }
    }
    parts.push(
      `<g fill="${options.trackColor ?? PIXEL.border}" opacity="${options.trackOpacity ?? 0.35}">` +
        trackDots.map(([cx, cy]) => `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(radius * 0.55).toFixed(2)}"/>`).join('') +
        `</g>`,
    );
  }

  options.values.forEach((value, index) => {
    const lit = Math.max(1, Math.round((value / maxValue) * rows));
    const cx = options.x + index * colGap + colGap / 2;
    const isToday = index === columns - 1 && options.highlightColor !== undefined;
    const color = isToday ? (options.highlightColor as string) : options.color;
    const dots: Dot[] = [];
    for (let r = 0; r < lit; r += 1) {
      for (let w = 0; w < dotsPerColumn; w += 1) {
        dots.push([cx + w * pitch, options.y + options.height - r * pitch - pitch / 2]);
      }
    }
    parts.push(circles(dots, isToday ? { radius: radius * 1.12, color } : { radius, color }));
  });

  return parts.join('');
}

/** Dots for a tiny sparkline (collapsed widget). */
export function dotSparklineSvg(options: {
  x: number;
  y: number;
  width: number;
  height: number;
  values: readonly number[];
  pitch: number;
  color: string;
  highlightColor?: string;
  radius?: number;
}): string {
  const cols = options.values.length;
  if (cols === 0) return '';
  const pitch = Math.max(2, Math.round(options.pitch));
  const radius = options.radius ?? Math.max(0.6, pitch * 0.34);
  const maxValue = Math.max(...options.values, 1);
  const rows = Math.max(1, Math.floor(options.height / pitch));
  const colGap = options.width / cols;
  const parts: string[] = [];
  options.values.forEach((value, index) => {
    const lit = Math.max(1, Math.round((value / maxValue) * rows));
    const cx = options.x + index * colGap + colGap / 2;
    const isToday = index === cols - 1 && options.highlightColor !== undefined;
    const dots: Dot[] = [];
    for (let r = 0; r < lit; r += 1) dots.push([cx, options.y + options.height - r * pitch - pitch / 2]);
    parts.push(circles(dots, { radius, color: isToday ? (options.highlightColor as string) : options.color }));
  });
  return parts.join('');
}

/** Progress / ratio strip built from discrete dots (IN / CACHE / OUT splits). */
export function dotRatioStripSvg(options: {
  x: number;
  y: number;
  width: number;
  ratio: number;
  pitch: number;
  color: string;
  trackColor?: string;
  radius?: number;
}): string {
  const pitch = Math.max(2, Math.round(options.pitch));
  const count = Math.max(1, Math.floor(options.width / pitch));
  const filled = Math.max(0, Math.min(count, Math.round(options.ratio * count)));
  const radius = options.radius ?? Math.max(0.7, pitch * 0.34);
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const cx = options.x + i * pitch + pitch / 2;
    const color = i < filled ? options.color : (options.trackColor ?? PIXEL.border);
    const opacity = i < filled ? 1 : 0.45;
    parts.push(
      `<circle cx="${cx.toFixed(2)}" cy="${options.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${color}" opacity="${opacity}"/>`,
    );
  }
  return parts.join('');
}

/** Status LED: one round dot with optional halo rings (never on text). */
export function dotLedSvg(options: {
  x: number;
  y: number;
  radius: number;
  color: string;
  halo?: boolean;
  haloOpacity?: number;
}): string {
  const halo = options.halo === false ? '' : 
    `<circle cx="${options.x}" cy="${options.y}" r="${(options.radius * 2.4).toFixed(2)}" fill="${options.color}" opacity="${options.haloOpacity ?? 0.1}"/>` +
    `<circle cx="${options.x}" cy="${options.y}" r="${(options.radius * 1.6).toFixed(2)}" fill="${options.color}" opacity="${(options.haloOpacity ?? 0.1) * 1.6}"/>`;
  return halo + `<circle cx="${options.x}" cy="${options.y}" r="${options.radius}" fill="${options.color}"/>`;
}

/** Faint dot-matrix texture for badge/panel backgrounds (subtle, never on text). */
export function dotTextureSvg(options: {
  x: number;
  y: number;
  width: number;
  height: number;
  pitch: number;
  color: string;
  opacity?: number;
  radius?: number;
}): string {
  const pitch = Math.max(2, Math.round(options.pitch));
  const radius = options.radius ?? Math.max(0.4, pitch * 0.16);
  const dots: string[] = [];
  for (let cy = options.y + pitch / 2; cy < options.y + options.height; cy += pitch) {
    for (let cx = options.x + pitch / 2; cx < options.x + options.width; cx += pitch) {
      dots.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius.toFixed(2)}"/>`);
    }
  }
  if (dots.length === 0) return '';
  return `<g fill="${options.color}" opacity="${options.opacity ?? 0.12}">${dots.join('')}</g>`;
}
