/**
 * Pixel SVG charts for READMEs and the dashboard (hand-written, self-contained).
 *
 *   /u/:user/chart.svg?type=line|bar|heatmap|models
 *                      &days=7..365&theme=dark|light|auto&width&height
 *
 * Design language (docs/CONTRACT-V3.md §3): V2 pixel panels, borders and bitmap
 * labels, but the **data marks are dot-matrix** — line points are dots joined by
 * a 1px stepped connector over a faint dot-texture area, bars are 2-dot-wide
 * columns with a faint track, model bars are dot segments and the heatmap keeps
 * its square cells while its legend swatches become dots.  Axis labels, titles
 * and empty states stay bitmap text (readability first).  No `<text>`, no
 * curves, no gradients, no external fonts.
 */

import { formatCost, pixelRectPath, pixelSpriteSvg } from '@token-island/core';
import type { ChartSeries, ModelStat } from '../stats.js';
import { chartHeader, dotAreaDef, dotGridDef, emptyState, pixelInset2, pixelPanel, svgFrame } from './frame.js';
import {
  clampNumber,
  costLabel,
  heatPaintByRatio,
  modelPaint,
  monthShort,
  niceMax,
  paintFill,
  paintStroke,
  paletteFor,
  parseSvgTheme,
  percentLabel,
  pixelText,
  shortDate,
  textWidth,
  tokensLabel,
  weekdayIndex,
  type Paint,
  type SvgTheme,
} from './tokens.js';

export type ChartType = 'line' | 'bar' | 'heatmap' | 'models';

const CHART_TYPES: readonly ChartType[] = ['line', 'bar', 'heatmap', 'models'];

export function parseChartType(raw: unknown): ChartType {
  return typeof raw === 'string' && (CHART_TYPES as readonly string[]).includes(raw)
    ? (raw as ChartType)
    : 'line';
}

export interface ChartOptions {
  type?: unknown;
  days?: unknown;
  theme?: unknown;
  width?: unknown;
  height?: unknown;
  idPrefix?: string;
  /** `false` hides the built-in header (used by dashboard cards with their own title). */
  header?: unknown;
}

interface ChartDimensions {
  width: number;
  height: number;
}

function chartDimensions(type: ChartType, rawWidth: unknown, rawHeight: unknown): ChartDimensions {
  const width = Math.round(clampNumber(rawWidth, 320, 1200, type === 'heatmap' ? 840 : 760));
  switch (type) {
    case 'heatmap':
      return { width, height: Math.round(clampNumber(rawHeight, 120, 400, 190)) };
    case 'models':
      return { width, height: Math.round(clampNumber(rawHeight, 120, 400, 260)) };
    case 'line':
    case 'bar':
    default:
      return { width, height: Math.round(clampNumber(rawHeight, 120, 400, 220)) };
  }
}

const PAD = 20;

function chartFrame(params: {
  width: number;
  height: number;
  theme: SvgTheme;
  idPrefix: string;
  title: string;
  description: string;
  defs: string;
  body: string;
}): string {
  const panel = pixelPanel({
    x: 0,
    y: 0,
    width: params.width,
    height: params.height,
    theme: params.theme,
    fill: 'bg',
    border: 'border',
    corner: 2,
  });
  return svgFrame({
    width: params.width,
    height: params.height,
    theme: params.theme,
    idPrefix: params.idPrefix,
    title: params.title,
    description: params.description,
    defs: params.defs,
    body: panel + params.body,
    background: null,
  });
}

function headerFor(params: {
  showHeader: boolean;
  theme: SvgTheme;
  width: number;
  title: string;
  detail: string;
}): string {
  if (!params.showHeader) return '';
  return chartHeader({
    theme: params.theme,
    x: PAD,
    y: 16,
    width: params.width - PAD * 2,
    title: params.title,
    detail: params.detail,
  });
}

function chartSummary(series: ChartSeries): string {
  return `${tokensLabel(series.totalTokens)} TOKENS · ${costLabel(series.totalCost)}`;
}

// ---------------------------------------------------------------------------
// Line + bar
// ---------------------------------------------------------------------------

interface PlotGeometry {
  left: number;
  top: number;
  right: number;
  bottom: number;
  plotWidth: number;
  plotHeight: number;
}

