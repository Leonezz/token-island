/**
 * Pixel profile card SVG (520x240 by default) for GitHub READMEs.
 *
 *   /u/:user/card.svg?theme=dark|light|auto&width=420..800
 *
 * Layout (docs/CONTRACT-V2.md §2.2): 48x48 avatar block with the uppercase
 * initial in a pixel frame, `@user` at bitmap scale 3, `AI AGENT TOKEN USAGE`
 * micro-label, the all-time token total big (scale 4/6), `~$` spend at scale 2,
 * a STREAK / ACTIVE DAYS / AVG PER DAY row, a 140x56 pixel-bar 30-day
 * sparkline, model/agent chips and a pixel footer.  Integer coordinates only.
 */

import { normalizeModelId, pixelSpriteSvg, truncateLabel } from '@token-island/core';
import { averagePerActiveDay, dailyWindow, type UserStats } from '../stats.js';
import { pixelPanel, pixelRule, svgFrame } from './frame.js';
import {
  clampNumber,
  costLabel,
  fitText,
  paintFill,
  paletteFor,
  parseSvgTheme,
  pixelText,
  relativeTime,
  textWidth,
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

/** Pixel sparkline: 30 daily bars, 2px wide with a 2px gap, on a 1px baseline. */
function renderSparkline(params: {
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
  const parts: string[] = [];
  const title = 'LAST 30 DAYS';
  const total = `${tokensLabel(values.reduce((sum, value) => sum + value, 0))} TOKENS`;
  parts.push(pixelText(title, { x, y: y - 14, scale: 1, paint: 'inkDim' }, theme));
  if (textWidth(title, 1) + 10 + textWidth(total, 1) <= width) {
    parts.push(
      pixelText(total, { x: x + width, y: y - 14, scale: 1, paint: 'inkDim', align: 'right' }, theme),
    );
  }
  const baseline = y + height;
  parts.push(`<rect x="${x}" y="${baseline}" width="${width}" height="1" ${paintFill(theme, 'grid')}/>`);
  const max = values.reduce((current, value) => Math.max(current, value), 0);
  if (max <= 0) {
    parts.push(
      pixelText(
        'NO DATA YET',
        { x: x + Math.round(width / 2), y: y + Math.round(height / 2) - 4, scale: 1, paint: 'inkDim', align: 'center' },
        theme,
      ),
    );
    return parts.join('');
  }
  const count = values.length;
  const gap = 2;
  const barWidth = Math.max(1, Math.floor((width - (count - 1) * gap) / count));
  const totalWidth = count * barWidth + (count - 1) * gap;
  const startX = x + Math.floor((width - totalWidth) / 2);
  const bars: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = values[index] ?? 0;
    const barHeight = value > 0 ? Math.max(1, Math.round((value / max) * (height - 4))) : 1;
    const barX = startX + index * (barWidth + gap);
    const barY = baseline - barHeight;
    bars.push(
      `<rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" ${paintFill(
        theme,
        index === count - 1 ? 'teal' : 'borderHi',
      )}/>`,
    );
  }
  parts.push(bars.join(''));
  return parts.join('');
}

function renderChips(params: {
  texts: string[];
  theme: SvgTheme;
  x: number;
  y: number;
  maxX: number;
  height: number;
}): string {
  const parts: string[] = [];
  let x = params.x;
  for (const text of params.texts) {
    const width = textWidth(text, 1) + 12;
    if (x + width > params.maxX) break;
    parts.push(
      pixelPanel({
        x,
        y: params.y,
        width,
        height: params.height,
        theme: params.theme,
        fill: 'surfaceAlt',
        border: 'border',
        corner: 0,
      }),
      pixelText(
        text,
        { x: x + 6, y: params.y + Math.floor((params.height - 5) / 2), scale: 1, paint: 'inkDim' },
        params.theme,
      ),
    );
    x += width + 8;
  }
  return parts.join('');
}

/** Renders the profile card for a known user. */
export function renderCard(stats: UserStats, options: CardOptions = {}): string {
  const theme = parseSvgTheme(options.theme);
  const width = cardWidth(options.width);
  const now = options.now ?? Date.now();
  const idPrefix = options.idPrefix ?? 'ti-card';

  const totalTokens = stats.totals.totalTokens;
  const totalLabel = tokensLabel(totalTokens);
  const spendLabel = costLabel(stats.totals.costUsd);
  const username = truncateLabel(stats.username, 32);
  const avatarSize = 48;
  const heroTop = 96;
  const sparkX = width - PAD - 140;
  const heroAvailable = sparkX - PAD - 20;

  let totalScale = 6;
  while (totalScale > 4 && textWidth(totalLabel, totalScale) > heroAvailable - 90) totalScale -= 2;
  const totalWidth = textWidth(totalLabel, totalScale);
  const costWidth = textWidth(spendLabel, 2);
  const costRight = sparkX - 20;
  let costX = costRight - costWidth;
  let costY = heroTop + 5 * totalScale - 10;
  if (costX < PAD + totalWidth + 8) {
    costX = PAD;
    costY = heroTop + 5 * totalScale + 6;
  }

  const statColumns = 3;
  const statsWidth = Math.max(120, sparkX - PAD - 20);
  const statColumnWidth = Math.floor(statsWidth / statColumns);
  const statLabels = ['STREAK', 'ACTIVE DAYS', 'AVG / DAY'];
  const statValues = [`${stats.streak.current}D`, String(stats.activeDays), tokensLabel(averagePerActiveDay(stats))];
  const statsTop = 146;
  const statParts: string[] = [];
  for (let column = 0; column < statColumns; column += 1) {
    const columnX = PAD + column * statColumnWidth;
    statParts.push(
      pixelText(fitText(statLabels[column] ?? '', statColumnWidth - 10, 1), {
        x: columnX,
        y: statsTop,
        scale: 1,
        paint: 'inkDim',
      }, theme),
      pixelText(statValues[column] ?? '', { x: columnX, y: statsTop + 10, scale: 2, paint: 'ink' }, theme),
    );
  }

  // Avatar: largest bitmap scale whose glyph fits the 48px block.
  const initial = avatarInitial(stats);
  const initialAdvance = textWidth(initial, 1) || 6;
  const initialScale = Math.max(2, Math.min(6, Math.floor(40 / initialAdvance)));
  const initialWidth = textWidth(initial, initialScale);
  const initialCaps = 5 * initialScale;

  const chips: string[] = [];
  const topModel = stats.models[0]?.model;
  if (topModel) chips.push(truncateLabel(normalizeModelId(topModel), 22).toUpperCase());
  for (const source of stats.sources.slice(0, 2)) chips.push(source.short.toUpperCase());
  const chipsMaxX = width - PAD - textWidth('TOKEN-ISLAND', 1) - 16;

  const body: string[] = [];
  body.push(pixelPanel({ x: 0, y: 0, width, height: CARD_HEIGHT, theme, fill: 'bg', border: 'border', corner: 2 }));
  body.push(
    pixelPanel({
      x: PAD,
      y: PAD,
      width: avatarSize,
      height: avatarSize,
      theme,
      fill: 'surfaceAlt',
      border: 'borderHi',
      corner: 1,
    }),
    pixelText(initial, {
      x: PAD + Math.floor((avatarSize - initialWidth) / 2),
      y: PAD + Math.floor((avatarSize - initialCaps) / 2),
      scale: initialScale,
      paint: 'teal',
    }, theme),
  );

  const identityX = PAD + avatarSize + 14;
  body.push(
    pixelText(`@${username}`, { x: identityX, y: PAD + 2, scale: 3, paint: 'ink' }, theme),
    pixelText('AI AGENT TOKEN USAGE', { x: identityX, y: PAD + 26, scale: 1, paint: 'inkDim' }, theme),
    pixelText('TOTAL TOKENS', { x: PAD, y: heroTop - 16, scale: 1, paint: 'inkDim' }, theme),
    pixelText(totalLabel, { x: PAD, y: heroTop, scale: totalScale, paint: 'ink' }, theme),
    pixelText(spendLabel, { x: costX, y: costY, scale: 2, paint: 'purple' }, theme),
    pixelText(tokensFullLabel(totalTokens), {
      x: width - PAD,
      y: heroTop - 16,
      scale: 1,
      paint: 'inkDim',
      align: 'right',
    }, theme),
    statParts.join(''),
  );

  body.push(renderSparkline({ stats, theme, x: sparkX, y: 92, width: 140, height: 56, now, timezone: options.timezone }));
  body.push(pixelRule({ theme, x: PAD, y: 178, width: width - PAD * 2, paint: 'border' }));
  body.push(renderChips({ texts: chips, theme, x: PAD, y: 188, maxX: chipsMaxX, height: 18 }));
  body.push(
    pixelText('TOKEN-ISLAND', { x: width - PAD, y: 195, scale: 1, paint: 'inkDim', align: 'right' }, theme),
    pixelText(`SYNCED ${relativeTime(stats.lastSyncAt, now)}`, {
      x: width - PAD,
      y: 220,
      scale: 1,
      paint: 'inkDim',
      align: 'right',
    }, theme),
    pixelText(`SINCE ${stats.firstDate ?? '—'}`, { x: PAD, y: 220, scale: 1, paint: 'inkDim' }, theme),
  );

  return svgFrame({
    width,
    height: CARD_HEIGHT,
    theme,
    idPrefix,
    title: `@${stats.username} · Token Island profile card`,
    description: `Pixel Token Island profile card for @${stats.username}: ${tokensLabel(
      totalTokens,
    )} tokens, about ${costLabel(stats.totals.costUsd)} estimated spend, ${stats.streak.current} day streak, ${
      stats.activeDays
    } active days.`,
    body: body.join(''),
    background: null,
  });
}

/** Renders the pixel "unknown user" card served with HTTP 404. */
export function renderUnknownCard(options: CardOptions = {}): string {
  const theme = parseSvgTheme(options.theme);
  const width = cardWidth(options.width);
  const idPrefix = options.idPrefix ?? 'ti-card-unknown';
  const cx = Math.round(width / 2);
  const cy = Math.round(CARD_HEIGHT / 2);
  const body = [
    pixelPanel({ x: 0, y: 0, width, height: CARD_HEIGHT, theme, fill: 'bg', border: 'border', corner: 2 }),
    pixelSpriteSvg('cross', cx - 7, cy - 46, 3, paletteFor(theme).inkFaint),
    pixelText('UNKNOWN USER', { x: cx, y: cy - 14, scale: 3, paint: 'inkDim', align: 'center' }, theme),
    pixelText('THIS TOKEN-ISLAND PROFILE DOES NOT EXIST', {
      x: cx,
      y: cy + 12,
      scale: 1,
      paint: 'inkDim',
      align: 'center',
    }, theme),
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
