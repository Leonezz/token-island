/**
 * Dot-matrix style exploration for Token Island.
 *
 * Generates self-contained SVG + HTML mockups for four candidate directions:
 *   A led   琥珀 LED 点阵（出发牌）
 *   B vfd   青色 VFD 点阵（荧光仪表）
 *   C flip  物理翻牌点阵（flip-dot board）
 *   D flat  现代平点阵（Nothing / TE 工业风）
 *
 *   node --import tsx docs/demos/dotmatrix/generate.mjs
 *
 * Throw-away exploration; no app code is touched.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PIXEL_GLYPHS, formatTokens, formatCost } from '@token-island/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'out');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Demo data (same fixture for every direction)
// ---------------------------------------------------------------------------

const fixture = JSON.parse(readFileSync(resolve(HERE, '../../../fixtures/summary.example.json'), 'utf8'));
const fmt = (n) => formatTokens(n).toUpperCase();
const fmtCost = (n) => formatCost(n, { approx: true }).toUpperCase();
const shortModel = (name) =>
  name
    .toUpperCase()
    .replace(/^CLAUDE-/, '')
    .replace(/^GPT-/, 'GPT-');

const DATA = {
  today: fixture.today.totalTokens,
  cost: fixture.today.costUsd,
  input: fixture.today.inputTokens,
  cache: fixture.today.cacheReadTokens,
  output: fixture.today.outputTokens,
  turns: fixture.today.messages,
  streak: fixture.streak.current,
  daily: fixture.daily.map((d) => d.totalTokens),
  models: fixture.models.slice(0, 3).map((m) => ({
    name: shortModel(m.label),
    tokens: m.totalTokens,
    share: m.share,
  })),
  live: fixture.live.slice(0, 2).map((s, index) => ({
    project: s.project.toUpperCase(),
    tokens: s.totalTokens,
    ago: index === 0 ? '29S' : '54S',
  })),
};

// ---------------------------------------------------------------------------
// Dot text renderer
// ---------------------------------------------------------------------------

function glyphDots(text, { x, y, pitch, scale = 1, letterSpacing = 0 }) {
  const dots = [];
  let pen = x;
  let baseline = y + 5 * scale * pitch; // cap-top -> baseline
  void baseline;
  for (const char of text.toUpperCase()) {
    const glyph = PIXEL_GLYPHS[char] ?? PIXEL_GLYPHS[' '];
    glyph.rows.forEach((row, rowIndex) => {
      for (let col = 0; col < row.length; col += 1) {
        if (row[col] !== '#') continue;
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            const cx = pen + (col * scale + sx) * pitch + pitch / 2;
            const cy = y + (5 + glyph.top + rowIndex) * scale * pitch + sy * pitch + pitch / 2;
            dots.push([cx, cy]);
          }
        }
      }
    });
    pen += glyph.advance * scale * pitch + letterSpacing;
  }
  return dots;
}

function textWidth(text, { pitch, scale = 1, letterSpacing = 0 }) {
  let width = 0;
  for (const char of text.toUpperCase()) {
    width += (PIXEL_GLYPHS[char] ?? PIXEL_GLYPHS[' ']).advance * scale * pitch + letterSpacing;
  }
  return Math.max(0, width - letterSpacing);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const STYLES = {
  led: {
    label: 'A · 琥珀 LED 点阵',
    caption: '经典 5×7 琥珀 LED 出发牌：未点亮圆点底纹、磷光辉光、扫描线、金属边框',
    pitch: 3,
    dense: true,
    palette: {
      bg: '#070603',
      panelTop: '#0c0a06',
      panelBottom: '#060503',
      off: '#241a09',
      ink: '#ffb020',
      hot: '#ffe3a3',
      dim: '#b97a18',
      faint: '#6b4c14',
      accent: '#7cff6b',
      warn: '#ff6b45',
      bezel: '#1a150d',
      bezelHi: '#3b3220',
      glass: '#ffffff',
    },
    dot: 0.4,
    glow: 0.85,
    glassAlpha: 0.05,
    scanline: 0.14,
    heroScale: 2,
  },
  vfd: {
    label: 'B · 青色 VFD 点阵',
    caption: '真空荧光（VFD）仪表：青色强发光、双层 bloom、玻璃反光、细亮边框',
    pitch: 3,
    dense: true,
    palette: {
      bg: '#020708',
      panelTop: '#04100f',
      panelBottom: '#010505',
      off: '#0c2f2c',
      ink: '#4ff0e0',
      hot: '#dcfffb',
      dim: '#2fbdb2',
      faint: '#1c6b66',
      accent: '#ffc857',
      warn: '#ff7b6b',
      bezel: '#07191a',
      bezelHi: '#1f5a56',
      glass: '#eafffd',
    },
    dot: 0.38,
    glow: 1.15,
    glassAlpha: 0.1,
    scanline: 0.07,
    heroScale: 2,
  },
  flip: {
    label: 'C · 物理翻牌点阵',
    caption: 'flip-dot 翻牌板：每个圆片有高光与投影、暖白翻起、单个强调色，点距更粗、信息更少',
    pitch: 5,
    dense: false,
    palette: {
      bg: '#0d0e11',
      panelTop: '#131418',
      panelBottom: '#0d0e11',
      off: '#2a2c32',
      ink: '#ece7d8',
      hot: '#fffdf4',
      dim: '#bdb7a8',
      faint: '#7a7466',
      accent: '#ff5d3d',
      warn: '#ff5d3d',
      bezel: '#1b1c20',
      bezelHi: '#3c3e46',
      glass: '#ffffff',
    },
    dot: 0.4,
    glow: 0,
    glassAlpha: 0.03,
    scanline: 0,
    heroScale: 2,
    snap: true,
  },
  flat: {
    label: 'D · 现代平点阵',
    caption: '细点阵 + 克制单色：无光晕、无扫描线，点密度表达数据，一抹荧光绿强调',
    pitch: 3,
    dense: true,
    palette: {
      bg: '#040405',
      panelTop: '#09090b',
      panelBottom: '#040405',
      off: '#1c1c23',
      ink: '#f2f2f6',
      hot: '#ffffff',
      dim: '#9b9ba6',
      faint: '#5c5c68',
      accent: '#86f7c9',
      warn: '#ff5d5d',
      bezel: '#191920',
      bezelHi: '#33333d',
      glass: '#ffffff',
    },
    dot: 0.36,
    glow: 0,
    glassAlpha: 0.02,
    scanline: 0,
    heroScale: 2,
  },
};

// ---------------------------------------------------------------------------
// SVG building blocks
// ---------------------------------------------------------------------------

function defs(style) {
  const p = style.palette;
  const p0 = style.pitch;
  const offGrid =
    style.id === 'flip'
      ? `<pattern id="grid" width="${p0}" height="${p0}" patternUnits="userSpaceOnUse">
           <circle cx="${p0 / 2}" cy="${p0 / 2}" r="${(p0 * 0.42).toFixed(2)}" fill="url(#flipOff)"/>
           <circle cx="${p0 / 2}" cy="${(p0 / 2 + 0.8).toFixed(2)}" r="${(p0 * 0.42).toFixed(2)}" fill="#000" opacity="0.35"/>
         </pattern>`
      : `<pattern id="grid" width="${p0}" height="${p0}" patternUnits="userSpaceOnUse">
           <circle cx="${p0 / 2}" cy="${p0 / 2}" r="${(p0 * 0.2).toFixed(2)}" fill="${p.off}" opacity="0.85"/>
         </pattern>`;
  return `
  <defs>
    <linearGradient id="panelFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.panelTop}"/>
      <stop offset="1" stop-color="${p.panelBottom}"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.glass}" stop-opacity="${style.glassAlpha}"/>
      <stop offset="0.42" stop-color="${p.glass}" stop-opacity="0"/>
      <stop offset="1" stop-color="${p.glass}" stop-opacity="${(style.glassAlpha * 0.6).toFixed(3)}"/>
    </linearGradient>
    <linearGradient id="bezel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.bezelHi}"/>
      <stop offset="0.14" stop-color="${p.bezel}"/>
      <stop offset="1" stop-color="#040404"/>
    </linearGradient>
    <radialGradient id="flipOn" cx="0.38" cy="0.3" r="0.9">
      <stop offset="0" stop-color="${p.hot}"/>
      <stop offset="0.5" stop-color="${p.ink}"/>
      <stop offset="1" stop-color="${p.dim}"/>
    </radialGradient>
    <radialGradient id="flipOff" cx="0.36" cy="0.28" r="0.95">
      <stop offset="0" stop-color="#41444d"/>
      <stop offset="0.45" stop-color="#26282e"/>
      <stop offset="1" stop-color="#121317"/>
    </radialGradient>
    <filter id="bloomSm" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="${(style.glow * 0.55).toFixed(2)}"/>
    </filter>
    <filter id="bloomLg" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="${(style.glow * 1.25).toFixed(2)}"/>
    </filter>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="1.2" fill="#000" opacity="0.5"/>
    </pattern>
    ${offGrid}
  </defs>`;
}

function dots(list, { style, color, pitch, opacity = 1, hot }) {
  if (list.length === 0) return '';
  const r = pitch * style.dot;
  const circles = list
    .map(([cx, cy]) => `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${r.toFixed(2)}"/>`)
    .join('');
  if (style.id === 'flip') {
    const shadows = list
      .map(([cx, cy]) => `<circle cx="${cx.toFixed(2)}" cy="${(cy + 1.2).toFixed(2)}" r="${(r * 1.02).toFixed(2)}" fill="#000" opacity="0.5"/>`)
      .join('');
    return `<g opacity="${opacity}">${shadows}<g fill="url(#flipOn)">${circles}</g><g fill="${style.palette.hot}" opacity="0.35">${list
      .map(([cx, cy]) => `<circle cx="${(cx - r * 0.28).toFixed(2)}" cy="${(cy - r * 0.35).toFixed(2)}" r="${(r * 0.3).toFixed(2)}"/>`)
      .join('')}</g></g>`;
  }
  if (style.glow > 0) {
    return (
      `<g opacity="${opacity}">` +
      `<g fill="${color}" filter="url(#bloomLg)" opacity="0.38">${circles}</g>` +
      `<g fill="${color}" filter="url(#bloomSm)" opacity="0.7">${circles}</g>` +
      `<g fill="${color}">${circles}</g>` +
      (hot
        ? `<g fill="${style.palette.hot}" opacity="0.85">${list
            .map(([cx, cy]) => `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(r * 0.42).toFixed(2)}"/>`)
            .join('')}</g>`
        : '') +
      `</g>`
    );
  }
  return `<g fill="${color}" opacity="${opacity}">${circles}</g>`;
}

function text(text, { style, ...opts }) {
  const pitch = opts.pitch ?? style.pitch;
  const dotsList = glyphDots(text, { ...opts, pitch });
  return dots(dotsList, { style, color: opts.color, pitch, opacity: opts.opacity, hot: opts.hot });
}

function textW(text, { style, pitch = style.pitch, scale = 1 }) {
  return textWidth(text, { pitch, scale });
}

let clipCounter = 0;

function panelBackground(style, { w, h }) {
  const p = style.palette;
  const radius = style.id === 'flat' ? 3 : 10;
  const clipId = `clip${++clipCounter}`;
  const svg = `
  <rect x="-16" y="-16" width="${w + 32}" height="${h + 32}" rx="${radius + 6}" fill="url(#bezel)"/>
  <rect x="-16" y="-16" width="${w + 32}" height="${h + 32}" rx="${radius + 6}" fill="none" stroke="#000" stroke-width="1.5" opacity="0.7"/>
  <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" fill="url(#panelFill)"/>
  <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" fill="url(#grid)"/>
  <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" fill="url(#glass)"/>
  <rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" fill="none" stroke="${p.bezelHi}" stroke-width="1" opacity="0.75"/>
  ${style.scanline > 0 ? `<rect x="0" y="0" width="${w}" height="${h}" rx="${radius}" fill="url(#scan)" opacity="${style.scanline}"/>` : ''}
  <clipPath id="${clipId}"><rect x="0" y="0" width="${w}" height="${h}" rx="${radius}"/></clipPath>`;
  return { svg, clipId };
}

function screws(w, h) {
  return [
    [-9, -9],
    [w + 9, -9],
    [-9, h + 9],
    [w + 9, h + 9],
  ]
    .map(
      ([x, y]) =>
        `<circle cx="${x}" cy="${y}" r="2.6" fill="#0b0b0b" stroke="#4a4a52" stroke-width="0.8"/><circle cx="${x - 0.6}" cy="${y - 0.6}" r="0.8" fill="#7a7a84"/>`,
    )
    .join('');
}

// ---------------------------------------------------------------------------
// Dense panel (A / B / D)
// ---------------------------------------------------------------------------

const DENSE = {
  header: 15,
  hero: 42,
  split: 106,
  chart: 158,
  chartTop: 172,
  chartBottom: 250,
  models: 262,
  sessionRows: 316,
  footer: 372,
};

function densePanel(style) {
  const w = 448;
  const h = 400;
  const p = style.palette;
  const pitch = style.pitch;
  const pad = 12;
  const inner = w - pad * 2;
  const parts = [];

  // Header -------------------------------------------------------------
  parts.push(text('TOKEN ISLAND', { style, x: pad, y: DENSE.header, color: p.ink }));
  const liveX = pad + textW('TOKEN ISLAND', { style }) + 14;
  parts.push(dots([[liveX - 9, DENSE.header + (5 * pitch) / 2]], { style, color: p.accent, pitch }));
  parts.push(text('LIVE', { style, x: liveX, y: DENSE.header, color: p.accent }));
  const synced = '2M AGO';
  parts.push(
    text(synced, {
      style,
      x: pad + inner - textW(synced, { style }),
      y: DENSE.header,
      color: p.faint,
    }),
  );

  // Hero ---------------------------------------------------------------
  const heroScale = style.heroScale;
  const todayText = fmt(DATA.today);
  parts.push(text(todayText, { style, x: pad, y: DENSE.hero, scale: heroScale, color: p.ink, hot: true }));
  parts.push(
    text('TODAY', {
      style,
      x: pad + 1,
      y: DENSE.hero + 5 * heroScale * pitch + 6,
      color: p.dim,
    }),
  );
  const costText = fmtCost(DATA.cost);
  const rightX = pad + inner - textW(costText, { style });
  const lineH = 5 * pitch;
  parts.push(text('EST', { style, x: rightX, y: DENSE.hero, color: p.faint }));
  parts.push(text(costText, { style, x: rightX, y: DENSE.hero + lineH + 2, color: p.accent }));
  parts.push(text('-7.2%', { style, x: rightX, y: DENSE.hero + 2 * lineH + 4, color: p.warn }));

  // Split --------------------------------------------------------------
  const groups = [
    { label: 'IN', value: fmt(DATA.input), ratio: DATA.input / DATA.today, color: p.ink },
    { label: 'CACHE', value: fmt(DATA.cache), ratio: DATA.cache / DATA.today, color: p.dim },
    { label: 'OUT', value: fmt(DATA.output), ratio: DATA.output / DATA.today, color: p.hot },
  ];
  const colWidth = inner / 3;
  groups.forEach((group, index) => {
    const gx = pad + index * colWidth;
    parts.push(text(group.label, { style, x: gx, y: DENSE.split, color: p.faint }));
    parts.push(text(group.value, { style, x: gx, y: DENSE.split + 5 * pitch + 5, color: p.ink }));
    const segments = Math.floor((colWidth - 12) / (pitch + 2));
    const filled = Math.max(1, Math.round(group.ratio * segments));
    const barDots = [];
    for (let i = 0; i < filled; i += 1) {
      barDots.push([gx + i * (pitch + 2) + pitch / 2, DENSE.split + 10 * pitch + 10]);
    }
    parts.push(dots(barDots, { style, color: group.color, pitch }));
  });

  // Chart --------------------------------------------------------------
  const chartTop = DENSE.chartTop;
  const chartBottom = DENSE.chartBottom;
  const chartHeight = chartBottom - chartTop;
  const max = Math.max(...DATA.daily);
  const columns = DATA.daily.length;
  const colGap = inner / columns;
  const rows = Math.max(1, Math.floor(chartHeight / pitch));
  parts.push(text('14 DAYS', { style, x: pad, y: DENSE.chart, color: p.faint }));
  parts.push(
    text(`MAX ${fmt(max)}`, {
      style,
      x: pad + inner - textW(`MAX ${fmt(max)}`, { style }),
      y: DENSE.chart,
      color: p.faint,
    }),
  );
  DATA.daily.forEach((value, index) => {
    const lit = Math.max(1, Math.round((value / max) * rows));
    const cx = pad + index * colGap + colGap / 2;
    const dotsList = [];
    for (let r = 0; r < lit; r += 1) {
      for (let w = 0; w < 3; w += 1) {
        dotsList.push([cx + w * pitch, chartBottom - r * pitch - pitch / 2]);
      }
    }
    const isToday = index === columns - 1;
    parts.push(
      dots(dotsList, {
        style,
        pitch,
        color: isToday ? p.accent : p.dim,
        opacity: isToday ? 1 : 0.75,
      }),
    );
  });

  // Models -------------------------------------------------------------
  DATA.models.slice(0, 2).forEach((model, index) => {
    const rowY = DENSE.models + index * 22;
    const name = model.name.length > 11 ? `${model.name.slice(0, 10)}.` : model.name;
    parts.push(text(`${index + 1}`, { style, x: pad, y: rowY, color: p.faint }));
    parts.push(text(name, { style, x: pad + 28, y: rowY, color: p.ink }));
    const barX = pad + 28 + textW('XXXXXXXXXXX', { style }) + 8;
    const segments = 8;
    const filled = Math.max(1, Math.round(model.share * segments));
    const barDots = [];
    for (let i = 0; i < segments; i += 1) {
      if (i < filled) barDots.push([barX + i * (pitch + 2), rowY + 5 * pitch - pitch / 2]);
    }
    parts.push(dots(barDots, { style, color: index === 0 ? p.accent : p.dim, pitch }));
    const valueText = fmt(model.tokens);
    const pctText = `${Math.round(model.share * 100)}%`;
    parts.push(text(pctText, { style, x: pad + inner - textW(pctText, { style }), y: rowY, color: p.dim }));
    parts.push(
      text(valueText, {
        style,
        x: pad + inner - textW(pctText, { style }) - textW(valueText, { style }) - 10,
        y: rowY,
        color: p.ink,
      }),
    );
  });

  // Live sessions ------------------------------------------------------
  DATA.live.forEach((session, index) => {
    const rowY = DENSE.sessionRows + index * 22;
    parts.push(dots([[pad + 2, rowY + (5 * pitch) / 2]], { style, color: p.accent, pitch }));
    const project = session.project.length > 14 ? `${session.project.slice(0, 13)}.` : session.project;
    parts.push(text(project, { style, x: pad + 12, y: rowY, color: p.ink }));
    const agoText = session.ago;
    const tokensText = fmt(session.tokens);
    parts.push(text(agoText, { style, x: pad + inner - textW(agoText, { style }), y: rowY, color: p.faint }));
    parts.push(
      text(tokensText, {
        style,
        x: pad + inner - textW(agoText, { style }) - textW(tokensText, { style }) - 10,
        y: rowY,
        color: p.dim,
      }),
    );
  });

  // Footer -------------------------------------------------------------
  parts.push(
    dots(
      [[pad + 2, DENSE.footer + (5 * pitch) / 2]],
      { style, color: p.accent, pitch },
    ),
  );
  parts.push(text(`${DATA.streak}D STREAK`, { style, x: pad + 12, y: DENSE.footer, color: p.accent }));
  parts.push(
    text(`${DATA.turns} TURNS`, {
      style,
      x: pad + 12 + textW(`${DATA.streak}D STREAK`, { style }) + 10,
      y: DENSE.footer,
      color: p.dim,
    }),
  );
  parts.push(
    text('V0.2.0', {
      style,
      x: pad + inner - textW('V0.2.0', { style }),
      y: DENSE.footer,
      color: p.faint,
    }),
  );

  const bg = panelBackground(style, { w, h });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 32}" height="${h + 32}" viewBox="-16 -16 ${w + 32} ${h + 32}">
    ${defs(style)}
    ${bg.svg}
    <g clip-path="url(#${bg.clipId})">${parts.join('')}</g>
    ${screws(w, h)}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Flip-dot panel (C) — coarser, deliberately less information
// ---------------------------------------------------------------------------

function flipPanel(style) {
  const w = 448;
  const h = 400;
  const p = style.palette;
  const pitch = style.pitch;
  const pad = 14;
  const inner = w - pad * 2;
  const parts = [];
  const lineH = 5 * pitch;

  parts.push(text('TOKEN ISLAND', { style, x: pad, y: 16, color: p.ink }));
  parts.push(dots([[pad + inner - 4, 16 + lineH / 2]], { style, color: p.accent, pitch }));

  parts.push(text(fmt(DATA.today), { style, x: pad, y: 54, scale: 2, color: p.ink }));
  parts.push(text('TODAY', { style, x: pad, y: 112, color: p.dim }));
  parts.push(text(`EST ${fmtCost(DATA.cost)}`, { style, x: pad, y: 142, color: p.accent }));

  // 14 day chart, coarse dots
  parts.push(text('14 DAYS', { style, x: pad, y: 180, color: p.faint }));
  const chartTop = 206;
  const chartBottom = 300;
  const max = Math.max(...DATA.daily);
  const colGap = inner / DATA.daily.length;
  DATA.daily.forEach((value, index) => {
    const lit = Math.max(1, Math.round((value / max) * 10));
    const cx = pad + index * colGap + colGap / 2;
    const isToday = index === DATA.daily.length - 1;
    const dotsList = [];
    for (let r = 0; r < lit; r += 1) {
      dotsList.push([cx, chartBottom - r * pitch - pitch / 2]);
      dotsList.push([cx + pitch, chartBottom - r * pitch - pitch / 2]);
    }
    parts.push(dots(dotsList, { style, pitch, color: isToday ? p.accent : p.ink, opacity: isToday ? 1 : 0.85 }));
  });
  void chartTop;

  parts.push(text('2 SESSIONS LIVE', { style, x: pad, y: 312, color: p.ink }));
  DATA.live.forEach((session, index) => {
    const rowY = 340 + index * lineH;
    if (rowY + lineH > h - 4) return;
    parts.push(dots([[pad + 2, rowY + lineH / 2]], { style, color: p.accent, pitch }));
    const project = session.project.length > 11 ? `${session.project.slice(0, 10)}.` : session.project;
    parts.push(text(project, { style, x: pad + 14, y: rowY, color: p.dim }));
    parts.push(text(session.ago, { style, x: pad + inner - textW(session.ago, { style }), y: rowY, color: p.faint }));
  });

  const bg = panelBackground(style, { w, h });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 32}" height="${h + 32}" viewBox="-16 -16 ${w + 32} ${h + 32}">
    ${defs(style)}
    ${bg.svg}
    <g clip-path="url(#${bg.clipId})">${parts.join('')}</g>
    ${screws(w, h)}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Collapsed pill
// ---------------------------------------------------------------------------

function collapsedSvg(style) {
  const w = 224;
  const h = 44;
  const pitch = style.pitch;
  const pad = 10;
  const parts = [];
  const p = style.palette;
  const todayText = fmt(DATA.today);
  const row1Y = 7;
  const row2Pitch = Math.max(2, pitch - 1);
  parts.push(dots([[pad + 2, row1Y + 8]], { style, color: p.accent, pitch }));
  parts.push(text(todayText, { style, x: pad + 12, y: row1Y, color: p.ink, hot: true }));
  const todayX = pad + 12 + textW(todayText, { style }) + 8;
  parts.push(text('TODAY', { style, x: todayX, y: row1Y + 1, color: p.faint }));
  const line2 = `EST ${fmtCost(DATA.cost)}  -7.2%`;
  parts.push(text(line2, { style, pitch: row2Pitch, x: pad + 12, y: 27, color: p.dim }));
  const bg = panelBackground(style, { w, h });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + 32}" height="${h + 32}" viewBox="-16 -16 ${w + 32} ${h + 32}">
    ${defs(style)}
    ${bg.svg}
    <g clip-path="url(#${bg.clipId})">${parts.join('')}</g>
  </svg>`;
}

// ---------------------------------------------------------------------------
// README strip: badges + chart
// ---------------------------------------------------------------------------

function readmeSvg(style) {
  const width = 720;
  const height = 260;
  const pitch = 2;
  const p = style.palette;
  const parts = [];
  const badges = [
    ['TOKENS', fmt(DATA.today), p.ink],
    ['EST SPEND', fmtCost(DATA.cost), p.hot],
    ['STREAK', `${DATA.streak}D`, p.hot],
  ];
  let bx = 32;
  for (const [label, value, color] of badges) {
    const bw = 8 + textW(label, { style, pitch }) + 10 + textW(value, { style, pitch }) + 8;
    const bh = 28;
    const bg = panelBackground(style, { w: bw, h: bh });
    parts.push(
      `<g transform="translate(${bx} 24)">${bg.svg}` +
        `<g clip-path="url(#${bg.clipId})">` +
        text(label, { style, pitch, x: 7, y: 8, color: p.faint }) +
        text(value, { style, pitch, x: 7 + textW(label, { style, pitch }) + 10, y: 8, color }) +
        `</g></g>`,
    );
    bx += bw + 22;
  }

  const chartW = 656;
  const chartH = 148;
  const chartX = 32;
  const chartY = 90;
  const dailyMax = Math.max(...DATA.daily);
  const chartBg = panelBackground(style, { w: chartW, h: chartH });
  parts.push(`<g transform="translate(${chartX} ${chartY})">`);
  parts.push(chartBg.svg);
  parts.push(`<g clip-path="url(#${chartBg.clipId})">`);
  parts.push(text('DAILY TOKENS  -  LAST 14 DAYS', { style, pitch, x: 8, y: 9, color: p.dim }));
  const maxLabel = `MAX ${fmt(dailyMax)}`;
  parts.push(text(maxLabel, { style, pitch, x: chartW - 8 - textW(maxLabel, { style, pitch }), y: 9, color: p.faint }));
  const colGap = (chartW - 16) / DATA.daily.length;
  const rows = Math.floor((chartH - 26) / pitch);
  DATA.daily.forEach((value, index) => {
    const lit = Math.max(1, Math.round((value / dailyMax) * rows));
    const cx = 8 + index * colGap + colGap / 2;
    const isToday = index === DATA.daily.length - 1;
    const dotsList = [];
    for (let r = 0; r < lit; r += 1) {
      dotsList.push([cx, chartH - 12 - r * pitch]);
      dotsList.push([cx + pitch, chartH - 12 - r * pitch]);
    }
    parts.push(dots(dotsList, { style, pitch, color: isToday ? p.accent : p.dim, opacity: isToday ? 1 : 0.85 }));
  });
  parts.push(`</g></g>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${defs(style)}
    <rect width="${width}" height="${height}" fill="${p.bg}"/>
    ${parts.join('')}
  </svg>`;
}

// ---------------------------------------------------------------------------
// Wallpaper + HTML wrappers
// ---------------------------------------------------------------------------

function wallpaperSvg() {
  let seed = 11;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const stars = [];
  for (let i = 0; i < 110; i += 1) {
    const x = Math.round(rand() * 960);
    const y = Math.round(rand() * 400);
    const size = rand() > 0.86 ? 2 : 1;
    const palette = ['#3be8b0', '#5b9dff', '#b388ff', '#6b6689'];
    stars.push(
      `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${palette[Math.floor(rand() * 4)]}" opacity="${(0.2 + rand() * 0.55).toFixed(2)}"/>`,
    );
  }
  const buildings = [];
  for (let x = 0; x < 960; x += 42) {
    const height = Math.round(50 + rand() * 170);
    const width = 24 + Math.round(rand() * 14);
    buildings.push(`<rect x="${x}" y="${570 - height}" width="${width}" height="${height}" fill="#0e0e19" stroke="#1e1b2e" stroke-width="1"/>`);
    for (let wy = 570 - height + 10; wy < 560; wy += 13) {
      for (let wx = x + 5; wx < x + width - 5; wx += 10) {
        if (rand() > 0.58) {
          buildings.push(`<rect x="${wx}" y="${wy}" width="3" height="3" fill="${rand() > 0.75 ? '#3be8b0' : '#5f5a7a'}" opacity="0.55"/>`);
        }
      }
    }
  }
  const skylineBars = [];
  for (let i = 0; i < 15; i += 1) {
    const height = 8 + Math.round(rand() * 55);
    skylineBars.push(`<rect x="${22 + i * 18}" y="${568 - height}" width="8" height="${height}" fill="${i % 3 === 0 ? '#3be8b0' : '#1f7a62'}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0a0a16"/>
        <stop offset="0.5" stop-color="#0d0b1a"/>
        <stop offset="1" stop-color="#080810"/>
      </linearGradient>
      <radialGradient id="aura" cx="0.5" cy="0.05" r="0.75">
        <stop offset="0" stop-color="#2a2350" stop-opacity="0.45"/>
        <stop offset="1" stop-color="#0a0a12" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="960" height="600" fill="url(#sky)"/>
    <rect width="960" height="300" fill="url(#aura)"/>
    ${stars.join('')}
    ${buildings.join('')}
    ${skylineBars.join('')}
    <rect x="0" y="568" width="960" height="32" fill="#06060d"/>
    <rect x="0" y="568" width="960" height="2" fill="#1e1b2e"/>
  </svg>`;
}

function page(inner, { width = 960, height = 600, background = '#050508' } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:${background}}
    .wall{position:absolute;inset:0}
    .widget{position:absolute;left:50%;transform:translateX(-50%);top:-16px}
  </style></head><body>
    <div style="position:relative;width:${width}px;height:${height}px">
      <div class="wall">${wallpaperSvg()}</div>
      <div class="widget">${inner}</div>
    </div>
  </body></html>`;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

const manifest = [];
for (const [id, style] of Object.entries(STYLES)) {
  const styled = { ...style, id };
  const expandedInner = styled.dense ? densePanel(styled) : flipPanel(styled);
  writeFileSync(resolve(OUT, `${id}-expanded.html`), page(expandedInner));
  writeFileSync(resolve(OUT, `${id}-collapsed.html`), page(collapsedSvg(styled)));
  writeFileSync(
    resolve(OUT, `${id}-readme.html`),
    page(readmeSvg(styled), { width: 720, height: 260, background: styled.palette.bg }),
  );
  writeFileSync(resolve(OUT, `${id}-expanded.svg`), expandedInner);
  writeFileSync(resolve(OUT, `${id}-collapsed.svg`), collapsedSvg(styled));
  writeFileSync(resolve(OUT, `${id}-readme.svg`), readmeSvg(styled));
  manifest.push({ id, label: style.label, caption: style.caption });
}

writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(manifest.map((m) => `${m.id}: ${m.label}`).join('\n'));
console.log(`out: ${OUT}`);
