/**
 * Server-rendered pixel HTML: landing page, public dashboard and 404 page.
 *
 * No frameworks, no bundler, no external resources: inline CSS/JS, the real
 * Silkscreen + VT323 fonts served from `/fonts/*`, and inline SVGs built by the
 * very same pixel renderers that serve the README assets.  Every piece of
 * user-controlled text goes through `escapeHtml`.
 */

import { formatCost, formatPercent, formatTokens, formatTokensFull } from '@token-island/core';
import {
  chartSeries,
  dailyWindow,
  windowModels,
  windowTotals,
  type UserStats,
} from '../stats.js';
import { renderBadge, type BadgeMetric } from './badge.js';
import { renderCard } from './card.js';
import { renderChart } from './chart.js';
import {
  dateTimeLabel,
  longDate,
  parseSvgTheme,
  relativeTime,
  shortDate,
  type SvgTheme,
} from './tokens.js';

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

/** 32x32 pixel island mark: flat fills, 2px frame, staircase corners. */
function logoMark(size = 32): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 32 32" role="img" aria-label="Token Island logo" ` +
    `xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">` +
    `<path d="M2 0h28v2h2v28h-2v2H2v-2H0V2h2z" fill="#57507a"/>` +
    `<path d="M3 2h26v1h2v26h-1v2H5v-1H2V5h1z" fill="#0b0b12"/>` +
    `<path d="M9 6h4v4H9z" fill="#ffc857"/>` +
    `<path d="M6 18h20v2H6zM4 20h24v2H4zM7 22h18v2H7zM10 24h12v2H10z" fill="#3be8b0"/>` +
    `<path d="M7 18h6v2H7z" fill="#8fffe0"/>` +
    `<path d="M24 11h2v2h-2zM22 13h2v2h-2z" fill="#b388ff"/>` +
    `</svg>`
  );
}

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%230b0b12'/%3E%3Crect x='6' y='18' width='20' height='2' fill='%233be8b0'/%3E%3Crect x='4' y='20' width='24' height='2' fill='%233be8b0'/%3E%3Crect x='9' y='6' width='4' height='4' fill='%23ffc857'/%3E%3C/svg%3E";

const FONT_FACES = `
@font-face { font-family: 'Silkscreen'; src: url('/fonts/Silkscreen-Regular.ttf') format('truetype'); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: 'Silkscreen'; src: url('/fonts/Silkscreen-Bold.ttf') format('truetype'); font-weight: 700; font-style: normal; font-display: swap; }
@font-face { font-family: 'VT323'; src: url('/fonts/VT323-Regular.ttf') format('truetype'); font-weight: 400; font-style: normal; font-display: swap; }
`;

const DARK_VARS = `
  color-scheme: dark;
  --bg: #0b0b12;
  --checker: #10101b;
  --surface: #14121d;
  --surface-alt: #1b1928;
  --inset: #090910;
  --border: #332d4a;
  --border-hi: #57507a;
  --ink: #f4f2ff;
  --ink-dim: #a39fc4;
  --ink-faint: #6b6689;
  --teal: #3be8b0;
  --blue: #5b9dff;
  --purple: #b388ff;
  --amber: #ffc857;
  --red: #ff6b6b;
  --green: #7dff9b;
  --shadow: #05050c;
  --code: #090910;
  --accent-ink: #0b0b12;
`;

const LIGHT_VARS = `
  color-scheme: light;
  --bg: #f4f2ff;
  --checker: #ece9f8;
  --surface: #ffffff;
  --surface-alt: #f0edfb;
  --inset: #e5e1f2;
  --border: #c9c3dc;
  --border-hi: #b9b3d0;
  --ink: #1b1928;
  --ink-dim: #4b4560;
  --ink-faint: #6f6a86;
  --teal: #0b7a61;
  --blue: #2f64d6;
  --purple: #6c40c8;
  --amber: #8a5f00;
  --red: #c23b3b;
  --green: #17864a;
  --shadow: #c9c3dc;
  --code: #f0edfb;
  --accent-ink: #f4f2ff;
`;

