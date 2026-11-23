/**
 * Profile card SVG (495x210 by default) for GitHub READMEs.
 *
 *   /u/:user/card.svg?theme=dark|light|auto&width=380..800
 *
 * Left: identity, all-time tokens + estimated spend, streak / active days /
 * average.  Right: a 30-day sparkline.  Bottom: top model + agent chips.
 */

import { formatCost, formatTokens, truncateLabel } from '@token-island/core';
import { averagePerActiveDay, dailyWindow, type SourceStat, type UserStats } from '../stats.js';
import {
  FONT_STACK,
  clampNumber,
  contrastText,
  escapeXml,
  isAutoTheme,
  paletteFor,
  parseSvgTheme,
  relativeTime,
  textWidth,
  type Palette,
  type SvgTheme,
} from './util.js';

export interface CardOptions {
  theme?: unknown;
  width?: unknown;
  now?: number;
  timezone?: string;
  idPrefix?: string;
}

const CARD_HEIGHT = 210;
const CARD_PADDING = 20;

function txt(x: number, y: number, content: string, options: {
  size?: number;
  fill?: string;
  weight?: number | string;
  anchor?: 'start' | 'middle' | 'end';
  className?: string;
  opacity?: number;
  letterSpacing?: number;
} = {}): string {
  const attributes: string[] = [`x="${Math.round(x * 100) / 100}"`, `y="${Math.round(y * 100) / 100}"`];
  if (options.size !== undefined) attributes.push(`font-size="${options.size}"`);
  if (options.fill !== undefined) attributes.push(`fill="${options.fill}"`);
  if (options.weight !== undefined) attributes.push(`font-weight="${options.weight}"`);
  if (options.anchor !== undefined) attributes.push(`text-anchor="${options.anchor}"`);
  if (options.opacity !== undefined) attributes.push(`fill-opacity="${options.opacity}"`);
  if (options.letterSpacing !== undefined) attributes.push(`letter-spacing="${options.letterSpacing}"`);
  if (options.className !== undefined) attributes.push(`class="${options.className}"`);
  return `<text ${attributes.join(' ')}>${escapeXml(content)}</text>`;
}

function autoLightStyle(): string {
  return (
    '<style>@media (prefers-color-scheme: light){' +
    '.ti-card-bg{fill:#FFFFFF}' +
    '.ti-card-panel{fill:#F6F8FA}' +
    '.ti-card-panel-alt{fill:#EAEEF2}' +
    '.ti-card-border{stroke:#D0D7DE}' +
    '.ti-card-text{fill:#1F2328}' +
    '.ti-card-muted{fill:#57606A}' +
    '.ti-card-accent{fill:#0D9488}' +
    '.ti-card-accent-stroke{stroke:#0D9488}' +
    '.ti-card-cost{fill:#6D28D9}' +
    '.ti-card-grad-top{stop-color:#0D9488}' +
    '.ti-card-grad-bottom{stop-color:#0D9488}' +
    '.ti-card-glow{stop-color:#0D9488;stop-opacity:.16}' +
    '}</style>'
  );
}

interface Chip {
  kind: 'model' | 'source';
  text: string;
  color?: string;
}

function buildChips(stats: UserStats, modelShort: string | null): Chip[] {
  const chips: Chip[] = [];
  if (modelShort) chips.push({ kind: 'model', text: truncateLabel(modelShort, 24) });
  for (const source of stats.sources.slice(0, 2)) chips.push(sourceChip(source));
  return chips;
}

function sourceChip(source: SourceStat): Chip {
  return { kind: 'source', text: source.short, color: source.color };
}

function renderChips(chips: Chip[], startX: number, maxWidth: number, y: number, palette: Palette): string {
  const parts: string[] = [];
  let x = startX;
  const height = 20;
  const radius = 10;
  for (const chip of chips) {
    const labelWidth = Math.ceil(textWidth(chip.text, 10));
    const dotWidth = chip.kind === 'model' ? 0 : 11;
    const width = labelWidth + dotWidth + 18;
    if (x + width > startX + maxWidth) break;
    parts.push(
      `<rect class="ti-card-panel-alt" x="${Math.round(x)}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${palette.panelAlt}"/>`,
    );
    if (chip.kind === 'source' && chip.color) {
      parts.push(
        `<circle cx="${Math.round(x + 10)}" cy="${y + height / 2}" r="3" fill="${chip.color}"/>`,
      );
    }
    parts.push(
      txt(x + dotWidth + 9, y + 14, chip.text, {
        size: 10,
        fill: palette.muted,
        className: 'ti-card-muted',
      }),
    );
    x += width + 8;
  }
  return parts.join('');
}

