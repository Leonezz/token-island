/**
 * Hand-written SVG charts for READMEs and the dashboard.
 *
 *   /u/:user/chart.svg?type=line|bar|heatmap|models
 *                      &days=7..365&theme=dark|light|auto&width&height
 *
 * Design language: GitHub dark (`#0D1117` / `#161B22` / `#8B949E`) with accent
 * colours from the contract.  The `auto` theme ships a `prefers-color-scheme`
 * style block so the README follows the reader's system theme.
 */

import { formatCost, formatPercent, formatTokens } from '@token-island/core';
import { MODEL_COLORS, MODEL_COLORS_LIGHT } from '../colors.js';
import type { ChartSeries, ModelStat } from '../stats.js';
import {
  FONT_STACK,
  clampNumber,
  escapeXml,
  isAutoTheme,
  monthShort,
  niceMax,
  paletteFor,
  parseSvgTheme,
  shortDate,
  textWidth,
  weekdayIndex,
  type Palette,
  type SvgTheme,
} from './util.js';

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
  /** `false` hides the built-in chart header (used when a page card has its own heading). */
  header?: unknown;
}

export interface TextOptions {
  size?: number;
  fill?: string;
  weight?: number | string;
  anchor?: 'start' | 'middle' | 'end';
  className?: string;
  opacity?: number;
  letterSpacing?: number;
}

function txt(x: number, y: number, content: string, options: TextOptions = {}): string {
  const attributes: string[] = [`x="${round(x)}"`, `y="${round(y)}"`];
  if (options.size !== undefined) attributes.push(`font-size="${options.size}"`);
  if (options.fill !== undefined) attributes.push(`fill="${options.fill}"`);
  if (options.weight !== undefined) attributes.push(`font-weight="${options.weight}"`);
  if (options.anchor !== undefined) attributes.push(`text-anchor="${options.anchor}"`);
  if (options.opacity !== undefined) attributes.push(`fill-opacity="${options.opacity}"`);
  if (options.letterSpacing !== undefined) attributes.push(`letter-spacing="${options.letterSpacing}"`);
  if (options.className !== undefined) attributes.push(`class="${options.className}"`);
  return `<text ${attributes.join(' ')}>${escapeXml(content)}</text>`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function autoChartStyle(): string {
  return (
    '<style>@media (prefers-color-scheme: light){' +
    '.ti-bg{fill:#FFFFFF}' +
    '.ti-panel{fill:#F6F8FA}' +
    '.ti-panel-alt{fill:#EAEEF2}' +
    '.ti-border{stroke:#D0D7DE}' +
    '.ti-grid{stroke:#E7ECF1}' +
    '.ti-text{fill:#1F2328}' +
    '.ti-muted{fill:#57606A}' +
    '.ti-accent-fill{fill:#0D9488}' +
    '.ti-accent-stroke{stroke:#0D9488}' +
    '.ti-grad-top{stop-color:#0D9488}' +
    '.ti-grad-bottom{stop-color:#0D9488}' +
    MODEL_COLORS_LIGHT.map((color, index) => `.ti-m${index}{fill:${color}}`).join('') +
    '}</style>'
  );
}

interface SvgFrame {
  width: number;
  height: number;
  theme: SvgTheme;
  idPrefix: string;
  title: string;
  description: string;
  defs?: string;
  body: string;
}

function svgFrame(frame: SvgFrame): string {
  const palette = paletteFor(frame.theme);
  const titleId = `${frame.idPrefix}-title`;
  const descId = `${frame.idPrefix}-desc`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" ` +
    `viewBox="0 0 ${frame.width} ${frame.height}" role="img" aria-labelledby="${titleId} ${descId}">` +
    `<title id="${titleId}">${escapeXml(frame.title)}</title>` +
    `<desc id="${descId}">${escapeXml(frame.description)}</desc>` +
    (isAutoTheme(frame.theme) ? autoChartStyle() : '') +
    (frame.defs ?? '') +
    `<rect class="ti-bg" width="${frame.width}" height="${frame.height}" fill="${palette.background}"/>` +
    `<g font-family="${FONT_STACK}">` +
    frame.body +
    `</g></svg>`
  );
}

