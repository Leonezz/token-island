/**
 * Precision Telemetry GitHub README status badges (self-contained vector SVG).
 *
 *   /u/:user/badge.svg?metric=tokens|cost|streak|messages|day|model|status
 *                      &theme=dark|light|auto&style=flat|flat-square
 *                      &label=<override>&days=1..365
 *
 * Crisp rounded geometry (`24px` flat / `22px` flat-square), system sans label,
 * tabular monospace value, geometric vector icon (and dual-halo LED dot on
 * `status`), >= 4.8:1 WCAG AA contrast across both dark and light themes.
 */

import { normalizeModelId, truncateLabel } from '@token-island/core';
import type { UserStats } from '../stats.js';
import { windowTotals } from '../stats.js';
import {
  costLabel,
  measureText,
  paintFill,
  paintStroke,
  parseSvgTheme,
  svgText,
  tokensLabel,
  type PaintRole,
  type SvgTheme,
} from './tokens.js';
import { svgFrame } from './frame.js';

export type BadgeMetric = 'tokens' | 'cost' | 'streak' | 'messages' | 'day' | 'model' | 'status';
export type BadgeStyle = 'flat' | 'flat-square';

const BADGE_METRICS: readonly BadgeMetric[] = [
  'tokens',
  'cost',
  'streak',
  'messages',
  'day',
  'model',
  'status',
];

export function parseBadgeMetric(raw: unknown): BadgeMetric {
  return typeof raw === 'string' && (BADGE_METRICS as readonly string[]).includes(raw)
    ? (raw as BadgeMetric)
    : 'tokens';
}

export function parseBadgeStyle(raw: unknown): BadgeStyle {
  return raw === 'flat-square' ? 'flat-square' : 'flat';
}

export interface BadgeOptions {
  metric?: unknown;
  theme?: unknown;
  label?: string | null;
  days?: unknown;
  style?: unknown;
  now?: number;
  timezone?: string;
  idPrefix?: string;
}

type IconKind = BadgeMetric | 'unknown';

const METRIC_ACCENTS: Record<BadgeMetric, PaintRole> = {
  tokens: 'teal',
  cost: 'amber',
  streak: 'amber',
  messages: 'blue',
  day: 'blue',
  model: 'ink',
  status: 'teal',
};

interface BadgeSpec {
  metric: BadgeMetric;
  label: string;
  value: string;
  title: string;
  detail: string;
  accent: PaintRole;
  icon: IconKind;
}

function metricSpec(stats: UserStats, options: BadgeOptions): BadgeSpec {
  const metric = parseBadgeMetric(options.metric);
  const now = options.now ?? Date.now();
  const days = Math.min(365, Math.max(1, Math.round(Number(options.days ?? 30)) || 30));
  const window = windowTotals(stats, days, { now, timezone: options.timezone });
  const windowLabel = days === 1 ? 'the last day' : `the last ${days} days`;
  const statusLive = stats.lastSyncAt !== null && now - stats.lastSyncAt < 86_400_000;

  let defaultLabel: string;
  let value: string;
  let detail: string;
  switch (metric) {
    case 'cost':
      defaultLabel = 'est. spend';
      value = costLabel(window.costUsd);
      detail = `estimated spend over ${windowLabel}`;
      break;
    case 'streak':
      defaultLabel = 'streak';
      value = `${stats.streak.current}d`;
      detail = `current daily usage streak (longest ${stats.streak.longest}d)`;
      break;
    case 'messages':
      defaultLabel = 'agent turns';
      value = tokensLabel(stats.totals.messages);
      detail = 'billable agent turns, all time';
      break;
    case 'day':
      defaultLabel = 'today';
      value = tokensLabel(stats.today.totalTokens);
      detail = 'tokens consumed today';
      break;
    case 'model': {
      defaultLabel = 'top model';
      const top = stats.models[0]?.model;
      value = top ? truncateLabel(normalizeModelId(top), 24) : 'no data';
      detail = top ? `most used model: ${top}` : 'no model data yet';
      break;
    }
    case 'status': {
      defaultLabel = 'status';
      value = statusLive ? 'live' : 'idle';
      detail = statusLive
        ? 'live: synced in the last 24 hours'
        : stats.lastSyncAt
          ? 'idle: no sync in the last 24 hours'
          : 'idle: waiting for the first sync';
      break;
    }
    case 'tokens':
    default:
      defaultLabel = 'tokens';
      value = tokensLabel(window.totalTokens);
      detail = `tokens over ${windowLabel}`;
      break;
  }

  const displayLabel =
    typeof options.label === 'string' && options.label.trim() !== ''
      ? truncateLabel(options.label.trim(), 40)
      : defaultLabel;

  return {
    metric,
    label: displayLabel,
    value,
    title: `${displayLabel}: ${value} · @${stats.username}`,
    detail,
    accent: metric === 'status' ? (statusLive ? 'teal' : 'inkDim') : METRIC_ACCENTS[metric],
    icon: metric,
  };
}

