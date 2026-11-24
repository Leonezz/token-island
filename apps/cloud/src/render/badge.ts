/**
 * Pixel GitHub-README status badges (hand-written, self-contained SVG).
 *
 *   /u/:user/badge.svg?metric=tokens|cost|streak|messages|day|model|status
 *                      &theme=dark|light|auto&style=flat|flat-square
 *                      &label=<override>&days=1..365
 *
 * Design (docs/CONTRACT-V3.md §3.2): 24px tall (22 flat-square), 2px border,
 * staircase corners, hard 2px shadow.  The text stays bitmap (label at scale 2
 * inkDim, value at scale 2 on an accent-filled block); the leading icon is a
 * dot-matrix mark per metric and the label area carries a ~0.10 opacity dot
 * texture.  Nothing measures text with a DOM — Silkscreen advances are exact.
 */

import { normalizeModelId, pixelRectPath, truncateLabel } from '@token-island/core';
import type { UserStats } from '../stats.js';
import { windowTotals } from '../stats.js';
import {
  accentInkPaint,
  contrastInk,
  costLabel,
  paletteFor,
  parseSvgTheme,
  paintFill,
  paintStroke,
  pixelText,
  textWidth,
  tokensLabel,
  type PaintRole,
  type SvgTheme,
} from './tokens.js';
import { dotIconSvg, dotLabelTextureDef, DOT_ICON_SIZE, type DotIconName } from './doticons.js';
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

const METRIC_ACCENTS: Record<BadgeMetric, PaintRole> = {
  tokens: 'teal',
  cost: 'purple',
  streak: 'amber',
  messages: 'blue',
  day: 'blue',
  model: 'blue',
  status: 'blue',
};

const METRIC_ICONS: Record<BadgeMetric, DotIconName> = {
  tokens: 'tokens',
  cost: 'cost',
  streak: 'streak',
  messages: 'messages',
  day: 'day',
  model: 'model',
  status: 'status',
};

interface BadgeSpec {
  metric: BadgeMetric;
  label: string;
  value: string;
  title: string;
  detail: string;
  accent: PaintRole;
  icon: DotIconName;
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
      defaultLabel = 'EST. SPEND';
      value = costLabel(window.costUsd);
      detail = `estimated spend over ${windowLabel}`;
      break;
    case 'streak':
      defaultLabel = 'STREAK';
      value = `${stats.streak.current}D`;
      detail = `current daily usage streak (longest ${stats.streak.longest}d)`;
      break;
    case 'messages':
      defaultLabel = 'AGENT TURNS';
      value = tokensLabel(stats.totals.messages);
      detail = 'billable agent turns, all time';
      break;
    case 'day':
      defaultLabel = 'TODAY';
      value = tokensLabel(stats.today.totalTokens);
      detail = 'tokens consumed today';
      break;
    case 'model': {
      defaultLabel = 'TOP MODEL';
      const top = stats.models[0]?.model;
      value = top ? truncateLabel(normalizeModelId(top), 22) : 'NO DATA';
      detail = top ? `most used model: ${top}` : 'no model data yet';
      break;
    }
    case 'status': {
      defaultLabel = 'STATUS';
      value = statusLive ? 'LIVE' : 'IDLE';
      detail = statusLive
        ? 'live: synced in the last 24 hours'
        : stats.lastSyncAt
          ? 'idle: no sync in the last 24 hours'
          : 'idle: waiting for the first sync';
      break;
    }
    case 'tokens':
    default:
      defaultLabel = 'TOKENS';
      value = tokensLabel(window.totalTokens);
      detail = `tokens over ${windowLabel}`;
      break;
  }

  const labelOverride =
    typeof options.label === 'string' && options.label.trim() !== ''
      ? truncateLabel(options.label.trim(), 40)
      : defaultLabel;

  const displayLabel = labelOverride.toUpperCase();
  const displayValue = value.toUpperCase();
  return {
    metric,
    label: displayLabel,
    value: displayValue,
    title: `${displayLabel}: ${displayValue} · @${stats.username}`,
    detail,
    // Status is colour-coded: teal = live/success, inkDim = idle/neutral.
    accent: metric === 'status' ? (statusLive ? 'teal' : 'inkDim') : METRIC_ACCENTS[metric],
    icon: METRIC_ICONS[metric],
  };
}

interface BadgeGeometry {
  height: number;
  panelHeight: number;
  panelWidth: number;
  width: number;
  corner: number;
  shadow: number;
  iconWidth: number;
  iconHeight: number;
  labelWidth: number;
  valueWidth: number;
  labelX: number;
  labelY: number;
  accentX: number;
}

