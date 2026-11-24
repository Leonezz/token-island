/**
 * Token Island pixel design system.
 *
 * One 8-bit visual language shared by the macOS widget (native), the cloud SVG
 * badges/charts/cards (self-contained, no webfonts on GitHub) and the cloud HTML
 * pages (which load the real Silkscreen TTF).
 *
 * Laws:
 *  - everything sits on an integer pixel grid; SVG coordinates are integers
 *  - text comes from the extracted Silkscreen bitmap glyphs (see
 *    `pixel-font.generated.ts`) so SVG and native typography are identical
 *  - panels have hard 2px borders, chamfered pixel corners and hard shadows
 *    (never blurred)
 *  - fills are flat; depth comes from dither patterns and offset shadows
 */

import {
  PIXEL_FONT_ASCENT,
  PIXEL_FONT_CAP_HEIGHT,
  PIXEL_FONT_DESCENT,
  PIXEL_FONT_TEXT_HEIGHT,
  PIXEL_GLYPHS,
  PIXEL_TYPE_SCALE,
} from './pixel-font.generated.js';
import type { PixelGlyph } from './pixel-font.generated.js';

export {
  PIXEL_FONT_ASCENT,
  PIXEL_FONT_CAP_HEIGHT,
  PIXEL_FONT_DESCENT,
  PIXEL_FONT_TEXT_HEIGHT,
  PIXEL_GLYPHS,
  PIXEL_TYPE_SCALE,
};
export type { PixelGlyph };

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/** The one and only 8-bit palette.  Hex strings so they work in SVG and CSS. */
export const PIXEL = {
  /** Page / wallpaper background. */
  bg: '#0b0b12',
  /** Slightly lifted background for striped sections. */
  bgRaised: '#10101b',
  /** Panel fill. */
  surface: '#14121d',
  /** Secondary panel / inset well. */
  surfaceAlt: '#1b1928',
  /** Deep inset (track background). */
  inset: '#090910',
  /** Default 2px border. */
  border: '#332d4a',
  /** Highlight border on the top/left edge of raised panels. */
  borderHi: '#57507a',
  /** Primary ink. */
  ink: '#f4f2ff',
  /** Secondary ink. */
  inkDim: '#a39fc4',
  /** Tertiary ink / axis labels. */
  inkFaint: '#6b6689',
  /** Brand / success / live. */
  teal: '#3be8b0',
  /** Cache / secondary data. */
  blue: '#5b9dff',
  /** Output / tertiary data. */
  purple: '#b388ff',
  /** Warning / streak. */
  amber: '#ffc857',
  /** Error. */
  red: '#ff6b6b',
  /** Positive trend. */
  green: '#7dff9b',
  /** Silkscreen accent for "today" highlights. */
  mint: '#8fffe0',
} as const;

export type PixelColor = keyof typeof PIXEL;

/** Ordered palette used by charts for categorical series. */
export const PIXEL_SERIES: readonly string[] = [
  PIXEL.teal,
  PIXEL.purple,
  PIXEL.blue,
  PIXEL.amber,
  PIXEL.green,
  PIXEL.red,
  PIXEL.mint,
  PIXEL.inkDim,
];

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Characters with no Silkscreen glyph are mapped to readable ASCII fallbacks. */
const TEXT_FALLBACKS: Record<string, string> = {
  '·': '*',
  '•': '*',
  '▲': '^',
  '▼': 'v',
  '→': '>',
  '←': '<',
  '↑': '^',
  '↓': 'v',
  '×': 'x',
  '✓': '+',
  '✗': 'x',
  '—': '-',
  '–': '-',
  '…': '.',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '\u00a0': ' ',
  '↗': '^',
  '↘': 'v',
  '≈': '~',
};

/** Replaces unsupported characters so a label can never render as boxes. */
export function sanitizePixelText(text: string): string {
  let out = '';
  for (const char of text) {
    const mapped = TEXT_FALLBACKS[char];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    out += PIXEL_GLYPHS[char] ? char : '?';
  }
  return out;
}

/** Width in device pixels of a single line at `scale`. */
export function pixelTextWidth(text: string, scale = 1, letterSpacing = 0): number {
  const clean = sanitizePixelText(text);
  if (clean.length === 0) return 0;
  let width = 0;
  for (const char of clean) width += (PIXEL_GLYPHS[char]?.advance ?? PIXEL_GLYPHS[' ']!.advance) * scale;
  return width + Math.max(0, clean.length - 1) * letterSpacing;
}