/** Crisp 12x12 vector metric glyph centered around `(cx, cy)`. */
function metricIconSvg(theme: SvgTheme, kind: IconKind, cx: number, cy: number, accent: PaintRole): string {
  switch (kind) {
    case 'status':
      return (
        `<circle cx="${cx}" cy="${cy}" r="5" ${paintFill(theme, accent)} opacity="0.18"/>` +
        `<circle cx="${cx}" cy="${cy}" r="2.6" ${paintFill(theme, accent)}/>`
      );
    case 'cost':
      return (
        `<circle cx="${cx}" cy="${cy}" r="4.5" fill="none" ${paintStroke(theme, accent)} stroke-width="1.3"/>` +
        `<line x1="${cx}" y1="${cy - 2.6}" x2="${cx}" y2="${cy + 2.6}" ${paintStroke(theme, accent)} stroke-width="1.3"/>`
      );
    case 'streak':
      return `<path d="M${cx} ${cy - 5}L${cx + 3.8} ${cy + 0.5}L${cx + 1} ${cy + 0.5}L${cx + 1.5} ${cy + 5}L${cx - 3.8} ${cy - 0.5}L${cx - 1} ${cy - 0.5}Z" ${paintFill(theme, accent)}/>`;
    case 'messages':
      return (
        `<rect x="${cx - 4.5}" y="${cy - 1}" width="2" height="5" rx="0.8" ${paintFill(theme, accent)}/>` +
        `<rect x="${cx - 1}" y="${cy - 4}" width="2" height="8" rx="0.8" ${paintFill(theme, accent)}/>` +
        `<rect x="${cx + 2.5}" y="${cy - 2.5}" width="2" height="6.5" rx="0.8" ${paintFill(theme, accent)}/>`
      );
    case 'day':
      return (
        `<rect x="${cx - 4.5}" y="${cy - 3.5}" width="9" height="8" rx="1.5" fill="none" ${paintStroke(theme, accent)} stroke-width="1.3"/>` +
        `<line x1="${cx - 4.5}" y1="${cy - 0.8}" x2="${cx + 4.5}" y2="${cy - 0.8}" ${paintStroke(theme, accent)} stroke-width="1.2"/>`
      );
    case 'model':
      return (
        `<rect x="${cx - 3.5}" y="${cy - 3.5}" width="7" height="7" rx="1.5" fill="none" ${paintStroke(theme, 'blue')} stroke-width="1.3"/>` +
        `<circle cx="${cx}" cy="${cy}" r="1.5" ${paintFill(theme, 'blue')}/>`
      );
    case 'unknown':
      return (
        `<line x1="${cx - 3.2}" y1="${cy - 3.2}" x2="${cx + 3.2}" y2="${cy + 3.2}" ${paintStroke(theme, 'inkDim')} stroke-width="1.4" stroke-linecap="round"/>` +
        `<line x1="${cx + 3.2}" y1="${cy - 3.2}" x2="${cx - 3.2}" y2="${cy + 3.2}" ${paintStroke(theme, 'inkDim')} stroke-width="1.4" stroke-linecap="round"/>`
      );
    case 'tokens':
    default:
      return (
        `<rect x="${cx - 4}" y="${cy - 4}" width="3.3" height="3.3" rx="0.8" ${paintFill(theme, accent)}/>` +
        `<rect x="${cx + 0.7}" y="${cy - 4}" width="3.3" height="3.3" rx="0.8" ${paintFill(theme, accent)} opacity="0.65"/>` +
        `<rect x="${cx - 4}" y="${cy + 0.7}" width="3.3" height="3.3" rx="0.8" ${paintFill(theme, accent)} opacity="0.65"/>` +
        `<rect x="${cx + 0.7}" y="${cy + 0.7}" width="3.3" height="3.3" rx="0.8" ${paintFill(theme, accent)}/>`
      );
  }
}

