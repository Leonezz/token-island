/**
 * SVG frame + pixel panel primitives for every cloud surface.
 *
 * Self-contained documents only: no webfonts, no external references, no
 * curves.  The only CSS is the optional `prefers-color-scheme` block for the
 * `auto` theme.  Every coordinate is an integer design pixel.
 */

import { escapeXml, pixelRectPath, pixelSpriteSvg } from '@token-island/core';
import {
  autoThemeStyle,
  paintFill,
  paintStroke,
  paletteFor,
  pixelText,
  textWidth,
  type Paint,
  type SvgTheme,
} from './tokens.js';

export interface SvgFrameOptions {
  width: number;
  height: number;
  theme: SvgTheme;
  idPrefix: string;
  title: string;
  description: string;
  body: string;
  defs?: string;
  /** Page/panel background behind the body; defaults to the theme bg role. */
  background?: Paint | null;
}

/** Wraps a rendered body in a self-contained, accessible SVG document. */
export function svgFrame(options: SvgFrameOptions): string {
  const width = Math.round(options.width);
  const height = Math.round(options.height);
  const titleId = `${options.idPrefix}-title`;
  const descId = `${options.idPrefix}-desc`;
  const background =
    options.background === null
      ? ''
      : `<path d="${pixelRectPath(0, 0, width, height, 0)}" ${paintFill(options.theme, options.background ?? 'bg')}/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId} ${descId}">` +
    `<title id="${titleId}">${escapeXml(options.title)}</title>` +
    `<desc id="${descId}">${escapeXml(options.description)}</desc>` +
    (options.theme === 'auto' ? autoThemeStyle() : '') +
    (options.defs ? `<defs>${options.defs}</defs>` : '') +
    background +
    `<g shape-rendering="crispEdges">${options.body}</g>` +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

export interface PixelPanelOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  theme: SvgTheme;
  fill?: Paint;
  /** `null` skips the 2px border (used for nested blocks). */
  border?: Paint | null;
  /** Chamfer size in design pixels (0..4). Default 2. */
  corner?: number;
  /** Hard drop shadow offset in pixels; 0 disables it. */
  shadow?: number;
  shadowPaint?: Paint;
  /** Dither pattern id painted over the fill (see `ditherDefs`). */
  dither?: string;
}

/**
 * A pixel panel: flat fill, staircase-chamfered corners, 2px hard border and an
 * optional hard offset shadow.  The border is drawn as a stroked inset path so
 * it always lands inside the requested box (nothing is clipped at the edges).
 */
export function pixelPanel(options: PixelPanelOptions): string {
  const width = Math.round(options.width);
  const height = Math.round(options.height);
  const x = Math.round(options.x);
  const y = Math.round(options.y);
  const corner = Math.max(0, Math.min(4, Math.round(options.corner ?? 2)));
  const parts: string[] = [];
  const shadow = Math.max(0, Math.round(options.shadow ?? 0));
  const path = pixelRectPath(x, y, width, height, corner);
  if (shadow > 0) {
    const shadowPath = pixelRectPath(x + shadow, y + shadow, width, height, corner);
    parts.push(`<path d="${shadowPath}" ${paintFill(options.theme, options.shadowPaint ?? 'shadow')} opacity="0.55"/>`);
  }
  parts.push(`<path d="${path}" ${paintFill(options.theme, options.fill ?? 'surface')}/>`);
  if (options.dither) {
    parts.push(`<path d="${path}" fill="url(#${options.dither})"/>`);
  }
  if (options.border !== null) {
    const borderPath = pixelRectPath(x + 1, y + 1, Math.max(1, width - 2), Math.max(1, height - 2), corner);
    parts.push(
      `<path d="${borderPath}" fill="none" ${paintStroke(options.theme, options.border ?? 'border')} stroke-width="2" shape-rendering="crispEdges"/>`,
    );
  }
  return parts.join('');
}

/** Inset "well" behind bars/tracks: 1px border, deep fill. */
export function pixelInset2(options: {
  x: number;
  y: number;
  width: number;
  height: number;
  theme: SvgTheme;
  fill?: Paint;
}): string {
  const path = pixelRectPath(
    Math.round(options.x),
    Math.round(options.y),
    Math.round(options.width),
    Math.round(options.height),
    1,
  );
  return (
    `<path d="${path}" ${paintFill(options.theme, options.fill ?? 'inset')}/>` +
    `<path d="${path}" fill="none" ${paintStroke(options.theme, 'border')} stroke-width="1" shape-rendering="crispEdges"/>`
  );
}

