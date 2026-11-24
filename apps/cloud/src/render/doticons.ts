/**
 * Dot-matrix metric icons + badge label texture (V3).
 *
 * The badge text itself stays crisp bitmap (Silkscreen paths) — these helpers
 * are only for the leading icon (the data mark) and the ~0.10 opacity texture
 * behind the label.  Every dot is an SVG `<circle>`; fills go through
 * `paintFill()` so the `auto` theme follows `prefers-color-scheme`.
 */

import { paintFill, type Paint, type SvgTheme } from './tokens.js';

export type DotIconName =
  | 'tokens'
  | 'cost'
  | 'streak'
  | 'messages'
  | 'day'
  | 'model'
  | 'status'
  | 'cross';

/** Icons share one 10x10 box so badge geometry is stable across metrics. */
export const DOT_ICON_SIZE = 10;

/** 5x5 dot patterns: one `#` = one dot on a 2px pitch inside the 10x10 box. */
const ICON_GRIDS: Record<Exclude<DotIconName, 'status'>, readonly string[]> = {
  // Page / usage totals: a cluster of dots.
  tokens: ['.#.#.', '#####', '.###.', '#####', '.#.#.'],
  // Estimated spend: a dot ring (a coin without the glyph noise).
  cost: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  // Streak: a dot flame.
  streak: ['..#..', '.##..', '####.', '#####', '.###.'],
  // Agent turns: dot bars at different heights.
  messages: ['..#..', '..#.#', '#.#.#', '#.#.#', '#.#.#'],
  // Today: a dot calendar (ring binders, header rule, day cells).
  day: ['.#.#.', '#####', '#...#', '#.#.#', '#####'],
  // Top model: a dot chip (pins above/below, matrix body).
  model: ['.#.#.', '#####', '#.#.#', '#####', '.#.#.'],
  // Unknown user: a dot cross.
  cross: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
};

const ICON_PITCH = 2;
const ICON_RADIUS = 0.9;

function iconDots(name: Exclude<DotIconName, 'status'>, x: number, y: number): string {
  const rows = ICON_GRIDS[name];
  const circles: string[] = [];
  rows.forEach((row, rowIndex) => {
    for (let col = 0; col < row.length; col += 1) {
      if (row[col] !== '#') continue;
      const cx = x + 1 + col * ICON_PITCH;
      const cy = y + 1 + rowIndex * ICON_PITCH;
      circles.push(`<circle cx="${cx}" cy="${cy}" r="${ICON_RADIUS}"/>`);
    }
  });
  return circles.join('');
}

/**
 * Leading badge icon. `status` is the one place allowed a soft LED halo because
 * it is a ≤8px status point (V3 §0); every other icon is flat dots.
 */
export function dotIconSvg(theme: SvgTheme, name: DotIconName, x: number, y: number, paint: Paint): string {
  if (name === 'status') {
    const cx = x + Math.round(DOT_ICON_SIZE / 2);
    const cy = y + Math.round(DOT_ICON_SIZE / 2);
    const fill = paintFill(theme, paint);
    return (
      `<g ${fill}><circle cx="${cx}" cy="${cy}" r="5" opacity="0.1"/>` +
      `<circle cx="${cx}" cy="${cy}" r="3.3" opacity="0.18"/>` +
      `<circle cx="${cx}" cy="${cy}" r="2.2"/></g>`
    );
  }
  return `<g ${paintFill(theme, paint)}>${iconDots(name, x, y)}</g>`;
}

/**
 * Faint dot texture for the badge label area.
 *
 * Returns a `<pattern>` def (small payload) painted at `opacity` (default 0.10)
 * behind the bitmap label.  The dots are ~6% area coverage, so the measured
 * label contrast barely moves (asserted in the tests).
 */
export function dotLabelTextureDef(
  theme: SvgTheme,
  id: string,
  options: { paint?: Paint; pitch?: number; radius?: number; opacity?: number } = {},
): string {
  const pitch = Math.max(3, Math.round(options.pitch ?? 4));
  const radius = Math.max(0.4, options.radius ?? 0.55);
  const opacity = options.opacity ?? 0.1;
  return (
    `<pattern id="${id}" width="${pitch}" height="${pitch}" patternUnits="userSpaceOnUse">` +
    `<circle cx="${pitch / 2}" cy="${pitch / 2}" r="${radius}" ${paintFill(
      theme,
      options.paint ?? 'ink',
    )} opacity="${opacity}"/>` +
    `</pattern>`
  );
}