function renderBadgeSvg(params: {
  spec: BadgeSpec;
  theme: SvgTheme;
  style: BadgeStyle;
  idPrefix: string;
}): string {
  const { spec, theme, style } = params;
  const flatSquare = style === 'flat-square';
  const height = flatSquare ? 22 : 24;
  const radius = flatSquare ? 2 : 6;
  const fontSize = 11.5;

  const iconBox = 20;
  const labelWidth = Math.max(18, measureText(spec.label, fontSize, { mono: false }));
  const valueWidth = Math.max(20, measureText(spec.value, fontSize, { mono: true }));

  const splitX = iconBox + labelWidth + 9;
  const width = splitX + 10 + valueWidth + 10;
  const baselineY = Math.round(height / 2 + 4);
  const cy = Math.round(height / 2);

  const clipId = `${params.idPrefix}-clip`;
  const defs = `<clipPath id="${clipId}"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}"/></clipPath>`;

  const body: string[] = [
    `<g clip-path="url(#${clipId})">`,
    `<rect x="0" y="0" width="${splitX}" height="${height}" ${paintFill(theme, 'surfaceAlt')}/>`,
    `<rect x="${splitX}" y="0" width="${width - splitX}" height="${height}" ${paintFill(theme, 'surface')}/>`,
    `<line x1="${splitX + 0.5}" y1="0" x2="${splitX + 0.5}" y2="${height}" ${paintStroke(theme, 'border')} stroke-width="1"/>`,
    metricIconSvg(theme, spec.icon, 11, cy, spec.accent),
    svgText(spec.label, { x: iconBox, y: baselineY, size: fontSize, weight: 500, paint: 'inkDim' }, theme),
    svgText(
      spec.value,
      {
        x: splitX + Math.round((width - splitX) / 2),
        y: baselineY,
        size: fontSize,
        weight: 600,
        mono: true,
        paint: spec.accent,
        align: 'center',
      },
      theme,
    ),
    `</g>`,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="${Math.max(0, radius - 0.5)}" fill="none" ${paintStroke(theme, 'borderHi')} stroke-width="1"/>`,
  ];

  return svgFrame({
    width,
    height,
    theme,
    idPrefix: params.idPrefix,
    defs,
    title: spec.title,
    description: `Token Island badge for @user: ${spec.detail}.`,
    body: body.join(''),
    background: null,
  });
}

export function renderBadge(stats: UserStats, options: BadgeOptions = {}): string {
  return renderBadgeSvg({
    spec: metricSpec(stats, options),
    theme: parseSvgTheme(options.theme),
    style: parseBadgeStyle(options.style),
    idPrefix: options.idPrefix ?? 'ti-badge',
  });
}

export function renderUnknownBadge(options: BadgeOptions = {}): string {
  const theme = parseSvgTheme(options.theme);
  const value =
    typeof options.label === 'string' && options.label.trim() ? options.label.trim() : 'no data';
  return renderBadgeSvg({
    spec: {
      metric: 'tokens',
      label: 'token-island',
      value,
      title: `token-island: ${value}`,
      detail: 'unknown user: no Token Island account exists for this user yet',
      accent: 'inkDim',
      icon: 'unknown',
    },
    theme,
    style: parseBadgeStyle(options.style),
    idPrefix: options.idPrefix ?? 'ti-badge-unknown',
  });
}