const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: 'VT323', ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 20px;
  line-height: 1.45;
  color: var(--ink);
  background-color: var(--bg);
  background-image:
    linear-gradient(45deg, var(--checker) 25%, transparent 25%, transparent 75%, var(--checker) 75%),
    linear-gradient(45deg, var(--checker) 25%, transparent 25%, transparent 75%, var(--checker) 75%);
  background-size: 8px 8px;
  background-position: 0 0, 4px 4px;
  image-rendering: pixelated;
  -webkit-font-smoothing: none;
}
a { color: inherit; }
img, svg { max-width: 100%; }
h1, h2, h3, h4, .label, .btn, .theme-switch a, .badge-name, .kicker, .site-header, .step-num { font-family: 'Silkscreen', ui-monospace, monospace; font-weight: 400; }
code, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.container { width: 100%; max-width: 1120px; margin: 0 auto; padding: 0 24px; }

/* pixel panels: 2px border + hard offset shadow + zero radius, always */
.panel { background: var(--surface); border: 2px solid var(--border); box-shadow: 4px 4px 0 var(--shadow); border-radius: 0; }
.panel-hi { border-color: var(--border-hi); }
.scanlines { height: 8px; margin: 22px 0; background: repeating-linear-gradient(0deg, var(--border) 0 2px, transparent 2px 8px); }

.site-header { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 20px 0; border-bottom: 2px solid var(--border); }
.brand { display: inline-flex; align-items: center; gap: 10px; text-decoration: none; font-size: 16px; letter-spacing: 0.06em; text-transform: uppercase; }
.brand span.beta { font-size: 11px; letter-spacing: 0.12em; color: var(--teal); border: 2px solid var(--border-hi); background: var(--surface-alt); padding: 2px 6px; }
.header-right { display: flex; align-items: center; gap: 16px; }
.nav-links { display: flex; align-items: center; gap: 16px; font-family: 'Silkscreen', monospace; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-dim); }
.nav-links a { text-decoration: none; }
.nav-links a:hover { color: var(--teal); }
.theme-switch { display: inline-flex; gap: 0; border: 2px solid var(--border-hi); background: var(--surface); box-shadow: 2px 2px 0 var(--shadow); }
.theme-switch a { padding: 4px 9px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; text-decoration: none; color: var(--ink-dim); border-right: 2px solid var(--border); }
.theme-switch a:last-child { border-right: 0; }
.theme-switch a[aria-current='true'] { background: var(--teal); color: var(--accent-ink); }
@media (max-width: 760px) { .nav-links { display: none; } }

.hero { display: grid; grid-template-columns: 1.04fr 0.96fr; align-items: center; gap: 48px; padding: 48px 0 40px; }
@media (max-width: 960px) { .hero { grid-template-columns: 1fr; gap: 32px; padding: 32px 0 24px; } }
.eyebrow { display: inline-block; margin-bottom: 20px; padding: 4px 8px; border: 2px solid var(--border-hi); background: var(--surface); font-family: 'Silkscreen', monospace; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--teal); box-shadow: 2px 2px 0 var(--shadow); }
h1.hero-title { margin: 0 0 20px; font-size: clamp(32px, 4.6vw, 48px); line-height: 1.16; letter-spacing: 0.01em; text-transform: uppercase; }
.hero-title .accent { color: var(--teal); }
.lede { max-width: 34em; margin: 0 0 24px; font-size: 21px; line-height: 1.4; color: var(--ink-dim); }
.cta-row { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border: 2px solid var(--border-hi); background: var(--surface-alt); color: var(--ink); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; text-decoration: none; box-shadow: 4px 4px 0 var(--shadow); cursor: pointer; }
.btn:hover { background: var(--surface); color: var(--teal); }
.btn:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0 var(--shadow); }
.btn-primary { background: var(--teal); border-color: var(--teal); color: var(--accent-ink); }
.btn-primary:hover { background: var(--mint, var(--teal)); color: var(--accent-ink); filter: none; }
.mini-stats { display: flex; flex-wrap: wrap; gap: 18px; font-family: 'Silkscreen', monospace; font-size: 12px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-dim); }
.mini-stats b { color: var(--teal); font-weight: 400; }

