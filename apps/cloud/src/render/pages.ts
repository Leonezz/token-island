/**
 * Server-rendered Precision Telemetry HTML: landing page, public dashboard and 404 page.
 *
 * Zero frameworks, zero external CDNs: inline Vanilla CSS & JS, crisp native
 * system sans-serif + tabular monospace stacks, and inline vector SVGs rendered
 * by the exact same renderers that serve GitHub README assets. Every piece of
 * user-controlled text passes through `escapeHtml`.
 */

import {
  formatCost,
  formatPercent,
  formatTokens,
  formatTokensFull,
  TELEMETRY_DARK,
  TELEMETRY_FONT_MONO,
  TELEMETRY_FONT_SANS,
  TELEMETRY_LIGHT,
} from '@token-island/core';
import {
  chartSeries,
  windowModels,
  windowTotals,
  type ModelStat,
  type UserStats,
} from '../stats.js';
import { renderBadge, type BadgeMetric } from './badge.js';
import { renderCard } from './card.js';
import { renderChart } from './chart.js';
import { CLOUD_VERSION } from '../version.js';
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

/** Crisp 28x28 rounded Precision Telemetry logo mark. */
function logoMark(size = 28): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 28 28" role="img" aria-label="Token Island logo" xmlns="http://www.w3.org/2000/svg">` +
    `<rect x="0.5" y="0.5" width="27" height="27" rx="7" fill="${TELEMETRY_DARK.surface}" stroke="${TELEMETRY_DARK.borderHi}"/>` +
    `<rect x="6" y="15" width="3.5" height="6" rx="1" fill="${TELEMETRY_DARK.blue}"/>` +
    `<rect x="12.25" y="9" width="3.5" height="12" rx="1" fill="${TELEMETRY_DARK.teal}"/>` +
    `<rect x="18.5" y="12" width="3.5" height="9" rx="1" fill="${TELEMETRY_DARK.amber}"/>` +
    `<circle cx="20.25" cy="7.5" r="2" fill="${TELEMETRY_DARK.teal}"/>` +
    `</svg>`
  );
}

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28'%3E%3Crect width='28' height='28' rx='7' fill='%2313171f'/%3E%3Crect x='6' y='15' width='3.5' height='6' rx='1' fill='%2338bdf8'/%3E%3Crect x='12.25' y='9' width='3.5' height='12' rx='1' fill='%2310b981'/%3E%3Crect x='18.5' y='12' width='3.5' height='9' rx='1' fill='%23f59e0b'/%3E%3C/svg%3E";

const DARK_VARS = `
  color-scheme: dark;
  --bg: ${TELEMETRY_DARK.bgRaised};
  --surface: ${TELEMETRY_DARK.surface};
  --surface-alt: ${TELEMETRY_DARK.surfaceAlt};
  --inset: ${TELEMETRY_DARK.inset};
  --border: ${TELEMETRY_DARK.border};
  --border-hi: ${TELEMETRY_DARK.borderHi};
  --ink: ${TELEMETRY_DARK.ink};
  --ink-dim: ${TELEMETRY_DARK.inkDim};
  --ink-faint: ${TELEMETRY_DARK.inkFaint};
  --teal: ${TELEMETRY_DARK.teal};
  --teal-soft: rgba(16, 185, 129, 0.14);
  --blue: ${TELEMETRY_DARK.blue};
  --amber: ${TELEMETRY_DARK.amber};
  --red: ${TELEMETRY_DARK.red};
  --green: ${TELEMETRY_DARK.green};
  --code: ${TELEMETRY_DARK.inset};
  --accent-ink: #04130d;
  --card-shadow: 0 1px 2px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  --elevated-shadow: 0 16px 36px -8px rgba(0, 0, 0, 0.52), inset 0 1px 0 rgba(255, 255, 255, 0.06);
`;

const LIGHT_VARS = `
  color-scheme: light;
  --bg: ${TELEMETRY_LIGHT.bg};
  --surface: ${TELEMETRY_LIGHT.surface};
  --surface-alt: ${TELEMETRY_LIGHT.surfaceAlt};
  --inset: ${TELEMETRY_LIGHT.inset};
  --border: ${TELEMETRY_LIGHT.border};
  --border-hi: ${TELEMETRY_LIGHT.borderHi};
  --ink: ${TELEMETRY_LIGHT.ink};
  --ink-dim: ${TELEMETRY_LIGHT.inkDim};
  --ink-faint: ${TELEMETRY_LIGHT.inkFaint};
  --teal: ${TELEMETRY_LIGHT.teal};
  --teal-soft: rgba(4, 120, 87, 0.10);
  --blue: ${TELEMETRY_LIGHT.blue};
  --amber: ${TELEMETRY_LIGHT.amber};
  --red: ${TELEMETRY_LIGHT.red};
  --green: ${TELEMETRY_LIGHT.green};
  --code: ${TELEMETRY_LIGHT.surfaceAlt};
  --accent-ink: #ffffff;
  --card-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
  --elevated-shadow: 0 16px 36px -10px rgba(15, 23, 42, 0.12), 0 1px 3px rgba(15, 23, 42, 0.05);
`;

