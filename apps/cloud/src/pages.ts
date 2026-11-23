/**
 * Server-rendered HTML: landing page, public dashboard and the 404 page.
 *
 * No frameworks, no bundler, no network calls: inline CSS/JS, inline SVGs built
 * by the very same renderers that serve the README assets.  Every piece of
 * user-controlled text goes through `escapeHtml`.
 */

import { formatCost, formatPercent, formatTokens, formatTokensFull } from '@token-island/core';
import {
  chartSeries,
  dailyWindow,
  windowModels,
  windowTotals,
  type UserStats,
} from './stats.js';
import { renderBadge, type BadgeMetric } from './svg/badge.js';
import { renderCard } from './svg/card.js';
import { renderChart } from './svg/chart.js';
import {
  dateTimeLabel,
  longDate,
  parseSvgTheme,
  relativeTime,
  shortDate,
  type SvgTheme,
} from './svg/util.js';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function pageTheme(raw: unknown): SvgTheme {
  return parseSvgTheme(raw);
}

function themeQuery(theme: SvgTheme): string {
  return `?theme=${theme}`;
}

function inlineSvg(svg: string, className = 'svg-inline'): string {
  return `<div class="${className}">${svg}</div>`;
}

function logoMark(size = 26): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 32 32" role="img" aria-label="Token Island logo" ` +
    `fill="none" xmlns="http://www.w3.org/2000/svg">` +
    `<defs><linearGradient id="ti-logo-bg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#0D1117"/><stop offset="1" stop-color="#161B22"/></linearGradient></defs>` +
    `<rect width="32" height="32" rx="9" fill="url(#ti-logo-bg)" stroke="#30363D"/>` +
    `<circle cx="10.5" cy="10" r="2.2" fill="#FBBF24"/>` +
    `<ellipse cx="16.5" cy="23" rx="9" ry="3.2" fill="#5EEAD4"/>` +
    `<path d="M17 22c0-5.4 1.1-8.3 3.2-10.4" stroke="#A78BFA" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M20.4 11.8c-3.2-1.4-5.5-.3-6.6 1.8M20.4 11.8c3.2-1.4 5.5-.3 6.6 1.8M20.4 11.8c-.2-2.2-1.2-3.4-2.4-4.4" stroke="#A78BFA" stroke-width="1.6" stroke-linecap="round"/>` +
    `</svg>`
  );
}

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='9' fill='%230D1117'/%3E%3Cellipse cx='16' cy='23' rx='9' ry='3' fill='%235EEAD4'/%3E%3Ccircle cx='10' cy='10' r='2' fill='%23FBBF24'/%3E%3C/svg%3E";

const DARK_VARS = `
  color-scheme: dark;
  --bg: #0A0E13;
  --bg-2: #0D1117;
  --panel: #12181F;
  --panel-2: #161D26;
  --border: #232B36;
  --border-2: #2E3845;
  --text: #E6EDF3;
  --muted: #9AA4B2;
  --faint: #6E7681;
  --accent: #5EEAD4;
  --accent-ink: #062D27;
  --accent-2: #A78BFA;
  --blue: #60A5FA;
  --green: #34D399;
  --amber: #FBBF24;
  --red: #F87171;
  --code: #0B0F14;
  --shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
  --glow-1: rgba(94, 234, 212, 0.12);
  --glow-2: rgba(167, 139, 250, 0.1);
`;

const LIGHT_VARS = `
  color-scheme: light;
  --bg: #F4F7FA;
  --bg-2: #FFFFFF;
  --panel: #FFFFFF;
  --panel-2: #F6F8FA;
  --border: #DCE3EA;
  --border-2: #C9D2DC;
  --text: #1F2328;
  --muted: #57606A;
  --faint: #6E7781;
  --accent: #0D9488;
  --accent-ink: #FFFFFF;
  --accent-2: #7C3AED;
  --blue: #2563EB;
  --green: #059669;
  --amber: #B45309;
  --red: #DC2626;
  --code: #F6F8FA;
  --shadow: 0 20px 55px rgba(31, 35, 40, 0.1);
  --glow-1: rgba(13, 148, 136, 0.1);
  --glow-2: rgba(124, 58, 237, 0.07);
`;

const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Ubuntu, 'Helvetica Neue', sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text);
  background:
    radial-gradient(1100px 560px at 82% -12%, var(--glow-1), transparent 62%),
    radial-gradient(900px 480px at 4% -4%, var(--glow-2), transparent 58%),
    var(--bg);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
a { color: inherit; }
code, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; }
img, svg { max-width: 100%; }
.container { width: 100%; max-width: 1120px; margin: 0 auto; padding: 0 24px; }

.site-header { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 22px 0; }
.brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; font-weight: 650; font-size: 15px; letter-spacing: -0.01em; }
.brand span { opacity: 0.95; }
.brand .beta { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 2px 7px; }
.header-right { display: flex; align-items: center; gap: 16px; }
.nav-links { display: flex; align-items: center; gap: 18px; font-size: 13px; color: var(--muted); }
.nav-links a { text-decoration: none; }
.nav-links a:hover { color: var(--text); }
.theme-switch { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--border); border-radius: 999px; background: var(--panel); }
.theme-switch a { padding: 4px 10px; border-radius: 999px; font-size: 11.5px; color: var(--muted); text-decoration: none; }
.theme-switch a[aria-current='true'] { background: var(--panel-2); color: var(--text); box-shadow: inset 0 0 0 1px var(--border-2); }
@media (max-width: 720px) { .nav-links { display: none; } }