.stage-panel { padding: 16px; }
.stage-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; font-family: 'Silkscreen', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-dim); }
.stage-top .live { display: inline-flex; align-items: center; gap: 6px; color: var(--green); }
.stage-top .live .dot { width: 6px; height: 6px; background: currentColor; }
.card-slot svg { display: block; width: 100%; height: auto; image-rendering: pixelated; }
.badge-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.badge-row .svg-inline { display: flex; }
.badge-row svg { display: block; height: 24px; width: auto; image-rendering: pixelated; }
.chart-slot { margin-top: 14px; overflow: hidden; border: 2px solid var(--border); background: var(--bg); }
.chart-slot svg { display: block; width: 100%; height: auto; image-rendering: pixelated; }
.seed-panel { display: grid; gap: 12px; padding: 20px; }
.seed-panel h3 { margin: 0; font-size: 16px; text-transform: uppercase; }
.seed-panel p { margin: 0; font-size: 19px; line-height: 1.45; color: var(--ink-dim); }

.section { padding: 44px 0; }
.section.tight { padding: 24px 0 44px; }
.section-head { max-width: 48em; margin-bottom: 22px; }
.section-head h2 { margin: 0 0 10px; font-size: clamp(20px, 2.6vw, 32px); line-height: 1.2; text-transform: uppercase; }
.section-head p { margin: 0; font-size: 20px; color: var(--ink-dim); line-height: 1.4; }
.kicker { display: block; margin-bottom: 10px; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--teal); }
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
@media (max-width: 900px) { .steps { grid-template-columns: 1fr; } }
.step { min-width: 0; padding: 18px; }
.step-num { display: grid; place-items: center; width: 28px; height: 28px; margin-bottom: 12px; border: 2px solid var(--border-hi); background: var(--surface-alt); font-size: 16px; color: var(--teal); box-shadow: 2px 2px 0 var(--shadow); }
.step h3 { margin: 0 0 8px; font-size: 16px; text-transform: uppercase; }
.step p { margin: 0 0 12px; font-size: 19px; line-height: 1.4; color: var(--ink-dim); }
.step p:last-child { margin-bottom: 0; }
.codeblock { margin: 0; padding: 10px 12px; overflow-x: auto; overflow-wrap: anywhere; word-break: break-word; border: 2px solid var(--border); background: var(--code); font-size: 16px; line-height: 1.55; color: var(--ink); white-space: pre-wrap; }

.table-wrap { min-width: 0; max-width: 100%; overflow-x: auto; }
table.endpoints { width: 100%; border-collapse: collapse; font-size: 19px; min-width: 640px; }
table.endpoints thead th { padding: 10px 14px; border-bottom: 2px solid var(--border-hi); font-family: 'Silkscreen', monospace; font-size: 11px; font-weight: 400; letter-spacing: 0.1em; text-transform: uppercase; text-align: left; color: var(--ink-dim); }
table.endpoints td { padding: 10px 14px; border-bottom: 2px solid var(--border); vertical-align: middle; }
table.endpoints tr:last-child td { border-bottom: none; }
table.endpoints tr:hover td { background: var(--surface-alt); }
table.endpoints code { font-size: 17px; color: var(--ink); }
table.endpoints .desc { color: var(--ink-dim); font-size: 18px; }
.method { display: inline-block; min-width: 50px; padding: 2px 6px; border: 2px solid; font-family: 'Silkscreen', monospace; font-size: 11px; letter-spacing: 0.06em; text-align: center; }
.method.get { color: var(--teal); border-color: var(--teal); }
.method.post { color: var(--purple); border-color: var(--purple); }