// ---------------------------------------------------------------------------
// Dither patterns (2px checkerboard + 1px dot grid)
// ---------------------------------------------------------------------------

export interface DitherSpec {
  id: string;
  paint: Paint;
  cell?: number;
  background?: Paint;
}

/** Checkerboard dither patterns referenced as `fill="url(#id)"`. */
export function ditherDefs(theme: SvgTheme, patterns: readonly DitherSpec[]): string {
  return patterns
    .map((pattern) => {
      const cell = Math.max(1, Math.round(pattern.cell ?? 2));
      const background =
        pattern.background !== undefined
          ? `<rect width="${cell * 2}" height="${cell * 2}" ${paintFill(theme, pattern.background)}/>`
          : '';
      const fill = paintFill(theme, pattern.paint);
      return (
        `<pattern id="${pattern.id}" width="${cell * 2}" height="${cell * 2}" patternUnits="userSpaceOnUse">` +
        background +
        `<rect width="${cell}" height="${cell}" ${fill}/>` +
        `<rect x="${cell}" y="${cell}" width="${cell}" height="${cell}" ${fill}/>` +
        `</pattern>`
      );
    })
    .join('');
}

/** Sparse 1px dot grid, used as a subtle chart texture. */
export function dotGridDef(theme: SvgTheme, id: string, paint: Paint = 'grid', gap = 8): string {
  return (
    `<pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse">` +
    `<rect width="1" height="1" ${paintFill(theme, paint)}/>` +
    `</pattern>`
  );
}

// ---------------------------------------------------------------------------
// Small shared fragments
// ---------------------------------------------------------------------------

/** Hero-level empty state: sprite + `NO DATA YET` + a hint line. */
export function emptyState(options: {
  theme: SvgTheme;
  cx: number;
  cy: number;
  title?: string;
  hint?: string;
}): string {
  const { theme, cx, cy } = options;
  const title = options.title ?? 'NO DATA YET';
  const hint = options.hint ?? 'SYNC YOUR COLLECTOR TO FILL THIS IN';
  return (
    pixelSpriteSvg('chart', Math.round(cx) - 7, Math.round(cy) - 34, 3, paletteFor(theme).inkFaint) +
    pixelText(title, { x: Math.round(cx), y: Math.round(cy) - 10, scale: 3, paint: 'inkDim', align: 'center' }, theme) +
    pixelText(hint, { x: Math.round(cx), y: Math.round(cy) + 12, scale: 1, paint: 'inkDim', align: 'center' }, theme)
  );
}

/** Chart header row: title scale 3 on the left, summary scale 2 inkDim right. */
export function chartHeader(options: {
  theme: SvgTheme;
  x: number;
  y: number;
  width: number;
  title: string;
  detail: string;
}): string {
  const { theme, x, y, width } = options;
  const left = pixelText(options.title, { x, y, scale: 3, paint: 'ink' }, theme);
  const detailWidth = textWidth(options.detail, 2);
  if (detailWidth > width - textWidth(options.title, 3) - 24) {
    return left;
  }
  return (
    left +
    pixelText(options.detail, { x: x + width, y, scale: 2, paint: 'inkDim', align: 'right' }, theme)
  );
}

/** 2px dashes, like a classic 8-bit rule. */
export function pixelRule(options: {
  theme: SvgTheme;
  x: number;
  y: number;
  width: number;
  paint?: Paint;
  step?: number;
}): string {
  const { theme, x, y } = options;
  const width = Math.round(options.width);
  const step = Math.max(4, Math.round(options.step ?? 6));
  const commands: string[] = [];
  for (let offset = 0; offset + 4 <= width; offset += step) {
    commands.push(`M${Math.round(x) + offset} ${Math.round(y)}h4v2h-4z`);
  }
  if (commands.length === 0) return '';
  return `<path d="${commands.join('')}" ${paintFill(theme, options.paint ?? 'border')}/>`;
}