const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  min-height: 100vh;
  font-family: ${TELEMETRY_FONT_SANS};
  font-size: 14px;
  line-height: 1.55;
  color: var(--ink);
  background-color: var(--bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
a { color: inherit; }
img, svg { max-width: 100%; }
code, pre, .mono, .tnum {
  font-family: ${TELEMETRY_FONT_MONO};
  font-variant-numeric: tabular-nums;
}
.container { width: 100%; max-width: 1120px; margin: 0 auto; padding: 0 24px; }

.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--card-shadow);
}
.panel-hi {
  border-color: var(--border-hi);
  box-shadow: var(--elevated-shadow);
}

/* Header */
.site-header-wrap {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  height: 60px;
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  font-weight: 600;
  font-size: 15px;
  letter-spacing: -0.01em;
}
.brand span.tag {
  font-size: 11px;
  font-weight: 500;
  color: var(--ink-dim);
  border: 1px solid var(--border);
  background: var(--surface-alt);
  padding: 2px 7px;
  border-radius: 5px;
}
.header-right { display: flex; align-items: center; gap: 18px; }
.nav-links {
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-dim);
}
.nav-links a { text-decoration: none; transition: color 120ms ease; }
.nav-links a:hover { color: var(--ink); }
.theme-switch {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--border-hi);
  border-radius: 8px;
  background: var(--surface);
}
.theme-switch a {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  text-transform: capitalize;
  text-decoration: none;
  color: var(--ink-dim);
  border-radius: 6px;
}
.theme-switch a[aria-current='true'] {
  background: var(--teal);
  color: var(--accent-ink);
  font-weight: 600;
}
@media (max-width: 760px) { .nav-links { display: none; } }

/* Landing Hero */
.hero {
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  align-items: center;
  gap: 44px;
  padding: 52px 0 44px;
}
@media (max-width: 960px) { .hero { grid-template-columns: 1fr; gap: 32px; padding: 32px 0 24px; } }
.eyebrow {
  display: inline-block;
  margin-bottom: 14px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--teal);
}
h1.hero-title {
  margin: 0 0 16px;
  font-size: clamp(30px, 4.2vw, 44px);
  font-weight: 700;
  line-height: 1.14;
  letter-spacing: -0.03em;
}
.lede {
  max-width: 42em;
  margin: 0 0 24px;
  font-size: 15.5px;
  line-height: 1.6;
  color: var(--ink-dim);
}
.cta-row { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 24px; }
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 15px;
  border: 1px solid var(--border-hi);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.btn:hover { background: var(--surface-alt); border-color: var(--teal); }
.btn-primary { background: var(--teal); border-color: var(--teal); color: var(--accent-ink); }
.btn-primary:hover { opacity: 0.92; background: var(--teal); color: var(--accent-ink); }

.mini-stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--ink-faint);
}
.mini-stats b {
  display: block;
  font-size: 17px;
  font-weight: 700;
  color: var(--ink);
  font-family: ${TELEMETRY_FONT_MONO};
}
@media (max-width: 520px) { .mini-stats { grid-template-columns: repeat(2, 1fr); } }

.stage-panel { padding: 18px; }
.stage-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-dim);
}
.stage-top .live { display: inline-flex; align-items: center; gap: 7px; color: var(--teal); font-weight: 600; }
.stage-top .live .dot { width: 7px; height: 7px; border-radius: 99px; background: currentColor; }
.card-slot svg { display: block; width: 100%; height: auto; }
.badge-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.badge-row .svg-inline { display: flex; }
.badge-row svg { display: block; height: 24px; width: auto; }
.chart-slot { margin-top: 12px; overflow: hidden; border-radius: 10px; }
.chart-slot svg { display: block; width: 100%; height: auto; }
.seed-panel { display: grid; gap: 12px; padding: 22px; }
.seed-panel h3 { margin: 0; font-size: 16px; font-weight: 600; }
.seed-panel p { margin: 0; font-size: 14px; color: var(--ink-dim); }

/* Sections & Setup Steps */
.section { padding: 36px 0; border-top: 1px solid var(--border); }
.section-head { max-width: 52em; margin-bottom: 20px; }
.section-head h2 { margin: 0 0 6px; font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
.section-head p { margin: 0; font-size: 14px; color: var(--ink-dim); }
.kicker {
  display: block;
  margin-bottom: 6px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--teal);
}
.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 900px) { .steps { grid-template-columns: 1fr; } }
.step { min-width: 0; padding: 18px; display: flex; flex-direction: column; justify-content: space-between; gap: 12px; }
.step-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.step-num {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: var(--teal-soft);
  font-family: ${TELEMETRY_FONT_MONO};
  font-size: 12px;
  font-weight: 700;
  color: var(--teal);
}
.step h3 { margin: 0; font-size: 15px; font-weight: 600; }
.step p { margin: 0; font-size: 13.5px; color: var(--ink-dim); }
.codeblock {
  margin: 0;
  padding: 11px 13px;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--code);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ink);
  white-space: pre;
}