.site-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; padding: 26px 0 40px; margin-top: 22px; border-top: 2px solid var(--border); font-size: 18px; color: var(--ink-dim); }
.site-footer .links { display: flex; flex-wrap: wrap; gap: 16px; }
.site-footer a { color: var(--ink-dim); text-decoration: none; }
.site-footer a:hover { color: var(--teal); }

/* dashboard */
.dash-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 30px 0 6px; }
.dash-title { margin: 0; font-size: clamp(24px, 3vw, 32px); line-height: 1.2; text-transform: uppercase; }
.dash-title .at { color: var(--ink-dim); }
.dash-sub { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 10px; font-size: 19px; color: var(--ink-dim); }
.dash-sub .sep { color: var(--ink-dim); }
.dash-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.stat-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 22px 0 4px; }
@media (max-width: 900px) { .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .stat-grid { grid-template-columns: 1fr; } }
.stat { padding: 14px 16px; }
.stat .label { margin-bottom: 8px; font-family: 'Silkscreen', monospace; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-dim); }
.stat .value { font-family: 'Silkscreen', monospace; font-size: 24px; line-height: 1.1; color: var(--ink); font-variant-numeric: tabular-nums; }
.stat .sub { margin-top: 8px; font-size: 19px; line-height: 1.35; color: var(--ink-dim); }
.chart-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
@media (max-width: 900px) { .chart-grid { grid-template-columns: 1fr; } }
.panel-card { min-width: 0; padding: 14px; overflow: hidden; }
.panel-card.wide { grid-column: span 2; }
@media (max-width: 900px) { .panel-card.wide { grid-column: span 1; } }
.panel-card h3 { margin: 0 0 4px; font-size: 16px; text-transform: uppercase; }
.panel-card .hint { margin: 0 0 10px; font-size: 20px; color: var(--ink-dim); }
.panel-card svg { display: block; width: 100%; height: auto; image-rendering: pixelated; }
.split-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 14px; }
@media (max-width: 900px) { .split-grid { grid-template-columns: 1fr; } }
table.data { width: 100%; border-collapse: collapse; font-size: 19px; }
table.data thead th { padding: 8px 9px; border-bottom: 2px solid var(--border-hi); font-family: 'Silkscreen', monospace; font-size: 11px; font-weight: 400; letter-spacing: 0.08em; text-transform: uppercase; text-align: left; color: var(--ink-dim); }
table.data td { padding: 8px 9px; border-bottom: 2px solid var(--border); vertical-align: middle; }
table.data tr:last-child td { border-bottom: none; }
table.data .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.data .model { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; }
table.data .model .swatch { flex: none; width: 8px; height: 8px; }
table.data .model code { font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.share-bar { height: 8px; min-width: 70px; background: var(--inset); border: 1px solid var(--border); }
.share-bar span { display: block; height: 100%; }
.empty-row { padding: 20px 8px; font-size: 19px; color: var(--ink-dim); }
.footnote { margin: 10px 0 0; font-size: 18px; color: var(--ink-dim); line-height: 1.4; }

.embed-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
@media (max-width: 860px) { .embed-grid { grid-template-columns: 1fr; } }
.embed-item { padding: 14px; min-width: 0; }
.embed-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.embed-head span { font-family: 'Silkscreen', monospace; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-dim); }
.embed-preview { display: flex; align-items: center; min-height: 26px; margin-bottom: 12px; overflow-x: auto; min-width: 0; background: var(--bg); border: 2px solid var(--border); padding: 8px; }
.embed-preview svg { display: block; width: auto; height: 24px; max-width: none; image-rendering: pixelated; }
.embed-preview.wide { overflow: hidden; display: block; }
.embed-preview.wide svg { display: block; width: 100%; height: auto; max-width: 100%; }
.snippet { display: flex; align-items: stretch; gap: 8px; min-width: 0; }
.snippet pre { flex: 1; min-width: 0; margin: 0; padding: 8px 10px; overflow-x: auto; overflow-wrap: anywhere; word-break: break-all; border: 2px solid var(--border); background: var(--code); font-size: 15px; line-height: 1.55; color: var(--ink-dim); white-space: pre-wrap; }
.copy { flex: none; padding: 0 10px; border: 2px solid var(--border-hi); background: var(--surface-alt); color: var(--ink); font-family: 'Silkscreen', monospace; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; box-shadow: 2px 2px 0 var(--shadow); }
.copy:hover { color: var(--teal); border-color: var(--teal); }
.copy:active { transform: translate(2px, 2px); box-shadow: none; }
.copy.copied { color: var(--green); border-color: var(--green); }
.markdown-block { min-width: 0; margin-top: 14px; padding: 14px; }
.markdown-block .embed-head span { color: var(--ink-dim); }
.markdown-block .snippet pre { max-height: 340px; overflow: auto; overflow-wrap: anywhere; word-break: break-all; font-size: 15px; line-height: 1.6; white-space: pre-wrap; }
.sync-steps { display: grid; gap: 14px; min-width: 0; }
.sync-step { padding: 14px; min-width: 0; }
.sync-step h4 { margin: 0 0 6px; font-size: 16px; text-transform: uppercase; }
.sync-step p { margin: 0 0 10px; font-size: 19px; line-height: 1.4; color: var(--ink-dim); }
.sync-step p:last-child { margin-bottom: 0; }
.callout { display: block; padding: 10px 12px; border: 2px solid var(--amber); background: var(--surface); font-size: 18px; line-height: 1.4; color: var(--ink-dim); }
.callout b { color: var(--ink); font-weight: 400; }

