/**
 * Precision Telemetry SVG charts for READMEs and the public dashboard.
 *
 *   /u/:user/chart.svg?type=line|bar|heatmap|models
 *                      &days=7..365&theme=dark|light|auto&width&height
 *
 * Crisp vector lines, rounded bars, 7-row contribution calendar and lowercase
 * monospace model breakdown bars — paired with readable 11.5px system/tabular
 * axis labels and self-contained themeable styling.
 */

import { formatCost, normalizeModelId } from '@token-island/core';
import type { ChartSeries, ModelStat } from '../stats.js';
import {
  chartHeader,
  emptyState,
  svgFrame,
  telemetryPanel,
  telemetryRule,
  telemetryTrack,
} from './frame.js';
import {
  clampNumber,
  costLabel,
  fitSvgText,
  heatPaintByRatio,
  measureText,
  modelPaint,
  monthShort,
  niceMax,
  paintFill,
  paintStroke,
  parseSvgTheme,
  percentLabel,
  shortDate,
  svgText,
  tokensLabel,
  weekdayIndex,
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
      return { width, height: Math.round(clampNumber(rawHeight, 120, 400, 250)) };
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
  defs?: string;
  body: string;
  framed?: boolean;
}): string {
  const panel =
    params.framed === false
      ? ''
      : telemetryPanel({
          x: 0,
          y: 0,
          width: params.width,
          height: params.height,
          theme: params.theme,
          fill: 'surface',
          border: 'border',
          radius: 10,
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
  return `${tokensLabel(series.totalTokens)} tokens · ${costLabel(series.totalCost)}`;
}

// ---------------------------------------------------------------------------
// Line + Bar Shared Geometry
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
  const left = PAD + 48;
  const right = width - PAD;
  const top = showHeader ? 48 : 16;
  const bottom = height - 28;
  return {
    left,
    top,
    right,
    bottom,
    plotWidth: Math.max(12, right - left),
    plotHeight: Math.max(12, bottom - top),
  };
}

function xPosition(geometry: PlotGeometry, count: number, index: number): number {
  if (count <= 1) return geometry.left;
  return Math.round((geometry.left + (index / (count - 1)) * geometry.plotWidth) * 10) / 10;
}

function yAxisLabels(geometry: PlotGeometry, max: number, theme: SvgTheme): string {
  const rows: Array<[number, string]> = [
    [geometry.top + 4, tokensLabel(max)],
    [geometry.top + Math.round(geometry.plotHeight / 2) + 4, tokensLabel(max / 2)],
    [geometry.bottom + 4, '0'],
  ];
  return rows
    .map(([y, label]) =>
      svgText(
        label,
        { x: geometry.left - 8, y, size: 11, weight: 500, mono: true, paint: 'inkFaint', align: 'right' },
        theme,
      ),
    )
    .join('');
}

function xAxisLabels(
  geometry: PlotGeometry,
  daily: ChartSeries['daily'],
  theme: SvgTheme,
): string {
  const count = daily.length;
  if (count === 0) return '';
  const indexes = count > 1 ? [0, Math.floor((count - 1) / 2), count - 1] : [0];
  const labelY = geometry.bottom + 18;
  const parts: string[] = [];
  for (const index of indexes) {
    const date = daily[index]?.date;
    if (!date) continue;
    const x = xPosition(geometry, count, index);
    const anchor = index === 0 ? 'left' : index === count - 1 ? 'right' : 'center';
    parts.push(
      svgText(
        shortDate(date),
        { x, y: labelY, size: 11, weight: 500, mono: true, paint: 'inkFaint', align: anchor },
        theme,
      ),
    );
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Line Chart
// ---------------------------------------------------------------------------

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

  const body: string[] = [
    headerFor({ showHeader, theme, width, title: 'Daily Tokens', detail: chartSummary(series) }),
  ];

  if (empty) {
    body.push(emptyState({ theme, cx: Math.round(width / 2), cy: Math.round(height / 2) }));
    return chartFrame({
      width,
      height,
      theme,
      idPrefix,
      title: 'Token Island · daily tokens',
      description: 'No daily token data has been synced yet.',
      body: body.join(''),
      framed: showHeader,
    });
  }

  const max = niceMax(rawMax);
  const geometry = plotGeometry(width, height, showHeader);
  const n = daily.length;
  const yFor = (value: number): number =>
    Math.round((geometry.bottom - (Math.min(value, max) / max) * geometry.plotHeight) * 10) / 10;

  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    const y = geometry.bottom - Math.round(fraction * geometry.plotHeight);
    body.push(
      telemetryRule({
        theme,
        x: geometry.left,
        y,
        width: geometry.plotWidth,
        paint: 'grid',
        dashed: true,
      }),
    );
  }
  body.push(
    telemetryRule({ theme, x: geometry.left, y: geometry.bottom, width: geometry.plotWidth, paint: 'border' }),
  );

  const coords = daily.map((_, i) => [xPosition(geometry, n, i), yFor(values[i] ?? 0)] as const);
  const lineCommands = coords.map(([x, y], idx) => `${idx === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  const firstX = coords[0]?.[0] ?? geometry.left;
  const lastCoord = coords[coords.length - 1] ?? [geometry.right, geometry.bottom];
  const areaCommands = `M${firstX} ${geometry.bottom} ${coords.map(([x, y]) => `L${x} ${y}`).join(' ')} L${lastCoord[0]} ${geometry.bottom} Z`;

  body.push(
    `<path d="${areaCommands}" ${paintFill(theme, 'teal')} opacity="0.13"/>`,
    `<path d="${lineCommands}" fill="none" ${paintStroke(theme, 'teal')} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  );

  if (n <= 60) {
    const pointGroup = coords
      .slice(0, -1)
      .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="2.2"/>`)
      .join('');
    if (pointGroup) {
      body.push(`<g ${paintFill(theme, 'teal')}>${pointGroup}</g>`);
    }
  }
  body.push(
    `<circle cx="${lastCoord[0]}" cy="${lastCoord[1]}" r="5" ${paintFill(theme, 'teal')} opacity="0.22"/>`,
    `<circle cx="${lastCoord[0]}" cy="${lastCoord[1]}" r="3" ${paintFill(theme, 'teal')}/>`,
  );

  body.push(yAxisLabels(geometry, max, theme), xAxisLabels(geometry, daily, theme));

  return chartFrame({
    width,
    height,
    theme,
    idPrefix,
    title: `Token Island · daily tokens (last ${n} days)`,
    description: `Telemetry line chart of daily token usage for the last ${n} days: ${tokensLabel(
      series.totalTokens,
    )} tokens in total, about ${formatCost(series.totalCost, { approx: true })} estimated spend.`,
    body: body.join(''),
    framed: showHeader,
  });
}

// ---------------------------------------------------------------------------
// Bar Chart
// ---------------------------------------------------------------------------

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

  const body: string[] = [
    headerFor({ showHeader, theme, width, title: 'Daily Tokens', detail: chartSummary(series) }),
  ];

  if (empty) {
    body.push(emptyState({ theme, cx: Math.round(width / 2), cy: Math.round(height / 2) }));
    return chartFrame({
      width,
      height,
      theme,
      idPrefix,
      title: 'Token Island · daily tokens',
      description: 'No daily token data has been synced yet.',
      body: body.join(''),
      framed: showHeader,
    });
  }

  const max = niceMax(rawMax);
  const geometry = plotGeometry(width, height, showHeader);
  const n = daily.length;

  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    const y = geometry.bottom - Math.round(fraction * geometry.plotHeight);
    body.push(
      telemetryRule({
        theme,
        x: geometry.left,
        y,
        width: geometry.plotWidth,
        paint: 'grid',
        dashed: true,
      }),
    );
  }
  body.push(
    telemetryRule({ theme, x: geometry.left, y: geometry.bottom, width: geometry.plotWidth, paint: 'border' }),
  );

  const slot = geometry.plotWidth / n;
  const gap = n > 60 ? 1 : n > 30 ? 2 : 3;
  const barWidth = Math.max(1.5, Math.min(18, Math.round((slot - gap) * 10) / 10));
  const barRx = Math.min(3, Math.max(1, Math.floor(barWidth / 3)));

  for (let index = 0; index < n; index += 1) {
    const value = values[index] ?? 0;
    const bx = Math.round((geometry.left + index * slot + (slot - barWidth) / 2) * 10) / 10;
    if (n <= 45) {
      body.push(
        `<rect x="${bx}" y="${geometry.top}" width="${barWidth}" height="${geometry.plotHeight}" rx="${barRx}" ${paintFill(theme, 'inset')} opacity="0.45"/>`,
      );
    }
    if (value <= 0) continue;
    const bh = Math.max(2, Math.round((Math.min(value, max) / max) * geometry.plotHeight));
    const by = geometry.bottom - bh;
    const isToday = index === n - 1;
    body.push(
      `<rect x="${bx}" y="${by}" width="${barWidth}" height="${bh}" rx="${barRx}" ${paintFill(
        theme,
        isToday ? 'teal' : 'blue',
      )}${isToday ? '' : ' opacity="0.78"'}/>`,
    );
  }

  body.push(yAxisLabels(geometry, max, theme), xAxisLabels(geometry, daily, theme));

  return chartFrame({
    width,
    height,
    theme,
    idPrefix,
    title: `Token Island · daily tokens (last ${n} days)`,
    description: `Telemetry bar chart of daily token usage for the last ${n} days: ${tokensLabel(
      series.totalTokens,
    )} tokens in total.`,
    body: body.join(''),
    framed: showHeader,
  });
}

// ---------------------------------------------------------------------------
// Heatmap Calendar
// ---------------------------------------------------------------------------

const HEAT_GAP = 3;
const WEEKDAYS = ['Mon', 'Wed', 'Fri'] as const;

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
  const body: string[] = [
    headerFor({ showHeader, theme, width, title: 'Activity Calendar', detail: chartSummary(series) }),
  ];

  if (daily.length === 0 || rawMax <= 0) {
    body.push(emptyState({ theme, cx: Math.round(width / 2), cy: Math.round(height / 2) }));
    return chartFrame({
      width,
      height,
      theme,
      idPrefix,
      title: 'Token Island · daily activity calendar',
      description: 'No daily activity has been synced yet.',
      body: body.join(''),
      framed: showHeader,
    });
  }

  const firstDate = daily[0]?.date ?? '';
  const leading = (weekdayIndex(firstDate) + 6) % 7;
  const columns = Math.max(1, Math.ceil((leading + daily.length) / 7));
  const labelWidth = 34;
  const gridLeft = PAD + labelWidth;
  const gridRight = width - PAD;
  const available = Math.max(20, gridRight - gridLeft);
  const monthRowY = showHeader ? 48 : 18;
  const gridTop = showHeader ? 56 : 26;
  const legendRowY = height - 12;
  const availableHeight = Math.max(20, legendRowY - 16 - gridTop);
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
    const isEmpty = day.totalTokens <= 0;
    cells.push(
      `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" ${paintFill(
        theme,
        isEmpty ? 'surfaceAlt' : heatPaintByRatio(theme, ratio),
      )}/>`,
    );
    const month = day.date.slice(0, 7);
    const mShort = monthShort(day.date);
    const mWidth = measureText(mShort, 10.5);
    if (month !== lastMonth && x - lastMonthX >= mWidth + 10) {
      monthLabels.push(
        svgText(mShort, { x, y: monthRowY, size: 10.5, weight: 500, paint: 'inkFaint' }, theme),
      );
      lastMonth = month;
      lastMonthX = x;
    }
  }

  const weekdayRows = [
    [0, WEEKDAYS[0]],
    [2, WEEKDAYS[1]],
    [4, WEEKDAYS[2]],
  ] as const;
  const weekdayLabels = weekdayRows
    .map(([row, label]) =>
      svgText(
        label,
        {
          x: gridX - 8,
          y: gridY + row * (cell + HEAT_GAP) + Math.round(cell * 0.8),
          size: 10.5,
          weight: 500,
          paint: 'inkFaint',
          align: 'right',
        },
        theme,
      ),
    )
    .join('');

  // Legend: Less [5 rounded swatches] More
  const swSize = 9;
  const swGap = 3;
  const totalSwW = 5 * swSize + 4 * swGap;
  const moreW = measureText('More', 10.5);
  const swStartX = width - PAD - moreW - 6 - totalSwW;
  const swY = legendRowY - 8;
  const legendSwatches: string[] = [
    `<rect x="${swStartX}" y="${swY}" width="${swSize}" height="${swSize}" rx="2" ${paintFill(theme, 'surfaceAlt')}/>`,
  ];
  for (let level = 1; level <= 4; level += 1) {
    const sx = swStartX + level * (swSize + swGap);
    legendSwatches.push(
      `<rect x="${sx}" y="${swY}" width="${swSize}" height="${swSize}" rx="2" ${paintFill(
        theme,
        heatPaintByRatio(theme, level / 4 - 0.01),
      )}/>`,
    );
  }

  body.push(
    monthLabels.join(''),
    weekdayLabels,
    cells.join(''),
    svgText('Less', { x: swStartX - 6, y: legendRowY, size: 10.5, paint: 'inkFaint', align: 'right' }, theme),
    legendSwatches.join(''),
    svgText('More', { x: width - PAD, y: legendRowY, size: 10.5, paint: 'inkFaint', align: 'right' }, theme),
  );

  return chartFrame({
    width,
    height,
    theme,
    idPrefix,
    title: `Token Island · daily activity calendar (${daily.length} days)`,
    description: `Heatmap of daily token usage from ${firstDate}: ${tokensLabel(series.totalTokens)} tokens in total.`,
    body: body.join(''),
    framed: showHeader,
  });
}

// ---------------------------------------------------------------------------
// Models Breakdown Chart
// ---------------------------------------------------------------------------

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
  const body: string[] = [
    headerFor({
      showHeader,
      theme,
      width,
      title: 'Top Models',
      detail: `${tokensLabel(total)} tokens`,
    }),
  ];

  if (models.length === 0 || total <= 0) {
    body.push(emptyState({ theme, cx: Math.round(width / 2), cy: Math.round(height / 2) }));
    return chartFrame({
      width,
      height,
      theme,
      idPrefix,
      title: 'Token Island · top models',
      description: 'No model data has been synced yet.',
      body: body.join(''),
      framed: showHeader,
    });
  }

  const rowsTop = showHeader ? 48 : 14;
  const rowsHeight = height - rowsTop - 20;
  const rowHeight = Math.max(24, Math.floor(rowsHeight / 5));
  const shareColW = 44;
  const tokensColW = 54;
  const barWidth = Math.max(90, Math.min(240, Math.round(width * 0.34)));
  const barX = width - PAD - shareColW - tokensColW - barWidth - 16;
  const labelMax = Math.max(60, barX - PAD - 22);

  models.forEach((model, index) => {
    const rowCenterY = rowsTop + index * rowHeight + Math.round(rowHeight / 2);
    const baselineY = rowCenterY + 4;
    const barH = 7;
    const barY = rowCenterY - Math.floor(barH / 2);
    const paint = modelPaint(theme, index);
    const cleanName = fitSvgText(normalizeModelId(model.model), labelMax, 12, { mono: true });
    const filledW = Math.max(3, Math.round(Math.min(1, Math.max(0, model.share)) * barWidth));

    body.push(
      `<rect x="${PAD}" y="${rowCenterY - 4}" width="8" height="8" rx="2" ${paintFill(theme, paint)}/>`,
      svgText(cleanName, { x: PAD + 14, y: baselineY, size: 12, weight: 500, mono: true, paint: 'ink' }, theme),
      telemetryTrack({ x: barX, y: barY, width: barWidth, height: barH, theme, fill: 'inset', radius: 3.5 }),
      `<rect x="${barX}" y="${barY}" width="${filledW}" height="${barH}" rx="3.5" ${paintFill(theme, paint)}/>`,
      svgText(
        tokensLabel(model.totalTokens),
        {
          x: barX + barWidth + 8 + tokensColW,
          y: baselineY,
          size: 12,
          weight: 600,
          mono: true,
          paint: 'ink',
          align: 'right',
        },
        theme,
      ),
      svgText(
        percentLabel(model.share),
        {
          x: width - PAD,
          y: baselineY,
          size: 11.5,
          weight: 500,
          mono: true,
          paint: 'inkDim',
          align: 'right',
        },
        theme,
      ),
    );
  });

  const extra = series.models.length - models.length;
  if (extra > 0) {
    body.push(
      svgText(
        `+${extra} more model${extra === 1 ? '' : 's'}`,
        { x: width - PAD, y: height - 8, size: 11, mono: true, paint: 'inkFaint', align: 'right' },
        theme,
      ),
    );
  }

  return chartFrame({
    width,
    height,
    theme,
    idPrefix,
    title: `Token Island · top models (${models.length})`,
    description: `Horizontal bar chart of top models by token usage: ${models
      .map((model) => `${model.model} ${tokensLabel(model.totalTokens)}`)
      .join(', ')}.`,
    body: body.join(''),
    framed: showHeader,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
      title: 'Token Island',
      detail: '',
    }) +
    svgText('Unknown user', { x: cx, y: cy - 4, size: 14, weight: 600, paint: 'inkDim', align: 'center' }, theme) +
    svgText(
      'No Token Island profile exists for this username yet.',
      { x: cx, y: cy + 16, size: 11.5, weight: 400, paint: 'inkFaint', align: 'center' },
      theme,
    );
  return chartFrame({
    width: dimensions.width,
    height: dimensions.height,
    theme,
    idPrefix,
    title: 'Token Island · unknown user',
    description: 'No Token Island account exists for this user.',
    body,
  });
}