function plotGeometry(width: number, height: number, showHeader: boolean): PlotGeometry {
  // scale-2 y labels can be 5 chars wide (e.g. `1.25M`); reserve 64px.
  const left = PAD + 64;
  const right = width - PAD;
  const top = showHeader ? 52 : 22;
  const bottom = height - 32;
  return {
    left,
    top,
    right,
    bottom,
    plotWidth: Math.max(10, right - left),
    plotHeight: Math.max(10, bottom - top),
  };
}

/** 1px dashed horizontal rule made of 3px on / 3px off pixel segments. */
function dashedRule(left: number, right: number, y: number, theme: SvgTheme, paint: Paint = 'grid'): string {
  const commands: string[] = [];
  for (let x = left; x + 3 <= right; x += 6) commands.push(`M${x} ${y}h3v1h-3z`);
  if (commands.length === 0) return '';
  return `<path d="${commands.join('')}" ${paintFill(theme, paint)}/>`;
}

// ---------------------------------------------------------------------------
// Dot-matrix data marks (V3).  Data points are circles on the integer grid;
// labels stay bitmap text so the chart is always readable at README size.
// ---------------------------------------------------------------------------

/** One theme-aware circle: integer centre, 0.1px radius precision. */
function dotCircle(cx: number, cy: number, radius: number): string {
  const r = Math.round(radius * 10) / 10;
  return `<circle cx="${Math.round(cx)}" cy="${Math.round(cy)}" r="${r}"/>`;
}

/** A painted group of dots (class-based fills so `auto` follows the reader's theme). */
function dotMarks(
  theme: SvgTheme,
  paint: Paint,
  dots: readonly (readonly [number, number])[],
  radius: number,
  opacity?: number,
): string {
  if (dots.length === 0) return '';
  const opacityAttr = opacity !== undefined ? ` opacity="${opacity}"` : '';
  return (
    `<g ${paintFill(theme, paint)}${opacityAttr}>` +
    dots.map(([cx, cy]) => dotCircle(cx, cy, radius)).join('') +
    `</g>`
  );
}

/** Evenly spaced integer row offsets from `bottom` up, used by bar dot columns. */
function dotRowYs(bottom: number, rows: number, pitch: number): number[] {
  const ys: number[] = [];
  for (let row = 0; row < rows; row += 1) ys.push(Math.round(bottom - (row + 0.5) * pitch));
  return ys;
}


function yAxisLabels(geometry: PlotGeometry, max: number, theme: SvgTheme): string {
  const parts: string[] = [];
  const rows: Array<[number, string]> = [
    [geometry.top, tokensLabel(max)],
    [geometry.top + Math.round(geometry.plotHeight / 2), tokensLabel(max / 2)],
    [geometry.bottom, '0'],
  ];
  for (const [y, label] of rows) {
    parts.push(
      pixelText(label, { x: geometry.left - 8, y: y - 5, scale: 2, paint: 'inkDim', align: 'right' }, theme),
    );
  }
  return parts.join('');
}

function xAxisLabels(
  geometry: PlotGeometry,
  daily: ChartSeries['daily'],
  theme: SvgTheme,
): string {
  const count = daily.length;
  if (count === 0) return '';
  const indexes = count > 1 ? [0, Math.floor((count - 1) / 2), count - 1] : [0];
  const labelY = geometry.bottom + 10;
  const parts: string[] = [];
  for (const index of indexes) {
    const date = daily[index]?.date;
    if (!date) continue;
    const x = xPosition(geometry, count, index);
    const anchor = index === 0 ? 'left' : index === count - 1 ? 'right' : 'center';
    parts.push(pixelText(shortDate(date), { x, y: labelY, scale: 2, paint: 'inkDim', align: anchor }, theme));
  }
  return parts.join('');
}

function xPosition(geometry: PlotGeometry, count: number, index: number): number {
  if (count <= 1) return geometry.left;
  return geometry.left + Math.round((index / (count - 1)) * geometry.plotWidth);
}

