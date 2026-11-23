/**
 * GitHub-README-safe status badges (shields.io look, hand-written SVG).
 *
 *   /u/:user/badge.svg?metric=tokens|cost|streak|messages|day|model|status
 *                      &theme=dark|light|auto&style=flat|flat-square
 *                      &label=<override>&days=1..365
 *
 * Badge geometry never measures text with the DOM: `textWidth()` uses a
 * generous character table, which is what keeps long model ids from clipping.
 */

import { formatCost, formatTokens, normalizeModelId, truncateLabel } from '@token-island/core';
import type { UserStats } from '../stats.js';
import { windowTotals } from '../stats.js';
import {
  FONT_STACK,
  clampNumber,
  contrastText,
  escapeXml,
  isAutoTheme,
  parseSvgTheme,
  textWidth,
  type SvgTheme,
} from './util.js';

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

interface AccentPair {
  dark: string;
  light: string;
}

const METRIC_ACCENTS: Record<BadgeMetric, AccentPair> = {
  tokens: { dark: '#5EEAD4', light: '#0F766E' },
  cost: { dark: '#A78BFA', light: '#6D28D9' },
  streak: { dark: '#FBBF24', light: '#B45309' },
  messages: { dark: '#60A5FA', light: '#1D4ED8' },
  day: { dark: '#60A5FA', light: '#1D4ED8' },
  model: { dark: '#60A5FA', light: '#1D4ED8' },
  status: { dark: '#60A5FA', light: '#1D4ED8' },
};

interface BadgeSpec {
  metric: BadgeMetric;
  label: string;
  value: string;
  detail: string;
  accentDark: string;
  accentLight: string;
}

function metricSpec(stats: UserStats, options: BadgeOptions): BadgeSpec {
  const metric = parseBadgeMetric(options.metric);
  const now = options.now ?? Date.now();
  const days = Math.round(clampNumber(options.days, 1, 365, 30));
  const window = windowTotals(stats, days, { now, timezone: options.timezone });
  const windowLabel = days === 1 ? 'the last day' : `the last ${days} days`;

  let detail: string;
  let defaultLabel: string;
  let value: string;
  switch (metric) {
    case 'cost':
      defaultLabel = 'est. spend';
      value = formatCost(window.costUsd, { approx: true });
      detail = `estimated spend over ${windowLabel}`;
      break;
    case 'streak':
      defaultLabel = 'streak';
      value = `${stats.streak.current}d`;
      detail = `current daily usage streak (longest ${stats.streak.longest}d)`;
      break;
    case 'messages':
      defaultLabel = 'agent turns';
      value = formatTokens(stats.totals.messages);
      detail = 'billable agent turns, all time';
      break;
    case 'day':
      defaultLabel = 'today';
      value = formatTokens(stats.today.totalTokens);
      detail = 'tokens consumed today';
      break;
    case 'model': {
      defaultLabel = 'top model';
      const top = stats.models[0]?.model;
      value = top ? truncateLabel(normalizeModelId(top), 22) : 'no data';
      detail = top ? `most used model: ${top}` : 'no model data yet';
      break;
    }
    case 'status': {
      defaultLabel = 'token-island';
      const live = stats.lastSyncAt !== null && now - stats.lastSyncAt < 86_400_000;
      value = live ? 'live' : 'idle';
      detail = live
        ? 'synced in the last 24 hours'
        : stats.lastSyncAt
          ? 'no sync in the last 24 hours'
          : 'waiting for the first sync';
      break;
    }
    case 'tokens':
    default:
      defaultLabel = 'tokens';
      value = formatTokens(window.totalTokens);
      detail = `tokens over ${windowLabel}`;
      break;
  }

  const labelOverride =
    typeof options.label === 'string' && options.label.trim() !== ''
      ? truncateLabel(options.label.trim(), 40)
      : defaultLabel;
  const accents = METRIC_ACCENTS[metric];

  return {
    metric,
    label: labelOverride,
    value,
    detail,
    accentDark: accents.dark,
    accentLight: accents.light,
  };
}

interface Geometry {
  height: number;
  radius: number;
  baseline: number;
  labelWidth: number;
  valueWidth: number;
  totalWidth: number;
}

function badgeGeometry(label: string, value: string, style: BadgeStyle): Geometry {
  const flatSquare = style === 'flat-square';
  const height = flatSquare ? 18 : 20;
  const pad = flatSquare ? 5 : 6;
  const labelWidth = Math.max(20, Math.ceil(textWidth(label, 11) + pad * 2 + 2));
  const valueWidth = Math.max(24, Math.ceil(textWidth(value, 11, true) + pad * 2 + 2));
  return {
    height,
    radius: flatSquare ? 0 : 4,
    baseline: flatSquare ? 13 : 14,
    labelWidth,
    valueWidth,
    totalWidth: labelWidth + valueWidth,
  };
}