.hero { display: grid; grid-template-columns: 1.04fr 0.96fr; align-items: center; gap: 56px; padding: 62px 0 46px; }
@media (max-width: 960px) { .hero { grid-template-columns: 1fr; gap: 40px; padding: 38px 0 28px; } }
.eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; margin-bottom: 22px; border: 1px solid var(--border); border-radius: 999px; background: var(--panel); font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent); }
h1.hero-title { margin: 0 0 20px; font-size: clamp(38px, 5vw, 56px); line-height: 1.03; letter-spacing: -0.035em; font-weight: 700; text-wrap: balance; }
.grad-text { background: linear-gradient(94deg, var(--accent) 1%, var(--accent-2) 96%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lede { max-width: 35em; margin: 0 0 26px; font-size: 16.5px; line-height: 1.62; color: var(--muted); }
.cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 26px; }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 11px 18px; border: 1px solid transparent; border-radius: 10px; font-size: 13.5px; font-weight: 600; text-decoration: none; transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease; }
.btn:hover { transform: translateY(-1px); }
.btn-primary { background: var(--accent); color: var(--accent-ink); box-shadow: 0 10px 30px color-mix(in srgb, var(--accent) 22%, transparent); }
.btn-ghost { border-color: var(--border-2); background: var(--panel); color: var(--text); }
.btn-ghost:hover { border-color: var(--accent); }
.mini-stats { display: flex; flex-wrap: wrap; gap: 22px; font-size: 12.5px; color: var(--muted); }
.mini-stats b { color: var(--text); font-weight: 600; }

.stage { position: relative; }
.stage-panel { position: relative; overflow: hidden; padding: 18px; border: 1px solid var(--border); border-radius: 18px; background: linear-gradient(180deg, var(--panel), var(--bg-2)); box-shadow: var(--shadow); }
.stage-panel::after { content: ''; position: absolute; inset: -1px; pointer-events: none; border-radius: 18px; background: radial-gradient(560px 200px at 85% -20%, var(--glow-1), transparent 70%); }
.stage-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.stage-top .live { display: inline-flex; align-items: center; gap: 6px; color: var(--green); }
.stage-top .live .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.card-slot svg { display: block; width: 100%; height: auto; }
.badge-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.badge-row .svg-inline { display: flex; }
.badge-row svg { display: block; height: 20px; width: auto; }
.chart-slot { margin-top: 14px; overflow: hidden; border: 1px solid var(--border); border-radius: 12px; }
.chart-slot svg { display: block; width: 100%; height: auto; }
.seed-panel { display: grid; gap: 12px; padding: 22px; }
.seed-panel h3 { margin: 0; font-size: 16px; }
.seed-panel p { margin: 0; font-size: 13px; line-height: 1.6; color: var(--muted); }
.seed-panel .codeblock { white-space: pre-wrap; }

.section { padding: 54px 0; }
.section.tight { padding: 34px 0 54px; }
.section-head { max-width: 46em; margin-bottom: 26px; }
.section-head h2 { margin: 0 0 10px; font-size: clamp(24px, 3vw, 32px); line-height: 1.1; letter-spacing: -0.022em; font-weight: 650; }
.section-head p { margin: 0; font-size: 14.5px; color: var(--muted); line-height: 1.6; }
.kicker { display: block; margin-bottom: 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }

.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
@media (max-width: 900px) { .steps { grid-template-columns: 1fr; } }
.step { min-width: 0; padding: 22px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); }
.steps > *, .chart-grid > *, .split-grid > * { min-width: 0; }
.step-num { display: grid; place-items: center; width: 26px; height: 26px; margin-bottom: 14px; border: 1px solid var(--border-2); border-radius: 8px; background: var(--panel-2); font-size: 12px; font-weight: 700; color: var(--accent); }
.step h3 { margin: 0 0 8px; font-size: 15px; letter-spacing: -0.01em; }
.step p { margin: 0 0 12px; font-size: 12.8px; line-height: 1.6; color: var(--muted); }
.step p:last-child { margin-bottom: 0; }
.codeblock { margin: 0; padding: 12px 14px; overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--code); font-size: 11.5px; line-height: 1.65; color: var(--text); white-space: pre; }
.codeblock .cm { color: var(--faint); }