/* API Endpoints Table */
.table-wrap { min-width: 0; max-width: 100%; overflow-x: auto; }
table.endpoints { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 600px; }
table.endpoints thead th {
  padding: 11px 16px;
  border-bottom: 1px solid var(--border-hi);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  text-align: left;
  color: var(--ink-faint);
}
table.endpoints td { padding: 11px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
table.endpoints tr:last-child td { border-bottom: none; }
table.endpoints tr:hover td { background: var(--surface-alt); }
table.endpoints code { font-size: 12.5px; color: var(--ink); }
table.endpoints .desc { color: var(--ink-dim); }
.method {
  display: inline-block;
  min-width: 48px;
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid;
  font-family: ${TELEMETRY_FONT_MONO};
  font-size: 11px;
  font-weight: 600;
  text-align: center;
}
.method.get { color: var(--teal); border-color: var(--teal); background: var(--teal-soft); }
.method.post { color: var(--amber); border-color: var(--amber); }

/* Dashboard */
.dash-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 18px;
  padding: 28px 0 8px;
}
.dash-identity { display: flex; align-items: center; gap: 14px; }
.dash-avatar {
  width: 46px;
  height: 46px;
  border-radius: 11px;
  background: var(--surface);
  border: 1px solid var(--border-hi);
  display: grid;
  place-items: center;
  font-size: 18px;
  font-weight: 700;
  color: var(--teal);
  box-shadow: var(--card-shadow);
}
.dash-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.dash-title { margin: 0; font-size: clamp(22px, 2.8vw, 28px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; }
.dash-title .at { color: var(--ink-faint); }
.sync-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 9px;
  border-radius: 99px;
  font-size: 12px;
  font-weight: 500;
  background: var(--teal-soft);
  color: var(--teal);
}
.dash-sub { display: flex; flex-wrap: wrap; gap: 6px 10px; margin-top: 4px; font-size: 13px; color: var(--ink-dim); }
.dash-sub .sep { color: var(--ink-faint); }
.dash-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }

.range-tabs {
  display: inline-flex;
  padding: 2px;
  border-radius: 8px;
  border: 1px solid var(--border-hi);
  background: var(--surface);
}
.range-tabs button {
  border: 0;
  background: transparent;
  color: var(--ink-dim);
  padding: 5px 11px;
  border-radius: 6px;
  font-family: ${TELEMETRY_FONT_MONO};
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.range-tabs button[aria-selected='true'] {
  background: var(--teal);
  color: var(--accent-ink);
}

.window-pane[hidden] { display: none !important; }

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin: 18px 0 14px;
}
@media (max-width: 900px) { .stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .stat-grid { grid-template-columns: 1fr; } }
.stat { padding: 16px 18px; }
.stat .label { font-size: 12px; font-weight: 500; color: var(--ink-dim); margin-bottom: 6px; }
.stat .value {
  font-family: ${TELEMETRY_FONT_MONO};
  font-size: 28px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.03em;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.stat .value.accent-spend { color: var(--amber); }
.stat .value.accent-streak { color: var(--teal); }
.stat .sub { margin-top: 8px; font-size: 12.5px; color: var(--ink-faint); line-height: 1.4; }

.chart-stack { display: grid; gap: 14px; margin-top: 14px; }
.panel-card { min-width: 0; padding: 18px; overflow: hidden; }
.panel-card-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.panel-card h3 { margin: 0; font-size: 15px; font-weight: 600; }
.panel-card .hint { margin: 0; font-size: 12.5px; color: var(--ink-dim); }
.panel-card svg { display: block; width: 100%; height: auto; }

.split-grid { display: grid; grid-template-columns: 1.25fr 0.75fr; gap: 14px; margin-top: 14px; }
@media (max-width: 920px) { .split-grid { grid-template-columns: 1fr; } }
table.data { width: 100%; border-collapse: collapse; font-size: 13px; }
table.data thead th {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-hi);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  text-align: left;
  color: var(--ink-faint);
}
table.data td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: middle; }
table.data tr:last-child td { border-bottom: none; }
table.data .num { text-align: right; font-family: ${TELEMETRY_FONT_MONO}; font-variant-numeric: tabular-nums; white-space: nowrap; }
table.data .model { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; }
table.data .model .swatch { flex: none; width: 8px; height: 8px; border-radius: 2px; }
table.data .model code { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.share-bar { height: 6px; min-width: 72px; background: var(--inset); border-radius: 99px; overflow: hidden; }
.share-bar span { display: block; height: 100%; border-radius: 99px; }
.empty-row { padding: 20px 8px; font-size: 13.5px; color: var(--ink-dim); }
.footnote { margin: 12px 0 0; font-size: 12px; color: var(--ink-faint); line-height: 1.45; }

/* Embed Snippets */
.embed-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
@media (max-width: 860px) { .embed-grid { grid-template-columns: 1fr; } }
.embed-item { padding: 16px; min-width: 0; }
.embed-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.embed-head span { font-size: 12.5px; font-weight: 600; color: var(--ink-dim); }
.embed-preview {
  display: flex;
  align-items: center;
  min-height: 40px;
  margin-bottom: 10px;
  overflow-x: auto;
  min-width: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
}
.embed-preview svg { display: block; width: auto; height: 24px; max-width: none; }
.embed-preview.wide { overflow: hidden; display: block; }
.embed-preview.wide svg { display: block; width: 100%; height: auto; max-width: 100%; }
.snippet { display: flex; align-items: stretch; gap: 8px; min-width: 0; }
.snippet pre {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 8px 11px;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--code);
  font-size: 12px;
  line-height: 1.55;
  color: var(--ink-dim);
  white-space: pre;
}
.copy {
  flex: none;
  padding: 0 12px;
  border: 1px solid var(--border-hi);
  border-radius: 7px;
  background: var(--surface-alt);
  color: var(--ink);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.copy:hover { border-color: var(--teal); color: var(--teal); }
.copy.copied { border-color: var(--green); color: var(--green); }
.markdown-block { min-width: 0; margin-top: 14px; padding: 16px; }
.sync-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; min-width: 0; }
@media (max-width: 900px) { .sync-steps { grid-template-columns: 1fr; } }
.sync-step { padding: 16px; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; gap: 10px; }
.sync-step h4 { margin: 0 0 6px; font-size: 14px; font-weight: 600; }
.sync-step p { margin: 0; font-size: 13px; color: var(--ink-dim); }