function renderSparkline(params: {
  palette: Palette;
  idPrefix: string;
  x: number;
  y: number;
  width: number;
  height: number;
  values: number[];
}): string {
  const { palette, idPrefix, x, y, width, height, values } = params;
  const boxRadius = 10;
  const plotX = x + 12;
  const plotY = y + 26;
  const plotWidth = width - 24;
  const plotHeight = height - 40;
  const bottom = plotY + plotHeight;
  const max = values.reduce((current, value) => Math.max(current, value), 0);

  const parts: string[] = [
    `<rect class="ti-card-panel" x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(width)}" height="${Math.round(height)}" rx="${boxRadius}" fill="${palette.panel}"/>`,
    txt(x + 12, y + 17, 'LAST 30 DAYS', {
      size: 8,
      fill: palette.faint,
      letterSpacing: 1.1,
      className: 'ti-card-muted',
    }),
    txt(x + width - 12, y + 17, `${formatTokens(values.reduce((sum, value) => sum + value, 0))} tokens`, {
      size: 8,
      fill: palette.faint,
      anchor: 'end',
      className: 'ti-card-muted',
    }),
    `<line x1="${Math.round(plotX)}" y1="${Math.round(bottom)}" x2="${Math.round(plotX + plotWidth)}" y2="${Math.round(bottom)}" stroke="${palette.grid}" stroke-width="1"/>`,
  ];

  if (max <= 0) {
    parts.push(
      txt(plotX + plotWidth / 2, bottom - plotHeight / 2 + 4, 'no data yet', {
        size: 9,
        fill: palette.faint,
        anchor: 'middle',
        className: 'ti-card-muted',
      }),
    );
    return parts.join('');
  }

  const n = values.length;
  const step = n > 1 ? plotWidth / (n - 1) : plotWidth;
  const points = values.map((value, index) => {
    const px = plotX + index * step;
    const py = bottom - Math.min(1, value / max) * plotHeight;
    return `${Math.round(px * 100) / 100},${Math.round(py * 100) / 100}`;
  });
  const area =
    `M ${Math.round(plotX)} ${Math.round(bottom)} ` +
    points.map((point) => `L ${point}`).join(' ') +
    ` L ${Math.round(plotX + plotWidth)} ${Math.round(bottom)} Z`;
  const lastPoint = points[points.length - 1] ?? `${plotX},${bottom}`;
  const [lastX = plotX, lastY = bottom] = lastPoint.split(',').map(Number);

  parts.push(
    `<defs><linearGradient id="${idPrefix}-spark" x1="0" y1="0" x2="0" y2="1">` +
      `<stop class="ti-card-grad-top" offset="0" stop-color="${palette.accent}" stop-opacity=".34"/>` +
      `<stop class="ti-card-grad-bottom" offset="1" stop-color="${palette.accent}" stop-opacity="0"/>` +
      `</linearGradient></defs>`,
    `<path d="${area}" fill="url(#${idPrefix}-spark)"/>`,
    `<polyline points="${points.join(' ')}" fill="none" stroke="${palette.accent}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" class="ti-card-accent-stroke"/>`,
    `<circle cx="${lastX}" cy="${lastY}" r="2.6" fill="${palette.accent}" class="ti-card-accent"/>`,
  );
  return parts.join('');
}

