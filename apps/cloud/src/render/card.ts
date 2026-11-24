/**
 * Precision Telemetry profile card SVG (`520x240` default) for GitHub READMEs.
 *
 *   /u/:user/card.svg?theme=dark|light|auto&width=420..800
 *
 * Clean 2-column grid layout eliminating label collisions:
 *  - Header: rounded initial avatar, `@username`, subtitle, and live sync pill
 *  - Left column: crisp 28px tabular-mono all-time token figure + spend +
 *    Streak / Active Days / Avg per Day metrics
 *  - Right column: dedicated inset container with `30d Trend` header + 30-bar sparkline
 *  - Footer: lowercase monospace model/agent chips + `Since YYYY-MM-DD · token-island`
 */

import { normalizeModelId, truncateLabel } from '@token-island/core';
import { averagePerActiveDay, dailyWindow, type UserStats } from '../stats.js';
import { svgFrame, telemetryPanel, telemetryRule } from './frame.js';
import {
  clampNumber,
  costLabel,
  fitSvgText,
  measureText,
  paintFill,
  parseSvgTheme,
  relativeTime,
  svgText,
  tokensFullLabel,
  tokensLabel,
  type SvgTheme,
} from './tokens.js';

export interface CardOptions {
  theme?: unknown;
  width?: unknown;
  now?: number;
  timezone?: string;
  idPrefix?: string;
}

const CARD_HEIGHT = 240;
const PAD = 20;

function cardWidth(raw: unknown): number {
  return Math.round(clampNumber(raw, 420, 800, 520));
}

function avatarInitial(stats: UserStats): string {
  const source = stats.displayName || stats.username;
  return (source.replace(/^@/, '').charAt(0) || '?').toUpperCase();
}

/** Dedicated right-column inset sparkline card (prevents any collision with left metrics). */
function renderSparklineCard(params: {
  stats: UserStats;
  theme: SvgTheme;
  x: number;
  y: number;
  width: number;
  height: number;
  now: number;
  timezone?: string;
}): string {
  const { stats, theme, x, y, width, height, now } = params;
  const values = dailyWindow(stats, 30, { now, timezone: params.timezone }).map((day) => day.totalTokens);
  const windowSum = values.reduce((sum, v) => sum + v, 0);
  const max = values.reduce((current, v) => Math.max(current, v), 0);

  const parts: string[] = [
    telemetryPanel({ x, y, width, height, theme, fill: 'surfaceAlt', border: 'border', radius: 8 }),
    svgText('30d Trend', { x: x + 10, y: y + 18, size: 11, weight: 500, paint: 'inkDim' }, theme),
    svgText(
      tokensLabel(windowSum),
      { x: x + width - 10, y: y + 18, size: 11, weight: 600, mono: true, paint: 'teal', align: 'right' },
      theme,
    ),
  ];

  const plotX = x + 10;
  const plotW = width - 20;
  const plotBottom = y + height - 10;
  const plotH = height - 38;

  if (max <= 0) {
    parts.push(
      svgText(
        'No recent activity',
        { x: x + Math.round(width / 2), y: y + Math.round(height / 2) + 8, size: 11, paint: 'inkFaint', align: 'center' },
        theme,
      ),
    );
    return parts.join('');
  }

  const count = values.length;
  const gap = 1.5;
  const barW = Math.max(1.5, Math.floor(((plotW - (count - 1) * gap) / count) * 10) / 10);
  const totalBarsW = count * barW + (count - 1) * gap;
  const startX = plotX + Math.max(0, (plotW - totalBarsW) / 2);

  for (let index = 0; index < count; index += 1) {
    const val = values[index] ?? 0;
    const barH = val > 0 ? Math.max(2, Math.round((val / max) * plotH)) : 1.5;
    const bx = Math.round((startX + index * (barW + gap)) * 10) / 10;
    const by = plotBottom - barH;
    const isToday = index === count - 1;
    parts.push(
      `<rect x="${bx}" y="${by}" width="${barW}" height="${barH}" rx="1" ${paintFill(
        theme,
        val <= 0 ? 'border' : isToday ? 'teal' : 'blue',
      )}${!isToday && val > 0 ? ' opacity="0.72"' : ''}/>`,
    );
  }
  return parts.join('');
}