.site-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 24px 0 36px;
  margin-top: 24px;
  border-top: 1px solid var(--border);
  font-size: 12.5px;
  color: var(--ink-faint);
}
.site-footer .links { display: flex; flex-wrap: wrap; gap: 16px; }
.site-footer a { color: var(--ink-dim); text-decoration: none; }
.site-footer a:hover { color: var(--teal); }

.notfound { display: grid; place-items: center; min-height: 64vh; padding: 40px 0; }
.notfound-card { width: min(560px, 100%); padding: 28px; text-align: center; }
.notfound-card h1 { margin: 0 0 10px; font-size: 22px; font-weight: 700; }
.notfound-card p { margin: 0 0 18px; font-size: 14px; color: var(--ink-dim); }
.notfound-card .codeblock { margin-bottom: 18px; text-align: left; }
`;

const PAGE_SCRIPT = `
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

  var rangeButtons = document.querySelectorAll('[data-range-btn]');
  var rangePanes = document.querySelectorAll('[data-range-pane]');
  for (var r = 0; r < rangeButtons.length; r += 1) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var selected = btn.getAttribute('data-range-btn');
        for (var i = 0; i < rangeButtons.length; i += 1) {
          rangeButtons[i].setAttribute(
            'aria-selected',
            rangeButtons[i].getAttribute('data-range-btn') === selected ? 'true' : 'false'
          );
        }
        for (var j = 0; j < rangePanes.length; j += 1) {
          if (rangePanes[j].getAttribute('data-range-pane') === selected) {
            rangePanes[j].removeAttribute('hidden');
          } else {
            rangePanes[j].setAttribute('hidden', 'hidden');
          }
        }
      });
    })(rangeButtons[r]);
  }
})();
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
    `html[data-theme='dark'], html[data-theme='auto'] {${DARK_VARS}}\n` +
    `html[data-theme='light'] {${LIGHT_VARS}}\n` +
    `@media (prefers-color-scheme: light) { html[data-theme='auto'] {${LIGHT_VARS}} }\n` +
    BASE_CSS +
    '\n</style>\n</head>\n<body>\n' +
    params.body +
    '\n<script>\n' +
    PAGE_SCRIPT +
    '\n</script>\n</body>\n</html>\n'
  );
}

function pageHref(theme: SvgTheme, params: { current: 'home' | 'dashboard'; dashboardUser?: string }): string {
  if (params.current === 'dashboard' && params.dashboardUser) {
    return `/u/${encodeURIComponent(params.dashboardUser)}?theme=${theme}`;
  }
  return `/?theme=${theme}`;
}

function siteHeader(params: { theme: SvgTheme; current: 'home' | 'dashboard'; dashboardUser?: string }): string {
  const themeLinks = (['dark', 'light', 'auto'] as const)
    .map(
      (theme) =>
        `<a href="${pageHref(theme, params)}"${theme === params.theme ? ' aria-current="true"' : ''}>${theme}</a>`,
    )
    .join('');
  return (
    '<div class="site-header-wrap"><header class="site-header container">' +
    `<a class="brand" href="/">${logoMark(28)}<span>Token Island</span><span class="tag">Cloud</span></a>` +
    '<div class="header-right">' +
    '<nav class="nav-links" aria-label="Primary">' +
    '<a href="/u/demo">Demo Dashboard</a>' +
    `<a href="${params.current === 'home' ? '#setup' : '/#setup'}">Setup</a>` +
    `<a href="${params.current === 'home' ? '#api' : '/#api'}">API</a>` +
    '<a href="/healthz">Health</a>' +
    '</nav>' +
    `<div class="theme-switch" role="group" aria-label="Theme">${themeLinks}</div>` +
    '</div></header></div>'
  );
}

