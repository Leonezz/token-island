/**
 * Self-contained Precision Telemetry Web Dashboard served by the local collector
 * at `GET /` and `GET /dashboard` (`http://127.0.0.1:47118/`).
 *
 * Zero external network/CDN dependencies so it works 100% offline in Local Mode.
 */

export function renderCollectorDashboardHtml(options: { version: string; demo: boolean }): string {
  const titleSuffix = options.demo ? ' · Demo' : '';
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Token Island · Local Telemetry${titleSuffix}</title>
  <style>
    :root, [data-theme="dark"] {
      --bg: #090b0e;
      --surface: #10141c;
      --surface-alt: #171c27;
      --inset: #0b0e14;
      --border: #242c3b;
      --border-hi: #343f54;
      --ink: #f4f6f9;
      --ink-dim: #a0aab8;
      --ink-faint: #737e91;
      --teal: #10b981;
      --blue: #38bdf8;
      --amber: #f59e0b;
      --red: #f43f5e;
      --green: #34d399;
      --shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
    }
    [data-theme="light"] {
      --bg: #f4f6f9;
      --surface: #ffffff;
      --surface-alt: #f1f5f9;
      --inset: #e8edf4;
      --border: #dbe2ec;
      --border-hi: #cbd5e1;
      --ink: #0f172a;
      --ink-dim: #475569;
      --ink-faint: #64748b;
      --teal: #047857;
      --blue: #0369a1;
      --amber: #b45309;
      --red: #be123c;
      --green: #15803d;
      --shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
    }
    .mono {
      font-family: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, monospace;
      font-variant-numeric: tabular-nums;
    }
    .wrap {
      max-width: 1120px;
      margin: 0 auto;
      padding: 24px 24px 48px;
    }
    header.topbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand h1 {
      margin: 0;
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 600;
      border: 1px solid var(--border);
      background: var(--surface-alt);
      color: var(--ink-dim);
    }
    .pill.live {
      color: var(--teal);
      border-color: color-mix(in srgb, var(--teal) 45%, var(--border));
      background: color-mix(in srgb, var(--teal) 12%, transparent);
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .seg {
      display: inline-flex;
      background: var(--inset);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 2px;
      gap: 2px;
    }
    .seg button {
      border: 0;
      background: transparent;
      color: var(--ink-dim);
      font-size: 12px;
      font-weight: 600;
      padding: 5px 10px;
      border-radius: 6px;
      cursor: pointer;
    }
    .seg button.active {
      background: var(--surface);
      color: var(--ink);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16);
    }
    .btn {
      border: 1px solid var(--border-hi);
      background: var(--surface);
      color: var(--ink);
      font-size: 12px;
      font-weight: 600;
      padding: 6px 11px;
      border-radius: 7px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .btn:hover { background: var(--surface-alt); }
    .btn.accent {
      border-color: var(--teal);
      color: var(--teal);
      background: color-mix(in srgb, var(--teal) 10%, transparent);
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(235px, 1fr));
      gap: 14px;
      margin-bottom: 16px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 18px;
    }
    .card-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--ink-dim);
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .kpi-val {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.15;
    }
    .kpi-sub {
      margin-top: 6px;
      font-size: 12px;
      color: var(--ink-faint);
    }
    .split-track {
      display: flex;
      gap: 3px;
      height: 9px;
      border-radius: 5px;
      overflow: hidden;
      background: var(--inset);
      margin: 10px 0 8px;
    }
    .split-legend {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--ink-dim);
    }
    .main-grid {
      display: grid;
      grid-template-columns: 1.25fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    @media (max-width: 900px) {
      .main-grid { grid-template-columns: 1fr; }
    }
    .bars-wrap {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      height: 136px;
      padding-top: 12px;
      border-bottom: 1px solid var(--border);
    }
    .bar-col {
      flex: 1;
      height: 100%;
      display: flex;
      align-items: flex-end;
      background: color-mix(in srgb, var(--inset) 70%, transparent);
      border-radius: 4px 4px 0 0;
      cursor: pointer;
      position: relative;
      border: 1px solid transparent;
    }
    .bar-col:hover { border-color: var(--border-hi); }
    .bar-col.selected { border-color: var(--amber); }
    .bar-fill {
      width: 100%;
      border-radius: 3px 3px 0 0;
      background: var(--blue);
      min-height: 2px;
      transition: opacity 0.12s ease;
    }
    .bar-col.today .bar-fill { background: var(--teal); }
    .bar-col.selected .bar-fill { background: var(--amber); }
    .bar-col.dimmed .bar-fill { opacity: 0.32; }
    .chart-foot {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 11.5px;
      color: var(--ink-faint);
    }
    .heatmap {
      display: grid;
      grid-template-columns: repeat(15, 1fr);
      gap: 4px;
      margin-top: 12px;
    }
    .heat-cell {
      aspect-ratio: 1;
      border-radius: 3px;
      background: var(--inset);
      cursor: pointer;
      border: 1px solid transparent;
    }
    .heat-cell:hover { border-color: var(--ink-dim); }
    .heat-cell.selected { border-color: var(--amber); }
    .b-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 10px;
    }
    .b-item {
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
    }
    .b-item.open {
      background: var(--surface-alt);
      border-color: var(--border-hi);
    }
    .b-head {
      display: grid;
      grid-template-columns: 16px 10px minmax(0, 1fr) 96px 68px 46px;
      align-items: center;
      gap: 8px;
      padding: 7px 9px;
      cursor: pointer;
      border-radius: 8px;
    }
    .b-head:hover { background: var(--surface-alt); }
    .b-bar {
      height: 6px;
      background: var(--inset);
      border-radius: 999px;
      overflow: hidden;
    }
    .b-bar > div { height: 100%; border-radius: 999px; }
    .b-drawer {
      padding: 8px 12px 10px 28px;
      border-top: 1px solid var(--border);
      font-size: 12px;
    }
    .sub-title {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--ink-faint);
      margin: 8px 0 4px;
    }
    .sub-row {
      display: grid;
      grid-template-columns: 8px minmax(0, 1fr) 64px 44px;
      align-items: center;
      gap: 8px;
      padding: 2px 0;
      color: var(--ink-dim);
    }
    .sessions-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    @media (max-width: 900px) {
      .sessions-grid { grid-template-columns: 1fr; }
    }
    .session-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 0;
      border-bottom: 1px solid var(--border);
      font-size: 12.5px;
    }
    .session-row:last-child { border-bottom: 0; }
    .toast {
      position: fixed;
      bottom: 20px;
      right: 24px;
      padding: 8px 14px;
      border-radius: 8px;
      background: var(--surface-alt);
      border: 1px solid var(--border-hi);
      box-shadow: var(--shadow);
      font-size: 12.5px;
      font-weight: 600;
      display: none;
    }
    .reset-link {
      border: 0;
      background: color-mix(in srgb, var(--amber) 16%, transparent);
      color: var(--amber);
      border-radius: 5px;
      padding: 2px 7px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="topbar">
      <div class="brand">
        <h1>Token Island</h1>
        <span id="statusPill" class="pill"><span class="dot"></span><span id="statusText">LOADING</span></span>
        <span id="metaPort" class="mono" style="font-size:12px;color:var(--ink-faint)"></span>
      </div>
      <div class="controls">
        <div class="seg" id="rangeSeg">
          <button data-range="today" class="active">Today</button>
          <button data-range="7d">7D</button>
          <button data-range="30d">30D</button>
          <button data-range="90d">90D</button>
          <button data-range="all">All</button>
        </div>
        <button class="btn" id="rescanBtn">Rescan</button>
        <button class="btn" id="syncBtn">Sync Cloud</button>
        <a class="btn accent" id="cloudProfileLink" href="#" target="_blank" rel="noopener" style="display:none">Cloud Profile ↗</a>
        <button class="btn" id="themeBtn" title="Toggle theme">Theme</button>
      </div>
    </header>

    <section class="kpi-grid">
      <div class="card">
        <div class="card-label">
          <span id="kpiTokensTitle">Today’s Tokens</span>
          <button id="resetDayBtn" class="reset-link" style="display:none">Reset Focus ↩</button>
        </div>
        <div class="kpi-val mono" id="kpiTokens">—</div>
        <div class="kpi-sub mono" id="kpiTokensFull">0 tokens</div>
      </div>

      <div class="card">
        <div class="card-label">
          <span>Input / Cache / Output</span>
          <span class="mono" id="kpiCacheHit">0% cache</span>
        </div>
        <div class="split-track" id="splitTrack"></div>
        <div class="split-legend mono">
          <span style="color:var(--teal)" id="splitIn">In 0</span>
          <span style="color:var(--blue)" id="splitCache">Cache 0</span>
          <span style="color:var(--amber)" id="splitOut">Out 0</span>
        </div>
      </div>

      <div class="card">
        <div class="card-label">
          <span>Estimated Spend</span>
          <span class="mono" id="kpiTurns">0 turns</span>
        </div>
        <div class="kpi-val mono" style="color:var(--amber)" id="kpiCost">$0</div>
        <div class="kpi-sub" id="kpiSessions">Local API pricing table</div>
      </div>

      <div class="card">
        <div class="card-label">
          <span>Coding Streak</span>
          <span class="mono" id="kpiLongest">Best 0d</span>
        </div>
        <div class="kpi-val mono" id="kpiStreak">0d</div>
        <div class="kpi-sub" id="kpiLastActive">Local SQLite telemetry</div>
      </div>
    </section>

    <section class="main-grid">
      <div class="card">
        <div class="card-label">
          <span>30-Day Daily Activity <span style="font-weight:400;color:var(--ink-faint)">(click bar to focus day)</span></span>
          <span class="mono" id="chartHoverLabel" style="color:var(--teal)"></span>
        </div>
        <div class="bars-wrap" id="dailyBars"></div>
        <div class="chart-foot mono">
          <span id="chartStart"></span>
          <span id="chartPeak"></span>
          <span>Today</span>
        </div>

        <div class="card-label" style="margin-top:18px;margin-bottom:4px">
          <span>90-Day Consistency Matrix</span>
          <span class="mono" style="color:var(--ink-faint)">90d</span>
        </div>
        <div class="heatmap" id="heatmapGrid"></div>
      </div>

      <div class="card">
        <div class="card-label" style="margin-bottom:10px">
          <div class="seg" id="dimSeg">
            <button data-dim="models" class="active">Models</button>
            <button data-dim="sources">Agent Apps</button>
            <button data-dim="projects">Projects</button>
          </div>
          <span style="font-weight:400;color:var(--ink-faint);font-size:11.5px">Click row to expand</span>
        </div>
        <div class="b-list" id="breakdownList"></div>
      </div>
    </section>

    <section class="sessions-grid">
      <div class="card">
        <div class="card-label">
          <span>Recent Agent Sessions</span>
          <span class="mono" id="liveCount">0 active</span>
        </div>
        <div id="sessionsList"></div>
      </div>

      <div class="card">
        <div class="card-label">
          <span>Local Collector & Agent Sources</span>
          <span class="mono" id="collectorVer"></span>
        </div>
        <div id="sourcesList"></div>
      </div>
    </section>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const state = {
      range: 'today',
      dim: 'models',
      selectedDate: null,
      expandedKey: null,
      summary: null,
      theme: localStorage.getItem('ti-theme') || 'dark',
    };
    document.documentElement.setAttribute('data-theme', state.theme);

    const SERIES = ['#10b981', '#38bdf8', '#f59e0b', '#fb7185', '#34d399', '#22d3ee'];

    function fmtTokens(n) {
      if (!Number.isFinite(n)) return '—';
      const v = Math.abs(Math.round(n));
      if (v < 1000) return String(v);
      if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 1 : 2).replace(/\\.?0+$/, '') + 'B';
      if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 1 : 2).replace(/\\.?0+$/, '') + 'M';
      return (v / 1e3).toFixed(v >= 1e4 ? 1 : 2).replace(/\\.?0+$/, '') + 'K';
    }
    function fmtCost(v) {
      if (!Number.isFinite(v) || v <= 0) return '~$0';
      if (v >= 100) return '~$' + Math.round(v);
      if (v >= 0.01) return '~$' + v.toFixed(2);
      return '<$0.01';
    }
    function fmtPct(r) {
      if (!Number.isFinite(r) || r <= 0) return '0%';
      const p = r * 100;
      if (p < 1) return '<1%';
      return (p < 10 ? p.toFixed(1) : Math.round(p)) + '%';
    }
    function esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function showToast(msg) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => { el.style.display = 'none'; }, 2600);
    }

    async function loadSummary() {
      try {
        const res = await fetch('/api/summary?range=' + encodeURIComponent(state.range) + '&days=90', { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        state.summary = await res.json();
        render();
      } catch (err) {
        document.getElementById('statusText').textContent = 'OFFLINE';
      }
    }

    function activeData(s) {
      if (state.selectedDate) {
        const pt = (s.daily || []).find((d) => d.date === state.selectedDate);
        if (pt) {
          return {
            title: 'Focused · ' + pt.date,
            totals: pt,
            models: pt.models || [],
            sources: pt.sources || [],
            projects: pt.projects || [],
            focused: true,
          };
        }
      }
      const rangeLabels = { today: 'Today’s Tokens', '7d': '7-Day Tokens', '30d': '30-Day Tokens', '90d': '90-Day Tokens', all: 'All-Time Tokens' };
      return {
        title: rangeLabels[state.range] || 'Total Tokens',
        totals: state.range === 'today' ? s.today : s.totals,
        models: s.models || [],
        sources: s.sources || [],
        projects: s.projects || [],
        focused: false,
      };
    }

    function render() {
      const s = state.summary;
      if (!s) return;
      const now = s.generatedAt || Date.now();
      const isLive = (s.live || []).some((x) => x.active) || (s.lastEventAt && now - s.lastEventAt < 600000);
      const pill = document.getElementById('statusPill');
      pill.className = 'pill' + (isLive ? ' live' : '');
      document.getElementById('statusText').textContent = isLive ? 'LIVE' : 'IDLE';
      document.getElementById('metaPort').textContent = location.host + ' · tz ' + (s.timezone || 'local');

      const cloud = s.collector && s.collector.cloud;
      const cloudLink = document.getElementById('cloudProfileLink');
      if (cloud && cloud.endpoint && cloud.username) {
        cloudLink.href = cloud.endpoint.replace(/\\/+$/, '') + '/u/' + encodeURIComponent(cloud.username);
        cloudLink.style.display = 'inline-flex';
      } else {
        cloudLink.style.display = 'none';
      }

      const view = activeData(s);
      const t = view.totals;
      document.getElementById('kpiTokensTitle').textContent = view.title;
      document.getElementById('resetDayBtn').style.display = view.focused ? 'inline-block' : 'none';
      document.getElementById('kpiTokens').textContent = fmtTokens(t.totalTokens);
      document.getElementById('kpiTokensFull').textContent = Number(t.totalTokens || 0).toLocaleString('en-US') + ' tokens';

      const sumSplit = Math.max(1, (t.inputTokens || 0) + (t.cacheReadTokens || 0) + (t.outputTokens || 0));
      const cachePct = fmtPct((t.cacheReadTokens || 0) / sumSplit);
      document.getElementById('kpiCacheHit').textContent = cachePct + ' cache';
      document.getElementById('splitTrack').innerHTML =
        '<div style="background:var(--teal);width:' + ((t.inputTokens || 0) / sumSplit * 100).toFixed(1) + '%"></div>' +
        '<div style="background:var(--blue);width:' + ((t.cacheReadTokens || 0) / sumSplit * 100).toFixed(1) + '%"></div>' +
        '<div style="background:var(--amber);flex:1"></div>';
      document.getElementById('splitIn').textContent = 'In ' + fmtTokens(t.inputTokens || 0);
      document.getElementById('splitCache').textContent = 'Cache ' + fmtTokens(t.cacheReadTokens || 0);
      document.getElementById('splitOut').textContent = 'Out ' + fmtTokens(t.outputTokens || 0);

      document.getElementById('kpiCost').textContent = fmtCost(t.costUsd || 0);
      document.getElementById('kpiTurns').textContent = (t.messages || 0) + ' turns';
      document.getElementById('kpiSessions').textContent = (s.totals.sessions || 0) + ' total sessions in range';

      document.getElementById('kpiStreak').textContent = '🔥 ' + (s.streak.current || 0) + 'd';
      document.getElementById('kpiLongest').textContent = 'Best ' + (s.streak.longest || 0) + 'd';
      document.getElementById('kpiLastActive').textContent = s.streak.lastActiveDate ? ('Last active ' + s.streak.lastActiveDate) : 'No active days yet';

      // 30-Day Bars
      const daily30 = (s.daily || []).slice(-30);
      const peak30 = Math.max(1, ...daily30.map((d) => d.totalTokens || 0));
      document.getElementById('chartStart').textContent = daily30[0] ? daily30[0].date : '';
      document.getElementById('chartPeak').textContent = 'Peak ' + fmtTokens(peak30);
      const barsHtml = daily30.map((d, idx) => {
        const isToday = idx === daily30.length - 1;
        const isSel = state.selectedDate === d.date;
        const dimmed = state.selectedDate && !isSel;
        const h = d.totalTokens > 0 ? Math.max(4, Math.round((d.totalTokens / peak30) * 100)) : 0;
        const cls = 'bar-col' + (isToday ? ' today' : '') + (isSel ? ' selected' : '') + (dimmed ? ' dimmed' : '');
        return '<div class="' + cls + '" data-date="' + esc(d.date) + '" title="' + esc(d.date + ': ' + fmtTokens(d.totalTokens) + ' (' + fmtCost(d.costUsd) + ')') + '">' +
          (h > 0 ? '<div class="bar-fill" style="height:' + h + '%"></div>' : '') +
          '</div>';
      }).join('');
      document.getElementById('dailyBars').innerHTML = barsHtml;

      // 90-Day Heatmap
      const daily90 = s.daily || [];
      const peak90 = Math.max(1, ...daily90.map((d) => d.totalTokens || 0));
      document.getElementById('heatmapGrid').innerHTML = daily90.map((d) => {
        const ratio = (d.totalTokens || 0) / peak90;
        const alpha = d.totalTokens > 0 ? (0.22 + ratio * 0.78).toFixed(2) : 0;
        const bg = d.totalTokens > 0 ? 'color-mix(in srgb, var(--teal) ' + Math.round(Number(alpha) * 100) + '%, var(--inset))' : 'var(--inset)';
        const isSel = state.selectedDate === d.date;
        return '<div class="heat-cell' + (isSel ? ' selected' : '') + '" data-date="' + esc(d.date) + '" style="background:' + bg + '" title="' + esc(d.date + ': ' + fmtTokens(d.totalTokens)) + '"></div>';
      }).join('');

      // Breakdowns + Inline Drill-Down
      const rows = view[state.dim] || [];
      const bEl = document.getElementById('breakdownList');
      if (rows.length === 0) {
        bEl.innerHTML = '<div style="color:var(--ink-faint);padding:12px 4px">No activity recorded for this selection.</div>';
      } else {
        bEl.innerHTML = rows.map((item, i) => {
          const open = state.expandedKey === item.key;
          const color = item.color || SERIES[i % SERIES.length];
          const sub1 = state.dim === 'models' ? ['Agent Apps', item.sources] : ['Models', item.models];
          const sub2 = state.dim === 'projects' ? ['Agent Apps', item.sources] : ['Projects', item.projects];
          let drawer = '';
          if (open) {
            const hasSplit = (item.inputTokens || 0) + (item.cacheReadTokens || 0) + (item.outputTokens || 0) > 0;
            drawer = '<div class="b-drawer">' +
              '<div class="mono" style="display:flex;justify-content:space-between;gap:8px;color:var(--ink-dim)">' +
              (hasSplit
                ? '<span>In ' + fmtTokens(item.inputTokens || 0) + ' · Cache ' + fmtTokens(item.cacheReadTokens || 0) + ' · Out ' + fmtTokens(item.outputTokens || 0) + '</span>'
                : '<span>' + Number(item.totalTokens || 0).toLocaleString('en-US') + ' tokens</span>') +
              '<span style="color:var(--amber)">' + fmtCost(item.costUsd || 0) + ' · ' + (item.messages || 0) + ' turns</span>' +
              '</div>' +
              renderSubGroup(sub1[0], sub1[1]) +
              renderSubGroup(sub2[0], sub2[1]) +
              '</div>';
          }
          return '<div class="b-item' + (open ? ' open' : '') + '">' +
            '<div class="b-head" data-bkey="' + esc(item.key) + '">' +
            '<span class="mono" style="color:var(--ink-faint)">' + (open ? '▾' : '▸') + '</span>' +
            '<span class="dot" style="background:' + esc(color) + '"></span>' +
            '<span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(item.label || item.key) + '</span>' +
            '<div class="b-bar"><div style="width:' + Math.max(4, Math.round((item.share || 0) * 100)) + '%;background:' + esc(color) + '"></div></div>' +
            '<span class="mono" style="text-align:right;font-weight:600">' + fmtTokens(item.totalTokens) + '</span>' +
            '<span class="mono" style="text-align:right;color:var(--ink-faint)">' + fmtPct(item.share || 0) + '</span>' +
            '</div>' + drawer + '</div>';
        }).join('');
      }

      // Live sessions
      const sessions = s.live || [];
      document.getElementById('liveCount').textContent = sessions.filter((x) => x.active).length + ' active';
      document.getElementById('sessionsList').innerHTML = sessions.length === 0
        ? '<div style="color:var(--ink-faint);padding:8px 0">No recent coding sessions in the last 6 hours.</div>'
        : sessions.map((ls) => (
          '<div class="session-row">' +
          '<div style="display:flex;align-items:center;gap:8px;min-width:0">' +
          '<span class="dot" style="color:' + (ls.active ? 'var(--teal)' : 'var(--ink-faint)') + '"></span>' +
          '<strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(ls.project) + '</strong>' +
          '<span class="pill mono">' + esc(ls.model) + '</span>' +
          '</div>' +
          '<span class="mono">' + fmtTokens(ls.totalTokens) + '</span>' +
          '</div>'
        )).join('');

      // Collector sources
      const meta = s.collector || {};
      document.getElementById('collectorVer').textContent = 'v' + (meta.version || '');
      document.getElementById('sourcesList').innerHTML = (meta.sources || []).map((src) => (
        '<div class="session-row">' +
        '<span><strong>' + esc(src.source) + '</strong> ' + (src.enabled ? '' : '<span style="color:var(--ink-faint)">(disabled)</span>') + '</span>' +
        '<span class="mono" style="color:var(--ink-dim)">' + Number(src.events || 0).toLocaleString('en-US') + ' events</span>' +
        '</div>'
      )).join('') + '<div class="mono" style="margin-top:8px;font-size:11px;color:var(--ink-faint);word-break:break-all">DB: ' + esc(meta.dbPath || '') + '</div>';
    }

    function renderSubGroup(title, items) {
      if (!items || items.length === 0) return '';
      return '<div class="sub-title">' + esc(title) + '</div>' +
        items.slice(0, 5).map((c, idx) => (
          '<div class="sub-row mono">' +
          '<span class="dot" style="width:5px;height:5px;background:' + esc(c.color || SERIES[idx % SERIES.length]) + '"></span>' +
          '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(c.label || c.key) + '</span>' +
          '<span style="text-align:right;color:var(--ink)">' + fmtTokens(c.totalTokens) + '</span>' +
          '<span style="text-align:right;color:var(--ink-faint)">' + fmtPct(c.share || 0) + '</span>' +
          '</div>'
        )).join('');
    }

    document.getElementById('rangeSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-range]');
      if (!btn) return;
      state.range = btn.dataset.range;
      state.selectedDate = null;
      state.expandedKey = null;
      for (const b of document.querySelectorAll('#rangeSeg button')) b.classList.toggle('active', b === btn);
      loadSummary();
    });

    document.getElementById('dimSeg').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-dim]');
      if (!btn) return;
      state.dim = btn.dataset.dim;
      state.expandedKey = null;
      for (const b of document.querySelectorAll('#dimSeg button')) b.classList.toggle('active', b === btn);
      render();
    });

    function handleDateClick(e) {
      const el = e.target.closest('[data-date]');
      if (!el) return;
      const d = el.dataset.date;
      state.selectedDate = state.selectedDate === d ? null : d;
      state.expandedKey = null;
      render();
    }
    document.getElementById('dailyBars').addEventListener('click', handleDateClick);
    document.getElementById('heatmapGrid').addEventListener('click', handleDateClick);
    document.getElementById('resetDayBtn').addEventListener('click', () => {
      state.selectedDate = null;
      state.expandedKey = null;
      render();
    });

    document.getElementById('breakdownList').addEventListener('click', (e) => {
      const head = e.target.closest('[data-bkey]');
      if (!head) return;
      const k = head.dataset.bkey;
      state.expandedKey = state.expandedKey === k ? null : k;
      render();
    });

    document.getElementById('rescanBtn').addEventListener('click', async () => {
      await fetch('/api/rescan', { method: 'POST' });
      showToast('Triggered local log rescan');
      setTimeout(loadSummary, 500);
    });

    document.getElementById('syncBtn').addEventListener('click', async () => {
      showToast('Syncing daily rollups to cloud…');
      const res = await fetch('/api/cloud/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) showToast('Cloud synced');
      else showToast((data.error && (data.error.message || data.error)) || 'Cloud sync not configured');
      loadSummary();
    });

    document.getElementById('themeBtn').addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('ti-theme', state.theme);
      document.documentElement.setAttribute('data-theme', state.theme);
    });

    loadSummary();
    try {
      const es = new EventSource('/api/events/stream?range=today&days=90');
      es.addEventListener('summary', (ev) => {
        if (state.range === 'today') {
          state.summary = JSON.parse(ev.data);
          render();
        }
      });
    } catch {}
  </script>
</body>
</html>`;
}
