import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dotColumnsSvg,
  dotFigureSvg,
  dotLedSvg,
  dotRatioStripSvg,
  dotSparklineSvg,
  dotTextDots,
  dotTextHeight,
  dotTextSvg,
  dotTextWidth,
  dotTextureSvg,
} from '../src/dotmatrix.js';

test('dotTextDots lays glyph pixels out as dot centres', () => {
  const dots = dotTextDots('A', { x: 0, y: 0, pitch: 4, scale: 1 });
  // 'A' has 12 lit glyph pixels.
  assert.equal(dots.length, 12);
  for (const [cx, cy] of dots) {
    assert.ok(Number.isFinite(cx) && Number.isFinite(cy));
    assert.equal(cx % 2, 0); // pitch 4 -> centres at even + 2
    assert.ok(cy >= 0 && cy <= 6 * 4);
  }
});

test('dotTextDots scales each font pixel into scale x scale dots', () => {
  const fine = dotTextDots('2', { x: 0, y: 0, pitch: 3, scale: 1 });
  const chunky = dotTextDots('2', { x: 0, y: 0, pitch: 3, scale: 2 });
  assert.equal(chunky.length, fine.length * 4);
});

test('dotTextWidth / height match the bitmap font metrics', () => {
  // '2' 6 + '.' 3 + '2' 6 + '8' 6 + 'M' 7 = 28 design px.
  assert.equal(dotTextWidth('2.28M', { pitch: 4, scale: 1 }), 112);
  assert.equal(dotTextWidth('A', { pitch: 3 }), 18);
  assert.equal(dotTextHeight({ pitch: 3 }), 18);
  assert.equal(dotTextHeight({ pitch: 4, scale: 2 }), 48);
});

test('dotTextSvg renders circles with radius and optional classes', () => {
  const svg = dotTextSvg('1.2M', { x: 10, y: 20, pitch: 4, color: '#3be8b0' });
  assert.match(svg, /<circle /);
  assert.match(svg, /fill="#3be8b0"/);
  assert.ok(!svg.includes('<text'));
});

test('dotFigureSvg draws LED halo rings behind the figure', () => {
  const svg = dotFigureSvg('2.28M', { x: 0, y: 0, pitch: 5, scale: 2, color: '#ffb020' });
  // Two halo groups + the core group.
  assert.equal((svg.match(/<g /g) ?? []).length, 3);
  assert.ok(svg.length > 500);
});

test('dotColumnsSvg builds tracks + highlighted today column', () => {
  const svg = dotColumnsSvg({
    x: 0,
    y: 0,
    width: 200,
    height: 60,
    values: [1, 2, 3, 4, 5],
    pitch: 4,
    color: '#a39fc4',
    highlightColor: '#3be8b0',
  });
  assert.match(svg, /#3be8b0/);
  assert.match(svg, /opacity="0\.35"/);
  assert.ok((svg.match(/<circle/g) ?? []).length > 40);
});

test('dotSparklineSvg and dotRatioStripSvg stay inside their box', () => {
  const spark = dotSparklineSvg({ x: 5, y: 10, width: 40, height: 20, values: [1, 3, 2], pitch: 3, color: '#5b9dff' });
  assert.match(spark, /<circle/);
  const strip = dotRatioStripSvg({ x: 0, y: 5, width: 50, ratio: 0.5, pitch: 4, color: '#3be8b0' });
  assert.equal((strip.match(/<circle/g) ?? []).length, 12);
  assert.match(strip, /opacity="0\.45"/);
});

test('dotLedSvg is the only element allowed to glow', () => {
  const led = dotLedSvg({ x: 4, y: 4, radius: 2, color: '#3be8b0' });
  assert.equal((led.match(/<circle/g) ?? []).length, 3);
  const plain = dotLedSvg({ x: 4, y: 4, radius: 2, color: '#3be8b0', halo: false });
  assert.equal((plain.match(/<circle/g) ?? []).length, 1);
});

test('dotTextureSvg fills a region with faint dots', () => {
  const texture = dotTextureSvg({ x: 0, y: 0, width: 20, height: 10, pitch: 4, color: '#ffffff' });
  assert.ok((texture.match(/<circle/g) ?? []).length >= 10);
  assert.match(texture, /opacity="0\.12"/);
});