function siteFooter(theme: SvgTheme): string {
  return (
    '<footer class="site-footer container">' +
    `<div>Token Island · local-first token telemetry for AI coding agents · v${CLOUD_VERSION} · <a href="/u/demo${themeQuery(theme)}">@demo</a></div>` +
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
// Landing Page (/)
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
      '" style="color:var(--ink-dim);text-decoration:none">Open dashboard →</a></div>' +
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
        height: 200,
        idPrefix: 'landing-chart',
      })}</div>` +
      '</div>'
    : '<div class="panel panel-hi seed-panel">' +
      '<div class="stage-top"><span>Demo data missing</span><span style="color:var(--amber)">Seed optional</span></div>' +
      '<h3>Seed the demo profile to preview live widgets</h3>' +
      '<p>The landing page renders live badges, charts and profile cards for <code>@demo</code>. Run the idempotent seed script once and refresh:</p>' +
      codeBlock('pnpm --filter @token-island/cloud seed\n# prints the demo API key and example URLs') +
      '<p>This service works immediately without demo data — register your own username and sync from the local collector.</p>' +
      '</div>';

  const badgesMarkdownSample = demo
    ? `[![tokens](${baseUrl}/u/${demo.username}/badge.svg?metric=tokens&theme=auto)](${baseUrl}/u/${demo.username})\n` +
      `[![cost](${baseUrl}/u/${demo.username}/badge.svg?metric=cost&theme=auto)](${baseUrl}/u/${demo.username})\n` +
      `[![streak](${baseUrl}/u/${demo.username}/badge.svg?metric=streak&theme=auto)](${baseUrl}/u/${demo.username})`
    : `[![tokens](${baseUrl}/u/your-name/badge.svg?metric=tokens&theme=auto)](${baseUrl}/u/your-name)\n` +
      `[![cost](${baseUrl}/u/your-name/badge.svg?metric=cost&theme=auto)](${baseUrl}/u/your-name)\n` +
      `[![streak](${baseUrl}/u/your-name/badge.svg?metric=streak&theme=auto)](${baseUrl}/u/your-name)`;

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
    '<span class="eyebrow">Local-First · Zero Runtime Dependencies</span>' +
    '<h1 class="hero-title">Your coding agent token usage, clearly measured.</h1>' +
    '<p class="lede">Token Island turns local daily aggregates from Claude Code, OpenAI Codex, OpenCode and DeepSeek Harness into crisp macOS Dynamic Island telemetry and GitHub-ready SVG badges, charts and profile cards.</p>' +
    '<div class="cta-row">' +
    `<a class="btn btn-primary" href="${demoLink}">Explore Live Dashboard →</a>` +
    '<a class="btn" href="#setup">3-Step Setup</a>' +
    '</div>' +
    '<div class="mini-stats">' +
    '<div><b>0</b>Runtime deps</div>' +
    '<div><b>1</b>D1 / SQLite DB</div>' +
    '<div><b>7</b>Badge metrics</div>' +
    '<div><b>4</b>Chart types</div>' +
    '</div>' +
    '</div>' +
    `<div class="stage">${stage}</div>` +
    '</section>' +
    '<section class="section" id="setup">' +
    '<div class="section-head"><span class="kicker">Setup</span><h2>Three steps to a live README badge</h2>' +
    '<p>The collector parses session files on 127.0.0.1; the cloud only ever receives daily aggregate totals — never prompts, file paths or secrets.</p></div>' +
    '<div class="steps">' +
    '<div class="panel step"><div><div class="step-top"><span class="step-num">1</span><h3>Register your profile</h3></div>' +
    '<p>One HTTP call reserves your username. The API key is returned once — only its SHA-256 hash is stored.</p></div>' +
    codeBlock(registerSnippet) +
    '</div>' +
    '<div class="panel step"><div><div class="step-top"><span class="step-num">2</span><h3>Sync from collector</h3></div>' +
    '<p>Point your local collector at this service so it pushes daily rollups every 15 minutes.</p></div>' +
    codeBlock(configSnippet) +
    '</div>' +
    '<div class="panel step"><div><div class="step-top"><span class="step-num">3</span><h3>Embed in README</h3></div>' +
    '<p>Drop responsive vector badges, charts or profile cards into any GitHub Markdown file.</p></div>' +
    codeBlock(badgesMarkdownSample) +
    '</div>' +
    '</div></section>' +
    '<section class="section" id="api">' +
    '<div class="section-head"><span class="kicker">HTTP API</span><h2>Small, predictable, edge-cached</h2>' +
    '<p>Plain HTTP + JSON. SVG assets carry 5-minute edge Cache-Control and content-hash ETags so README traffic stays fast.</p></div>' +
    '<div class="panel table-wrap"><table class="endpoints"><thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead><tbody>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/healthz</code></td><td class="desc">Service health: users, stored day rows, uptime.</td></tr>' +
    '<tr><td><span class="method post">POST</span></td><td><code>/api/v1/register</code></td><td class="desc">Create a profile and return its API key once.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/api/v1/me</code></td><td class="desc">Bearer-authenticated totals for the calling profile.</td></tr>' +
    '<tr><td><span class="method post">POST</span></td><td><code>/api/v1/ingest</code></td><td class="desc">Upload up to 400 daily aggregates (idempotent latest-wins upsert).</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/api/v1/u/:user</code></td><td class="desc">Public stats JSON backing the dashboard.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/u/:user/badge.svg</code></td><td class="desc">Vector badge: tokens, cost, streak, messages, day, model, status.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/u/:user/chart.svg</code></td><td class="desc">Line, bar, heatmap or models chart with theme and size parameters.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/u/:user/card.svg</code></td><td class="desc">520×240 profile card with all-time totals, streak and 30d sparkline.</td></tr>' +
    '<tr><td><span class="method get">GET</span></td><td><code>/u/:user</code></td><td class="desc">Public telemetry dashboard with timeframe tabs and embed snippets.</td></tr>' +
    '</tbody></table></div>' +
    '</section>' +
    '</main>' +
    siteFooter(theme);

  return documentShell({
    title: 'Token Island — coding agent token telemetry, clearly measured',
    description:
      'Local-first token usage tracker for AI coding agents: macOS Dynamic Island widget plus GitHub README badges, charts, profile cards and public dashboard.',
    theme,
    body,
  });
}

// ---------------------------------------------------------------------------
// Dashboard Page (/u/:user)
// ---------------------------------------------------------------------------

export interface DashboardPageOptions {
  stats: UserStats;
  theme: SvgTheme;
  baseUrl: string;
  now?: number;
  timezone?: string;
}

function statCard(label: string, value: string, sub: string, accentClass = ''): string {
  return (
    '<div class="panel stat">' +
    `<div class="label">${escapeHtml(label)}</div>` +
    `<div class="value${accentClass ? ` ${accentClass}` : ''}">${escapeHtml(value)}</div>` +
    `<div class="sub">${escapeHtml(sub)}</div>` +
    '</div>'
  );
}

function modelsTable(models: readonly ModelStat[]): string {
  if (models.length === 0) {
    return '<div class="empty-row">No model data synced yet.</div>';
  }
  const rows = models
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
        Math.max(1.5, row.share * 100).toFixed(1) +
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
    { metric: 'cost', label: 'Est. spend' },
    { metric: 'streak', label: 'Streak' },
    { metric: 'messages', label: 'Agent turns' },
    { metric: 'day', label: 'Today' },
    { metric: 'model', label: 'Top model' },
    { metric: 'status', label: 'Status' },
  ];

  const badgeItems = metrics
    .map((entry) => {
      const snippet = `<img alt="token island ${entry.metric}" src="${base}/badge.svg?metric=${entry.metric}&theme=auto" height="24" />`;
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

  const chartSnippet = `<img alt="token island activity chart" src="${base}/chart.svg?type=line&days=30&theme=auto" width="760" height="220" />`;
  const cardSnippet = `<img alt="token island profile card" src="${base}/card.svg?theme=auto" width="520" height="240" />`;
  const markdown =
    `[![tokens](${base}/badge.svg?metric=tokens&theme=auto)](${base})\n` +
    `[![cost](${base}/badge.svg?metric=cost&theme=auto)](${base})\n` +
    `[![streak](${base}/badge.svg?metric=streak&theme=auto)](${base})\n\n` +
    `[![Token Island activity](${base}/chart.svg?type=heatmap&days=365&theme=auto)](${base})\n` +
    `[![Token Island card](${base}/card.svg?theme=auto)](${base})`;

  return (
    '<section class="section" id="embed">' +
    '<div class="section-head"><span class="kicker">README Widgets</span><h2>Embed in your README</h2>' +
    '<p>Copy any snippet below into your GitHub profile or project README. Assets support <code>theme=dark|light|auto</code> with zero external scripts.</p></div>' +
    `<div class="embed-grid">${badgeItems}</div>` +
    '<div class="embed-grid" style="margin-top:14px">' +
    '<div class="panel embed-item"><div class="embed-head"><span>30-day activity chart</span></div>' +
    `<div class="embed-preview wide">${renderChart(chartSeries(stats, 30, {}), {
      type: 'line',
      theme,
      width: 760,
      height: 210,
      idPrefix: 'dash-embed-line',
    })}</div>` +
    snippetBlock('snippet-chart', chartSnippet) +
    '</div>' +
    '<div class="panel embed-item"><div class="embed-head"><span>Profile card (520×240)</span></div>' +
    `<div class="embed-preview wide">${renderCard(stats, {
      theme,
      width: 520,
      idPrefix: 'dash-embed-card',
    })}</div>` +
    snippetBlock('snippet-card', cardSnippet) +
    '</div>' +
    '</div>' +
    '<div class="panel markdown-block"><div class="embed-head"><span>Complete Markdown bundle</span></div>' +
    snippetBlock('snippet-markdown', markdown) +
    '</div></section>'
  );
}

function syncSection(stats: UserStats, baseUrl: string, now: number): string {
  const lastSync = stats.lastSyncAt
    ? `${dateTimeLabel(stats.lastSyncAt)} (${relativeTime(stats.lastSyncAt, now)})`
    : 'never';
  return (
    '<section class="section" id="sync">' +
    '<div class="section-head"><span class="kicker">Sync</span><h2>Keep daily aggregates fresh</h2>' +
    `<p>Last sync: <b>${escapeHtml(lastSync)}</b>. Re-uploading a date performs an idempotent latest-wins upsert.</p></div>` +
    '<div class="sync-steps">' +
    '<div class="panel sync-step"><div><h4>1 · Bearer API key</h4>' +
    '<p>Authenticate with the key returned once during registration.</p></div>' +
    codeBlock('Authorization: Bearer ti_…') +
    '</div>' +
    '<div class="panel sync-step"><div><h4>2 · Automatic daemon sync</h4>' +
    '<p>Enable <code>cloud.enabled</code> in <code>~/.token-island/config.json</code> or trigger manually:</p></div>' +
    codeBlock('tokenisland sync') +
    '</div>' +
    '<div class="panel sync-step"><div><h4>3 · Direct HTTP ingest</h4>' +
    '<p>POST up to 400 daily rollups directly from CI or custom scripts.</p></div>' +
    codeBlock(`curl -X POST ${baseUrl}/api/v1/ingest \\\n  -H 'Authorization: Bearer ti_…' \\\n  -d '{"days":[...]}'`) +
    '</div>' +
    '</div>' +
    `<p class="footnote">Stored days: ${stats.totalDays} · active days: ${stats.activeDays}${stats.firstDate ? ` · tracking since ${escapeHtml(longDate(stats.firstDate))}` : ''}</p>` +
    '</section>'
  );
}

function renderDashboardWindowPane(params: {
  key: '7d' | '30d' | '90d' | 'all';
  active: boolean;
  stats: UserStats;
  theme: SvgTheme;
  now: number;
  timezone?: string;
}): string {
  const { key, active, stats, theme, now, timezone } = params;
  const daysMap = { '7d': 7, '30d': 30, '90d': 90, all: 90 } as const;
  const chartDays = daysMap[key];

  const isAll = key === 'all';
  const win = isAll ? stats.totals : windowTotals(stats, chartDays, { now, timezone });
  const winModels = isAll ? stats.models : windowModels(stats, chartDays, { now, timezone });
  const rangeTitle =
    key === '7d' ? 'Last 7 days' : key === '30d' ? 'Last 30 days' : key === '90d' ? 'Last 90 days' : 'All time';
  const tokenSub = isAll
    ? `${formatTokensFull(win.totalTokens)} across ${stats.activeDays} active days`
    : `${formatTokensFull(win.totalTokens)} in ${rangeTitle.toLowerCase()}`;
  const spendSub =
    win.unpricedTokens > 0
      ? `${formatTokens(win.unpricedTokens)} tokens unpriced`
      : 'estimated from public API list prices';
  const turnsVal = formatTokens(win.messages);
  const turnsSub = `~${formatTokens(win.messages > 0 ? win.totalTokens / win.messages : 0)} tokens / turn`;

  const series = chartSeries(stats, chartDays, { now, timezone });
  const chartType = key === '90d' ? 'bar' : 'line';

  return (
    `<div class="window-pane" data-range-pane="${key}"${active ? '' : ' hidden="hidden"'}>` +
    '<section class="stat-grid">' +
    statCard('Total tokens', formatTokens(win.totalTokens), tokenSub) +
    statCard('Est. spend', formatCost(win.costUsd, { approx: true }), spendSub, 'accent-spend') +
    statCard(
      'Current streak',
      `${stats.streak.current}d`,
      `longest ${stats.streak.longest}d · last active ${stats.streak.lastActiveDate ? shortDate(stats.streak.lastActiveDate) : '—'}`,
      'accent-streak',
    ) +
    statCard('Messages', turnsVal, turnsSub) +
    '</section>' +
    '<div class="panel panel-card">' +
    '<div class="panel-card-head"><h3>Daily token consumption</h3>' +
    `<p class="hint">Last ${chartDays} days · ${escapeHtml(formatTokens(series.totalTokens))} tokens · ${escapeHtml(formatCost(series.totalCost, { approx: true }))}</p></div>` +
    renderChart(series, {
      type: chartType,
      theme,
      width: 1040,
      height: 230,
      idPrefix: `dash-main-${key}`,
      header: false,
    }) +
    '</div>' +
    '<section class="split-grid">' +
    `<div class="panel panel-card"><div class="panel-card-head"><h3>Model breakdown</h3><p class="hint">${rangeTitle} · share of tokens</p></div>` +
    modelsTable(winModels) +
    '</div>' +
    '<div class="panel panel-card"><div class="panel-card-head"><h3>Coding agents</h3><p class="hint">All time · inferred from model families</p></div>' +
    sourcesTable(stats) +
    '<p class="footnote">Cloud rollups store daily per-model counts only — prompts, sessions and local paths never leave 127.0.0.1.</p>' +
    '</div>' +
    '</section>' +
    '</div>'
  );
}

export function renderDashboardPage(options: DashboardPageOptions): string {
  const { stats, theme, baseUrl } = options;
  const now = options.now ?? Date.now();
  const user = encodeURIComponent(stats.username);
  const lastSync = stats.lastSyncAt ? `Synced ${relativeTime(stats.lastSyncAt, now)}` : 'Never synced';
  const initial = (stats.displayName || stats.username).replace(/^@/, '').charAt(0).toUpperCase() || '?';

  const body =
    siteHeader({ theme, current: 'dashboard', dashboardUser: stats.username }) +
    '<main class="container">' +
    '<section class="dash-head">' +
    '<div class="dash-identity">' +
    `<div class="dash-avatar" aria-hidden="true">${escapeHtml(initial)}</div>` +
    '<div>' +
    '<div class="dash-title-row">' +
    `<h1 class="dash-title"><span class="at">@</span>${escapeHtml(stats.username)}</h1>` +
    `<span class="sync-pill">● ${escapeHtml(lastSync)}</span>` +
    '</div>' +
    '<div class="dash-sub">' +
    `<span>${escapeHtml(stats.displayName)}</span><span class="sep">·</span>` +
    `<span>${stats.activeDays} active ${stats.activeDays === 1 ? 'day' : 'days'}${stats.firstDate ? ` since ${escapeHtml(shortDate(stats.firstDate))}` : ''}</span>` +
    '</div></div></div>' +
    '<div class="dash-actions">' +
    '<div class="range-tabs" role="tablist" aria-label="Timeframe">' +
    '<button type="button" role="tab" data-range-btn="7d" aria-selected="false">7D</button>' +
    '<button type="button" role="tab" data-range-btn="30d" aria-selected="false">30D</button>' +
    '<button type="button" role="tab" data-range-btn="90d" aria-selected="false">90D</button>' +
    '<button type="button" role="tab" data-range-btn="all" aria-selected="true">All Time</button>' +
    '</div>' +
    '<a class="btn" href="#embed">Embed Badges</a>' +
    `<a class="btn" href="/api/v1/u/${user}">JSON API</a>` +
    '</div>' +
    '</section>' +
    renderDashboardWindowPane({ key: '7d', active: false, stats, theme, now, timezone: options.timezone }) +
    renderDashboardWindowPane({ key: '30d', active: false, stats, theme, now, timezone: options.timezone }) +
    renderDashboardWindowPane({ key: '90d', active: false, stats, theme, now, timezone: options.timezone }) +
    renderDashboardWindowPane({ key: 'all', active: true, stats, theme, now, timezone: options.timezone }) +
    '<section class="chart-stack">' +
    '<div class="panel panel-card">' +
    '<div class="panel-card-head"><h3>Activity calendar</h3><p class="hint">Last 52 weeks · daily token intensity</p></div>' +
    renderChart(chartSeries(stats, 365, { now, timezone: options.timezone }), {
      type: 'heatmap',
      theme,
      width: 1040,
      height: 170,
      idPrefix: 'dash-heat',
      header: false,
    }) +
    '</div>' +
    '</section>' +
    embedSection(stats, theme, baseUrl) +
    syncSection(stats, baseUrl, now) +
    '</main>' +
    siteFooter(theme);

  return documentShell({
    title: `@${stats.username} · Token Island dashboard`,
    description: `Token Island public dashboard for @${stats.username}: token totals, streaks, model breakdown and embeddable GitHub README widgets.`,
    theme,
    body,
  });
}

// ---------------------------------------------------------------------------
// 404 Page
// ---------------------------------------------------------------------------

export function renderNotFoundPage(theme: SvgTheme, username: string): string {
  const body =
    siteHeader({ theme, current: 'home' }) +
    '<main class="container"><section class="notfound"><div class="panel panel-hi notfound-card">' +
    '<h1>Profile not found</h1>' +
    `<p>There is no Token Island profile for <code>@${escapeHtml(username)}</code> yet. ` +
    'Register a username and sync daily aggregates from the collector — your public dashboard will appear automatically.</p>' +
    codeBlock(
      `curl -s -X POST http://127.0.0.1:47117/api/v1/register \\\n  -H 'content-type: application/json' \\\n  -d '{"username":"${username}"}'`,
    ) +
    '<div class="cta-row" style="justify-content:center;margin-bottom:0">' +
    '<a class="btn btn-primary" href="/">Back to home</a>' +
    `<a class="btn" href="/u/demo${themeQuery(theme)}">View demo profile</a>` +
    '</div></div></section></main>' +
    siteFooter(theme);
  return documentShell({
    title: 'Profile not found · Token Island',
    description: 'This Token Island profile does not exist.',
    theme,
    body,
  });
}