function renderBadgeSvg(params: {
  label: string;
  value: string;
  title: string;
  description: string;
  accentDark: string;
  accentLight: string;
  theme: SvgTheme;
  style: BadgeStyle;
  idPrefix: string;
}): string {
  const { label, value, accentDark, accentLight, theme, style, idPrefix } = params;
  const geometry = badgeGeometry(label, value, style);
  const auto = isAutoTheme(theme);
  const labelBackground = theme === 'light' ? '#555555' : '#4A4A55';
  const accent = theme === 'light' ? accentLight : accentDark;
  const labelText = theme === 'light' ? '#FFFFFF' : '#F0F6FC';
  const valueText = contrastText(accent);
  const sheenId = `${idPrefix}-sheen`;
  const clipId = `${idPrefix}-clip`;
  const titleId = `${idPrefix}-title`;
  const descId = `${idPrefix}-desc`;
  const { height, radius, baseline, labelWidth, valueWidth, totalWidth } = geometry;
  const labelX = labelWidth / 2;
  const valueX = labelWidth + valueWidth / 2;

  const lightStyle = auto
    ? `<style>@media (prefers-color-scheme: light){.ti-b-label-bg{fill:#555555}.ti-b-value-bg{fill:${accentLight}}.ti-b-label-text{fill:#FFFFFF}.ti-b-value-text{fill:${contrastText(accentLight)}}.ti-b-border{stroke:#000000;stroke-opacity:.12}}</style>`
    : '';
  const shouldShadow = valueText === '#FFFFFF' ? false : true;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" ` +
    `viewBox="0 0 ${totalWidth} ${height}" role="img" aria-labelledby="${titleId} ${descId}">` +
    `<title id="${titleId}">${escapeXml(params.title)}</title>` +
    `<desc id="${descId}">${escapeXml(params.description)}</desc>` +
    lightStyle +
    `<defs>` +
    `<linearGradient id="${sheenId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".14"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="${clipId}"><rect width="${totalWidth}" height="${height}" rx="${radius}"/></clipPath>` +
    `</defs>` +
    `<g font-family="${FONT_STACK}">` +
    `<g clip-path="url(#${clipId})">` +
    `<rect class="ti-b-label-bg" width="${labelWidth}" height="${height}" fill="${labelBackground}"/>` +
    `<rect class="ti-b-value-bg" x="${labelWidth}" width="${valueWidth}" height="${height}" fill="${accent}"/>` +
    `<rect width="${totalWidth}" height="${height}" fill="url(#${sheenId})"/>` +
    `</g>` +
    `<rect class="ti-b-border" x=".5" y=".5" width="${totalWidth - 1}" height="${height - 1}" rx="${radius}" fill="none" stroke="${theme === 'light' ? '#000000' : '#FFFFFF'}" stroke-opacity=".12"/>` +
    `<g font-size="11" text-anchor="middle">` +
    (shouldShadow
      ? `<text x="${labelX}" y="${baseline + 1}" fill="#010101" fill-opacity=".28">${escapeXml(label)}</text>` +
        `<text x="${valueX}" y="${baseline + 1}" fill="#010101" fill-opacity=".28" font-weight="700">${escapeXml(value)}</text>`
      : `<text x="${valueX}" y="${baseline + 1}" fill="#010101" fill-opacity=".14" font-weight="700">${escapeXml(value)}</text>`) +
    `<text class="ti-b-label-text" x="${labelX}" y="${baseline}" fill="${labelText}">${escapeXml(label)}</text>` +
    `<text class="ti-b-value-text" x="${valueX}" y="${baseline}" fill="${valueText}" font-weight="700">${escapeXml(value)}</text>` +
    `</g></g></svg>`
  );
}

/** Renders the badge for a known user. */
export function renderBadge(stats: UserStats, options: BadgeOptions = {}): string {
  const theme = parseSvgTheme(options.theme);
  const style = parseBadgeStyle(options.style);
  const spec = metricSpec(stats, options);
  const user = `@${stats.username}`;
  return renderBadgeSvg({
    label: spec.label,
    value: spec.value,
    title: `${spec.label}: ${spec.value} · ${user}`,
    description: `Token Island badge for ${user}: ${spec.detail}.`,
    accentDark: spec.accentDark,
    accentLight: spec.accentLight,
    theme,
    style,
    idPrefix: options.idPrefix ?? 'ti-badge',
  });
}

/** Renders the badge served with HTTP 404 for unknown users. */
export function renderUnknownBadge(options: BadgeOptions = {}): string {
  const theme = parseSvgTheme(options.theme);
  const style = parseBadgeStyle(options.style);
  const value = typeof options.label === 'string' && options.label.trim() ? options.label.trim() : 'unknown user';
  return renderBadgeSvg({
    label: 'token-island',
    value,
    title: `token-island: ${value}`,
    description: 'No Token Island account exists for this user yet.',
    accentDark: '#6E7681',
    accentLight: '#57606A',
    theme,
    style,
    idPrefix: options.idPrefix ?? 'ti-badge-unknown',
  });
}