.notfound { display: grid; place-items: center; min-height: 64vh; padding: 40px 0; }
.notfound-card { width: min(560px, 100%); padding: 28px; text-align: center; }
.notfound-card h1 { margin: 0 0 10px; font-size: 24px; text-transform: uppercase; }
.notfound-card p { margin: 0 0 18px; font-size: 19px; line-height: 1.4; color: var(--ink-dim); }
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
    `<html lang="en" data-theme="${params.theme}">\n<head>\n` +
    '<meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    '<meta name="color-scheme" content="dark light" />\n' +
    `<title>${escapeHtml(params.title)}</title>\n` +
    `<meta name="description" content="${escapeHtml(params.description)}" />\n` +
    `<link rel="icon" href="${FAVICON}" />\n` +
    '<style>\n' +
    FONT_FACES +
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
          button.textContent = 'COPIED';
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
    `<a class="brand" href="/">${logoMark(28)}<span>Token Island</span><span class="beta">Cloud</span></a>` +
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
    ? '<div class="panel panel-hi stage-panel">' +
      '<div class="stage-top"><span class="live"><span class="dot"></span>Live from @' +
      escapeHtml(demo.username) +
      '</span><a href="' +
      demoLink +
      '" style="color:var(--ink-dim);text-decoration:none">open dashboard &gt;&gt;</a></div>' +
      `<div class="card-slot">${renderCard(demo, { theme, width: 520, idPrefix: 'landing-card' })}</div>` +
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
    : '<div class="panel panel-hi seed-panel">' +
      '<div class="stage-top"><span>Demo data missing</span><span style="color:var(--amber)">seed required</span></div>' +
      '<h3>Seed the demo profile to bring this page to life</h3>' +
      '<p>The landing page renders live pixel badges and charts for the seeded <code>@demo</code> user. Run the seed script once and refresh:</p>' +
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
    '<span class="eyebrow">Local-first · zero dependencies</span>' +
    '<h1 class="hero-title">Your agent<br />token usage,<br /><span class="accent">at a glance.</span></h1>' +
    '<p class="lede">Token Island turns daily aggregates from Claude Code, OpenAI Codex, OpenCode and DeepSeek Harness into GitHub-ready pixel badges, charts and profile cards — from a single dependency-free service that runs on Cloudflare Workers + D1 or Node.</p>' +
    '<div class="cta-row">' +
    `<a class="btn btn-primary" href="${demoLink}">View the live dashboard &gt;&gt;</a>` +
    '<a class="btn" href="#setup">Set it up in 3 steps</a>' +
    '</div>' +
    '<div class="mini-stats">' +
    '<span><b>0</b> runtime dependencies</span>' +
    '<span><b>1</b> D1 database / SQLite file</span>' +
    '<span><b>7</b> badge metrics</span>' +
    '<span><b>4</b> chart types</span>' +
    '</div>' +
    '</div>' +
    `<div class="stage">${stage}</div>` +
    '</section>' +
    '<div class="scanlines" role="presentation"></div>' +
    '<section class="section" id="setup">' +
    '<div class="section-head"><span class="kicker">Setup</span><h2>Three steps to a live README badge</h2>' +
    '<p>The collector does the parsing; the cloud only ever sees daily aggregate numbers — never prompts, paths or secrets.</p></div>' +
    '<div class="steps">' +
    '<div class="panel step"><div class="step-num">1</div><h3>Register your profile</h3>' +
    '<p>One API call creates your username. The API key is returned exactly once — only its hash is stored.</p>' +
    codeBlock(registerSnippet) +
    '</div>' +
    '<div class="panel step"><div class="step-num">2</div><h3>Sync from the collector</h3>' +
    '<p>Point the collector at this service, then let it push daily rollups every 15 minutes.</p>' +
    codeBlock(configSnippet) +
    '</div>' +
    '<div class="panel step"><div class="step-num">3</div><h3>Embed in your README</h3>' +
    '<p>Drop the pixel badges next to your project name. Charts and profile cards work the same way.</p>' +
    codeBlock(badgesMarkdownSample) +
    '</div>' +
    '</div></section>' +
    '<section class="section tight" id="api">' +
    '<div class="section-head"><span class="kicker">API</span><h2>Small, boring, cache-friendly</h2>' +
    '<p>Everything is plain HTTP + JSON. SVG responses are cached at the edge for five minutes, so README traffic never touches the database.</p></div>' +
    '<div class="panel table-wrap"><table class="endpoints"><thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead><tbody>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/healthz</code></td><td class="desc">Service health: users, stored day rows, uptime.</td></tr>' +
    '<tr><td><span class="method post">POST</span></td><td><code>/api/v1/register</code></td><td class="desc">Create a profile. Returns the API key once.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/api/v1/me</code></td><td class="desc">Bearer-authenticated totals for the calling profile.</td></tr>' +
    '<tr><td><span class="method post">POST</span></td><td><code>/api/v1/ingest</code></td><td class="desc">Upload up to 400 daily aggregates (latest-wins upsert).</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/api/v1/u/:user</code></td><td class="desc">Public stats JSON used by the dashboard.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/u/:user/badge.svg</code></td><td class="desc">Pixel badge: tokens, cost, streak, messages, day, model, status.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/u/:user/chart.svg</code></td><td class="desc">Line, bar, heatmap or models chart with theme and size options.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/u/:user/card.svg</code></td><td class="desc">Pixel profile card with totals, streak and a 30-day sparkline.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/u/:user</code></td><td class="desc">Public dashboard with embed snippets and sync instructions.</td></tr>' +
    '</tbody></table></div>' +
    '</section>' +
    '</main>' +
    siteFooter(theme);

  return documentShell({
    title: 'Token Island — your agent token usage, at a glance',
    description:
      'Local-first token usage tracker for AI coding agents: pixel GitHub README badges, charts, profile cards and a public dashboard on Cloudflare Workers + D1 or Node.',
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
    '<div class="panel stat">' +
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
      const snippet = `<img alt="token island ${entry.metric}" src="${base}/badge.svg?metric=${entry.metric}&theme=dark" height="24" />`;
      return (
        '<div class="panel embed-item"><div class="embed-head"><span>' +
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
  const cardSnippet = `<img alt="token island profile card" src="${base}/card.svg?theme=dark" width="520" height="240" />`;
  const markdown =
    `[![tokens](${base}/badge.svg?metric=tokens&theme=dark)](${base})\n` +
    `[![cost](${base}/badge.svg?metric=cost&theme=dark)](${base})\n` +
    `[![streak](${base}/badge.svg?metric=streak&theme=dark)](${base})\n` +
    '\n' +
    `[![Token Island activity](${base}/chart.svg?type=heatmap&days=365&theme=dark)](${base})\n` +
    `[![Token Island card](${base}/card.svg?theme=dark)](${base})`;

  return (
    '<section class="section" id="embed" style="padding-bottom:12px">' +
    '<div class="section-head"><span class="kicker">Embed</span><h2>Embed in your README</h2>' +
    '<p>Copy a snippet, paste it into any GitHub README or Markdown file. All assets are cached pixel SVGs with no external scripts or fonts.</p></div>' +
    `<div class="embed-grid">${badgeItems}</div>` +
    '<div class="split-grid">' +
    '<div class="panel embed-item"><div class="embed-head"><span>Activity chart</span></div>' +
    `<div class="embed-preview wide">${renderChart(chartSeries(stats, 30, {}), {
      type: 'line',
      theme,
      width: 760,
      height: 220,
      idPrefix: 'dash-embed-line',
    })}</div>` +
    snippetBlock('snippet-chart', chartSnippet) +
    '</div>' +
    '<div class="panel embed-item"><div class="embed-head"><span>Profile card</span></div>' +
    `<div class="embed-preview wide">${renderCard(stats, {
      theme,
      width: 520,
      idPrefix: 'dash-embed-card',
    })}</div>` +
    snippetBlock('snippet-card', cardSnippet) +
    '</div>' +
    '</div>' +
    '<div class="panel markdown-block"><div class="embed-head"><span>Markdown block — badges, chart and card</span></div>' +
    snippetBlock('snippet-markdown', markdown) +
    '</div></section>'
  );
}

function syncSection(stats: UserStats, baseUrl: string, now: number): string {
  const lastSync = stats.lastSyncAt
    ? `${dateTimeLabel(stats.lastSyncAt)} (${relativeTime(stats.lastSyncAt, now).toLowerCase()})`
    : 'never';
  return (
    '<section class="section" id="sync" style="padding-top:12px">' +
    '<div class="section-head"><span class="kicker">Sync</span><h2>Keep it fresh</h2>' +
    `<p>Last sync: <b>${escapeHtml(lastSync)}</b>. The collector pushes daily aggregates; re-ingesting the same day is an idempotent latest-wins upsert.</p></div>` +
    '<div class="sync-steps">' +
    '<div class="panel sync-step"><h4>1 · Authorize</h4>' +
    '<p>Send your API key as a bearer token. It is only shown once at registration.</p>' +
    codeBlock('Authorization: Bearer ti_…') +
    '</div>' +
    '<div class="panel sync-step"><h4>2 · Push daily rollups</h4>' +
    '<p>POST up to 400 days of aggregates to the ingest endpoint. Body limit 400 KB.</p>' +
    codeBlock(`curl -s -X POST ${baseUrl}/api/v1/ingest \\\n  -H 'Authorization: Bearer ti_…' \\\n  -H 'content-type: application/json' \\\n  -d '{"client":"collector","days":[{"date":"2026-11-23","inputTokens":829403,"outputTokens":104135,"cacheReadTokens":1273336,"cacheWriteTokens":70038,"reasoningTokens":29423,"totalTokens":2276912,"unpricedTokens":0,"costUsd":6.108177,"messages":58}]}'`) +
    '</div>' +
    '<div class="panel sync-step"><h4>3 · Or let the collector do it</h4>' +
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
  const lastSync = stats.lastSyncAt ? relativeTime(stats.lastSyncAt, now).toLowerCase() : 'never synced';
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
    '<a class="btn" href="#embed">Embed badges</a>' +
    `<a class="btn" href="/api/v1/u/${user}">Public JSON</a>` +
    `<div class="theme-switch" role="group" aria-label="Theme">${themeLinks}</div>` +
    '</div>' +
    '</section>' +

    '<section class="stat-grid">' +
    statCard(
      'Total tokens',
      formatTokens(totals.totalTokens),
      `${formatTokensFull(totals.totalTokens)} in ${stats.activeDays} active days`,
    ) +
    statCard(
      'Est. spend',
      formatCost(totals.costUsd, { approx: true }),
      totals.unpricedTokens > 0
        ? `${formatTokens(totals.unpricedTokens)} tokens unpriced`
        : 'estimated from public list prices',
    ) +
    statCard(
      'Current streak',
      `${stats.streak.current}d`,
      `longest ${stats.streak.longest}d · last active ${stats.streak.lastActiveDate ? shortDate(stats.streak.lastActiveDate) : '—'}`,
    ) +
    statCard(
      'Messages',
      formatTokens(totals.messages),
      `~${formatTokens(totals.messages > 0 ? totals.totalTokens / totals.messages : 0)} tokens / turn`,
    ) +
    '</section>' +

    '<section class="chart-grid">' +
    '<div class="panel panel-card wide"><h3>Tokens per day</h3><p class="hint">Last 30 days · ' +
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
    '<div class="panel panel-card"><h3>Daily activity</h3><p class="hint">Last 90 days</p>' +
    renderChart(
      {
        daily: dailyWindow(stats, 90, { now, timezone: options.timezone }),
        models: modelsWindow,
        totalTokens: last90.totalTokens,
        totalCost: last90.costUsd,
      },
      { type: 'bar', theme, width: 560, height: 230, idPrefix: 'dash-bar', header: false },
    ) +
    '</div>' +
    '<div class="panel panel-card"><h3>Top models</h3><p class="hint">Last 90 days · by tokens</p>' +
    renderChart(
      { daily: [], models: modelsWindow, totalTokens: last90.totalTokens, totalCost: last90.costUsd },
      { type: 'models', theme, width: 560, height: 230, idPrefix: 'dash-models', header: false },
    ) +
    '</div>' +
    '<div class="panel panel-card wide"><h3>Token calendar</h3><p class="hint">Last 52 weeks · intensity = daily tokens</p>' +
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
    '<div class="panel panel-card"><h3>Models</h3><p class="hint">All time · share of total tokens</p>' +
    modelsTable(stats) +
    '</div>' +
    '<div class="panel panel-card"><h3>Agents</h3><p class="hint">All time · inferred from model families</p>' +
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
    description: `Token Island public dashboard for @${stats.username}: pixel token totals, streaks, models and embeddable README badges.`,
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
    '<main class="container"><section class="notfound"><div class="panel panel-hi notfound-card">' +
    '<h1>Profile not found</h1>' +
    `<p>There is no Token Island profile for <code>@${escapeHtml(username)}</code> yet. ` +
    'Register a username and sync daily aggregates from the collector — the public dashboard will appear automatically.</p>' +
    codeBlock(
      `curl -s -X POST http://127.0.0.1:47117/api/v1/register \\\n  -H 'content-type: application/json' \\\n  -d '{"username":"${username}"}'`,
    ) +
    '<div class="cta-row" style="justify-content:center">' +
    '<a class="btn btn-primary" href="/">Back to home</a>' +
    `<a class="btn" href="/u/demo${themeQuery(theme)}">View the demo profile</a>` +
    '</div></div></section></main>' +
    siteFooter(theme);
  return documentShell({
    title: 'Profile not found · Token Island',
    description: 'This Token Island profile does not exist.',
    theme,
    body,
  });
}