/** Renders the profile card for a known user. */
export function renderCard(stats: UserStats, options: CardOptions = {}): string {
  const theme = parseSvgTheme(options.theme);
  const width = Math.round(clampNumber(options.width, 380, 800, 495));
  const now = options.now ?? Date.now();
  const palette = paletteFor(theme);
  const idPrefix = options.idPrefix ?? 'ti-card';
  const auto = isAutoTheme(theme);
  const username = `@${stats.username}`;
  const totalTokens = stats.totals.totalTokens;
  const totalLabel = formatTokens(totalTokens);
  const costLabel = formatCost(stats.totals.costUsd, { approx: true });
  const modelShort = stats.models[0]?.model ?? null;
  const sparkValues = dailyWindow(stats, 30, { now, timezone: options.timezone }).map((day) => day.totalTokens);
  const activeDays = stats.activeDays;
  const avgLabel = formatTokens(averagePerActiveDay(stats));
  const streakLabel = `${stats.streak.current}d`;

  const sparkWidth = Math.round(Math.min(300, Math.max(160, width * 0.4)));
  const sparkX = width - CARD_PADDING - sparkWidth;
  const sparkY = 58;
  const sparkHeight = 94;
  const leftWidth = Math.max(120, sparkX - CARD_PADDING - 22);
  const statColumn = leftWidth / 3;
  const narrowStats = statColumn < 64;
  const activeDaysLabel = narrowStats ? 'ACTIVE' : 'ACTIVE DAYS';
  const avgStatLabel = narrowStats ? 'AVG/DAY' : 'AVG / DAY';
  const avatarSize = 30;
  const subtitle = 'AI agent token usage';
  const rightSubtitleX = width - CARD_PADDING;

  const usernameMaxWidth =
    rightSubtitleX - 16 - (CARD_PADDING + avatarSize + 12) - textWidth(subtitle, 9.5) - 24;
  const usernameLabel = truncateLabel(username, 40);
  const fittedUsername = fitUsername(usernameLabel, usernameMaxWidth);

  const chips = buildChips(stats, modelShort);
  const footerWidth = textWidth('token-island', 9) + 8;
  const chipsMaxWidth = width - CARD_PADDING - footerWidth - CARD_PADDING - 10;

  const body: string[] = [];
  if (auto) body.push(autoLightStyle());
  body.push(
    `<defs>` +
      `<linearGradient id="${idPrefix}-avatar" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${palette.accent}"/><stop offset="1" stop-color="${palette.accent2}"/>` +
      `</linearGradient>` +
      `<radialGradient id="${idPrefix}-glow" cx="0.82" cy="0" r="0.85">` +
      `<stop class="ti-card-glow" offset="0" stop-color="${palette.accent}" stop-opacity=".10"/>` +
      `<stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>` +
      `</radialGradient>` +
      `<clipPath id="${idPrefix}-clip"><rect width="${width}" height="${CARD_HEIGHT}" rx="12"/></clipPath>` +
      `</defs>`,
    `<rect class="ti-card-bg" width="${width}" height="${CARD_HEIGHT}" rx="12" fill="${palette.background}"/>`,
    `<g clip-path="url(#${idPrefix}-clip)"><rect width="${width}" height="${CARD_HEIGHT}" fill="url(#${idPrefix}-glow)"/></g>`,
    `<rect class="ti-card-border" x=".5" y=".5" width="${width - 1}" height="${CARD_HEIGHT - 1}" rx="12" fill="none" stroke="${palette.border}"/>`,
    // identity
    `<rect x="${CARD_PADDING}" y="18" width="${avatarSize}" height="${avatarSize}" rx="9" fill="url(#${idPrefix}-avatar)"/>`,
    txt(CARD_PADDING + avatarSize / 2, 18 + avatarSize / 2 + 4.5, stats.username.charAt(0).toUpperCase(), {
      size: 13,
      weight: 700,
      fill: contrastText(palette.accent),
      anchor: 'middle',
    }),
    txt(CARD_PADDING + avatarSize + 12, 38, fittedUsername, {
      size: 16,
      weight: 700,
      fill: palette.text,
      className: 'ti-card-text',
    }),
    txt(rightSubtitleX, 38, subtitle, {
      size: 9.5,
      fill: palette.muted,
      anchor: 'end',
      className: 'ti-card-muted',
    }),
    // totals
    txt(CARD_PADDING, 72, 'TOTAL TOKENS', {
      size: 8,
      fill: palette.faint,
      letterSpacing: 1.2,
      className: 'ti-card-muted',
    }),
    txt(CARD_PADDING, 103, totalLabel, {
      size: 30,
      weight: 700,
      fill: palette.text,
      className: 'ti-card-text',
    }),
    txt(CARD_PADDING + textWidth(totalLabel, 30, true) + 10, 100, costLabel, {
      size: 14,
      weight: 600,
      fill: palette.cost,
      className: 'ti-card-cost',
    }),
    // small stats
    txt(CARD_PADDING, 130, 'STREAK', {
      size: 8,
      fill: palette.faint,
      letterSpacing: narrowStats ? 0.4 : 1,
      className: 'ti-card-muted',
    }),
    txt(CARD_PADDING, 146, streakLabel, {
      size: 12.5,
      weight: 600,
      fill: palette.text,
      className: 'ti-card-text',
    }),
    txt(CARD_PADDING + statColumn, 130, activeDaysLabel, {
      size: 8,
      fill: palette.faint,
      letterSpacing: narrowStats ? 0.4 : 1,
      className: 'ti-card-muted',
    }),
    txt(CARD_PADDING + statColumn, 146, String(activeDays), {
      size: 12.5,
      weight: 600,
      fill: palette.text,
      className: 'ti-card-text',
    }),
    txt(CARD_PADDING + statColumn * 2, 130, avgStatLabel, {
      size: 8,
      fill: palette.faint,
      letterSpacing: narrowStats ? 0.4 : 1,
      className: 'ti-card-muted',
    }),
    txt(CARD_PADDING + statColumn * 2, 146, avgLabel, {
      size: 12.5,
      weight: 600,
      fill: palette.text,
      className: 'ti-card-text',
    }),
    // sparkline
    renderSparkline({
      palette,
      idPrefix,
      x: sparkX,
      y: sparkY,
      width: sparkWidth,
      height: sparkHeight,
      values: sparkValues,
    }),
    // rule + footer
    `<line x1="${CARD_PADDING}" y1="162" x2="${width - CARD_PADDING}" y2="162" stroke="${palette.border}" stroke-width="1" class="ti-card-border"/>`,
  );
  body.push(renderChips(chips, CARD_PADDING, chipsMaxWidth, 172, palette));
  body.push(
    txt(width - CARD_PADDING, 186, 'token-island', {
      size: 9,
      fill: palette.faint,
      anchor: 'end',
      className: 'ti-card-muted',
    }),
  );
  body.push(
    txt(CARD_PADDING, 204, `synced ${relativeTime(stats.lastSyncAt, now)}`, {
      size: 8,
      fill: palette.faint,
      opacity: 0.85,
      className: 'ti-card-muted',
    }),
  );

  const titleId = `${idPrefix}-title`;
  const descId = `${idPrefix}-desc`;
  const title = `${username} · Token Island`;
  const description =
    `Token Island profile card for ${username}: ${totalLabel} tokens, about ${costLabel} estimated spend, ` +
    `${streakLabel} streak, ${activeDays} active days.`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CARD_HEIGHT}" ` +
    `viewBox="0 0 ${width} ${CARD_HEIGHT}" role="img" aria-labelledby="${titleId} ${descId}">` +
    `<title id="${titleId}">${escapeXml(title)}</title>` +
    `<desc id="${descId}">${escapeXml(description)}</desc>` +
    `<g font-family="${FONT_STACK}">${body.join('')}</g></svg>`
  );
}