function renderLineChart(
  series: ChartSeries,
  dimensions: ChartDimensions,
  theme: SvgTheme,
  idPrefix: string,
  showHeader: boolean,
): string {
  const { width, height } = dimensions;
  const daily = series.daily;
  const values = daily.map((day) => day.totalTokens);
  const rawMax = values.reduce((max, value) => Math.max(max, value), 0);
  const empty = daily.length === 0 || rawMax <= 0;

  const defs = empty
    ? ''
    : dotAreaDef(theme, `${idPrefix}-area`, 'teal', { gap: 6, radius: 1.1, opacity: 0.18 }) +
      dotGridDef(theme, `${idPrefix}-dots`, 'grid', 8);
  const body: string[] = [];
  body.push(headerFor({ showHeader, theme, width, title: 'DAILY TOKENS', detail: chartSummary(series) }));

  if (empty) {
    body.push(emptyState({ theme, cx: Math.round(width / 2), cy: Math.round(height / 2) }));
    return chartFrame({
      width,
      height,
      theme,
      idPrefix,
      title: 'Token Island · daily tokens',
      description: 'No daily token data has been synced yet.',
      defs,
      body: body.join(''),
    });
  }

  const max = niceMax(rawMax);
  const geometry = plotGeometry(width, height, showHeader);
  const n = daily.length;
  const yFor = (value: number): number =>
    Math.min(geometry.bottom, geometry.bottom - Math.round((Math.min(value, max) / max) * geometry.plotHeight));

  // Faint dot grid + dashed horizontal rules; both stay subtler than the data.
  body.push(
    `<path d="${pixelRectPath(geometry.left, geometry.top, geometry.plotWidth, geometry.plotHeight, 0)}" fill="url(#${idPrefix}-dots)"/>`,
  );
  for (const fraction of [0.25, 0.5, 0.75]) {
    const y = geometry.bottom - Math.round(fraction * geometry.plotHeight);
    body.push(dashedRule(geometry.left, geometry.right, y, theme));
  }
  body.push(dashedRule(geometry.left, geometry.right, geometry.bottom, theme, 'border'));

  // Staircase area filled with a very faint dot texture (readable, not a band).
  const y0 = yFor(values[0] ?? 0);
  const area: string[] = [`M${geometry.left} ${geometry.bottom}`, `V${y0}`];
  const connector: string[] = [];
  for (let index = 0; index < n - 1; index += 1) {
    const xCurrent = xPosition(geometry, n, index);
    const xNext = xPosition(geometry, n, index + 1);
    const yNext = yFor(values[index + 1] ?? 0);
    area.push(`h${Math.max(1, xNext - xCurrent)}`, `V${yNext}`);
    connector.push(`H${xNext}`, `V${yNext}`);
  }
  area.push(`V${geometry.bottom}`, 'Z');
  body.push(`<path d="${area.join('')}" fill="url(#${idPrefix}-area)"/>`);

  // 1px low-opacity stepped connector — it links the dots without becoming a
  // thick line that would compete with the axis labels.
  body.push(
    `<path d="M${geometry.left} ${y0}${connector.join('')}" fill="none" ${paintStroke(
      theme,
      'teal',
    )} stroke-width="1" opacity="0.45"/>`,
  );

  // Data points: one dot per day, 1.8–2.4px radius; today is a mint dot.
  const points: Array<readonly [number, number]> = daily.map((_, index) => [
    xPosition(geometry, n, index),
    yFor(values[index] ?? 0),
  ]);
  const pointRadius = n > 180 ? 1.8 : n > 90 ? 2 : 2.2;
  body.push(dotMarks(theme, 'teal', points.slice(0, -1), pointRadius));
  const last = points[n - 1];
  if (last) body.push(dotMarks(theme, 'mint', [last], 2.4));

  body.push(yAxisLabels(geometry, max, theme), xAxisLabels(geometry, daily, theme));

  return chartFrame({
    width,
    height,
    theme,
    idPrefix,
    title: `Token Island · daily tokens (last ${n} days)`,
    description: `Dot-matrix line chart of daily token usage for the last ${n} days: ${tokensLabel(
      series.totalTokens,
    )} tokens in total, about ${formatCost(series.totalCost, { approx: true })} estimated spend.`,
    defs,
    body: body.join(''),
  });
}