.table-wrap { min-width: 0; max-width: 100%; overflow-x: auto; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); }
table.endpoints { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 620px; }
table.endpoints th { padding: 12px 16px; border-bottom: 1px solid var(--border); font-size: 10.5px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; text-align: left; color: var(--faint); }
table.endpoints td { padding: 12px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
table.endpoints tr:last-child td { border-bottom: none; }
table.endpoints tr:hover td { background: var(--panel-2); }
table.endpoints code { font-size: 12.5px; color: var(--text); }
table.endpoints .desc { color: var(--muted); font-size: 12.5px; }
.method { display: inline-block; min-width: 46px; padding: 3px 7px; border: 1px solid; border-radius: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-align: center; }
.method.get { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.method.post { color: var(--accent-2); border-color: color-mix(in srgb, var(--accent-2) 40%, transparent); background: color-mix(in srgb, var(--accent-2) 8%, transparent); }

.site-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; padding: 30px 0 46px; margin-top: 26px; border-top: 1px solid var(--border); font-size: 12px; color: var(--faint); }
.site-footer .links { display: flex; flex-wrap: wrap; gap: 16px; }
.site-footer a { color: var(--muted); text-decoration: none; }
.site-footer a:hover { color: var(--text); }

/* dashboard */
.dash-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 34px 0 8px; }
.dash-title { margin: 0; font-size: clamp(26px, 3.4vw, 38px); letter-spacing: -0.025em; line-height: 1.1; }
.dash-title .at { color: var(--faint); }
.dash-sub { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 10px; font-size: 13px; color: var(--muted); }
.dash-sub .sep { color: var(--faint); }
.dash-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.stat-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 24px 0 6px; }
@media (max-width: 900px) { .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .stat-grid { grid-template-columns: 1fr; } }
.stat { padding: 16px 18px; border: 1px solid var(--border); border-radius: 14px; background: var(--panel); }
.stat .label { margin-bottom: 10px; font-size: 10px; font-weight: 600; letter-spacing: 0.11em; text-transform: uppercase; color: var(--faint); }
.stat .value { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.stat .sub { margin-top: 6px; font-size: 11.5px; color: var(--muted); }
.chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
@media (max-width: 900px) { .chart-grid { grid-template-columns: 1fr; } }
.panel-card { padding: 16px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); overflow: hidden; }
.panel-card.wide { grid-column: span 2; }
@media (max-width: 900px) { .panel-card.wide { grid-column: span 1; } }
.panel-card h3 { margin: 0 0 4px; font-size: 13px; font-weight: 600; }
.panel-card .hint { margin: 0 0 12px; font-size: 11.5px; color: var(--faint); }
.panel-card svg { display: block; width: 100%; height: auto; }
.split-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
@media (max-width: 900px) { .split-grid { grid-template-columns: 1fr; } }
table.data { width: 100%; border-collapse: collapse; font-size: 12.5px; }
table.data th { padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 10px; font-weight: 600; letter-spacing: 0.09em; text-transform: uppercase; text-align: left; color: var(--faint); }
table.data td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
table.data tr:last-child td { border-bottom: none; }
table.data .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.data .model { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; }
table.data .model .swatch { flex: none; width: 8px; height: 8px; border-radius: 2px; }
table.data .model code { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.share-bar { height: 6px; min-width: 70px; border-radius: 3px; background: var(--panel-2); overflow: hidden; }
.share-bar span { display: block; height: 100%; border-radius: 3px; }
.empty-row { padding: 22px 10px; font-size: 12.5px; color: var(--faint); }
.footnote { margin: 10px 0 0; font-size: 11px; color: var(--faint); }

.embed-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
@media (max-width: 860px) { .embed-grid { grid-template-columns: 1fr; } }
.embed-item { padding: 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--panel); min-width: 0; }
.embed-item .embed-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.embed-item .embed-head span { font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); }
.embed-preview { display: flex; align-items: center; min-height: 24px; margin-bottom: 12px; overflow-x: auto; min-width: 0; }
.embed-preview svg { display: block; width: auto; height: 20px; max-width: none; }
.embed-preview.wide { overflow: hidden; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-2); }
.embed-preview.wide svg { display: block; width: 100%; height: auto; max-width: 100%; }
.snippet { display: flex; align-items: stretch; gap: 8px; min-width: 0; }
.snippet pre { flex: 1; min-width: 0; margin: 0; padding: 9px 11px; overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--code); font-size: 11px; line-height: 1.55; color: var(--muted); white-space: pre; }
.copy { flex: none; padding: 0 12px; border: 1px solid var(--border-2); border-radius: 8px; background: var(--panel-2); color: var(--text); font-size: 11px; font-weight: 600; cursor: pointer; transition: color 0.15s ease, border-color 0.15s ease; }
.copy:hover { color: var(--accent); border-color: var(--accent); }
.copy.copied { color: var(--green); border-color: var(--green); }
.markdown-block { min-width: 0; margin-top: 16px; padding: 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--panel); }
.markdown-block .snippet pre { max-height: 340px; overflow: auto; font-size: 11.5px; line-height: 1.7; }
.sync-steps { display: grid; gap: 14px; min-width: 0; }
.sync-steps > *, .sync-step { min-width: 0; }
.sync-step { padding: 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--panel); }
.step .codeblock, .sync-step .codeblock { white-space: pre-wrap; overflow-wrap: anywhere; }
.sync-step h4 { margin: 0 0 6px; font-size: 13px; }
.sync-step p { margin: 0 0 10px; font-size: 12.5px; line-height: 1.6; color: var(--muted); }
.sync-step p:last-child { margin-bottom: 0; }
.callout { display: flex; gap: 10px; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--amber) 30%, var(--border)); border-radius: 10px; background: color-mix(in srgb, var(--amber) 6%, transparent); font-size: 12px; line-height: 1.55; color: var(--muted); }
.callout b { color: var(--text); font-weight: 600; }