function modelPalette(theme: SvgTheme): readonly string[] {
  return theme === 'light' ? MODEL_COLORS_LIGHT : MODEL_COLORS;
}

function emptyChart(params: {
  width: number;
  height: number;
  theme: SvgTheme;
  idPrefix: string;
  title: string;
  showTitle?: boolean;
}): string {
  const palette = paletteFor(params.theme);
  const showTitle = params.showTitle ?? true;
  const panelTop = showTitle ? 42 : 18;
  const body = [
    ...(showTitle
      ? [txt(20, 26, params.title, { size: 11, weight: 600, fill: palette.text, className: 'ti-text' })]
      : []),
    `<rect x="20" y="${panelTop}" width="${params.width - 40}" height="${params.height - panelTop - 20}" rx="8" fill="${palette.panel}" class="ti-panel"/>`,
    `<circle cx="${params.width / 2}" cy="${params.height / 2 - 8}" r="13" fill="none" stroke="${palette.grid}" stroke-width="1.5" class="ti-grid"/>`,
    txt(params.width / 2, params.height / 2 - 3, '–', {
      size: 15,
      weight: 700,
      fill: palette.faint,
      anchor: 'middle',
      className: 'ti-muted',
    }),
    txt(params.width / 2, params.height / 2 + 20, 'no data yet', {
      size: 12,
      weight: 600,
      fill: palette.muted,
      anchor: 'middle',
      className: 'ti-muted',
    }),
    txt(params.width / 2, params.height / 2 + 38, 'sync your collector to fill this chart', {
      size: 10,
      fill: palette.faint,
      anchor: 'middle',
      className: 'ti-muted',
    }),
  ].join('');
  return svgFrame({
    width: params.width,
    height: params.height,
    theme: params.theme,
    idPrefix: params.idPrefix,
    title: `Token Island · ${params.title.toLowerCase()}`,
    description: `Token Island chart: no data yet for ${params.title.toLowerCase()}.`,
    body,
  });
}

// ---------------------------------------------------------------------------
// Line + bar charts
// ---------------------------------------------------------------------------

interface PlotGeometry {
  left: number;
  top: number;
  right: number;
  bottom: number;
  plotWidth: number;
  plotHeight: number;
}

const PLOT_PADDING = { top: 46, right: 20, bottom: 30, left: 54 };

function plotGeometry(width: number, height: number, topPadding = PLOT_PADDING.top): PlotGeometry {
  const left = PLOT_PADDING.left;
  const top = topPadding;
  const right = width - PLOT_PADDING.right;
  const bottom = height - PLOT_PADDING.bottom;
  return { left, top, right, bottom, plotWidth: Math.max(10, right - left), plotHeight: Math.max(10, bottom - top) };
}

function chartHeader(params: {
  palette: Palette;
  width: number;
  title: string;
  detail: string;
}): string {
  const titleWidth = textWidth(params.title, 11, true);
  const detailWidth = textWidth(params.detail, 11);
  const fits = params.width - 40 - titleWidth - detailWidth > 30;
  const parts = [
    txt(20, 24, params.title, {
      size: 11,
      weight: 700,
      fill: params.palette.text,
      className: 'ti-text',
    }),
  ];
  if (fits) {
    parts.push(
      txt(params.width - 20, 24, params.detail, {
        size: 10,
        fill: params.palette.muted,
        anchor: 'end',
        className: 'ti-muted',
      }),
    );
  }
  return parts.join('');
}