function renderBarChart(
  series: ChartSeries,
  dimensions: ChartDimensions,
  theme: SvgTheme,
  idPrefix: string,
  showHeader: boolean,
): string {
  const { width, height } = dimensions;
  const daily = series.daily;
  const values = daily.map((day) => day.totalTokens);
  const rawMax = values.reduce((max, value) => Math.max(max, value), 0);
  const empty = daily.length === 0 || rawMax <= 0;

  const body: string[] = [];
  body.push(headerFor({ showHeader, theme, width, title: 'DAILY TOKENS', detail: chartSummary(series) }));
  if (empty) {
    body.push(emptyState({ theme, cx: Math.round(width / 2), cy: Math.round(height / 2) }));
    return chartFrame({
      width,
      height,
      theme,
      idPrefix,
      title: 'Token Island · daily tokens',
      description: 'No daily token data has been synced yet.',
      defs: dotGridDef(theme, `${idPrefix}-dots`, 'grid', 8),
      body: body.join(''),
    });
  }

  const max = niceMax(rawMax);
  const geometry = plotGeometry(width, height, showHeader);
  const n = daily.length;

  body.push(
    `<path d="${pixelRectPath(geometry.left, geometry.top, geometry.plotWidth, geometry.plotHeight, 0)}" fill="url(#${idPrefix}-dots)"/>`,
  );
  for (const fraction of [0.25, 0.5, 0.75]) {
    const y = geometry.bottom - Math.round(fraction * geometry.plotHeight);
    body.push(dashedRule(geometry.left, geometry.right, y, theme));
  }
  body.push(dashedRule(geometry.left, geometry.right, geometry.bottom, theme, 'border'));

  // Dot-matrix columns: every day is 2 dots wide on a faint track.  The grid
  // pitch adapts to the window so 7 days stay chunky and 90+ days never turn
  // into an unreadable point mass.
  const slot = geometry.plotWidth / n;
  const columnPitch = Math.max(2, Math.min(7, Math.floor(slot * 0.5)));
  const radius = Math.max(1, Math.min(2.6, columnPitch * 0.38 + 0.35));
  const naturalRowPitch = Math.max(3, Math.min(9, geometry.plotHeight / 18));
  const naturalRows = Math.max(1, Math.floor(geometry.plotHeight / naturalRowPitch));
  // Short windows (the README default) keep a full dot track.  Long windows
  // paint the unlit track as a 1px dotted rule so the SVG stays lean while the
  // lit dots keep the full matrix resolution.
  const dotTrack = n <= 45;
  const rows = dotTrack
    ? Math.max(6, Math.min(naturalRows, Math.floor(3000 / (3 * n))))
    : Math.max(6, Math.min(naturalRows, Math.floor(2600 / n)));
  const rowPitch = geometry.plotHeight / rows;
  const rowYs = dotRowYs(geometry.bottom - 1, rows, rowPitch);

  const trackDots: Array<readonly [number, number]> = [];
  const trackRules: string[] = [];
  const litDots: Array<readonly [number, number]> = [];
  const todayDots: Array<readonly [number, number]> = [];
  for (let index = 0; index < n; index += 1) {
    const clusterX = Math.round(geometry.left + (index + 0.5) * slot - columnPitch / 2);
    if (dotTrack) {
      for (const y of rowYs) trackDots.push([clusterX, y], [clusterX + columnPitch, y]);
    } else {
      trackRules.push(`M${clusterX + Math.round(columnPitch / 2)} ${geometry.bottom - 1}V${geometry.top}`);
    }
    const value = values[index] ?? 0;
    const lit = value > 0 ? Math.max(1, Math.min(rows, Math.round((Math.min(value, max) / max) * rows))) : 0;
    const isToday = index === n - 1;
    const target = isToday ? todayDots : litDots;
    for (let row = 0; row < lit; row += 1) {
      const y = rowYs[row] as number;
      target.push([clusterX, y], [clusterX + columnPitch, y]);
    }
  }
  body.push(
    dotMarks(theme, 'border', trackDots, Math.max(0.6, radius * 0.55), 0.55),
    trackRules.length > 0
      ? `<path d="${trackRules.join('')}" fill="none" ${paintStroke(
          theme,
          'border',
        )} stroke-width="1" stroke-dasharray="1 3" opacity="0.6"/>`
      : '',
    dotMarks(theme, 'inkDim', litDots, radius),
    dotMarks(theme, 'teal', todayDots, radius * 1.08),
  );
  body.push(yAxisLabels(geometry, max, theme), xAxisLabels(geometry, daily, theme));

  return chartFrame({
    width,
    height,
    theme,
    idPrefix,
    title: `Token Island · daily tokens (last ${n} days)`,
    description: `Dot-matrix column chart of daily token usage for the last ${n} days: ${tokensLabel(
      series.totalTokens,
    )} tokens in total.`,
    defs: dotGridDef(theme, `${idPrefix}-dots`, 'grid', 8),
    body: body.join(''),
  });
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

const HEAT_GAP = 3;
const WEEKDAYS = ['MON', 'WED', 'FRI'] as const;

function renderHeatmap(
  series: ChartSeries,
  dimensions: ChartDimensions,
  theme: SvgTheme,
  idPrefix: string,
  showHeader: boolean,
): string {
  const { width, height } = dimensions;
  const daily = series.daily;
  const values = daily.map((day) => day.totalTokens);
  const rawMax = values.reduce((max, value) => Math.max(max, value), 0);
  const body: string[] = [];
  body.push(headerFor({ showHeader, theme, width, title: 'DAILY ACTIVITY', detail: chartSummary(series) }));
  if (daily.length === 0 || rawMax <= 0) {
    body.push(emptyState({ theme, cx: Math.round(width / 2), cy: Math.round(height / 2) }));
    return chartFrame({
      width,
      height,
      theme,
      idPrefix,
      title: 'Token Island · daily activity calendar',
      description: 'No daily activity has been synced yet.',
      defs: '',
      body: body.join(''),
    });
  }

  const firstDate = daily[0]?.date ?? '';
  const leading = (weekdayIndex(firstDate) + 6) % 7; // Monday = 0
  const columns = Math.max(1, Math.ceil((leading + daily.length) / 7));
  const labelWidth = Math.max(34, textWidth('WED', 2) + 10);
  const gridLeft = PAD + labelWidth;
  const gridRight = width - PAD;
  const available = Math.max(20, gridRight - gridLeft);
  const monthRowY = showHeader ? 44 : 18;
  const gridTop = showHeader ? 60 : 32;
  const legendRowY = height - 20;
  const availableHeight = Math.max(20, legendRowY - 14 - gridTop);
  const cellByWidth = Math.floor((available - (columns - 1) * HEAT_GAP) / columns);
  const cellByHeight = Math.floor((availableHeight - 6 * HEAT_GAP) / 7);
  const cell = Math.max(4, Math.min(12, cellByWidth, cellByHeight));
  const gridWidth = columns * cell + (columns - 1) * HEAT_GAP;
  const gridHeight = 7 * cell + 6 * HEAT_GAP;
  const gridX = gridLeft + Math.max(0, Math.floor((available - gridWidth) / 2));
  const gridY = gridTop + Math.max(0, Math.floor((availableHeight - gridHeight) / 2));

  const cells: string[] = [];
  const monthLabels: string[] = [];
  let lastMonth = '';
  let lastMonthX = -Infinity;
  for (let index = 0; index < daily.length; index += 1) {
    const day = daily[index];
    if (!day) continue;
    const slot = leading + index;
    const column = Math.floor(slot / 7);
    const row = slot % 7;
    const x = gridX + column * (cell + HEAT_GAP);
    const y = gridY + row * (cell + HEAT_GAP);
    const ratio = rawMax > 0 ? day.totalTokens / rawMax : 0;
    const empty = day.totalTokens <= 0;
    cells.push(
      `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" ${paintFill(
        theme,
        empty ? 'surfaceAlt' : heatPaintByRatio(theme, ratio),
      )}/>`,
    );
    if (index === daily.length - 1) {
      cells.push(
        `<path d="${pixelRectPath(x, y, cell, cell, 0)}" fill="none" ${paintStroke(
          theme,
          'inkFaint',
        )} stroke-width="1" shape-rendering="crispEdges"/>`,
      );
    }
    const month = day.date.slice(0, 7);
    const monthLabelWidth = textWidth(monthShort(day.date), 2);
    if (month !== lastMonth && x - lastMonthX >= monthLabelWidth + 12) {
      monthLabels.push(
        pixelText(monthShort(day.date), { x, y: monthRowY, scale: 2, paint: 'inkDim' }, theme),
      );
      lastMonth = month;
      lastMonthX = x;
    }
  }

  const weekdayLabels: string[] = [];
  const weekdayRows = [
    [0, WEEKDAYS[0]],
    [2, WEEKDAYS[1]],
    [4, WEEKDAYS[2]],
  ] as const;
  for (const [row, label] of weekdayRows) {
    weekdayLabels.push(
      pixelText(
        label,
        {
          x: gridX - 8,
          y: gridY + row * (cell + HEAT_GAP) + Math.floor((cell - 10) / 2),
          scale: 2,
          paint: 'inkDim',
          align: 'right',
        },
        theme,
      ),
    );
  }

  // Legend: LESS [4 swatches] MORE.
  const legendCell = 10;
  const legendGap = 3;
  const squaresWidth = 4 * legendCell + 3 * legendGap;
  const legendLabelY = legendRowY;
  const moreLabel = pixelText('MORE', { x: width - PAD, y: legendLabelY, scale: 2, paint: 'inkDim', align: 'right' }, theme);
  const squaresX = width - PAD - textWidth('MORE', 2) - 8 - squaresWidth;
  const lessLabel = pixelText('LESS', { x: squaresX - 8, y: legendLabelY, scale: 2, paint: 'inkDim', align: 'right' }, theme);
  // Legend swatches are dot-matrix marks; the calendar cells stay square.
  const swatches: string[] = [];
  for (let level = 1; level <= 4; level += 1) {
    const boxX = squaresX + (level - 1) * (legendCell + legendGap);
    const dots: Array<readonly [number, number]> = [
      [boxX + 2, legendRowY + 2],
      [boxX + 8, legendRowY + 2],
      [boxX + 2, legendRowY + 8],
      [boxX + 8, legendRowY + 8],
    ];
    swatches.push(dotMarks(theme, heatPaintByRatio(theme, level / 4 - 0.01), dots, 2.1));
  }

  body.push(
    monthLabels.join(''),
    weekdayLabels.join(''),
    cells.join(''),
    lessLabel,
    swatches.join(''),
    moreLabel,
  );

  return chartFrame({
    width,
    height,
    theme,
    idPrefix,
    title: `Token Island · daily activity calendar (${daily.length} days)`,
    description: `Pixel heatmap of daily token usage from ${firstDate}: ${tokensLabel(
      series.totalTokens,
    )} tokens in total.`,
    defs: '',
    body: body.join(''),
  });
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** Horizontal dot-segment bar (faint track dots + lit dots) for the models chart. */
function dotSegmentBar(params: {
  x: number;
  y: number;
  width: number;
  height: number;
  ratio: number;
  paint: Paint;
  theme: SvgTheme;
}): string {
  const pitch = 8;
  const count = Math.max(1, Math.floor(params.width / pitch));
  const startX = params.x + Math.floor((params.width - (count - 1) * pitch) / 2);
  const cy = params.y + Math.round(params.height / 2);
  const filled = Math.max(0, Math.min(count, Math.round(params.ratio * count)));
  const track: Array<readonly [number, number]> = [];
  const lit: Array<readonly [number, number]> = [];
  for (let index = 0; index < count; index += 1) {
    const dot: readonly [number, number] = [startX + index * pitch, cy];
    if (index < filled) lit.push(dot);
    else track.push(dot);
  }
  return (
    dotMarks(params.theme, 'border', track, 1.5, 0.6) +
    dotMarks(params.theme, params.paint, lit, 2.2)
  );
}

function renderModelsChart(
  series: ChartSeries,
  dimensions: ChartDimensions,
  theme: SvgTheme,
  idPrefix: string,
  showHeader: boolean,
): string {
  const { width, height } = dimensions;
  const models: ModelStat[] = series.models.slice(0, 5);
  const total = series.models.reduce((sum, model) => sum + model.totalTokens, 0);
  const body: string[] = [];
  body.push(
    headerFor({
      showHeader,
      theme,
      width,
      title: 'TOP MODELS',
      detail: `${tokensLabel(total)} TOKENS`,
    }),
  );
  if (models.length === 0 || total <= 0) {
    body.push(emptyState({ theme, cx: Math.round(width / 2), cy: Math.round(height / 2) }));
    return chartFrame({
      width,
      height,
      theme,
      idPrefix,
      title: 'Token Island · top models',
      description: 'No model data has been synced yet.',
      defs: '',
      body: body.join(''),
    });
  }

  const rowsTop = showHeader ? 54 : 20;
  const rowsHeight = height - rowsTop - 16;
  const rowHeight = Math.max(24, Math.floor(rowsHeight / 5));
  const barWidth = 200;
  const barHeight = 8;
  const rightShareWidth = Math.max(36, textWidth('100%', 2));
  const tokensWidth = Math.max(48, textWidth('999.9T', 2));
  const barX = width - PAD - rightShareWidth - 12 - barWidth - 12 - tokensWidth;
  const labelMax = Math.max(40, barX - PAD - 12);

  const rows: string[] = [];
  models.forEach((model, index) => {
    const rowTop = rowsTop + index * rowHeight;
    const barY = rowTop + Math.floor((rowHeight - barHeight) / 2);
    const labelY = rowTop + Math.floor((rowHeight - 10) / 2);
    const color = modelPaint(theme, index);
    rows.push(
      pixelText(fitModelLabel(model.model, labelMax), { x: PAD, y: labelY, scale: 2, paint: 'ink' }, theme),
    );
    rows.push(pixelInset2({ x: barX, y: barY, width: barWidth, height: barHeight, theme, fill: 'inset' }));
    rows.push(
      dotSegmentBar({
        x: barX,
        y: barY,
        width: barWidth,
        height: barHeight,
        ratio: model.share,
        paint: color,
        theme,
      }),
    );
    rows.push(
      pixelText(tokensLabel(model.totalTokens), {
        x: barX + barWidth + 12,
        y: labelY,
        scale: 2,
        paint: 'ink',
      }, theme),
    );
    rows.push(
      pixelText(percentLabel(model.share), {
        x: width - PAD,
        y: labelY,
        scale: 2,
        paint: 'inkDim',
        align: 'right',
      }, theme),
    );
  });

  const extra = series.models.length - models.length;
  if (extra > 0) {
    body.push(
      pixelText(`+${extra} MORE MODEL${extra === 1 ? '' : 'S'}`, {
        x: width - PAD,
        y: height - 14,
        scale: 1,
        paint: 'inkDim',
        align: 'right',
      }, theme),
    );
  }
  body.push(rows.join(''));

  return chartFrame({
    width,
    height,
    theme,
    idPrefix,
    title: `Token Island · top models (${models.length})`,
    description: `Pixel bar chart of the top models by token usage: ${models
      .map((model) => `${model.model} ${tokensLabel(model.totalTokens)}`)
      .join(', ')}.`,
    defs: '',
    body: body.join(''),
  });
}

function fitModelLabel(model: string, maxWidth: number): string {
  const clean = model.toUpperCase();
  if (textWidth(clean, 2) <= maxWidth) return clean;
  const chars = [...clean];
  while (chars.length > 4) {
    chars.pop();
    if (textWidth(chars.join(''), 2) <= maxWidth) return chars.join('') + '..';
  }
  return chars.join('');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders a chart.  `series.daily` must be a zero-filled window ending today
 * (see `chartSeries()` in stats.ts) and `series.models` the models of the same
 * window.
 */
export function renderChart(series: ChartSeries, options: ChartOptions = {}): string {
  const type = parseChartType(options.type);
  const theme = parseSvgTheme(options.theme);
  const dimensions = chartDimensions(type, options.width, options.height);
  const idPrefix = options.idPrefix ?? 'ti-chart';
  const showHeader = options.header !== false;
  switch (type) {
    case 'bar':
      return renderBarChart(series, dimensions, theme, idPrefix, showHeader);
    case 'heatmap':
      return renderHeatmap(series, dimensions, theme, idPrefix, showHeader);
    case 'models':
      return renderModelsChart(series, dimensions, theme, idPrefix, showHeader);
    case 'line':
    default:
      return renderLineChart(series, dimensions, theme, idPrefix, showHeader);
  }
}

/** Renders the "unknown user" pixel chart served with HTTP 404. */
export function renderUnknownChart(options: ChartOptions = {}): string {
  const type = parseChartType(options.type);
  const theme = parseSvgTheme(options.theme);
  const dimensions = chartDimensions(type, options.width, options.height);
  const idPrefix = options.idPrefix ?? 'ti-chart-unknown';
  const cx = Math.round(dimensions.width / 2);
  const cy = Math.round(dimensions.height / 2);
  const body =
    headerFor({
      showHeader: options.header !== false,
      theme,
      width: dimensions.width,
      title: 'TOKEN ISLAND',
      detail: '',
    }) +
    pixelSpriteSvg('cross', cx - 7, cy - 40, 3, paletteFor(theme).inkFaint) +
    pixelText('UNKNOWN USER', { x: cx, y: cy - 10, scale: 3, paint: 'inkDim', align: 'center' }, theme) +
    pixelText(
      'THIS TOKEN-ISLAND PROFILE DOES NOT EXIST',
      { x: cx, y: cy + 12, scale: 1, paint: 'inkDim', align: 'center' },
      theme,
    );
  return chartFrame({
    width: dimensions.width,
    height: dimensions.height,
    theme,
    idPrefix,
    title: 'Token Island · unknown user',
    description: 'No Token Island account exists for this user.',
    defs: '',
    body,
  });
}