/** Height of a single line of text at `scale` (cap top to baseline row). */
export function pixelTextHeight(scale = 1): number {
  return PIXEL_FONT_TEXT_HEIGHT * scale;
}

export interface PixelTextOptions {
  x: number;
  /** Top of the capital letters. */
  y: number;
  scale?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** Extra pixels between glyphs, in device pixels (must be an integer). */
  letterSpacing?: number;
  /** CSS class instead of an inline color (for themeable HTML/SVG). */
  className?: string;
}

/**
 * Renders text as SVG rects (one path, merged horizontal runs) using the
 * Silkscreen bitmap glyphs.  Position is the top-left of the capital letters;
 * `align` shifts the block relative to `x`.
 */
export function pixelTextPath(text: string, options: PixelTextOptions): { path: string; width: number; height: number } {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const spacing = Math.round(options.letterSpacing ?? 0);
  const clean = sanitizePixelText(text);
  const width = pixelTextWidth(clean, scale, spacing);
  let penX = Math.round(options.x);
  if (options.align === 'center') penX -= Math.floor(width / 2);
  else if (options.align === 'right') penX -= width;
  const baseline = Math.round(options.y) + PIXEL_FONT_CAP_HEIGHT * scale;

  const commands: string[] = [];
  for (const char of clean) {
    const glyph = PIXEL_GLYPHS[char] ?? PIXEL_GLYPHS[' ']!;
    if (glyph.rows.length > 0) {
      for (let rowIndex = 0; rowIndex < glyph.rows.length; rowIndex += 1) {
        const row = glyph.rows[rowIndex] as string;
        const rowY = baseline + (glyph.top + rowIndex) * scale;
        let runStart = -1;
        for (let col = 0; col <= row.length; col += 1) {
          const on = col < row.length && row[col] === '#';
          if (on && runStart === -1) runStart = col;
          if (!on && runStart !== -1) {
            const runX = penX + runStart * scale;
            commands.push(`M${runX} ${rowY}h${(col - runStart) * scale}v${scale}h${-(col - runStart) * scale}z`);
            runStart = -1;
          }
        }
      }
    }
    penX += glyph.advance * scale + spacing;
  }

  return { path: commands.join(''), width, height: pixelTextHeight(scale) };
}

/** Convenience: a complete `<path>` element for a line of pixel text. */
export function pixelTextSvg(text: string, options: PixelTextOptions): string {
  const { path } = pixelTextPath(text, options);
  if (!path) return '';
  const paint = options.className
    ? ` class="${options.className}"`
    : ` fill="${options.color ?? PIXEL.ink}"`;
  return `<path d="${path}"${paint} shape-rendering="crispEdges"/>`;
}

