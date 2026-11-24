import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PIXEL,
  PIXEL_GLYPHS,
  pixelBar,
  pixelDivider,
  pixelDitherDefs,
  pixelInset,
  pixelPanel,
  pixelRectPath,
  pixelSegmentedBar,
  pixelSpritePath,
  pixelSpriteSize,
  pixelSpriteSvg,
  pixelTextHeight,
  pixelTextPath,
  pixelTextSvg,
  pixelTextWidth,
  pixelHeatColor,
  sanitizePixelText,
} from '../src/pixel.js';
import { PIXEL_FONT_CAP_HEIGHT, PIXEL_FONT_TEXT_HEIGHT } from '../src/pixel-font.generated.js';

test('palette covers every design role with hex colors', () => {
  for (const [role, color] of Object.entries(PIXEL)) {
    assert.match(color, /^#[0-9a-f]{6}$/, `${role} should be a hex color`);
  }
  assert.equal(Object.keys(PIXEL).length >= 12, true);
});

test('glyph table is complete for printable ASCII', () => {
  for (let code = 32; code < 127; code += 1) {
    const char = String.fromCharCode(code);
    assert.ok(PIXEL_GLYPHS[char], `missing glyph for ${JSON.stringify(char)}`);
  }
  const a = PIXEL_GLYPHS['A']!;
  assert.deepEqual(a.rows, ['.##.', '#..#', '####', '#..#', '#..#']);
  assert.equal(a.advance, 6);
  assert.equal(a.top, -5);
});

test('pixelTextWidth matches advances and scales', () => {
  // "A" advances 6, "B" 6, space 4 at scale 1.
  assert.equal(pixelTextWidth('AB', 1), 12);
  assert.equal(pixelTextWidth('AB', 2), 24);
  assert.equal(pixelTextWidth('', 3), 0);
  assert.equal(pixelTextWidth('  ', 1), 8);
});

test('pixelTextPath emits merged run rectangles', () => {
  const { path, width, height } = pixelTextPath('A', { x: 10, y: 20 });
  assert.equal(width, 6);
  assert.equal(height, PIXEL_FONT_TEXT_HEIGHT);
  assert.match(path, /^M\d+ \d+h\d+v1h-\d+z/);
  // 'A' has 1 + 2 + 1 + 2 + 2 = 8 merged horizontal runs.
  assert.equal((path.match(/M/g) ?? []).length, 8);
});

test('pixelTextPath honours alignment and letter spacing', () => {
  const left = pixelTextPath('HI', { x: 100, y: 0 }).path;
  const center = pixelTextPath('HI', { x: 100, y: 0, align: 'center' }).path;
  const right = pixelTextPath('HI', { x: 100, y: 0, align: 'right' }).path;
  assert.notEqual(left, center);
  assert.notEqual(center, right);
  const spaced = pixelTextPath('HI', { x: 0, y: 0, letterSpacing: 3 });
  assert.equal(spaced.width, pixelTextWidth('HI', 1) + 3);
});

test('sanitizePixelText maps unicode fallbacks and unknown chars', () => {
  assert.equal(sanitizePixelText('▲ 12%'), '^ 12%');
  assert.equal(sanitizePixelText('a·b'), 'a*b');
  assert.equal(sanitizePixelText('✓ done'), '+ done');
  assert.equal(sanitizePixelText('中文'), '??');
  assert.equal(sanitizePixelText('ok — fine'), 'ok - fine');
});

test('pixelTextSvg renders a paint attribute', () => {
  const dark = pixelTextSvg('LIVE', { x: 0, y: 0, color: PIXEL.teal });
  assert.match(dark, /fill="#3be8b0"/);
  assert.match(dark, /shape-rendering="crispEdges"/);
  const themed = pixelTextSvg('LIVE', { x: 0, y: 0, className: 'ink' });
  assert.match(themed, /class="ink"/);
});

test('pixelRectPath chamfers corners without curves', () => {
  const path = pixelRectPath(0, 0, 20, 10, 2);
  assert.ok(!path.includes('Q') && !path.includes('C') && !path.includes('A'));
  assert.match(path, /^M2 0h16v2h2v6h-2v2h-16v-2h-2v-6h2z$/);
  assert.equal(pixelRectPath(0, 0, 20, 10, 0), 'M0 0h20v10h-20z');
});

test('pixelPanel composes shadow + fill + border + dither', () => {
  const svg = pixelPanel({
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    fill: PIXEL.surface,
    border: PIXEL.border,
    shadow: 3,
    dither: 'dither-teal',
  });
  assert.match(svg, /fill="#14121d"/);
  assert.match(svg, /stroke="#332d4a" stroke-width="2"/);
  assert.match(svg, /fill="url\(#dither-teal\)"/);
  assert.match(svg, /opacity="0.55"/);
});

test('pixelDitherDefs builds checkerboard patterns', () => {
  const defs = pixelDitherDefs([{ id: 'dither-teal', color: PIXEL.teal, cell: 2 }]);
  assert.match(defs, /<pattern id="dither-teal" width="4" height="4"/);
  assert.equal((defs.match(/<rect/g) ?? []).length, 2);
});

test('bars and dividers stay on the pixel grid', () => {
  const bar = pixelSegmentedBar({ x: 0, y: 0, width: 64, height: 6, ratio: 0.5, color: PIXEL.teal });
  assert.match(bar, /shape-rendering="crispEdges"/);
  const segmentCount = Math.floor((64 + 2) / (4 + 2));
  assert.equal((bar.match(/<rect/g) ?? []).length, segmentCount);
  const single = pixelBar({ x: 0, y: 0, width: 10, height: 12, color: PIXEL.blue, notch: true });
  assert.equal((single.match(/<rect/g) ?? []).length, 2);
  const divider = pixelDivider(0, 0, 20);
  assert.equal((divider.match(/M/g) ?? []).length, 3);
  assert.match(pixelInset(0, 0, 10, 4), /#090910/);
});

test('sprites render at integer scales', () => {
  const dot = pixelSpriteSize('dot', 2);
  assert.deepEqual(dot, { width: 6, height: 6 });
  assert.match(pixelSpriteSvg('dot', 0, 0, 2, PIXEL.teal), /h6v2h-6z/);
  assert.equal((pixelSpritePath('heart', 0, 0, 1).match(/M/g) ?? []).length, 6);
  assert.ok(pixelSpritePath('bolt', 0, 0, 1).length > 10);
});

test('pixelHeatColor returns stepped palette stops', () => {
  assert.equal(pixelHeatColor(0), PIXEL.surfaceAlt);
  assert.equal(pixelHeatColor(0.1), '#1f6f5b');
  assert.equal(pixelHeatColor(0.9), PIXEL.teal);
  assert.equal(pixelTextHeight(2), PIXEL_FONT_TEXT_HEIGHT * 2);
  assert.equal(PIXEL_FONT_CAP_HEIGHT, 5);
});