function fitUsername(text: string, maxWidth: number): string {
  if (textWidth(text, 16, true) <= maxWidth) return text;
  return truncateLabel(text, Math.max(4, Math.floor(maxWidth / 8.2)));
}

/** Renders the "unknown user" card served with HTTP 404. */
export function renderUnknownCard(options: CardOptions = {}): string {
  const theme = parseSvgTheme(options.theme);
  const width = Math.round(clampNumber(options.width, 380, 800, 495));
  const palette = paletteFor(theme);
  const idPrefix = options.idPrefix ?? 'ti-card-unknown';
  const titleId = `${idPrefix}-title`;
  const descId = `${idPrefix}-desc`;
  const body = [
    `<rect class="ti-card-bg" width="${width}" height="${CARD_HEIGHT}" rx="12" fill="${palette.background}"/>`,
    `<rect class="ti-card-border" x=".5" y=".5" width="${width - 1}" height="${CARD_HEIGHT - 1}" rx="12" fill="none" stroke="${palette.border}"/>`,
    txt(width / 2, CARD_HEIGHT / 2 - 6, 'unknown user', {
      size: 15,
      weight: 600,
      fill: palette.muted,
      anchor: 'middle',
      className: 'ti-card-muted',
    }),
    txt(width / 2, CARD_HEIGHT / 2 + 16, 'this token-island profile does not exist', {
      size: 10,
      fill: palette.faint,
      anchor: 'middle',
      className: 'ti-card-muted',
    }),
  ].join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CARD_HEIGHT}" ` +
    `viewBox="0 0 ${width} ${CARD_HEIGHT}" role="img" aria-labelledby="${titleId} ${descId}">` +
    `<title id="${titleId}">Token Island · unknown user</title>` +
    `<desc id="${descId}">No Token Island account exists for this user.</desc>` +
    `<g font-family="${FONT_STACK}">${body}</g></svg>`
  );
}