function gridLines(geometry: PlotGeometry, palette: Palette): string {
  const parts: string[] = [];
  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    const y = round(geometry.bottom - fraction * geometry.plotHeight);
    parts.push(
      `<line x1="${geometry.left}" y1="${y}" x2="${geometry.right}" y2="${y}" stroke="${palette.grid}" stroke-width="1" class="ti-grid"/>`,
    );
  }
  parts.push(
    `<line x1="${geometry.left}" y1="${geometry.bottom}" x2="${geometry.right}" y2="${geometry.bottom}" stroke="${palette.grid}" stroke-width="1" class="ti-grid"/>`,
  );
  return parts.join('');
}

function axisLabels(params: {
  geometry: PlotGeometry;
  palette: Palette;
  daily: ChartSeries['daily'];
  max: number;
}): string {
  const { geometry, palette, daily, max } = params;
  const parts: string[] = [];
  parts.push(
    txt(geometry.left - 10, geometry.top + 4, formatTokens(max), {
      size: 9,
      fill: palette.muted,
      anchor: 'end',
      className: 'ti-muted',
    }),
  );
  parts.push(
    txt(geometry.left - 10, geometry.bottom + 4, '0', {
      size: 9,
      fill: palette.muted,
      anchor: 'end',
      className: 'ti-muted',
    }),
  );
  const count = daily.length;
  const indexes = count > 1 ? [0, Math.floor((count - 1) / 2), count - 1] : [0];
  const labelY = geometry.bottom + 19;
  for (const index of indexes) {
    const date = daily[index]?.date;
    if (!date) continue;
    const x = count > 1 ? geometry.left + (index / (count - 1)) * geometry.plotWidth : geometry.left;
    const anchor = index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle';
    parts.push(
      txt(x, labelY, shortDate(date), {
        size: 9,
        fill: palette.muted,
        anchor,
        className: 'ti-muted',
      }),
    );
  }
  return parts.join('');
}

function renderLineChart(
  series: ChartSeries,
  options: Required<ChartDimensions>,
  theme: SvgTheme,
  idPrefix: string,
  showHeader: boolean,
): string {
  const { width, height } = options;
  const palette = paletteFor(theme);
  const daily = series.daily;
  const values = daily.map((day) => day.totalTokens);
  const rawMax = values.reduce((max, value) => Math.max(max, value), 0);
  if (daily.length === 0 || rawMax <= 0) {
    return emptyChart({ width, height, theme, idPrefix, title: 'Daily tokens', showTitle: showHeader });
  }
  const max = niceMax(rawMax);
  const geometry = plotGeometry(width, height, showHeader ? PLOT_PADDING.top : 22);
  const n = daily.length;
  const xFor = (index: number): number =>
    n > 1 ? geometry.left + (index / (n - 1)) * geometry.plotWidth : geometry.left;
  const yFor = (value: number): number =>
    Math.min(geometry.bottom, geometry.bottom - (Math.min(value, max) / max) * geometry.plotHeight);

  const points = values.map((value, index) => `${round(xFor(index))},${round(yFor(value))}`);
  const areaPath =
    `M ${round(xFor(0))} ${round(geometry.bottom)} ` +
    points.map((point) => `L ${point}`).join(' ') +
    ` L ${round(xFor(n - 1))} ${round(geometry.bottom)} Z`;
  const lastIndex = n - 1;
  const lastValue = values[lastIndex] ?? 0;
  const lastX = round(xFor(lastIndex));
  const lastY = round(yFor(lastValue));

  const defs =
    `<defs>` +
    `<linearGradient id="${idPrefix}-area" x1="0" y1="0" x2="0" y2="1">` +
    `<stop class="ti-grad-top" offset="0" stop-color="${palette.accent}" stop-opacity=".38"/>` +
    `<stop class="ti-grad-bottom" offset="1" stop-color="${palette.accent}" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<linearGradient id="${idPrefix}-line" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${palette.accent}"/>` +
    `<stop offset="1" stop-color="${palette.blue}"/>` +
    `</linearGradient>` +
    `</defs>`;

  const body =
    (showHeader
      ? chartHeader({
          palette,
          width,
          title: 'Daily tokens',
          detail: `${formatTokens(series.totalTokens)} tokens · ${formatCost(series.totalCost, { approx: true })}`,
        })
      : '') +
    gridLines(geometry, palette) +
    axisLabels({ geometry, palette, daily, max }) +
    `<path d="${areaPath}" fill="url(#${idPrefix}-area)"/>` +
    `<polyline points="${points.join(' ')}" fill="none" stroke="url(#${idPrefix}-line)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${lastX}" cy="${lastY}" r="6" fill="${palette.accent}" fill-opacity=".18"/>` +
    `<circle cx="${lastX}" cy="${lastY}" r="3" fill="${palette.accent}" class="ti-accent-fill"/>`;

  return svgFrame({
    width,
    height,
    theme,
    idPrefix,
    title: `Token Island · daily tokens (last ${n} days)`,
    description: `Daily token usage for the last ${n} days: ${formatTokens(
      series.totalTokens,
    )} tokens in total, about ${formatCost(series.totalCost, { approx: true })} estimated spend.`,
    defs,
    body,
  });
}