function renderChips(params: {
  texts: string[];
  theme: SvgTheme;
  x: number;
  y: number;
  maxX: number;
}): string {
  const parts: string[] = [];
  let cursor = params.x;
  const height = 20;
  for (const label of params.texts) {
    const labelW = measureText(label, 11, { mono: true });
    const pillW = labelW + 14;
    if (cursor + pillW > params.maxX) break;
    parts.push(
      telemetryPanel({
        x: cursor,
        y: params.y,
        width: pillW,
        height,
        theme: params.theme,
        fill: 'surfaceAlt',
        border: 'border',
        radius: 5,
      }),
      svgText(
        label,
        { x: cursor + 7, y: params.y + 13.5, size: 11, weight: 500, mono: true, paint: 'inkDim' },
        params.theme,
      ),
    );
    cursor += pillW + 6;
  }
  return parts.join('');
}

export function renderCard(stats: UserStats, options: CardOptions = {}): string {
  const theme = parseSvgTheme(options.theme);
  const width = cardWidth(options.width);
  const now = options.now ?? Date.now();
  const idPrefix = options.idPrefix ?? 'ti-card';

  const totalTokens = stats.totals.totalTokens;
  const totalLabel = tokensLabel(totalTokens);
  const spendLabel = costLabel(stats.totals.costUsd);
  const username = truncateLabel(stats.username, 28);
  const syncText = stats.lastSyncAt ? `Synced ${relativeTime(stats.lastSyncAt, now)}` : 'Not synced yet';
  const isLive = stats.lastSyncAt !== null && now - stats.lastSyncAt < 86_400_000;

  const sparkW = Math.min(184, Math.max(138, Math.round(width * 0.33)));
  const sparkX = width - PAD - sparkW;
  const leftMaxW = sparkX - PAD - 16;

  const body: string[] = [
    telemetryPanel({ x: 0, y: 0, width, height: CARD_HEIGHT, theme, fill: 'surface', border: 'borderHi', radius: 12 }),
  ];

  // Header: Avatar + Identity + Sync Pill
  const avatarSize = 38;
  body.push(
    telemetryPanel({
      x: PAD,
      y: 18,
      width: avatarSize,
      height: avatarSize,
      theme,
      fill: 'surfaceAlt',
      border: 'borderHi',
      radius: 9,
    }),
    svgText(
      avatarInitial(stats),
      { x: PAD + avatarSize / 2, y: 42.5, size: 17, weight: 700, paint: 'teal', align: 'center' },
      theme,
    ),
    svgText(`@${username}`, { x: PAD + avatarSize + 12, y: 34, size: 15, weight: 700, paint: 'ink' }, theme),
    svgText(
      'AI Coding Agent Telemetry',
      { x: PAD + avatarSize + 12, y: 51, size: 11.5, weight: 400, paint: 'inkDim' },
      theme,
    ),
  );

  // Sync pill top-right
  const syncPillW = measureText(syncText, 11, { mono: true }) + 24;
  const syncPillX = width - PAD - syncPillW;
  if (syncPillX > PAD + avatarSize + 160) {
    body.push(
      telemetryPanel({
        x: syncPillX,
        y: 22,
        width: syncPillW,
        height: 22,
        theme,
        fill: 'surfaceAlt',
        border: 'border',
        radius: 11,
      }),
      `<circle cx="${syncPillX + 10}" cy="33" r="3" ${paintFill(theme, isLive ? 'teal' : 'inkFaint')}/>`,
      svgText(
        syncText,
        { x: syncPillX + 18, y: 36.5, size: 11, weight: 500, mono: true, paint: isLive ? 'inkDim' : 'inkFaint' },
        theme,
      ),
    );
  }

  // Left Column: All-time Tokens + Spend + 3 Sub-Stats
  body.push(
    svgText('All-Time Tokens', { x: PAD, y: 82, size: 11.5, weight: 500, paint: 'inkDim' }, theme),
    svgText(totalLabel, { x: PAD, y: 112, size: 28, weight: 700, mono: true, paint: 'ink' }, theme),
  );

  const totalTextW = measureText(totalLabel, 28, { mono: true });
  const spendX = PAD + totalTextW + 10;
  if (spendX + measureText(spendLabel, 14, { mono: true }) <= PAD + leftMaxW) {
    body.push(
      svgText(spendLabel, { x: spendX, y: 111, size: 14, weight: 600, mono: true, paint: 'amber' }, theme),
    );
  }

  body.push(
    svgText(
      fitSvgText(`${tokensFullLabel(totalTokens)} total`, leftMaxW, 11, { mono: true }),
      { x: PAD, y: 129, size: 11, weight: 400, mono: true, paint: 'inkFaint' },
      theme,
    ),
  );

  // 3-Column Metrics Row
  const colW = Math.floor(leftMaxW / 3);
  const subMetrics: Array<[string, string]> = [
    ['Streak', `${stats.streak.current}d`],
    ['Active Days', String(stats.activeDays)],
    ['Avg / Day', tokensLabel(averagePerActiveDay(stats))],
  ];
  subMetrics.forEach(([lbl, val], idx) => {
    const cx = PAD + idx * colW;
    body.push(
      svgText(lbl, { x: cx, y: 152, size: 11, weight: 500, paint: 'inkFaint' }, theme),
      svgText(val, { x: cx, y: 169, size: 13.5, weight: 600, mono: true, paint: 'ink' }, theme),
    );
  });

  // Right Column: Dedicated 30d Sparkline Box
  body.push(
    renderSparklineCard({
      stats,
      theme,
      x: sparkX,
      y: 72,
      width: sparkW,
      height: 100,
      now,
      timezone: options.timezone,
    }),
  );

  // Footer Divider + Chips + Brand/Since
  body.push(telemetryRule({ theme, x: PAD, y: 188, width: width - PAD * 2, paint: 'border' }));

  const chips: string[] = [];
  const topModel = stats.models[0]?.model;
  if (topModel) chips.push(truncateLabel(normalizeModelId(topModel), 22));
  for (const source of stats.sources.slice(0, 2)) chips.push(source.short);

  const rightFooter = stats.firstDate ? `Since ${stats.firstDate} · token-island` : 'token-island';
  const rightFooterW = measureText(rightFooter, 11, { mono: true });
  body.push(
    renderChips({ texts: chips, theme, x: PAD, y: 200, maxX: width - PAD - rightFooterW - 14 }),
    svgText(
      rightFooter,
      { x: width - PAD, y: 214, size: 11, weight: 500, mono: true, paint: 'inkFaint', align: 'right' },
      theme,
    ),
  );

  return svgFrame({
    width,
    height: CARD_HEIGHT,
    theme,
    idPrefix,
    title: `@${stats.username} · Token Island profile card`,
    description: `Token Island profile card for @${stats.username}: ${tokensLabel(
      totalTokens,
    )} tokens, about ${costLabel(stats.totals.costUsd)} estimated spend, ${stats.streak.current} day streak, ${
      stats.activeDays
    } active days.`,
    body: body.join(''),
    background: null,
  });
}

export function renderUnknownCard(options: CardOptions = {}): string {
  const theme = parseSvgTheme(options.theme);
  const width = cardWidth(options.width);
  const idPrefix = options.idPrefix ?? 'ti-card-unknown';
  const cx = Math.round(width / 2);
  const cy = Math.round(CARD_HEIGHT / 2);
  const body = [
    telemetryPanel({ x: 0, y: 0, width, height: CARD_HEIGHT, theme, fill: 'surface', border: 'borderHi', radius: 12 }),
    svgText('Unknown user', { x: cx, y: cy - 4, size: 15, weight: 600, paint: 'inkDim', align: 'center' }, theme),
    svgText(
      'No Token Island profile exists for this username yet.',
      { x: cx, y: cy + 16, size: 12, weight: 400, paint: 'inkFaint', align: 'center' },
      theme,
    ),
  ].join('');
  return svgFrame({
    width,
    height: CARD_HEIGHT,
    theme,
    idPrefix,
    title: 'Token Island · unknown user',
    description: 'No Token Island account exists for this user.',
    body,
    background: null,
  });
}