function badgeGeometry(spec: BadgeSpec, style: BadgeStyle, theme: SvgTheme): BadgeGeometry {
  const flatSquare = style === 'flat-square';
  const height = flatSquare ? 22 : 24;
  const shadow = flatSquare || theme === 'light' ? 0 : 2;
  const panelHeight = height - shadow;
  const labelWidth = Math.max(10, textWidth(spec.label, 2));
  const valueWidth = Math.max(12, textWidth(spec.value, 2));
  const panelWidth = 6 + DOT_ICON_SIZE + 6 + labelWidth + 10 + valueWidth + 8;
  const labelX = 6 + DOT_ICON_SIZE + 6;
  return {
    height,
    panelHeight,
    panelWidth,
    width: panelWidth + shadow,
    corner: flatSquare ? 0 : 2,
    shadow,
    iconWidth: DOT_ICON_SIZE,
    iconHeight: DOT_ICON_SIZE,
    labelWidth,
    valueWidth,
    labelX,
    labelY: Math.floor((panelHeight - 10) / 2),
    accentX: labelX + labelWidth + 10,
  };
}

function renderBadgeSvg(params: {
  spec: BadgeSpec;
  theme: SvgTheme;
  style: BadgeStyle;
  idPrefix: string;
}): string {
  const { spec, theme, style } = params;
  const geometry = badgeGeometry(spec, style, theme);
  const palette = paletteFor(theme);
  const accent = palette[spec.accent];
  const body: string[] = [];

  if (geometry.shadow > 0) {
    body.push(
      `<path d="${pixelRectPath(
        geometry.shadow,
        geometry.shadow,
        geometry.panelWidth,
        geometry.panelHeight,
        geometry.corner,
      )}" ${paintFill(theme, 'shadow')} opacity="0.6"/>`,
    );
  }
  body.push(
    `<path d="${pixelRectPath(0, 0, geometry.panelWidth, geometry.panelHeight, geometry.corner)}" ${paintFill(
      theme,
      'surface',
    )}/>`,
  );
  // ~0.10 opacity dot texture behind the label only (never under the value).
  const textureX = geometry.labelX - 2;
  const textureWidth = Math.max(4, geometry.accentX - geometry.labelX - 6);
  body.push(
    `<path d="${pixelRectPath(textureX, 2, textureWidth, geometry.panelHeight - 4, 0)}" fill="url(#${
      params.idPrefix
    }-label-dots)"/>`,
  );
  // Accent block for the value (1px chamfer so it reads as pixel art).
  const accentWidth = geometry.panelWidth - 2 - geometry.accentX;
  body.push(
    `<path d="${pixelRectPath(geometry.accentX, 2, accentWidth, geometry.panelHeight - 4, 1)}" ${paintFill(
      theme,
      spec.accent,
    )}/>`,
  );
  // 2px hard border on top of both fills, inside the panel box.
  body.push(
    `<path d="${pixelRectPath(1, 1, geometry.panelWidth - 2, geometry.panelHeight - 2, geometry.corner)}" fill="none" ` +
      `${paintStroke(theme, 'borderHi')} stroke-width="2" shape-rendering="crispEdges"/>`,
  );
  // Dot-matrix metric icon, vertically centred on the panel.
  const iconY = Math.round((geometry.panelHeight - geometry.iconHeight) / 2);
  body.push(dotIconSvg(theme, spec.icon, 6, iconY, spec.accent));
  // Label + value.
  body.push(
    pixelText(spec.label, { x: geometry.labelX, y: geometry.labelY, scale: 2, paint: 'inkDim' }, theme),
    pixelText(
      spec.value,
      {
        x: geometry.accentX + Math.round(accentWidth / 2),
        y: geometry.labelY,
        scale: 2,
        paint: theme === 'auto' ? accentInkPaint(theme) : { color: contrastInk(accent) },
        align: 'center',
      },
      theme,
    ),
  );

  return svgFrame({
    width: geometry.width,
    height: geometry.height,
    theme,
    idPrefix: params.idPrefix,
    defs: dotLabelTextureDef(theme, `${params.idPrefix}-label-dots`, { paint: 'ink', pitch: 4, radius: 0.55, opacity: 0.1 }),
    title: spec.title,
    description: `Token Island badge for @user: ${spec.detail}.`,
    body: body.join(''),
    background: null,
  });
}

/** Renders the badge for a known user. */
export function renderBadge(stats: UserStats, options: BadgeOptions = {}): string {
  return renderBadgeSvg({
    spec: metricSpec(stats, options),
    theme: parseSvgTheme(options.theme),
    style: parseBadgeStyle(options.style),
    idPrefix: options.idPrefix ?? 'ti-badge',
  });
}

/** Renders the pixel `NO DATA` badge served with HTTP 404 for unknown users. */
export function renderUnknownBadge(options: BadgeOptions = {}): string {
  const theme = parseSvgTheme(options.theme);
  const value =
    typeof options.label === 'string' && options.label.trim() ? options.label.trim().toUpperCase() : 'NO DATA';
  return renderBadgeSvg({
    spec: {
      metric: 'tokens',
      label: 'TOKEN-ISLAND',
      value,
      title: `token-island: ${value}`,
      detail: 'unknown user: no Token Island account exists for this user yet',
      accent: 'inkDim',
      icon: 'cross',
    },
    theme,
    style: parseBadgeStyle(options.style),
    idPrefix: options.idPrefix ?? 'ti-badge-unknown',
  });
}