/** Multi-line helper returning one `<path>` per line (baseline-aligned). */
export function pixelTextLinesSvg(
  lines: readonly string[],
  options: PixelTextOptions & { lineHeight?: number },
): string {
  const scale = Math.max(1, Math.round(options.scale ?? 1));
  const lineHeight = options.lineHeight ?? pixelTextHeight(scale) + scale;
  return lines
    .map((line, index) =>
      pixelTextSvg(line, { ...options, y: options.y + index * lineHeight }),
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Panels, shadows, dithering
// ---------------------------------------------------------------------------

export interface PixelPanelOptions {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Panel fill; `none` for a frame only. */
  fill?: string;
  /** Border color; pass `none` to skip the border. */
  border?: string;
  /** Chamfer size in pixels (1..4). Default 2. */
  corner?: number;
  /** Hard drop shadow offset in pixels; 0 disables it. Default 0. */
  shadow?: number;
  shadowColor?: string;
  /** Optional dither pattern id painted on top (see `pixelDitherDefs`). */
  dither?: string;
  opacity?: number;
  className?: string;
}

/** Rectangle path with pixel-chamfered corners (no curves, ever). */
export function pixelRectPath(x: number, y: number, width: number, height: number, corner = 2): string {
  const c = Math.max(0, Math.min(Math.round(corner), Math.floor(Math.min(width, height) / 2)));
  if (c === 0) return `M${x} ${y}h${width}v${height}h${-width}z`;
  return [
    `M${x + c} ${y}`,
    `h${width - c * 2}`,
    `v${c}`,
    `h${c}`,
    `v${height - c * 2}`,
    `h${-c}`,
    `v${c}`,
    `h${-(width - c * 2)}`,
    `v${-c}`,
    `h${-c}`,
    `v${-(height - c * 2)}`,
    `h${c}`,
    'z',
  ].join('');
}

/** Complete pixel panel (shadow + fill + 2px border + optional dither). */
export function pixelPanel(options: PixelPanelOptions): string {
  const corner = Math.max(0, Math.min(4, Math.round(options.corner ?? 2)));
  const fill = options.fill ?? PIXEL.surface;
  const border = options.border ?? PIXEL.border;
  const opacity = options.opacity !== undefined ? ` opacity="${options.opacity}"` : '';
  const className = options.className ? ` class="${options.className}"` : '';
  const parts: string[] = [];
  const shadow = Math.max(0, Math.round(options.shadow ?? 0));
  const path = pixelRectPath(options.x, options.y, options.width, options.height, corner);

  if (shadow > 0) {
    const shadowPath = pixelRectPath(options.x + shadow, options.y + shadow, options.width, options.height, corner);
    parts.push(`<path d="${shadowPath}" fill="${options.shadowColor ?? '#000000'}" opacity="0.55"/>`);
  }
  parts.push(`<path d="${path}" fill="${fill}"${opacity}${className}/>`);
  if (options.dither) {
    parts.push(`<path d="${path}" fill="url(#${options.dither})"${opacity}/>`);
  }
  if (border !== 'none') {
    // 2px hard border drawn as a stroked path with crisp edges.
    parts.push(
      `<path d="${path}" fill="none" stroke="${border}" stroke-width="2" shape-rendering="crispEdges"/>`,
    );
  }
  return parts.join('');
}

/** Inset "well" used behind bars and tracks. */
export function pixelInset(x: number, y: number, width: number, height: number, fill = PIXEL.inset): string {
  const path = pixelRectPath(x, y, width, height, 1);
  return `<path d="${path}" fill="${fill}"/><path d="${path}" fill="none" stroke="${PIXEL.border}" stroke-width="1" shape-rendering="crispEdges"/>`;
}

/**
 * Checkerboard dither definitions.  Include once per SVG and reference by id,
 * e.g. `pixelPanel({ dither: 'dither-teal' })`.
 */
export function pixelDitherDefs(
  patterns: readonly { id: string; color: string; cell?: number; background?: string }[],
): string {
  return patterns
    .map((pattern) => {
      const cell = pattern.cell ?? 2;
      const bg = pattern.background ? `<rect width="${cell * 2}" height="${cell * 2}" fill="${pattern.background}"/>` : '';
      return (
        `<pattern id="${pattern.id}" width="${cell * 2}" height="${cell * 2}" patternUnits="userSpaceOnUse">` +
        bg +
        `<rect width="${cell}" height="${cell}" fill="${pattern.color}"/>` +
        `<rect x="${cell}" y="${cell}" width="${cell}" height="${cell}" fill="${pattern.color}"/>` +
        `</pattern>`
      );
    })
    .join('');
}

/** Horizontal 2px divider with 1px gaps, like a classic 8-bit rule. */
export function pixelDivider(x: number, y: number, width: number, color = PIXEL.border, step = 6): string {
  const commands: string[] = [];
  for (let offset = 0; offset + 4 <= width; offset += step) {
    commands.push(`M${x + offset} ${y}h4v2h-4z`);
  }
  return `<path d="${commands.join('')}" fill="${color}" shape-rendering="crispEdges"/>`;
}

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

/** Chunky bar: `segments` cells, `filled` of them lit. */
export function pixelSegmentedBar(options: {
  x: number;
  y: number;
  width: number;
  height: number;
  ratio: number;
  color: string;
  track?: string;
  segments?: number;
  gap?: number;
}): string {
  const height = Math.max(2, Math.round(options.height));
  const gap = Math.max(1, Math.round(options.gap ?? 2));
  const width = Math.max(2, Math.round(options.width));
  const segmentCount = Math.max(1, options.segments ?? Math.floor((width + gap) / (4 + gap)));
  const segmentWidth = Math.max(1, Math.floor((width - gap * (segmentCount - 1)) / segmentCount));
  const filled = Math.max(0, Math.min(segmentCount, Math.round(options.ratio * segmentCount)));
  const cells: string[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const cellX = options.x + index * (segmentWidth + gap);
    cells.push(
      `<rect x="${cellX}" y="${options.y}" width="${segmentWidth}" height="${height}" fill="${
        index < filled ? options.color : (options.track ?? PIXEL.inset)
      }"/>`,
    );
  }
  return `<g shape-rendering="crispEdges">${cells.join('')}</g>`;
}

/** Single rectangular bar (chunky, for bar charts). */
export function pixelBar(options: {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /** Draw with a 2px notch on the top edge for a hand-made feel. */
  notch?: boolean;
}): string {
  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  const rect = `<rect x="${options.x}" y="${options.y}" width="${width}" height="${height}" fill="${options.color}"/>`;
  if (!options.notch || width < 4) return rect;
  return (
    `<rect x="${options.x}" y="${options.y}" width="${width}" height="${height}" fill="${options.color}"/>` +
    `<rect x="${options.x + 2}" y="${options.y}" width="${Math.max(1, width - 4)}" height="1" fill="${PIXEL.bg}" opacity="0.35"/>`
  );
}

// ---------------------------------------------------------------------------
// Icons (7x7-ish pixel sprites)
// ---------------------------------------------------------------------------

export const PIXEL_SPRITES = {
  /** Live pulse / health dot (3x3). */
  dot: ['###', '###', '###'],
  heart: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  flame: ['..#..', '.##..', '####.', '#####', '.###.', '..#..'],
  bolt: ['...##', '..##.', '.##..', '.###.', '..##.', '.##..', '##...'],
  cloud: ['..###..', '.#####.', '#######', '#######', '.#####.'],
  pin: ['..#..', '.###.', '.###.', '..#..', '..#..', '..#..'],
  check: ['....#', '...#.', '#.#..', '.#...'],
  cross: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  arrowUp: ['..#..', '.###.', '#####', '..#..', '..#..'],
  arrowDown: ['..#..', '..#..', '#####', '.###.', '..#..'],
  pulse: ['#....', '.#..#', '..#..', '..#..', '#..#.', '#....'],
  coin: ['.###.', '#...#', '#.#.#', '#...#', '.###.'],
  chart: ['....#', '...#.', '..#..', '.#.#.', '#...#'],
  clock: ['.###.', '#...#', '#.#.#', '#...#', '.###.'],
  gear: ['.#.#.', '#####', '.##..', '#####', '.#.#.'],
} as const;

export type PixelSpriteName = keyof typeof PIXEL_SPRITES;

/** SVG path for a sprite at an integer scale. */
export function pixelSpritePath(name: PixelSpriteName, x: number, y: number, scale = 1): string {
  const rows = PIXEL_SPRITES[name];
  const commands: string[] = [];
  rows.forEach((row, rowIndex) => {
    let runStart = -1;
    for (let col = 0; col <= row.length; col += 1) {
      const on = col < row.length && row[col] === '#';
      if (on && runStart === -1) runStart = col;
      if (!on && runStart !== -1) {
        commands.push(
          `M${x + runStart * scale} ${y + rowIndex * scale}h${(col - runStart) * scale}v${scale}h${-(col - runStart) * scale}z`,
        );
        runStart = -1;
      }
    }
  });
  return commands.join('');
}

export function pixelSpriteSvg(name: PixelSpriteName, x: number, y: number, scale: number, color: string): string {
  return `<path d="${pixelSpritePath(name, x, y, scale)}" fill="${color}" shape-rendering="crispEdges"/>`;
}

/** Width/height in pixels of a sprite at a scale. */
export function pixelSpriteSize(name: PixelSpriteName, scale = 1): { width: number; height: number } {
  const rows = PIXEL_SPRITES[name];
  return { width: Math.max(...rows.map((row) => row.length)) * scale, height: rows.length * scale };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Clamp + snap a number to the pixel grid. */
export function snap(value: number, grid = 1): number {
  return Math.round(value / grid) * grid;
}

/** Mix-free "stepped" color for heatmap levels: returns one of the palette stops. */
export function pixelHeatColor(ratio: number): string {
  if (ratio <= 0) return PIXEL.surfaceAlt;
  if (ratio < 0.25) return '#1f6f5b';
  if (ratio < 0.5) return '#239b7c';
  if (ratio < 0.75) return '#2bc79e';
  return PIXEL.teal;
}