function renderBarChart(
  series: ChartSeries,
  options: Required<ChartDimensions>,
  theme: SvgTheme,
  idPrefix: string,
  showHeader: boolean,
): string {
  const { width, height } = options;
  const palette = paletteFor(theme);
  const daily = series.daily;
  const values = daily.map((day) => day.totalTokens);
  const rawMax = values.reduce((max, value) => Math.max(max, value), 0);
  if (daily.length === 0 || rawMax <= 0) {
    return emptyChart({ width, height, theme, idPrefix, title: 'Daily tokens', showTitle: showHeader });
  }
  const max = niceMax(rawMax);
  const geometry = plotGeometry(width, height, showHeader ? PLOT_PADDING.top : 22);
  const n = daily.length;
  const step = geometry.plotWidth / n;
  const barWidth = Math.max(1, Math.min(16, step * 0.62));

  const defs =
    `<defs><linearGradient id="${idPrefix}-bar" x1="0" y1="0" x2="0" y2="1">` +
    `<stop class="ti-grad-top" offset="0" stop-color="${palette.accent}" stop-opacity=".95"/>` +
    `<stop class="ti-grad-bottom" offset="1" stop-color="${palette.accent}" stop-opacity=".32"/>` +
    `</linearGradient></defs>`;

  const bars: string[] = [];
  for (let index = 0; index < n; index += 1) {
    const value = values[index] ?? 0;
    if (value <= 0) continue;
    const barHeight = Math.max(1, (Math.min(value, max) / max) * geometry.plotHeight);
    const x = round(geometry.left + index * step + (step - barWidth) / 2);
    const y = round(geometry.bottom - barHeight);
    const isToday = index === n - 1;
    const fill = isToday ? palette.accent : `url(#${idPrefix}-bar)`;
    const fillClass = isToday ? ' class="ti-accent-fill"' : '';
    bars.push(
      `<rect${fillClass} x="${x}" y="${y}" width="${round(barWidth)}" height="${round(barHeight)}" rx="${round(
        Math.min(3, barWidth / 2),
      )}" fill="${fill}"/>`,
    );
  }

  const body =
    (showHeader
      ? chartHeader({
          palette,
          width,
          title: 'Daily tokens',
          detail: `${formatTokens(series.totalTokens)} tokens · ${formatCost(series.totalCost, { approx: true })}`,
        })
      : '') +
    gridLines(geometry, palette) +
    axisLabels({ geometry, palette, daily, max }) +
    bars.join('');

  return svgFrame({
    width,
    height,
    theme,
    idPrefix,
    title: `Token Island · daily tokens (last ${n} days)`,
    description: `Bar chart of daily token usage for the last ${n} days: ${formatTokens(
      series.totalTokens,
    )} tokens in total.`,
    defs,
    body,
  });
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

const HEATMAP_LEVELS = [0.24, 0.45, 0.68, 0.95];
const HEATMAP_GAP = 3;

function renderHeatmap(
  series: ChartSeries,
  options: Required<ChartDimensions>,
  theme: SvgTheme,
  idPrefix: string,
  showHeader: boolean,
): string {
  const { width, height } = options;
  const palette = paletteFor(theme);
  const daily = series.daily;
  const values = daily.map((day) => day.totalTokens);
  const rawMax = values.reduce((max, value) => Math.max(max, value), 0);
  if (daily.length === 0 || rawMax <= 0) {
    return emptyChart({ width, height, theme, idPrefix, title: 'Daily activity', showTitle: showHeader });
  }

  const firstDate = daily[0]?.date;
  const lastDate = daily[daily.length - 1]?.date;
  const leading = firstDate ? (weekdayIndex(firstDate) + 6) % 7 : 0; // Monday = 0
  const columns = Math.ceil((leading + daily.length) / 7);

  const labelWidth = 34;
  const rightPad = 20;
  const availableWidth = width - labelWidth - rightPad;
  const cellByWidth = Math.floor((availableWidth - (columns - 1) * HEATMAP_GAP) / columns);
  const gridTopBase = showHeader ? 48 : 26;
  const cellByHeight = Math.floor((height - gridTopBase - 34 - 6 * HEATMAP_GAP) / 7);
  const cell = Math.max(6, Math.min(13, Math.min(cellByWidth, cellByHeight)));
  const gridWidth = columns * cell + (columns - 1) * HEATMAP_GAP;
  const gridHeight = 7 * cell + 6 * HEATMAP_GAP;
  const gridX = labelWidth + Math.max(0, (availableWidth - gridWidth) / 2);
  const gridY = gridTopBase + Math.max(0, (height - gridTopBase - 34 - gridHeight) / 2);

  const cells: string[] = [];
  const monthLabels: string[] = [];
  let lastMonthLabelX = -Infinity;
  let lastMonth = '';
  for (let index = 0; index < daily.length; index += 1) {
    const day = daily[index];
    if (!day) continue;
    const slot = leading + index;
    const column = Math.floor(slot / 7);
    const row = slot % 7;
    const x = round(gridX + column * (cell + HEATMAP_GAP));
    const y = round(gridY + row * (cell + HEATMAP_GAP));
    const value = day.totalTokens;
    const isToday = index === daily.length - 1;
    if (value > 0) {
      const ratio = value / rawMax;
      const level = ratio > 0.66 ? 3 : ratio > 0.33 ? 2 : ratio > 0.1 ? 1 : 0;
      const opacity = HEATMAP_LEVELS[level] ?? HEATMAP_LEVELS[0];
      cells.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${palette.accent}" fill-opacity="${opacity}" class="ti-accent-fill"/>`,
      );
    } else {
      cells.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${palette.panelAlt}" class="ti-panel-alt"/>`,
      );
    }
    if (isToday) {
      cells.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="none" stroke="${palette.muted}" stroke-width="1" stroke-opacity=".8"/>`,
      );
    }
    const month = day.date.slice(0, 7);
    if (month !== lastMonth && x - lastMonthLabelX >= 30) {
      monthLabels.push(
        txt(x, round(gridY - 8), monthShort(day.date), {
          size: 9,
          fill: palette.muted,
          className: 'ti-muted',
        }),
      );
      lastMonthLabelX = x;
      lastMonth = month;
    }
  }

  const weekdayLabels: string[] = [];
  for (const [row, label] of [
    [0, 'Mon'],
    [2, 'Wed'],
    [4, 'Fri'],
  ] as const) {
    weekdayLabels.push(
      txt(gridX - 8, round(gridY + row * (cell + HEATMAP_GAP) + cell / 2 + 3), label, {
        size: 9,
        fill: palette.muted,
        anchor: 'end',
        className: 'ti-muted',
      }),
    );
  }

  const legendCell = 10;
  const legendGap = 3;
  const legendSquaresWidth = 4 * legendCell + 3 * legendGap;
  const legendY = height - 16;
  const moreWidth = textWidth('More', 9);
  const squaresX = width - 20 - moreWidth - 8 - legendSquaresWidth;
  const legend: string[] = [
    txt(squaresX - 8, legendY + 8, 'Less', {
      size: 9,
      fill: palette.muted,
      anchor: 'end',
      className: 'ti-muted',
    }),
  ];
  for (let index = 0; index < 4; index += 1) {
    legend.push(
      `<rect x="${round(squaresX + index * (legendCell + legendGap))}" y="${legendY}" width="${legendCell}" height="${legendCell}" rx="2" fill="${palette.accent}" fill-opacity="${HEATMAP_LEVELS[index]}" class="ti-accent-fill"/>`,
    );
  }
  legend.push(
    txt(width - 20, legendY + 8, 'More', {
      size: 9,
      fill: palette.muted,
      anchor: 'end',
      className: 'ti-muted',
    }),
  );

  const body =
    (showHeader
      ? chartHeader({
          palette,
          width,
          title: 'Daily activity',
          detail: `${formatTokens(series.totalTokens)} tokens · ${formatCost(series.totalCost, { approx: true })}`,
        })
      : '') +
    monthLabels.join('') +
    weekdayLabels.join('') +
    cells.join('') +
    legend.join('');

  return svgFrame({
    width,
    height,
    theme,
    idPrefix,
    title: `Token Island · daily activity calendar (${daily.length} days)`,
    description: `GitHub-style heatmap of daily token usage from ${firstDate ?? ''} to ${
      lastDate ?? ''
    }: ${formatTokens(series.totalTokens)} tokens in total.`,
    body,
  });
}

// ---------------------------------------------------------------------------
// Models chart
// ---------------------------------------------------------------------------

function displayModel(model: string): string {
  return model.length > 0 ? model : 'unknown';
}

function renderModelsChart(
  series: ChartSeries,
  options: Required<ChartDimensions>,
  theme: SvgTheme,
  idPrefix: string,
  showHeader: boolean,
): string {
  const { width, height } = options;
  const palette = paletteFor(theme);
  const paletteColors = modelPalette(theme);
  const models: ModelStat[] = series.models.slice(0, 5);
  const total = series.models.reduce((sum, model) => sum + model.totalTokens, 0);
  if (models.length === 0 || total <= 0) {
    return emptyChart({ width, height, theme, idPrefix, title: 'Top models', showTitle: showHeader });
  }

  const labelWidth = Math.min(210, Math.max(120, Math.round(width * 0.28)));
  const rightWidth = 118;
  const barX = 20 + labelWidth + 14;
  const barMaxWidth = Math.max(40, width - 20 - rightWidth - barX);
  const rowHeight = Math.max(26, Math.min(42, (height - (showHeader ? 58 : 28)) / 5));
  const barHeight = 14;

  const rows: string[] = [];
  models.forEach((model, index) => {
    const rowTop = (showHeader ? 44 : 14) + index * rowHeight;
    const barY = rowTop + (rowHeight - barHeight) / 2;
    const color = paletteColors[index % paletteColors.length] ?? palette.accent;
    const barWidth = Math.max(3, model.share * barMaxWidth);
    rows.push(
      txt(20, round(barY + barHeight / 2 + 4), displayModel(model.model), {
        size: 11,
        fill: palette.text,
        className: 'ti-text',
      }),
    );
    rows.push(
      `<rect x="${barX}" y="${round(barY)}" width="${round(barMaxWidth)}" height="${barHeight}" rx="${barHeight / 2}" fill="${palette.panel}" class="ti-panel"/>`,
    );
    rows.push(
      `<rect class="ti-m${index}" x="${barX}" y="${round(barY)}" width="${round(barWidth)}" height="${barHeight}" rx="${barHeight / 2}" fill="${color}"/>`,
    );
    rows.push(
      txt(barX + barMaxWidth + 12, round(barY + barHeight / 2 + 4), formatTokens(model.totalTokens), {
        size: 11,
        fill: palette.text,
        className: 'ti-text',
      }),
    );
    rows.push(
      txt(width - 20, round(barY + barHeight / 2 + 4), formatPercent(model.share), {
        size: 10,
        fill: palette.muted,
        anchor: 'end',
        className: 'ti-muted',
      }),
    );
  });

  const extra = series.models.length - models.length;
  const footer =
    extra > 0
      ? txt(width - 20, height - 12, `+${extra} more model${extra === 1 ? '' : 's'}`, {
          size: 9,
          fill: palette.faint,
          anchor: 'end',
          className: 'ti-muted',
        })
      : '';

  const body =
    (showHeader
      ? chartHeader({
          palette,
          width,
          title: 'Top models',
          detail: `by tokens · ${formatTokens(total)} total`,
        })
      : '') +
    rows.join('') +
    footer;

  return svgFrame({
    width,
    height,
    theme,
    idPrefix,
    title: `Token Island · top models (${models.length})`,
    description: `Horizontal bar chart of the top models by token usage: ${models
      .map((model) => `${displayModel(model.model)} ${formatTokens(model.totalTokens)}`)
      .join(', ')}.`,
    body,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

interface ChartDimensions {
  width: number;
  height: number;
}

function chartDimensions(type: ChartType, rawWidth: unknown, rawHeight: unknown): Required<ChartDimensions> {
  switch (type) {
    case 'heatmap': {
      const width = Math.round(clampNumber(rawWidth, 360, 1400, 840));
      // Keep the 7 weekday rows and the legend visible for any height.
      const minHeight = 120;
      const height = Math.round(clampNumber(rawHeight, minHeight, 300, 160));
      return { width, height };
    }
    case 'models': {
      const width = Math.round(clampNumber(rawWidth, 420, 1200, 760));
      const height = Math.round(clampNumber(rawHeight, 160, 400, 240));
      return { width, height };
    }
    case 'line':
    case 'bar':
    default: {
      const width = Math.round(clampNumber(rawWidth, 320, 1400, 760));
      const height = Math.round(clampNumber(rawHeight, 140, 400, 220));
      return { width, height };
    }
  }
}

/**
 * Renders a chart.  `series.daily` is expected to be a zero-filled window that
 * ends today (see `chartSeries()` in stats.ts) and `series.models` the models of
 * the same window.
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

/** Renders the "unknown user" chart served with HTTP 404. */
export function renderUnknownChart(options: ChartOptions = {}): string {
  const type = parseChartType(options.type);
  const theme = parseSvgTheme(options.theme);
  const dimensions = chartDimensions(type, options.width, options.height);
  const palette = paletteFor(theme);
  const width = dimensions.width;
  const height = dimensions.height;
  const body = [
    txt(width / 2, height / 2 - 8, 'unknown user', {
      size: 13,
      weight: 600,
      fill: palette.muted,
      anchor: 'middle',
      className: 'ti-muted',
    }),
    txt(width / 2, height / 2 + 12, 'this token-island profile does not exist', {
      size: 10,
      fill: palette.faint,
      anchor: 'middle',
      className: 'ti-muted',
    }),
  ].join('');
  return svgFrame({
    width,
    height,
    theme,
    idPrefix: options.idPrefix ?? 'ti-chart-unknown',
    title: 'Token Island · unknown user',
    description: 'No Token Island account exists for this user.',
    body,
  });
}
