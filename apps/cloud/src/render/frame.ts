/**
 * SVG frame + Precision Telemetry panel primitives for every cloud surface.
 *
 * Self-contained SVG documents with zero external references or scripts:
 * embedded system/monospace font classes, accessible `<title>` + `<desc>`,
 * rounded architectural cards (`rx`), and 1px crisp structural hairlines.
 */

import { escapeXml } from '@token-island/core';
import {
  measureText,
  paintFill,
  paintStroke,
  svgStyleBlock,
  svgText,
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
  /** Page/panel background behind the body; `null` leaves outer corners transparent. */
  background?: Paint | null;
  radius?: number;
}

/** Wraps a rendered body in a self-contained, accessible SVG document. */
export function svgFrame(options: SvgFrameOptions): string {
  const width = Math.round(options.width);
  const height = Math.round(options.height);
  const titleId = `${options.idPrefix}-title`;
  const descId = `${options.idPrefix}-desc`;
  const rx = options.radius ?? 0;
  const rxAttr = rx > 0 ? ` rx="${rx}"` : '';
  const background =
    options.background === null
      ? ''
      : `<rect x="0" y="0" width="${width}" height="${height}"${rxAttr} ${paintFill(options.theme, options.background ?? 'surface')}/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${titleId} ${descId}">` +
    `<title id="${titleId}">${escapeXml(options.title)}</title>` +
    `<desc id="${descId}">${escapeXml(options.description)}</desc>` +
    svgStyleBlock(options.theme) +
    (options.defs ? `<defs>${options.defs}</defs>` : '') +
    background +
    options.body +
    `</svg>`
  );
}

export interface TelemetryCardOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  theme: SvgTheme;
  fill?: Paint;
  border?: Paint | null;
  radius?: number;
}

/** Rounded architectural card with an inset 1px border so nothing clips at SVG bounds. */
export function telemetryPanel(options: TelemetryCardOptions): string {
  const x = Math.round(options.x);
  const y = Math.round(options.y);
  const width = Math.round(options.width);
  const height = Math.round(options.height);
  const radius = Math.max(0, Math.round(options.radius ?? 10));
  const rxAttr = radius > 0 ? ` rx="${radius}"` : '';
  const innerRx = Math.max(0, radius - 0.5);
  const innerRxAttr = innerRx > 0 ? ` rx="${innerRx}"` : '';
  const fillRect = `<rect x="${x}" y="${y}" width="${width}" height="${height}"${rxAttr} ${paintFill(options.theme, options.fill ?? 'surface')}/>`;
  if (options.border === null) return fillRect;
  const strokeRect = `<rect x="${x + 0.5}" y="${y + 0.5}" width="${Math.max(1, width - 1)}" height="${Math.max(1, height - 1)}"${innerRxAttr} fill="none" ${paintStroke(options.theme, options.border ?? 'border')} stroke-width="1"/>`;
  return fillRect + strokeRect;
}

/** Subtle inset track behind progress bars or mini sparklines. */
export function telemetryTrack(options: {
  x: number;
  y: number;
  width: number;
  height: number;
  theme: SvgTheme;
  fill?: Paint;
  radius?: number;
}): string {
  const x = Math.round(options.x);
  const y = Math.round(options.y);
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  const rx = Math.round(options.radius ?? Math.floor(height / 2));
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ${paintFill(options.theme, options.fill ?? 'inset')}/>`;
}

/** 1px horizontal divider rule. */
export function telemetryRule(options: {
  theme: SvgTheme;
  x: number;
  y: number;
  width: number;
  paint?: Paint;
  dashed?: boolean;
}): string {
  const x1 = Math.round(options.x);
  const x2 = Math.round(options.x + options.width);
  const y = Math.round(options.y) + 0.5;
  const dash = options.dashed ? ' stroke-dasharray="3 4"' : '';
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" ${paintStroke(options.theme, options.paint ?? 'border')} stroke-width="1"${dash}/>`;
}

/** Clean empty-state block for charts with zero activity. */
export function emptyState(options: {
  theme: SvgTheme;
  cx: number;
  cy: number;
  title?: string;
  hint?: string;
}): string {
  const cx = Math.round(options.cx);
  const cy = Math.round(options.cy);
  const title = options.title ?? 'No data synced yet';
  const hint = options.hint ?? 'Run the local collector to populate daily metrics';
  return (
    `<circle cx="${cx}" cy="${cy - 22}" r="10" fill="none" ${paintStroke(options.theme, 'borderHi')} stroke-width="1.5"/>` +
    `<circle cx="${cx}" cy="${cy - 22}" r="3" ${paintFill(options.theme, 'inkFaint')}/>` +
    svgText(title, { x: cx, y: cy + 2, size: 13, weight: 600, paint: 'inkDim', align: 'center' }, options.theme) +
    svgText(hint, { x: cx, y: cy + 20, size: 11.5, weight: 400, paint: 'inkFaint', align: 'center' }, options.theme)
  );
}

/** Chart header row: crisp title on the left, tabular summary on the right. */
export function chartHeader(options: {
  theme: SvgTheme;
  x: number;
  y: number;
  width: number;
  title: string;
  detail: string;
}): string {
  const { theme, x, y, width } = options;
  const baseline = y + 12;
  const left = svgText(options.title, { x, y: baseline, size: 13, weight: 600, paint: 'ink' }, theme);
  if (!options.detail) return left;
  const titleW = measureText(options.title, 13);
  const detailW = measureText(options.detail, 11.5, { mono: true });
  if (detailW > width - titleW - 16) return left;
  return (
    left +
    svgText(
      options.detail,
      { x: x + width, y: baseline, size: 11.5, weight: 500, mono: true, paint: 'inkDim', align: 'right' },
      theme,
    )
  );
}