.notfound { display: grid; place-items: center; min-height: 68vh; padding: 40px 0; }
.notfound-card { width: min(560px, 100%); padding: 34px; border: 1px solid var(--border); border-radius: 18px; background: var(--panel); text-align: center; box-shadow: var(--shadow); }
.notfound-card h1 { margin: 0 0 10px; font-size: 26px; letter-spacing: -0.02em; }
.notfound-card p { margin: 0 0 18px; font-size: 13.5px; line-height: 1.6; color: var(--muted); }
.notfound-card .codeblock { margin-bottom: 18px; text-align: left; }
`;

function documentShell(params: {
  title: string;
  description: string;
  theme: SvgTheme;
  body: string;
}): string {
  return (
    '<!doctype html>\n' +
    '<html lang="en" data-theme="' +
    params.theme +
    '">\n<head>\n' +
    '<meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    '<meta name="color-scheme" content="dark light" />\n' +
    `<title>${escapeHtml(params.title)}</title>\n` +
    `<meta name="description" content="${escapeHtml(params.description)}" />\n` +
    `<link rel="icon" href="${FAVICON}" />\n` +
    '<style>\n' +
    `html[data-theme='dark'], html[data-theme='auto'] {${DARK_VARS}}\n` +
    `html[data-theme='light'] {${LIGHT_VARS}}\n` +
    `@media (prefers-color-scheme: light) { html[data-theme='auto'] {${LIGHT_VARS}} }\n` +
    BASE_CSS +
    '\n</style>\n</head>\n<body>\n' +
    params.body +
    '\n<script>\n' +
    COPY_SCRIPT +
    '\n</script>\n</body>\n</html>\n'
  );
}

const COPY_SCRIPT = `
(function () {
  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    }
    fallbackCopy(text);
    return Promise.resolve();
  }
  var buttons = document.querySelectorAll('[data-copy]');
  for (var index = 0; index < buttons.length; index += 1) {
    (function (button) {
      button.addEventListener('click', function () {
        var target = document.getElementById(button.getAttribute('data-copy') || '');
        if (!target) return;
        copyText(target.textContent || '').then(function () {
          var previous = button.textContent;
          button.textContent = 'Copied';
          button.classList.add('copied');
          window.setTimeout(function () {
            button.textContent = previous;
            button.classList.remove('copied');
          }, 1500);
        });
      });
    })(buttons[index]);
  }
})();
`;

function siteHeader(params: { theme: SvgTheme; current: 'home' | 'dashboard'; dashboardUser?: string }): string {
  const themeLinks = (['dark', 'light', 'auto'] as const)
    .map(
      (theme) =>
        `<a href="${pageHref(theme, params)}"${theme === params.theme ? ' aria-current="true"' : ''}>${theme}</a>`,
    )
    .join('');
  return (
    '<header class="site-header container">' +
    `<a class="brand" href="/">${logoMark(26)}<span>Token Island</span><span class="beta">Cloud</span></a>` +
    '<div class="header-right">' +
    '<nav class="nav-links" aria-label="Primary">' +
    '<a href="/u/demo">Demo dashboard</a>' +
    '<a href="#setup">Setup</a>' +
    '<a href="#api">API</a>' +
    '<a href="/healthz">Health</a>' +
    '</nav>' +
    `<div class="theme-switch" role="group" aria-label="Theme">${themeLinks}</div>` +
    '</div></header>'
  );
}

function pageHref(theme: SvgTheme, params: { current: 'home' | 'dashboard'; dashboardUser?: string }): string {
  if (params.current === 'dashboard' && params.dashboardUser) {
    return `/u/${encodeURIComponent(params.dashboardUser)}?theme=${theme}`;
  }
  return `/?theme=${theme}`;
}

function siteFooter(theme: SvgTheme): string {
  return (
    '<footer class="site-footer container">' +
    `<div>Token Island · local-first token tracking for AI coding agents · <a href="/u/demo${themeQuery(theme)}">@demo</a></div>` +
    '<div class="links">' +
    '<a href="/healthz">/healthz</a>' +
    '<a href="/api/v1/u/demo">/api/v1/u/demo</a>' +
    '<a href="/u/demo/card.svg">card.svg</a>' +
    '</div></footer>'
  );
}

function codeBlock(code: string, extraClass = ''): string {
  return `<pre class="codeblock${extraClass ? ` ${extraClass}` : ''}"><code>${escapeHtml(code)}</code></pre>`;
}

function snippetBlock(id: string, text: string): string {
  return (
    `<div class="snippet"><pre><code id="${escapeHtml(id)}">${escapeHtml(text)}</code></pre>` +
    `<button type="button" class="copy" data-copy="${escapeHtml(id)}">Copy</button></div>`
  );
}

function badgePreview(metric: BadgeMetric, theme: SvgTheme, stats: UserStats, idPrefix: string): string {
  return renderBadge(stats, { metric, theme, idPrefix });
}

// ---------------------------------------------------------------------------
// Landing page
// ---------------------------------------------------------------------------

export interface LandingPageOptions {
  theme: SvgTheme;
  demo: UserStats | null;
  baseUrl: string;
}

export function renderLandingPage(options: LandingPageOptions): string {
  const { theme, demo, baseUrl } = options;
  const demoLink = demo ? `/u/${encodeURIComponent(demo.username)}${themeQuery(theme)}` : '#setup';

  const stage = demo
    ? '<div class="stage-panel">' +
      '<div class="stage-top"><span class="live"><span class="dot"></span>Live from @' +
      escapeHtml(demo.username) +
      '</span><a href="' +
      demoLink +
      '" style="color:var(--muted);text-decoration:none">open dashboard →</a></div>' +
      `<div class="card-slot">${renderCard(demo, { theme, width: 495, idPrefix: 'landing-card' })}</div>` +
      '<div class="badge-row">' +
      `<div class="svg-inline">${badgePreview('tokens', theme, demo, 'landing-badge-tokens')}</div>` +
      `<div class="svg-inline">${badgePreview('cost', theme, demo, 'landing-badge-cost')}</div>` +
      `<div class="svg-inline">${badgePreview('streak', theme, demo, 'landing-badge-streak')}</div>` +
      `<div class="svg-inline">${badgePreview('model', theme, demo, 'landing-badge-model')}</div>` +
      '</div>' +
      `<div class="chart-slot">${renderChart(chartSeries(demo, 30, {}), {
        type: 'line',
        theme,
        width: 760,
        height: 210,
        idPrefix: 'landing-chart',
      })}</div>` +
      '</div>'
    : '<div class="stage-panel seed-panel">' +
      '<div class="stage-top"><span>Demo data missing</span><span style="color:var(--amber)">seed required</span></div>' +
      '<h3>Seed the demo profile to bring this page to life</h3>' +
      '<p>The landing page renders live badges and charts for the seeded <code>@demo</code> user. Run the seed script once and refresh:</p>' +
      codeBlock('pnpm --filter @token-island/cloud seed\n# prints the demo API key and example URLs') +
      '<p>The seed is idempotent and safe to re-run. This server is still fully usable without demo data — register a profile and sync from the collector.</p>' +
      '</div>';

  const badgesMarkdownSample = demo
    ? `[![tokens](${baseUrl}/u/${demo.username}/badge.svg?metric=tokens&theme=dark)](${baseUrl}/u/${demo.username})\n` +
      `[![cost](${baseUrl}/u/${demo.username}/badge.svg?metric=cost&theme=dark)](${baseUrl}/u/${demo.username})\n` +
      `[![streak](${baseUrl}/u/${demo.username}/badge.svg?metric=streak&theme=dark)](${baseUrl}/u/${demo.username})`
    : `[![tokens](${baseUrl}/u/your-name/badge.svg?metric=tokens&theme=dark)](${baseUrl}/u/your-name)\n` +
      `[![cost](${baseUrl}/u/your-name/badge.svg?metric=cost&theme=dark)](${baseUrl}/u/your-name)\n` +
      `[![streak](${baseUrl}/u/your-name/badge.svg?metric=streak&theme=dark)](${baseUrl}/u/your-name)`;

  const registerSnippet =
    `curl -s -X POST ${baseUrl}/api/v1/register \\\n` +
    `  -H 'content-type: application/json' \\\n` +
    `  -d '{"username":"you","displayName":"You"}'`;

  const configSnippet =
    `{\n  "cloud": {\n    "enabled": true,\n    "url": "${baseUrl}",\n    "username": "you",\n    "apiKey": "ti_…",\n    "autoSync": true,\n    "intervalMinutes": 15\n  }\n}`;

  const body =
    siteHeader({ theme, current: 'home' }) +
    '<main class="container">' +
    '<section class="hero">' +
    '<div class="hero-copy">' +
    '<span class="eyebrow"><span class="dot"></span>Local-first · zero dependencies</span>' +
    '<h1 class="hero-title">Your agent<br />token usage,<br /><span class="grad-text">at a glance.</span></h1>' +
    '<p class="lede">Token Island turns daily aggregates from Claude Code, OpenAI Codex, OpenCode and DeepSeek Harness into GitHub-ready badges, charts and profile cards — from a single dependency-free Node service.</p>' +
    '<div class="cta-row">' +
    `<a class="btn btn-primary" href="${demoLink}">View the live dashboard →</a>` +
    '<a class="btn btn-ghost" href="#setup">Set it up in 3 steps</a>' +
    '</div>' +
    '<div class="mini-stats">' +
    '<span><b>0</b> runtime dependencies</span>' +
    '<span><b>1</b> SQLite file</span>' +
    '<span><b>7</b> badge metrics</span>' +
    '<span><b>4</b> chart types</span>' +
    '</div>' +
    '</div>' +
    `<div class="stage">${stage}</div>` +
    '</section>' +

    '<section class="section" id="setup">' +
    '<div class="section-head"><span class="kicker">Setup</span><h2>Three steps to a live README badge</h2>' +
    '<p>The collector does the parsing, the cloud only ever sees daily aggregate numbers — never prompts, paths or secrets.</p></div>' +
    '<div class="steps">' +
    '<div class="step"><div class="step-num">1</div><h3>Register your profile</h3>' +
    '<p>One API call creates your username. The API key is returned exactly once — only its hash is stored.</p>' +
    codeBlock(registerSnippet) +
    '</div>' +
    '<div class="step"><div class="step-num">2</div><h3>Sync from the collector</h3>' +
    '<p>Point the collector at this service, then let it push daily rollups every 15 minutes.</p>' +
    codeBlock(configSnippet) +
    '</div>' +
    '<div class="step"><div class="step-num">3</div><h3>Embed in your README</h3>' +
    '<p>Drop the badges next to your project name. Charts and profile cards work the same way.</p>' +
    codeBlock(badgesMarkdownSample) +
    '</div>' +
    '</div></section>' +

    '<section class="section tight" id="api">' +
    '<div class="section-head"><span class="kicker">API</span><h2>Small, boring, cache-friendly</h2>' +
    '<p>Everything is plain HTTP + JSON. SVG responses are cached for five minutes, so README traffic never touches SQLite.</p></div>' +
    '<div class="table-wrap"><table class="endpoints"><thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead><tbody>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/healthz</code></td><td class="desc">Service health: users, stored day rows, uptime.</td></tr>' +
    '<tr><td><span class="method post">POST</span></td><td><code>/api/v1/register</code></td><td class="desc">Create a profile. Returns the API key once.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/api/v1/me</code></td><td class="desc">Bearer-authenticated totals for the calling profile.</td></tr>' +
    '<tr><td><span class="method post">POST</span></td><td><code>/api/v1/ingest</code></td><td class="desc">Upload up to 400 daily aggregates (latest-wins upsert).</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/api/v1/u/:user</code></td><td class="desc">Public stats JSON used by the dashboard.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/u/:user/badge.svg</code></td><td class="desc">README badge: tokens, cost, streak, messages, day, model, status.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/u/:user/chart.svg</code></td><td class="desc">Line, bar, heatmap or models chart with theme and size options.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/u/:user/card.svg</code></td><td class="desc">Profile card with totals, streak and a 30-day sparkline.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/u/:user</code></td><td class="desc">Public dashboard with embed snippets and sync instructions.</td></tr>' +
    '</tbody></table></div>' +
    '</section>' +
    '</main>' +
    siteFooter(theme);

  return documentShell({
    title: 'Token Island — your agent token usage, at a glance',
    description:
      'Local-first token usage tracker for AI coding agents: dependency-free cloud service with GitHub README badges, charts, profile cards and a public dashboard.',
    theme,
    body,
  });
}

// ---------------------------------------------------------------------------
// Dashboard page
// ---------------------------------------------------------------------------

export interface DashboardPageOptions {
  stats: UserStats;
  theme: SvgTheme;
  baseUrl: string;
  now?: number;
  timezone?: string;
}

function statCard(label: string, value: string, sub: string): string {
  return (
    '<div class="stat">' +
    `<div class="label">${escapeHtml(label)}</div>` +
    `<div class="value">${escapeHtml(value)}</div>` +
    `<div class="sub">${escapeHtml(sub)}</div>` +
    '</div>'
  );
}

function modelsTable(stats: UserStats): string {
  if (stats.models.length === 0) {
    return '<div class="empty-row">No model data synced yet.</div>';
  }
  const rows = stats.models
    .slice(0, 8)
    .map(
      (row) =>
        '<tr>' +
        '<td><span class="model"><span class="swatch" style="background:' +
        escapeHtml(row.color) +
        '"></span><code>' +
        escapeHtml(row.model) +
        '</code></span></td>' +
        `<td class="num">${escapeHtml(formatTokens(row.totalTokens))}</td>` +
        `<td class="num">${escapeHtml(formatPercent(row.share))}</td>` +
        '<td><div class="share-bar"><span style="width:' +
        (row.share * 100).toFixed(1) +
        '%;background:' +
        escapeHtml(row.color) +
        '"></span></div></td>' +
        '</tr>',
    )
    .join('');
  return (
    '<table class="data"><thead><tr><th>Model</th><th class="num">Tokens</th><th class="num">Share</th><th></th></tr></thead>' +
    `<tbody>${rows}</tbody></table>`
  );
}

function sourcesTable(stats: UserStats): string {
  if (stats.sources.length === 0) {
    return '<div class="empty-row">No agent data synced yet.</div>';
  }
  const rows = stats.sources
    .map(
      (row) =>
        '<tr>' +
        '<td><span class="model"><span class="swatch" style="background:' +
        escapeHtml(row.color) +
        '"></span>' +
        escapeHtml(row.label) +
        `</span></td><td class="num">${escapeHtml(formatTokens(row.totalTokens))}</td>` +
        `<td class="num">${escapeHtml(formatPercent(row.share))}</td>` +
        '</tr>',
    )
    .join('');
  return (
    '<table class="data"><thead><tr><th>Agent</th><th class="num">Tokens</th><th class="num">Share</th></tr></thead>' +
    `<tbody>${rows}</tbody></table>`
  );
}

function embedSection(stats: UserStats, theme: SvgTheme, baseUrl: string): string {
  const user = encodeURIComponent(stats.username);
  const base = `${baseUrl}/u/${user}`;
  const metrics: Array<{ metric: BadgeMetric; label: string }> = [
    { metric: 'tokens', label: 'Tokens' },
    { metric: 'cost', label: 'Cost' },
    { metric: 'streak', label: 'Streak' },
    { metric: 'messages', label: 'Agent turns' },
    { metric: 'day', label: 'Today' },
    { metric: 'model', label: 'Top model' },
    { metric: 'status', label: 'Status' },
  ];

  const badgeItems = metrics
    .map((entry) => {
      const snippet = `<img alt="token island ${entry.metric}" src="${base}/badge.svg?metric=${entry.metric}&theme=dark" height="20" />`;
      return (
        '<div class="embed-item"><div class="embed-head"><span>' +
        escapeHtml(entry.label) +
        ' badge</span></div>' +
        `<div class="embed-preview">${renderBadge(stats, {
          metric: entry.metric,
          theme,
          idPrefix: `dash-badge-${entry.metric}`,
        })}</div>` +
        snippetBlock(`snippet-badge-${entry.metric}`, snippet) +
        '</div>'
      );
    })
    .join('');

  const chartSnippet = `<img alt="token island activity chart" src="${base}/chart.svg?type=line&days=30&theme=dark" width="760" height="220" />`;
  const cardSnippet = `<img alt="token island profile card" src="${base}/card.svg?theme=dark" width="495" height="210" />`;
  const markdown =
    `[![tokens](${base}/badge.svg?metric=tokens&theme=dark)](${base})\n` +
    `[![cost](${base}/badge.svg?metric=cost&theme=dark)](${base})\n` +
    `[![streak](${base}/badge.svg?metric=streak&theme=dark)](${base})\n` +
    '\n' +
    `[![Token Island activity](${base}/chart.svg?type=heatmap&days=365&theme=dark)](${base})\n` +
    `[![Token Island card](${base}/card.svg?theme=dark)](${base})`;

  return (
    '<section class="section" id="embed" style="padding-bottom:16px">' +
    '<div class="section-head"><span class="kicker">Embed</span><h2>Embed in your README</h2>' +
    '<p>Copy a snippet, paste it into any GitHub README or Markdown file. All assets are cached SVGs with no external scripts or fonts.</p></div>' +
    `<div class="embed-grid">${badgeItems}</div>` +
    '<div class="split-grid">' +
    '<div class="embed-item"><div class="embed-head"><span>Activity chart</span></div>' +
    `<div class="embed-preview wide">${renderChart(chartSeries(stats, 30, {}), {
      type: 'line',
      theme,
      width: 760,
      height: 220,
      idPrefix: 'dash-embed-line',
    })}</div>` +
    snippetBlock('snippet-chart', chartSnippet) +
    '</div>' +
    '<div class="embed-item"><div class="embed-head"><span>Profile card</span></div>' +
    `<div class="embed-preview wide">${renderCard(stats, {
      theme,
      width: 495,
      idPrefix: 'dash-embed-card',
    })}</div>` +
    snippetBlock('snippet-card', cardSnippet) +
    '</div>' +
    '</div>' +
    '<div class="markdown-block"><div class="embed-head" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px"><span style="font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)">Markdown block — badges, chart and card</span></div>' +
    snippetBlock('snippet-markdown', markdown) +
    '</div></section>'
  );
}

function syncSection(stats: UserStats, baseUrl: string, now: number): string {
  const lastSync = stats.lastSyncAt ? `${dateTimeLabel(stats.lastSyncAt)} (${relativeTime(stats.lastSyncAt, now)})` : 'never';
  return (
    '<section class="section" id="sync" style="padding-top:16px">' +
    '<div class="section-head"><span class="kicker">Sync</span><h2>Keep it fresh</h2>' +
    `<p>Last sync: <b>${escapeHtml(lastSync)}</b>. The collector pushes daily aggregates; re-ingesting the same day is an idempotent latest-wins upsert.</p></div>` +
    '<div class="sync-steps">' +
    '<div class="sync-step"><h4>1 · Authorize</h4>' +
    '<p>Send your API key as a bearer token. It is only shown once at registration.</p>' +
    codeBlock('Authorization: Bearer ti_…') +
    '</div>' +
    '<div class="sync-step"><h4>2 · Push daily rollups</h4>' +
    `<p>POST up to 400 days of aggregates to the ingest endpoint. Body limit 400 KB.</p>` +
    codeBlock(`curl -s -X POST ${baseUrl}/api/v1/ingest \\\n  -H 'Authorization: Bearer ti_…' \\\n  -H 'content-type: application/json' \\\n  -d '{"client":"collector","days":[{"date":"2026-11-23","inputTokens":829403,"outputTokens":104135,"cacheReadTokens":1273336,"cacheWriteTokens":70038,"reasoningTokens":29423,"totalTokens":2276912,"unpricedTokens":0,"costUsd":6.108177,"messages":58}]}'`) +
    '</div>' +
    '<div class="sync-step"><h4>3 · Or let the collector do it</h4>' +
    '<p>With <code>cloud.enabled</code> in <code>~/.token-island/config.json</code> the collector syncs automatically every 15 minutes. A manual push is one command:</p>' +
    codeBlock('tokenisland sync\n# or: pnpm --filter @token-island/collector exec tsx src/index.ts sync') +
    '</div>' +
    `<p class="footnote">Total days stored: ${stats.totalDays} · active days: ${stats.activeDays}${stats.firstDate ? ` · since ${escapeHtml(longDate(stats.firstDate))}` : ''}</p>` +
    '</div></section>'
  );
}

export function renderDashboardPage(options: DashboardPageOptions): string {
  const { stats, theme, baseUrl } = options;
  const now = options.now ?? Date.now();
  const user = encodeURIComponent(stats.username);
  const totals = stats.totals;
  const last30 = windowTotals(stats, 30, { now, timezone: options.timezone });
  const last90 = windowTotals(stats, 90, { now, timezone: options.timezone });
  const modelsWindow = windowModels(stats, 90, { now, timezone: options.timezone });
  const lastSync = stats.lastSyncAt ? relativeTime(stats.lastSyncAt, now) : 'never synced';
  const themeLinks = (['dark', 'light', 'auto'] as const)
    .map(
      (value) =>
        `<a href="/u/${user}?theme=${value}"${value === theme ? ' aria-current="true"' : ''}>${value}</a>`,
    )
    .join('');

  const body =
    siteHeader({ theme, current: 'dashboard', dashboardUser: stats.username }) +
    '<main class="container">' +
    '<section class="dash-head">' +
    '<div>' +
    `<h1 class="dash-title"><span class="at">@</span>${escapeHtml(stats.username)}</h1>` +
    '<div class="dash-sub">' +
    `<span>${escapeHtml(stats.displayName)}</span><span class="sep">·</span>` +
    `<span>Public dashboard</span><span class="sep">·</span>` +
    `<span>synced ${escapeHtml(lastSync)}</span><span class="sep">·</span>` +
    `<span>${stats.totalDays} active ${stats.totalDays === 1 ? 'day' : 'days'}${stats.firstDate ? ` since ${escapeHtml(shortDate(stats.firstDate))}` : ''}</span>` +
    '</div></div>' +
    '<div class="dash-actions">' +
    '<a class="btn btn-ghost" href="#embed">Embed badges</a>' +
    `<a class="btn btn-ghost" href="/api/v1/u/${user}">Public JSON</a>` +
    `<div class="theme-switch" role="group" aria-label="Theme">${themeLinks}</div>` +
    '</div>' +
    '</section>' +

    '<section class="stat-grid">' +
    statCard('Total tokens', formatTokens(totals.totalTokens), `${formatTokensFull(totals.totalTokens)} in ${stats.activeDays} active days`) +
    statCard('Est. spend', formatCost(totals.costUsd, { approx: true }), totals.unpricedTokens > 0 ? `${formatTokens(totals.unpricedTokens)} tokens unpriced` : 'estimated from public list prices') +
    statCard('Current streak', `${stats.streak.current}d`, `longest ${stats.streak.longest}d · last active ${stats.streak.lastActiveDate ? shortDate(stats.streak.lastActiveDate) : '—'}`) +
    statCard(
      'Messages',
      formatTokens(totals.messages),
      `~${formatTokens(totals.messages > 0 ? totals.totalTokens / totals.messages : 0)} tokens / turn`,
    ) +
    '</section>' +

    '<section class="chart-grid">' +
    '<div class="panel-card wide"><h3>Tokens per day</h3><p class="hint">Last 30 days · ' +
    `${escapeHtml(formatTokens(last30.totalTokens))} tokens · ${escapeHtml(formatCost(last30.costUsd, { approx: true }))}</p>` +
    renderChart(chartSeries(stats, 30, { now, timezone: options.timezone }), {
      type: 'line',
      theme,
      width: 1000,
      height: 250,
      idPrefix: 'dash-line',
      header: false,
    }) +
    '</div>' +
    '<div class="panel-card"><h3>Daily activity</h3><p class="hint">Last 90 days</p>' +
    renderChart(
      { daily: dailyWindow(stats, 90, { now, timezone: options.timezone }), models: modelsWindow, totalTokens: last90.totalTokens, totalCost: last90.costUsd },
      { type: 'bar', theme, width: 560, height: 230, idPrefix: 'dash-bar', header: false },
    ) +
    '</div>' +
    '<div class="panel-card"><h3>Top models</h3><p class="hint">Last 90 days · by tokens</p>' +
    renderChart(
      { daily: [], models: modelsWindow, totalTokens: last90.totalTokens, totalCost: last90.costUsd },
      { type: 'models', theme, width: 560, height: 230, idPrefix: 'dash-models', header: false },
    ) +
    '</div>' +
    '<div class="panel-card wide"><h3>Token calendar</h3><p class="hint">Last 52 weeks · intensity = daily tokens</p>' +
    renderChart(chartSeries(stats, 365, { now, timezone: options.timezone }), {
      type: 'heatmap',
      theme,
      width: 1000,
      height: 170,
      idPrefix: 'dash-heat',
      header: false,
    }) +
    '</div>' +
    '</section>' +

    '<section class="split-grid">' +
    '<div class="panel-card"><h3>Models</h3><p class="hint">All time · share of total tokens</p>' +
    modelsTable(stats) +
    '</div>' +
    '<div class="panel-card"><h3>Agents</h3><p class="hint">All time · inferred from model families</p>' +
    sourcesTable(stats) +
    '<p class="footnote">Daily aggregates only carry per-model token counts, so agent families are inferred from model ids.</p>' +
    '</div>' +
    '</section>' +

    embedSection(stats, theme, baseUrl) +
    syncSection(stats, baseUrl, now) +
    '</main>' +
    siteFooter(theme);

  return documentShell({
    title: `@${stats.username} · Token Island dashboard`,
    description: `Token Island public dashboard for @${stats.username}: token totals, streaks, models and embeddable README badges.`,
    theme,
    body,
  });
}

// ---------------------------------------------------------------------------
// 404 page
// ---------------------------------------------------------------------------

export function renderNotFoundPage(theme: SvgTheme, username: string): string {
  const body =
    siteHeader({ theme, current: 'home' }) +
    '<main class="container"><section class="notfound"><div class="notfound-card">' +
    '<h1>Profile not found</h1>' +
    `<p>There is no Token Island profile for <code>@${escapeHtml(username)}</code> yet. ` +
    'Register a username and sync daily aggregates from the collector — the public dashboard will appear automatically.</p>' +
    codeBlock(
      `curl -s -X POST http://127.0.0.1:47117/api/v1/register \\\n  -H 'content-type: application/json' \\\n  -d '{"username":"${username}"}'`,
    ) +
    '<div class="cta-row" style="justify-content:center">' +
    '<a class="btn btn-primary" href="/">Back to home</a>' +
    `<a class="btn btn-ghost" href="/u/demo${themeQuery(theme)}">View the demo profile</a>` +
    '</div></div></section></main>' +
    siteFooter(theme);
  return documentShell({
    title: 'Profile not found · Token Island',
    description: 'This Token Island profile does not exist.',
    theme,
    body,
  });
}
