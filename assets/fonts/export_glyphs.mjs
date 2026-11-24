/**
 * Exports the Silkscreen bitmap glyph table as JSON so the native macOS app can
 * render dot-matrix figures with the exact same glyphs as the SVG side.
 *
 *   node --import tsx assets/fonts/export_glyphs.mjs
 *
 * Output: assets/fonts/pixel-glyphs.json
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PIXEL_GLYPHS, PIXEL_FONT_ASCENT, PIXEL_FONT_CAP_HEIGHT, PIXEL_FONT_TEXT_HEIGHT } from '@token-island/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'pixel-glyphs.json');

const glyphs = {};
for (const [char, glyph] of Object.entries(PIXEL_GLYPHS)) {
  glyphs[char] = { a: glyph.advance, t: glyph.top, r: glyph.rows };
}

writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      font: 'Silkscreen',
      license: 'OFL-1.1',
      capHeight: PIXEL_FONT_CAP_HEIGHT,
      textHeight: PIXEL_FONT_TEXT_HEIGHT,
      ascent: PIXEL_FONT_ASCENT,
      glyphs,
    },
    null,
    0,
  )}\n`,
  'utf8',
);

console.log(`wrote ${OUT} (${Object.keys(glyphs).length} glyphs)`);
