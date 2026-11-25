#!/usr/bin/env node

// packages/core/src/types.ts
var SOURCE_META = {
  claude: { label: "Claude Code", short: "Claude", color: "#D97757" },
  codex: { label: "OpenAI Codex", short: "Codex", color: "#10A37F" },
  opencode: { label: "OpenCode", short: "OpenCode", color: "#6C7BFF" },
  dsh: { label: "DeepSeek Harness", short: "DSH", color: "#4D6BFE" },
  gemini: { label: "Gemini CLI", short: "Gemini", color: "#4285F4" },
  other: { label: "Other", short: "Other", color: "#8B8B8B" }
};
var SOURCE_IDS = ["claude", "codex", "opencode", "dsh", "gemini", "other"];
var RANGES = ["today", "7d", "30d", "90d", "all"];

// packages/core/src/pricing.ts
var DEFAULT_PRICE_RULES = [
  { id: "free", match: /(?:^|[-/._])(?:free|trial)(?:$|[-/._])/, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, note: "free tier" },
  // Anthropic
  { id: "claude-opus", match: /claude.*(?:opus|fable)/, input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75, note: "list price" },
  { id: "claude-sonnet", match: /claude.*sonnet/, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, note: "list price" },
  { id: "claude-haiku", match: /claude.*haiku/, input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1, note: "list price" },
  { id: "claude-family", match: /claude/, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, note: "family estimate" },
  // OpenAI
  { id: "gpt-nano", match: /gpt-5(?:\.\d+)?-nano/, input: 0.05, output: 0.4, cacheRead: 5e-3, note: "list price" },
  { id: "gpt-mini", match: /gpt-5(?:\.\d+)?-mini/, input: 0.25, output: 2, cacheRead: 0.025, note: "list price" },
  { id: "gpt-codex", match: /(?:gpt-5(?:\.\d+)?-codex|codex-mini)/, input: 1.25, output: 10, cacheRead: 0.125, note: "list price" },
  { id: "gpt-5", match: /gpt-5/, input: 1.25, output: 10, cacheRead: 0.125, note: "list price" },
  { id: "gpt-6", match: /gpt-6/, input: 1.25, output: 10, cacheRead: 0.125, note: "unreleased assumption, override me" },
  { id: "gpt-4.1", match: /gpt-4\.1/, input: 2, output: 8, cacheRead: 0.5, note: "list price" },
  { id: "o4-mini", match: /^o4-mini/, input: 1.1, output: 4.4, cacheRead: 0.275 },
  { id: "o3", match: /^o3(?:-|$)/, input: 2, output: 8, cacheRead: 0.5 },
  { id: "gpt-4o", match: /gpt-4o/, input: 2.5, output: 10, cacheRead: 1.25 },
  { id: "gpt-4", match: /gpt-4/, input: 2, output: 8, cacheRead: 1 },
  // DeepSeek
  { id: "deepseek-chat", match: /deepseek-(?:chat|flash|v3)/, input: 0.28, output: 0.42, cacheRead: 0.028, note: "estimate" },
  { id: "deepseek-reasoner", match: /deepseek-(?:reasoner|r1)/, input: 0.28, output: 0.42, cacheRead: 0.028, note: "estimate" },
  { id: "deepseek", match: /deepseek/, input: 0.28, output: 0.42, cacheRead: 0.028, note: "estimate" },
  // Chinese OSS models commonly used through coding agents
  { id: "glm", match: /glm-?[45]/, input: 0.6, output: 2.2, note: "estimate" },
  { id: "kimi", match: /(?:kimi|moonshot)/, input: 0.6, output: 2.5, note: "estimate" },
  { id: "qwen", match: /qwen/, input: 0.4, output: 1.2, note: "estimate" },
  { id: "minimax", match: /minimax|abab/, input: 0.3, output: 1.2, note: "estimate" },
  // Google
  { id: "gemini-pro", match: /gemini.*pro/, input: 1.25, output: 10, note: "estimate" },
  { id: "gemini-flash", match: /gemini.*flash/, input: 0.3, output: 2.5, note: "estimate" },
  { id: "gemini", match: /gemini/, input: 0.3, output: 2.5, note: "family estimate" },
  // Others
  { id: "grok-code", match: /grok.*code/, input: 0.2, output: 1.5, cacheRead: 0.02, note: "estimate" },
  { id: "grok", match: /grok-?4/, input: 3, output: 15, note: "estimate" },
  { id: "grok-family", match: /grok/, input: 3, output: 15, note: "family estimate" },
  { id: "mistral", match: /(?:mistral|magistral|codestral)/, input: 0.4, output: 2, note: "estimate" }
];
function normalizeModelId(model) {
  return model.trim().toLowerCase().replace(/^[a-z0-9_-]+\//, "").replace(/[:@]latest$/, "").replace(/[-_](?:20\d{2})[-_]?\d{2}[-_]?\d{2}$/, "").replace(/[-_](?:20\d{6})$/, "");
}
function resolvePrice(model, provider, overrides = []) {
  const normalized = normalizeModelId(model);
  if (!normalized) return null;
  for (const override of overrides) {
    if (!override.match) continue;
    if (normalized.includes(override.match.trim().toLowerCase())) {
      return {
        id: `override:${override.match}`,
        match: new RegExp(escapeRegExp(override.match), "i"),
        input: override.input,
        output: override.output,
        ...override.cacheRead !== void 0 ? { cacheRead: override.cacheRead } : {},
        ...override.cacheWrite !== void 0 ? { cacheWrite: override.cacheWrite } : {},
        note: override.note ?? "config override"
      };
    }
  }
  const haystack = provider ? `${provider}/${normalized}` : normalized;
  for (const rule of DEFAULT_PRICE_RULES) {
    if (rule.match.test(normalized) || rule.match.test(haystack)) return rule;
  }
  return null;
}
function estimateCostUsd(counts, model, provider, overrides = []) {
  const rule = resolvePrice(model, provider, overrides);
  if (!rule) return null;
  const cacheReadPrice = rule.cacheRead ?? rule.input;
  const cacheWritePrice = rule.cacheWrite ?? rule.input * 1.25;
  const perMillion = counts.inputTokens * rule.input + (counts.outputTokens ?? 0) * rule.output + (counts.cacheReadTokens ?? 0) * cacheReadPrice + (counts.cacheWriteTokens ?? 0) * cacheWritePrice;
  if (!Number.isFinite(perMillion)) return null;
  return Math.round(perMillion / 1e6 * 1e6) / 1e6;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// packages/core/src/format.ts
function trimZero(value) {
  return value.includes(".") ? value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1") : value;
}
function formatTokens(n, opts = {}) {
  if (!Number.isFinite(n)) return "\u2014";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n));
  const space = opts.space ? " " : "";
  if (abs < 1e3) {
    if (n > 0 && n < 1) return "<1";
    return `${sign}${abs}`;
  }
  const [divisor, suffix] = abs >= 1e12 ? [1e12, "T"] : abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : [1e3, "K"];
  const scaled = abs / divisor;
  let decimals;
  if (scaled < 10) decimals = 2;
  else if (scaled < 100) decimals = 1;
  else decimals = 0;
  if (opts.maxDecimals !== void 0) decimals = Math.min(decimals, opts.maxDecimals);
  return `${sign}${trimZero(scaled.toFixed(decimals))}${space}${suffix}`;
}
function formatCost(usd, opts = {}) {
  const prefix = opts.approx ? "~" : "";
  if (usd === null || usd === void 0 || !Number.isFinite(usd)) return "\u2014";
  const abs = Math.abs(usd);
  if (abs === 0) return `${prefix}$0`;
  if (abs >= 1e4) return `${prefix}$${formatTokens(abs)}`;
  if (abs >= 100) return `${prefix}$${Math.round(abs)}`;
  if (abs >= 10) return `${prefix}$${trimZero(abs.toFixed(2))}`;
  if (abs >= 1) return `${prefix}$${trimZero(abs.toFixed(2))}`;
  if (abs >= 0.01) return `${prefix}$${trimZero(abs.toFixed(2))}`;
  if (abs >= 1e-4) return `${prefix}<$0.01`;
  return `${prefix}<$0.0001`;
}
function formatPercent(ratio, decimals = 0) {
  if (!Number.isFinite(ratio) || ratio <= 0) return "0%";
  const pct = ratio * 100;
  if (pct < 1) return "<1%";
  return `${trimZero(pct.toFixed(decimals === 0 && pct < 10 ? 1 : decimals))}%`;
}

// packages/core/src/aggregate.ts
var formatterCache = /* @__PURE__ */ new Map();
function resolveTimezone(timeZone) {
  const candidate = timeZone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate });
    return candidate;
  } catch {
    return "UTC";
  }
}
function partsFormatter(timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}
function localParts(ts, timeZone) {
  const parts = partsFormatter(resolveTimezone(timeZone)).formatToParts(new Date(ts));
  const out = { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  for (const part of parts) {
    const value = Number(part.value);
    switch (part.type) {
      case "year":
        out.year = value;
        break;
      case "month":
        out.month = value;
        break;
      case "day":
        out.day = value;
        break;
      case "hour":
        out.hour = value === 24 ? 0 : value;
        break;
      case "minute":
        out.minute = value;
        break;
      case "second":
        out.second = value;
        break;
      default:
        break;
    }
  }
  return out;
}
function dateKey(ts, timeZone) {
  const p = localParts(ts, timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
function localHour(ts, timeZone) {
  return localParts(ts, timeZone).hour;
}
function tzOffsetMs(ts, timeZone) {
  const p = localParts(ts, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ts / 1e3) * 1e3;
}
function startOfLocalDay(ts, timeZone) {
  const p = localParts(ts, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day) - tzOffsetMs(ts, timeZone);
}
function addDays(date, delta) {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const next = new Date(Date.UTC(y, m - 1, d) + delta * 864e5);
  return next.toISOString().slice(0, 10);
}
function dateRangeKeys(end, days) {
  const count = Math.max(1, Math.min(4e3, Math.floor(days)));
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) keys.push(addDays(end, -i));
  return keys;
}
function rangeStartKey(range, today) {
  switch (range) {
    case "today":
      return today;
    case "7d":
      return addDays(today, -6);
    case "30d":
      return addDays(today, -29);
    case "90d":
      return addDays(today, -89);
    case "all":
    default:
      return "0000-01-01";
  }
}
function zeroTokenCounts() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0
  };
}
function zeroTotals() {
  return { ...zeroTokenCounts(), unpricedTokens: 0, costUsd: 0, messages: 0, sessions: 0 };
}
function zeroDailyPoint(date) {
  return { date, ...zeroTokenCounts(), unpricedTokens: 0, costUsd: 0, messages: 0 };
}
function zeroHourPoint(hour) {
  return { hour, totalTokens: 0, costUsd: 0, messages: 0 };
}
function emptyCollectorMeta() {
  return {
    version: "dev",
    uptimeSec: 0,
    dbPath: "",
    watchRoots: [],
    sources: SOURCE_IDS.map((source) => ({
      source,
      enabled: true,
      lastEventAt: null,
      events: 0,
      error: null
    })),
    cloud: {
      enabled: false,
      lastSyncAt: null,
      lastError: null,
      username: null,
      endpoint: null
    }
  };
}
function applyToDaily(point, event) {
  point.inputTokens += event.inputTokens;
  point.outputTokens += event.outputTokens;
  point.cacheReadTokens += event.cacheReadTokens;
  point.cacheWriteTokens += event.cacheWriteTokens;
  point.reasoningTokens += event.reasoningTokens;
  point.totalTokens += event.totalTokens;
  point.messages += 1;
  if (event.costUsd === null) point.unpricedTokens += event.totalTokens;
  else point.costUsd += event.costUsd;
}
function breakdownMap() {
  return /* @__PURE__ */ new Map();
}
function bumpBreakdown(map, key, label, color, event) {
  let row = map.get(key);
  if (!row) {
    row = { key, label, totalTokens: 0, costUsd: 0, messages: 0 };
    if (color) row.color = color;
    map.set(key, row);
  }
  row.totalTokens += event.totalTokens;
  row.messages += 1;
  if (event.costUsd !== null) row.costUsd += event.costUsd;
}
function modelColor(model) {
  const normalized = model.toLowerCase();
  if (normalized.includes("claude")) return "#D97757";
  if (normalized.includes("gpt") || normalized.includes("o3") || normalized.includes("codex")) return "#10A37F";
  if (normalized.includes("deepseek")) return "#4D6BFE";
  if (normalized.includes("glm") || normalized.includes("kimi") || normalized.includes("qwen")) return "#8B5CF6";
  if (normalized.includes("gemini")) return "#4285F4";
  return void 0;
}
function sourceColor(source) {
  return SOURCE_META[source]?.color;
}
function sourceLabel(source) {
  return SOURCE_META[source]?.label ?? source;
}
var DEFAULT_LIVE_WINDOW_MS = 10 * 60 * 1e3;
var DEFAULT_DAILY_DAYS = 14;
function bumpChild(map, key, label, color, cell) {
  let child = map.get(key);
  if (!child) {
    child = { key, label, totalTokens: 0, costUsd: 0, messages: 0 };
    if (color) child.color = color;
    map.set(key, child);
  }
  child.totalTokens += cell.totalTokens;
  child.costUsd += cell.costUsd;
  child.messages += cell.messages;
}
function finalizeChildren(map, parentTokens, limit = 6) {
  return [...map.values()].filter((row) => row.totalTokens > 0).sort((a, b) => b.totalTokens - a.totalTokens).slice(0, limit).map((row) => ({
    key: row.key,
    label: row.label,
    ...row.color ? { color: row.color } : {},
    totalTokens: row.totalTokens,
    costUsd: row.costUsd,
    messages: row.messages,
    share: parentTokens > 0 ? row.totalTokens / parentTokens : 0
  }));
}
function getOrCreateParent(map, key, label, color) {
  let acc = map.get(key);
  if (!acc) {
    acc = {
      key,
      label,
      ...color ? { color } : {},
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      messages: 0,
      models: /* @__PURE__ */ new Map(),
      sources: /* @__PURE__ */ new Map(),
      projects: /* @__PURE__ */ new Map()
    };
    map.set(key, acc);
  }
  return acc;
}
function addCellToParent(parent, cell) {
  parent.inputTokens += cell.inputTokens;
  parent.outputTokens += cell.outputTokens;
  parent.cacheReadTokens += cell.cacheReadTokens;
  parent.cacheWriteTokens += cell.cacheWriteTokens;
  parent.reasoningTokens += cell.reasoningTokens;
  parent.totalTokens += cell.totalTokens;
  parent.costUsd += cell.costUsd;
  parent.messages += cell.messages;
}
function parentToAgg(parent, include) {
  return {
    key: parent.key,
    label: parent.label,
    ...parent.color ? { color: parent.color } : {},
    inputTokens: parent.inputTokens,
    outputTokens: parent.outputTokens,
    cacheReadTokens: parent.cacheReadTokens,
    cacheWriteTokens: parent.cacheWriteTokens,
    reasoningTokens: parent.reasoningTokens,
    totalTokens: parent.totalTokens,
    costUsd: parent.costUsd,
    messages: parent.messages,
    ...include.models ? { models: finalizeChildren(parent.models, parent.totalTokens) } : {},
    ...include.sources ? { sources: finalizeChildren(parent.sources, parent.totalTokens) } : {},
    ...include.projects ? { projects: finalizeChildren(parent.projects, parent.totalTokens) } : {}
  };
}
var EventAggregator = class {
  timezone;
  daily = /* @__PURE__ */ new Map();
  hourlyByDate = /* @__PURE__ */ new Map();
  modelsByDate = /* @__PURE__ */ new Map();
  sourcesByDate = /* @__PURE__ */ new Map();
  projectsByDate = /* @__PURE__ */ new Map();
  cubesByDate = /* @__PURE__ */ new Map();
  sessionsByDate = /* @__PURE__ */ new Map();
  sessions = /* @__PURE__ */ new Map();
  unpricedModels = /* @__PURE__ */ new Map();
  lastEventAt = null;
  eventCount = 0;
  constructor(options = {}) {
    this.timezone = resolveTimezone(options.timezone);
  }
  get size() {
    return this.eventCount;
  }
  reset() {
    this.daily.clear();
    this.hourlyByDate.clear();
    this.modelsByDate.clear();
    this.sourcesByDate.clear();
    this.projectsByDate.clear();
    this.cubesByDate.clear();
    this.sessionsByDate.clear();
    this.sessions.clear();
    this.unpricedModels.clear();
    this.lastEventAt = null;
    this.eventCount = 0;
  }
  add(event) {
    const date = event.date || dateKey(event.ts, this.timezone);
    const hour = Number.isFinite(event.hour) ? Math.min(23, Math.max(0, Math.floor(event.hour))) : localHour(event.ts, this.timezone);
    let point = this.daily.get(date);
    if (!point) {
      point = zeroDailyPoint(date);
      this.daily.set(date, point);
    }
    applyToDaily(point, event);
    let hours = this.hourlyByDate.get(date);
    if (!hours) {
      hours = Array.from({ length: 24 }, (_, h) => zeroHourPoint(h));
      this.hourlyByDate.set(date, hours);
    }
    const bucket = hours[hour];
    if (bucket) {
      bucket.totalTokens += event.totalTokens;
      bucket.messages += 1;
      if (event.costUsd !== null) bucket.costUsd += event.costUsd;
    }
    const modelKey = event.model || "unknown";
    const projectKey = event.project || "unknown";
    this.bump(this.modelsByDate, date, modelKey, modelKey, modelColor(modelKey), event);
    this.bump(
      this.sourcesByDate,
      date,
      event.source,
      sourceLabel(event.source),
      sourceColor(event.source),
      event
    );
    this.bump(this.projectsByDate, date, projectKey, projectKey, void 0, event);
    this.bumpCube(date, modelKey, event.source, projectKey, event);
    let sessionSet = this.sessionsByDate.get(date);
    if (!sessionSet) {
      sessionSet = /* @__PURE__ */ new Set();
      this.sessionsByDate.set(date, sessionSet);
    }
    const sessionKey = `${event.source}:${event.sessionId}`;
    sessionSet.add(sessionKey);
    const existing = this.sessions.get(sessionKey);
    if (existing) {
      const previousUpdatedAt = existing.updatedAt;
      existing.updatedAt = Math.max(previousUpdatedAt, event.ts);
      existing.totalTokens += event.totalTokens;
      existing.messages += 1;
      if (event.ts >= previousUpdatedAt) existing.model = event.model || existing.model;
      if (event.project) existing.project = event.project;
    } else {
      this.sessions.set(sessionKey, {
        source: event.source,
        sessionId: event.sessionId,
        project: event.project || "unknown",
        model: event.model || "unknown",
        updatedAt: event.ts,
        totalTokens: event.totalTokens,
        messages: 1
      });
    }
    if (event.costUsd === null) {
      this.unpricedModels.set(modelKey, (this.unpricedModels.get(modelKey) ?? 0) + event.totalTokens);
    }
    this.lastEventAt = this.lastEventAt === null ? event.ts : Math.max(this.lastEventAt, event.ts);
    this.eventCount += 1;
  }
  addMany(events) {
    for (const event of events) this.add(event);
  }
  bump(store, date, key, label, color, event) {
    let map = store.get(date);
    if (!map) {
      map = breakdownMap();
      store.set(date, map);
    }
    bumpBreakdown(map, key, label, color, event);
  }
  bumpCube(date, model, source, project, event) {
    let dayCube = this.cubesByDate.get(date);
    if (!dayCube) {
      dayCube = /* @__PURE__ */ new Map();
      this.cubesByDate.set(date, dayCube);
    }
    const cellKey = `${model}\0${source}\0${project}`;
    let cell = dayCube.get(cellKey);
    if (!cell) {
      cell = {
        model,
        source,
        project,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        messages: 0
      };
      dayCube.set(cellKey, cell);
    }
    cell.inputTokens += event.inputTokens;
    cell.outputTokens += event.outputTokens;
    cell.cacheReadTokens += event.cacheReadTokens;
    cell.cacheWriteTokens += event.cacheWriteTokens;
    cell.reasoningTokens += event.reasoningTokens;
    cell.totalTokens += event.totalTokens;
    cell.messages += 1;
    if (event.costUsd !== null) cell.costUsd += event.costUsd;
  }
  buildFacetBreakdowns(dates) {
    const modelMap = /* @__PURE__ */ new Map();
    const sourceMap = /* @__PURE__ */ new Map();
    const projectMap = /* @__PURE__ */ new Map();
    for (const date of dates) {
      const dayCube = this.cubesByDate.get(date);
      if (!dayCube) continue;
      for (const cell of dayCube.values()) {
        const mColor = modelColor(cell.model);
        const sLabel = sourceLabel(cell.source);
        const sColor = sourceColor(cell.source);
        const modelParent = getOrCreateParent(modelMap, cell.model, cell.model, mColor);
        addCellToParent(modelParent, cell);
        bumpChild(modelParent.sources, cell.source, sLabel, sColor, cell);
        bumpChild(modelParent.projects, cell.project, cell.project, void 0, cell);
        const sourceParent = getOrCreateParent(sourceMap, cell.source, sLabel, sColor);
        addCellToParent(sourceParent, cell);
        bumpChild(sourceParent.models, cell.model, cell.model, mColor, cell);
        bumpChild(sourceParent.projects, cell.project, cell.project, void 0, cell);
        const projectParent = getOrCreateParent(projectMap, cell.project, cell.project, void 0);
        addCellToParent(projectParent, cell);
        bumpChild(projectParent.models, cell.model, cell.model, mColor, cell);
        bumpChild(projectParent.sources, cell.source, sLabel, sColor, cell);
      }
    }
    return {
      models: [...modelMap.values()].map((p) => parentToAgg(p, { sources: true, projects: true })),
      sources: [...sourceMap.values()].map((p) => parentToAgg(p, { models: true, projects: true })),
      projects: [...projectMap.values()].map((p) => parentToAgg(p, { models: true, sources: true }))
    };
  }
  /** Dates with activity, ascending. */
  activeDates() {
    return [...this.daily.keys()].sort();
  }
  dailyPoints() {
    return this.activeDates().map((date) => this.daily.get(date));
  }
  finalize(options) {
    const now = options.now ?? Date.now();
    const today = dateKey(now, this.timezone);
    const start = rangeStartKey(options.range, today);
    const inRange = this.activeDates().filter((d) => d >= start);
    const rangeSet = new Set(inRange);
    const dailyDays = Math.max(1, Math.min(366, Math.floor(options.dailyDays ?? DEFAULT_DAILY_DAYS)));
    const windowDateSet = new Set(dateRangeKeys(today, dailyDays));
    const sessionUnion = /* @__PURE__ */ new Set();
    for (const date of inRange) {
      const set = this.sessionsByDate.get(date);
      if (set) for (const key of set) sessionUnion.add(key);
    }
    const { models, sources, projects } = this.buildFacetBreakdowns(rangeSet);
    const enrichedDaily = this.dailyPoints().map((point) => {
      if (!windowDateSet.has(point.date)) return point;
      const dayFacets = this.buildFacetBreakdowns([point.date]);
      return {
        ...point,
        models: toBreakdowns(dayFacets.models, point.totalTokens, 8),
        sources: toBreakdowns(dayFacets.sources, point.totalTokens, SOURCE_IDS.length),
        projects: toBreakdowns(dayFacets.projects, point.totalTokens, 8)
      };
    });
    const liveWindow = options.liveWindowMs ?? DEFAULT_LIVE_WINDOW_MS;
    const live = [...this.sessions.values()].filter((session) => now - session.updatedAt <= Math.max(liveWindow, 6 * 60 * 60 * 1e3)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, options.liveLimit ?? 6).map((session) => ({
      source: session.source,
      sessionId: session.sessionId,
      project: session.project,
      model: session.model,
      updatedAt: session.updatedAt,
      totalTokens: session.totalTokens,
      messages: session.messages,
      active: now - session.updatedAt <= liveWindow
    }));
    const unpricedModels = [...this.unpricedModels.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([model]) => model);
    const raw = {
      daily: enrichedDaily,
      models,
      sources,
      projects,
      hourly: this.hourlyByDate.get(today) ?? [],
      live,
      sessions: sessionUnion.size,
      lastEventAt: this.lastEventAt,
      unpricedModels,
      collector: options.collector
    };
    return assembleSummary(raw, {
      range: options.range,
      now,
      timezone: this.timezone,
      dailyDays
    });
  }
  /** Daily rollups for the cloud sync, ascending by date. */
  cloudDays(options = {}) {
    const includeModels = options.includeModels ?? true;
    const dates = this.activeDates();
    const selected = options.maxDays ? dates.slice(-Math.max(1, options.maxDays)) : dates;
    return selected.map((date) => {
      const point = this.daily.get(date);
      const models = this.modelsByDate.get(date);
      const day = {
        date,
        inputTokens: point.inputTokens,
        outputTokens: point.outputTokens,
        cacheReadTokens: point.cacheReadTokens,
        cacheWriteTokens: point.cacheWriteTokens,
        reasoningTokens: point.reasoningTokens,
        totalTokens: point.totalTokens,
        unpricedTokens: point.unpricedTokens,
        costUsd: point.costUsd,
        messages: point.messages
      };
      if (includeModels && models && models.size > 0) {
        const modelMap = {};
        for (const [key, row] of models) modelMap[key] = row.totalTokens;
        day.models = modelMap;
      }
      return day;
    });
  }
};
function mergeCollectorMeta(partial) {
  const base = emptyCollectorMeta();
  if (!partial) return base;
  return {
    ...base,
    ...partial,
    sources: partial.sources ?? base.sources,
    cloud: { ...base.cloud, ...partial.cloud ?? {} },
    watchRoots: partial.watchRoots ?? base.watchRoots
  };
}
function totalsFromDaily(points, sessions) {
  const totals = zeroTotals();
  for (const point of points) {
    totals.inputTokens += point.inputTokens;
    totals.outputTokens += point.outputTokens;
    totals.cacheReadTokens += point.cacheReadTokens;
    totals.cacheWriteTokens += point.cacheWriteTokens;
    totals.reasoningTokens += point.reasoningTokens;
    totals.totalTokens += point.totalTokens;
    totals.unpricedTokens += point.unpricedTokens;
    totals.costUsd += point.costUsd;
    totals.messages += point.messages;
  }
  totals.sessions = sessions;
  return totals;
}
function computeStreak(daily, today) {
  const isActive = (date) => (daily.get(date)?.totalTokens ?? 0) > 0;
  const todayActive = isActive(today);
  const yesterday = addDays(today, -1);
  const anchor = todayActive ? today : isActive(yesterday) ? yesterday : null;
  let current = 0;
  if (anchor) {
    let cursor = anchor;
    while (isActive(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
    }
  }
  let longest = 0;
  let run = 0;
  let previous = null;
  for (const date of [...daily.keys()].sort()) {
    if (!isActive(date)) continue;
    run = previous && addDays(previous, 1) === date ? run + 1 : 1;
    previous = date;
    if (run > longest) longest = run;
  }
  longest = Math.max(longest, current);
  let lastActiveDate = null;
  for (const date of [...daily.keys()].sort()) if (isActive(date)) lastActiveDate = date;
  return { current, longest, todayActive, lastActiveDate };
}
function toBreakdowns(rows, totalTokens, limit) {
  return rows.slice().sort((a, b) => b.totalTokens - a.totalTokens).slice(0, Math.max(1, limit)).map((row) => ({
    key: row.key,
    label: row.label,
    ...row.color ? { color: row.color } : {},
    ...row.inputTokens !== void 0 ? { inputTokens: row.inputTokens } : {},
    ...row.outputTokens !== void 0 ? { outputTokens: row.outputTokens } : {},
    ...row.cacheReadTokens !== void 0 ? { cacheReadTokens: row.cacheReadTokens } : {},
    ...row.cacheWriteTokens !== void 0 ? { cacheWriteTokens: row.cacheWriteTokens } : {},
    ...row.reasoningTokens !== void 0 ? { reasoningTokens: row.reasoningTokens } : {},
    totalTokens: row.totalTokens,
    costUsd: row.costUsd,
    messages: row.messages,
    share: totalTokens > 0 ? row.totalTokens / totalTokens : 0,
    ...row.models ? { models: row.models } : {},
    ...row.sources ? { sources: row.sources } : {},
    ...row.projects ? { projects: row.projects } : {}
  }));
}
function assembleSummary(raw, options) {
  const timezone = resolveTimezone(options.timezone);
  const now = options.now ?? Date.now();
  const today = dateKey(now, timezone);
  const start = rangeStartKey(options.range, today);
  const dailyDays = Math.max(1, Math.min(366, Math.floor(options.dailyDays ?? DEFAULT_DAILY_DAYS)));
  const dailyMap = /* @__PURE__ */ new Map();
  for (const point of raw.daily) dailyMap.set(point.date, point);
  const rangeDays = [...dailyMap.values()].filter((d) => d.date >= start);
  const totals = totalsFromDaily(rangeDays, raw.sessions);
  const todayPoint = dailyMap.get(today) ?? zeroDailyPoint(today);
  const todayTotals = {
    inputTokens: todayPoint.inputTokens,
    outputTokens: todayPoint.outputTokens,
    cacheReadTokens: todayPoint.cacheReadTokens,
    cacheWriteTokens: todayPoint.cacheWriteTokens,
    reasoningTokens: todayPoint.reasoningTokens,
    totalTokens: todayPoint.totalTokens,
    unpricedTokens: todayPoint.unpricedTokens,
    costUsd: todayPoint.costUsd,
    messages: todayPoint.messages,
    sessions: 0
  };
  const daily = dateRangeKeys(today, dailyDays).map(
    (date) => dailyMap.get(date) ?? zeroDailyPoint(date)
  );
  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const found = raw.hourly.find((h) => h.hour === hour);
    return found ?? zeroHourPoint(hour);
  });
  return {
    version: 1,
    generatedAt: now,
    range: options.range,
    timezone,
    totals,
    today: todayTotals,
    streak: computeStreak(dailyMap, today),
    daily,
    hourly,
    models: toBreakdowns(raw.models, totals.totalTokens, 8),
    sources: toBreakdowns(raw.sources, totals.totalTokens, SOURCE_IDS.length),
    projects: toBreakdowns(raw.projects, totals.totalTokens, 8),
    live: raw.live.slice(0, options.liveLimit ?? 6),
    lastEventAt: raw.lastEventAt,
    unpricedModels: raw.unpricedModels.slice(0, 5),
    collector: mergeCollectorMeta(raw.collector)
  };
}
var EMPTY_COLLECTOR = mergeCollectorMeta({ version: "core" });

// packages/core/src/demo.ts
var MODEL_SPECS = [
  {
    source: "claude",
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    weight: 26,
    cacheRead: [1.2, 2.8],
    cacheWrite: [0.15, 0.9],
    output: [180, 1800],
    longOutputChance: 0.12
  },
  {
    source: "claude",
    model: "claude-opus-4-6",
    provider: "anthropic",
    weight: 12,
    cacheRead: [1.5, 3.2],
    cacheWrite: [0.2, 1.1],
    output: [220, 2400],
    longOutputChance: 0.16,
    reasoning: true
  },
  {
    source: "claude",
    model: "claude-haiku-4-6",
    provider: "anthropic",
    weight: 8,
    cacheRead: [0.8, 2],
    cacheWrite: [0.05, 0.4],
    output: [120, 900]
  },
  {
    source: "codex",
    model: "gpt-6.2-astra",
    provider: "openai",
    weight: 20,
    cacheRead: [0.8, 2.2],
    cacheWrite: [0, 0],
    output: [200, 2200],
    longOutputChance: 0.14,
    reasoning: true
  },
  {
    source: "codex",
    model: "gpt-5.2-codex",
    provider: "openai",
    weight: 10,
    cacheRead: [0.6, 1.8],
    cacheWrite: [0, 0],
    output: [160, 1600],
    longOutputChance: 0.1,
    reasoning: true
  },
  {
    source: "dsh",
    model: "deepseek-flash",
    provider: "deepseek-official",
    weight: 12,
    cacheRead: [0.5, 1.6],
    cacheWrite: [0, 0],
    output: [150, 1400],
    longOutputChance: 0.08
  },
  {
    source: "dsh",
    model: "deepseek-v4",
    provider: "deepseek-official",
    weight: 6,
    cacheRead: [0.4, 1.4],
    cacheWrite: [0, 0],
    output: [200, 2e3],
    longOutputChance: 0.12,
    reasoning: true
  },
  {
    source: "opencode",
    model: "glm-4.7-free",
    provider: "opencode",
    weight: 4,
    cacheRead: [0.2, 1],
    cacheWrite: [0, 0],
    output: [150, 1200]
  },
  {
    source: "opencode",
    model: "kimi-k2.5",
    provider: "moonshot",
    weight: 3,
    cacheRead: [0.3, 1.2],
    cacheWrite: [0, 0],
    output: [180, 1500]
  }
];
var PROJECTS = [
  "acme/desktop-app",
  "acme/api-gateway",
  "personal/notes",
  "oss/token-island",
  "work/data-pipeline",
  "scratch/experiments",
  "acme/design-system",
  "personal/dotfiles"
];
var CWD_BY_PROJECT = {
  "acme/desktop-app": "/Users/demo/code/acme/desktop-app",
  "acme/api-gateway": "/Users/demo/code/acme/api-gateway",
  "personal/notes": "/Users/demo/notes",
  "oss/token-island": "/Users/demo/code/token-island",
  "work/data-pipeline": "/Users/demo/work/data-pipeline",
  "scratch/experiments": "/Users/demo/scratch/experiments",
  "acme/design-system": "/Users/demo/code/acme/design-system",
  "personal/dotfiles": "/Users/demo/dotfiles"
};
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function pickWeighted(rand, items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = rand() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}
function between(rand, min, max) {
  return min + rand() * (max - min);
}
function round(value) {
  return Math.max(0, Math.round(value));
}
var HOUR_WEIGHTS = [
  1,
  0.6,
  0.4,
  0.2,
  0.2,
  0.4,
  1,
  2,
  3.5,
  5,
  6,
  6.5,
  4,
  4.5,
  6,
  6.5,
  6,
  5.5,
  4.5,
  4,
  3.5,
  3,
  2.4,
  1.6
];
function pickHour(rand) {
  const total = HOUR_WEIGHTS.reduce((sum, w) => sum + w, 0);
  let roll = rand() * total;
  for (let hour = 0; hour < 24; hour += 1) {
    roll -= HOUR_WEIGHTS[hour];
    if (roll <= 0) return hour;
  }
  return 22;
}
function buildEvent(rand, params) {
  const { spec } = params;
  const baseInput = 900 + Math.pow(rand(), 1.7) * 34e3;
  const inputTokens = round(baseInput);
  const cacheFactor = between(rand, spec.cacheRead[0], spec.cacheRead[1]);
  const cacheReadTokens = rand() < 0.08 ? 0 : round(inputTokens * cacheFactor);
  const cacheWriteTokens = spec.cacheWrite ? rand() < 0.35 ? round(inputTokens * between(rand, spec.cacheWrite[0], spec.cacheWrite[1])) : 0 : 0;
  const long = rand() < (spec.longOutputChance ?? 0);
  const outputTokens = round(
    long ? between(rand, 4200, 12e3) : between(rand, spec.output[0], spec.output[1])
  );
  const reasoningTokens = spec.reasoning ? round(outputTokens * between(rand, 0.15, 0.75)) : 0;
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const localDate = dateKey(params.ts, params.timezone);
  const hour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: params.timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date(params.ts)));
  return {
    id: `demo:${spec.source}:${params.sessionId}:${params.index}`,
    source: spec.source,
    sessionId: params.sessionId,
    messageId: `demo-msg-${params.sessionId}-${params.index}`,
    ts: params.ts,
    date: localDate,
    hour,
    model: spec.model,
    provider: spec.provider,
    agent: params.agent,
    project: params.project,
    cwd: CWD_BY_PROJECT[params.project] ?? `/Users/demo/code/${params.project}`,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
    costUsd: estimateCostUsd(
      { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
      spec.model,
      spec.provider
    )
  };
}
function generateDemoEvents(options = {}) {
  const now = options.now ?? Date.now();
  const timezone = resolveTimezone(options.timezone);
  const days = Math.max(1, Math.min(365, Math.floor(options.days ?? 120)));
  const seed = options.seed ?? 42;
  const liveSessions = Math.max(0, Math.min(3, options.liveSessions ?? 2));
  const rand = mulberry32(seed);
  const events = [];
  const todayKey = dateKey(now, timezone);
  const todayStart = startOfLocalDay(now, timezone);
  const todayKeyFromNow = todayKey;
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const dayStart = startOfLocalDay(todayStart - offset * 864e5 + 12 * 36e5, timezone);
    const dayKey = dateKey(dayStart + 12 * 36e5, timezone);
    const isToday = dayKey === todayKeyFromNow;
    const weekday = new Date(dayStart + 12 * 36e5).getDay();
    const weekend = weekday === 0 || weekday === 6;
    const recent = offset <= 5;
    const activeProbability = isToday ? 1 : recent ? 1 : weekend ? 0.55 : 0.82;
    if (!isToday && offset > 5 && rand() > activeProbability) continue;
    const sessionCount = 2 + Math.floor(rand() * (weekend ? 3 : 5));
    for (let s = 0; s < sessionCount; s += 1) {
      const project = PROJECTS[Math.floor(rand() * PROJECTS.length)];
      const sessionId = `demo-${dayKey}-${s}-${Math.floor(rand() * 1e6).toString(36)}`;
      const eventCount = 3 + Math.floor(rand() * 13);
      for (let e = 0; e < eventCount; e += 1) {
        const spec = pickWeighted(rand, MODEL_SPECS);
        let ts;
        if (isToday) {
          const elapsed = Math.max(1, now - todayStart);
          const skew = Math.pow(rand(), 1.6);
          ts = todayStart + Math.floor(elapsed * skew);
        } else {
          const hour = pickHour(rand);
          const minute = Math.floor(rand() * 60);
          const second = Math.floor(rand() * 60);
          ts = dayStart + hour * 36e5 + minute * 6e4 + second * 1e3;
        }
        if (ts > now) ts = now - Math.floor(rand() * 6e4);
        events.push(
          buildEvent(rand, {
            ts,
            timezone,
            sessionId,
            project,
            spec,
            index: e,
            agent: rand() < 0.16 ? "subagent" : "main"
          })
        );
      }
    }
  }
  const recentPool = events.filter((event) => event.date === todayKey);
  if (liveSessions > 0 && recentPool.length > 0) {
    for (let i = 0; i < liveSessions; i += 1) {
      const candidate = recentPool[recentPool.length - 1 - i];
      if (!candidate) continue;
      candidate.ts = now - (2e4 + i * 45e3 + Math.floor(rand() * 2e4));
      candidate.date = dateKey(candidate.ts, timezone);
    }
    events.sort((a, b) => a.ts - b.ts);
  }
  return events;
}

// packages/core/src/pixel.ts
var PIXEL = {
  /** Page / wallpaper background. */
  bg: "#0b0b12",
  /** Slightly lifted background for striped sections. */
  bgRaised: "#10101b",
  /** Panel fill. */
  surface: "#14121d",
  /** Secondary panel / inset well. */
  surfaceAlt: "#1b1928",
  /** Deep inset (track background). */
  inset: "#090910",
  /** Default 2px border. */
  border: "#332d4a",
  /** Highlight border on the top/left edge of raised panels. */
  borderHi: "#57507a",
  /** Primary ink. */
  ink: "#f4f2ff",
  /** Secondary ink. */
  inkDim: "#a39fc4",
  /** Tertiary ink / axis labels. */
  inkFaint: "#6b6689",
  /** Brand / success / live. */
  teal: "#3be8b0",
  /** Cache / secondary data. */
  blue: "#5b9dff",
  /** Output / tertiary data. */
  purple: "#b388ff",
  /** Warning / streak. */
  amber: "#ffc857",
  /** Error. */
  red: "#ff6b6b",
  /** Positive trend. */
  green: "#7dff9b",
  /** Silkscreen accent for "today" highlights. */
  mint: "#8fffe0"
};
var PIXEL_SERIES = [
  PIXEL.teal,
  PIXEL.purple,
  PIXEL.blue,
  PIXEL.amber,
  PIXEL.green,
  PIXEL.red,
  PIXEL.mint,
  PIXEL.inkDim
];

// apps/collector/src/config.ts
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
var DEFAULT_PORT = 47118;
var DEMO_PORT = 47119;
var DEFAULT_BACKFILL_DAYS = 30;
var DEFAULT_SCAN_INTERVAL_MS = 2e3;
var DEFAULT_LIVE_WINDOW_MS2 = 6e5;
function clampInt(value, fallback, min, max) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
function expandPath(value, homeDir) {
  const trimmed = value.trim();
  if (trimmed.length === 0) return homeDir;
  if (trimmed === "~") return homeDir;
  if (trimmed.startsWith("~/")) return path.join(homeDir, trimmed.slice(2));
  if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
  return path.resolve(homeDir, trimmed);
}
function resolveStateHome(env, homeDir) {
  const override = typeof env.TOKEN_ISLAND_HOME === "string" ? env.TOKEN_ISLAND_HOME.trim() : "";
  if (override.length > 0) return expandPath(override, homeDir);
  return path.join(homeDir, ".token-island");
}
function parsePort(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
  return parsed;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizePrices(value) {
  if (!Array.isArray(value)) return [];
  const prices = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const match = typeof entry.match === "string" ? entry.match.trim() : "";
    const input = Number(entry.input);
    const output = Number(entry.output);
    if (!match || !Number.isFinite(input) || !Number.isFinite(output)) continue;
    const override = { match, input, output };
    const cacheRead = Number(entry.cacheRead);
    if (Number.isFinite(cacheRead)) override.cacheRead = cacheRead;
    const cacheWrite = Number(entry.cacheWrite);
    if (Number.isFinite(cacheWrite)) override.cacheWrite = cacheWrite;
    if (typeof entry.note === "string") override.note = entry.note;
    prices.push(override);
  }
  return prices;
}
function normalizeCloudConfig(value) {
  const raw = isRecord(value) ? value : {};
  return {
    enabled: raw.enabled === true,
    url: typeof raw.url === "string" ? raw.url.trim() : "",
    username: typeof raw.username === "string" ? raw.username : "",
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    autoSync: raw.autoSync !== false,
    intervalMinutes: clampInt(raw.intervalMinutes, 15, 1, 1440)
  };
}
function readRawConfigFile(configPath) {
  let text;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (error) {
    const code = error.code;
    if (code === "ENOENT") return { raw: {}, error: null };
    return { raw: {}, error: `cannot read config: ${error.message}` };
  }
  try {
    const parsed = JSON.parse(text);
    if (!isRecord(parsed)) return { raw: {}, error: "config is not a JSON object" };
    return { raw: parsed, error: null };
  } catch (error) {
    return { raw: {}, error: `invalid config JSON: ${error.message}` };
  }
}
function readCloudSettings(configPath) {
  const { raw, error } = readRawConfigFile(configPath);
  return { cloud: normalizeCloudConfig(raw.cloud), error };
}
function loadConfig(options = {}) {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const home = resolveStateHome(env, homeDir);
  const configPath = path.join(home, "config.json");
  const { raw, error } = readRawConfigFile(configPath);
  const envPort = parsePort(env.TOKEN_ISLAND_PORT);
  const filePort = parsePort(raw.port);
  const port = envPort ?? filePort ?? DEFAULT_PORT;
  const demoPort = parsePort(env.TOKEN_ISLAND_DEMO_PORT) ?? parsePort(raw.demoPort) ?? DEMO_PORT;
  const timezoneSetting = typeof raw.timezone === "string" && raw.timezone.trim().length > 0 ? raw.timezone.trim() : "auto";
  const timezone = resolveTimezone(timezoneSetting === "auto" ? void 0 : timezoneSetting);
  const defaultPaths = {
    claude: path.join(homeDir, ".claude"),
    codex: path.join(homeDir, ".codex"),
    opencode: path.join(homeDir, ".local", "share", "opencode"),
    dsh: path.join(homeDir, ".dsh")
  };
  const filePaths = isRecord(raw.paths) ? raw.paths : {};
  const paths = {
    claude: expandPath(filePaths.claude ?? defaultPaths.claude, homeDir),
    codex: expandPath(filePaths.codex ?? defaultPaths.codex, homeDir),
    opencode: expandPath(filePaths.opencode ?? defaultPaths.opencode, homeDir),
    dsh: expandPath(filePaths.dsh ?? defaultPaths.dsh, homeDir)
  };
  const fileSources = isRecord(raw.sources) ? raw.sources : {};
  const sources = {
    claude: fileSources.claude !== false,
    codex: fileSources.codex !== false,
    opencode: fileSources.opencode !== false,
    dsh: fileSources.dsh !== false,
    gemini: fileSources.gemini === true
  };
  return {
    home,
    configPath,
    dbPath: path.join(home, "data.db"),
    demoDbPath: path.join(home, "demo.db"),
    port,
    demoPort,
    timezoneSetting,
    timezone,
    backfillDays: clampInt(raw.backfillDays, DEFAULT_BACKFILL_DAYS, 1, 3650),
    scanIntervalMs: clampInt(raw.scanIntervalMs, DEFAULT_SCAN_INTERVAL_MS, 250, 36e5),
    liveWindowMs: clampInt(raw.liveWindowMs, DEFAULT_LIVE_WINDOW_MS2, 6e4, 864e5),
    sources,
    paths,
    prices: normalizePrices(raw.prices),
    cloud: normalizeCloudConfig(raw.cloud),
    raw,
    configError: error
  };
}

// apps/collector/src/db.ts
import { mkdirSync, rmSync } from "node:fs";
import path2 from "node:path";
import { DatabaseSync } from "node:sqlite";
var SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,
  date TEXT NOT NULL,
  hour INTEGER NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  agent TEXT NOT NULL DEFAULT 'main',
  project TEXT NOT NULL DEFAULT '',
  cwd TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  ingested_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(source, session_id);
CREATE TABLE IF NOT EXISTS file_state (
  path TEXT PRIMARY KEY, offset INTEGER NOT NULL DEFAULT 0,
  mtime_ms INTEGER NOT NULL DEFAULT 0, size INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
var INSERT_EVENT = `
INSERT INTO events (
  id, source, session_id, message_id, ts, date, hour, model, provider, agent, project, cwd,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
  total_tokens, cost_usd, ingested_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO NOTHING
`;
function toNumber(value, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function rowToEvent(row) {
  return {
    id: String(row.id),
    source: row.source,
    sessionId: String(row.session_id),
    messageId: String(row.message_id ?? ""),
    ts: toNumber(row.ts),
    date: String(row.date),
    hour: toNumber(row.hour),
    model: String(row.model ?? ""),
    provider: String(row.provider ?? ""),
    agent: String(row.agent ?? "main"),
    project: String(row.project ?? ""),
    cwd: String(row.cwd ?? ""),
    inputTokens: toNumber(row.input_tokens),
    outputTokens: toNumber(row.output_tokens),
    cacheReadTokens: toNumber(row.cache_read_tokens),
    cacheWriteTokens: toNumber(row.cache_write_tokens),
    reasoningTokens: toNumber(row.reasoning_tokens),
    totalTokens: toNumber(row.total_tokens),
    costUsd: row.cost_usd === null || row.cost_usd === void 0 ? null : toNumber(row.cost_usd)
  };
}
var Store = class {
  path;
  db;
  closed = false;
  constructor(dbPath) {
    this.path = dbPath;
    if (dbPath !== ":memory:") mkdirSync(path2.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);
  }
  /**
   * Inserts a batch of events in a single transaction.  Returns only the
   * events that were actually written so the in-memory aggregator stays exact.
   */
  insertEvents(events) {
    if (events.length === 0) return { inserted: [], duplicates: 0 };
    const inserted = [];
    let duplicates = 0;
    const statement = this.db.prepare(INSERT_EVENT);
    this.db.exec("BEGIN");
    try {
      const ingestedAt = Date.now();
      for (const event of events) {
        const result = statement.run(
          event.id,
          event.source,
          event.sessionId,
          event.messageId,
          event.ts,
          event.date,
          event.hour,
          event.model,
          event.provider,
          event.agent,
          event.project,
          event.cwd,
          event.inputTokens,
          event.outputTokens,
          event.cacheReadTokens,
          event.cacheWriteTokens,
          event.reasoningTokens,
          event.totalTokens,
          event.costUsd,
          ingestedAt
        );
        if (Number(result.changes) > 0) inserted.push(event);
        else duplicates += 1;
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
      }
      throw error;
    }
    return { inserted, duplicates };
  }
  getFileState(filePath) {
    const row = this.db.prepare("SELECT offset, mtime_ms, size FROM file_state WHERE path = ?").get(filePath);
    if (!row) return null;
    return { offset: toNumber(row.offset), mtimeMs: toNumber(row.mtime_ms), size: toNumber(row.size) };
  }
  setFileState(filePath, state) {
    this.db.prepare(
      `INSERT INTO file_state (path, offset, mtime_ms, size, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           offset = excluded.offset, mtime_ms = excluded.mtime_ms,
           size = excluded.size, updated_at = excluded.updated_at`
    ).run(
      filePath,
      Math.max(0, Math.floor(state.offset)),
      Math.max(0, Math.floor(state.mtimeMs)),
      Math.max(0, Math.floor(state.size)),
      Date.now()
    );
  }
  getKv(key) {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
    return row && row.value !== void 0 && row.value !== null ? String(row.value) : null;
  }
  setKv(key, value) {
    this.db.prepare(
      `INSERT INTO kv (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, value);
  }
  deleteKv(key) {
    this.db.prepare("DELETE FROM kv WHERE key = ?").run(key);
  }
  /** Streams all persisted events in time order (used to warm the aggregator on boot). */
  *iterateEvents() {
    const statement = this.db.prepare("SELECT * FROM events ORDER BY ts");
    for (const row of statement.iterate()) {
      yield rowToEvent(row);
    }
  }
  countEvents() {
    const row = this.db.prepare("SELECT COUNT(*) AS events FROM events").get();
    return toNumber(row?.events);
  }
  lastEventAt() {
    const row = this.db.prepare("SELECT MAX(ts) AS last_event_at FROM events").get();
    const value = row?.last_event_at;
    return value === null || value === void 0 ? null : toNumber(value);
  }
  sourceEventStats() {
    const rows = this.db.prepare("SELECT source, COUNT(*) AS events, MAX(ts) AS last_event_at FROM events GROUP BY source").all();
    const stats = /* @__PURE__ */ new Map();
    for (const row of rows) {
      if (typeof row.source !== "string") continue;
      stats.set(row.source, {
        events: toNumber(row.events),
        lastEventAt: row.last_event_at === null || row.last_event_at === void 0 ? null : toNumber(row.last_event_at)
      });
    }
    return stats;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
  /** Best-effort deletion of the SQLite database and its WAL side files (`--reset`). */
  static removeDatabaseFiles(dbPath) {
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        rmSync(`${dbPath}${suffix}`, { force: true });
      } catch {
      }
    }
  }
};

// apps/collector/src/scanner.ts
import { existsSync as existsSync2, promises as fs } from "node:fs";
import path8 from "node:path";

// apps/collector/src/sources/index.ts
import path7 from "node:path";

// apps/collector/src/sources/claude.ts
import path4 from "node:path";

// apps/collector/src/stream.ts
import { createReadStream } from "node:fs";
var NEWLINE = 10;
var DEFAULT_CHUNK_SIZE = 1 << 20;
async function readLinesFromOffset(filePath, options) {
  const start = Math.max(0, Math.floor(options.start));
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  let offset = start;
  let stopped = false;
  const pending = [];
  const stream = createReadStream(filePath, { start, highWaterMark: DEFAULT_CHUNK_SIZE });
  try {
    for await (const chunk of stream) {
      const data = chunk;
      let cursor = 0;
      while (true) {
        const newline = data.indexOf(NEWLINE, cursor);
        if (newline === -1) {
          if (cursor < data.length) pending.push(data.subarray(cursor));
          break;
        }
        let line;
        if (pending.length > 0) {
          pending.push(data.subarray(cursor, newline));
          line = Buffer.concat(pending);
          pending.length = 0;
        } else {
          line = data.subarray(cursor, newline);
        }
        offset += line.length + 1;
        options.onLine(line, offset);
        cursor = newline + 1;
        if (offset - start >= maxBytes) {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }
  } finally {
    stream.destroy();
  }
  const size = options.sizeHint;
  const more = stopped && (size === void 0 ? true : offset < size);
  return { nextOffset: offset, more, bytesRead: offset - start };
}

// apps/collector/src/sources/util.ts
import path3 from "node:path";
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonNegativeInt(value) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}
function stringValue(value) {
  return typeof value === "string" ? value : "";
}
function parseTimestamp(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function sumTokens(counts) {
  return nonNegativeInt(counts.inputTokens) + nonNegativeInt(counts.outputTokens) + nonNegativeInt(counts.cacheReadTokens) + nonNegativeInt(counts.cacheWriteTokens);
}
function projectFromCwd(cwd) {
  const trimmed = cwd.trim();
  if (trimmed.length === 0) return "unknown";
  const base = path3.basename(trimmed);
  return base.length > 0 && base !== "." ? base : "unknown";
}
function buildUsageEvent(input, ctx) {
  const inputTokens = nonNegativeInt(input.counts.inputTokens);
  const outputTokens = nonNegativeInt(input.counts.outputTokens);
  const cacheReadTokens = nonNegativeInt(input.counts.cacheReadTokens);
  const cacheWriteTokens = nonNegativeInt(input.counts.cacheWriteTokens);
  const reasoningTokens = nonNegativeInt(input.counts.reasoningTokens);
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const cwd = stringValue(input.cwd).trim();
  const model = input.model.length > 0 ? input.model : "unknown";
  const provider = input.provider ?? "";
  const costUsd = estimateCostUsd(
    { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
    model,
    provider,
    ctx.prices
  );
  return {
    id: input.id,
    source: input.source,
    sessionId: input.sessionId,
    messageId: input.messageId ?? "",
    ts: input.ts,
    date: dateKey(input.ts, ctx.timezone),
    hour: localHour(input.ts, ctx.timezone),
    model,
    provider,
    agent: input.agent && input.agent.length > 0 ? input.agent : "main",
    project: projectFromCwd(cwd),
    cwd,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
    costUsd
  };
}
function startOffsetFor(file, prior) {
  if (!prior) return 0;
  if (file.size < prior.offset) return 0;
  return Math.max(0, prior.offset);
}

// apps/collector/src/sources/claude.ts
var ASSISTANT_MARKER = Buffer.from('"type":"assistant"');
var ASSISTANT_MARKER_PRETTY = Buffer.from('"type": "assistant"');
var SYNTHETIC_MODEL = "<synthetic>";
function looksLikeAssistantLine(line) {
  return line.indexOf(ASSISTANT_MARKER) !== -1 || line.indexOf(ASSISTANT_MARKER_PRETTY) !== -1;
}
function parseClaudeLine(line, filePath, offsetAfter, ctx) {
  let parsed;
  try {
    parsed = JSON.parse(line.toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord2(parsed) || parsed.type !== "assistant") return null;
  const message = isRecord2(parsed.message) ? parsed.message : null;
  const usage = message && isRecord2(message.usage) ? message.usage : null;
  if (!message || !usage) return null;
  const model = stringValue(message.model).trim();
  if (model.length === 0 || model === SYNTHETIC_MODEL) return null;
  const counts = {
    inputTokens: nonNegativeInt(usage.input_tokens),
    outputTokens: nonNegativeInt(usage.output_tokens),
    cacheReadTokens: nonNegativeInt(usage.cache_read_input_tokens),
    cacheWriteTokens: nonNegativeInt(usage.cache_creation_input_tokens)
  };
  if (sumTokens(counts) <= 0) return null;
  const details = isRecord2(usage.output_tokens_details) ? usage.output_tokens_details : null;
  const ts = parseTimestamp(parsed.timestamp);
  if (ts === null) return null;
  const fileName = path4.basename(filePath);
  const sessionId = stringValue(parsed.sessionId).trim() || path4.basename(filePath, path4.extname(filePath));
  const messageId = stringValue(message.id).trim();
  const id = messageId.length > 0 ? `claude:${messageId}` : `claude:${fileName}:${offsetAfter}`;
  return buildUsageEvent(
    {
      id,
      source: "claude",
      sessionId,
      messageId,
      ts,
      model,
      provider: "anthropic",
      agent: parsed.isSidechain === true ? "subagent" : "main",
      cwd: stringValue(parsed.cwd),
      counts: {
        ...counts,
        reasoningTokens: details ? nonNegativeInt(details.thinking_tokens) : 0
      }
    },
    ctx
  );
}
async function scanClaudeFile(input) {
  const { file, ctx } = input;
  const events = [];
  const seen = /* @__PURE__ */ new Set();
  const read = await readLinesFromOffset(file.path, {
    start: startOffsetFor(file, input.prior),
    maxBytes: input.maxBytes,
    sizeHint: file.size,
    onLine: (line, nextOffset) => {
      if (!looksLikeAssistantLine(line)) return;
      const event = parseClaudeLine(line, file.path, nextOffset, ctx);
      if (!event) return;
      if (seen.has(event.id)) return;
      seen.add(event.id);
      events.push(event);
    }
  });
  return {
    events,
    offset: read.nextOffset,
    size: file.size,
    mtimeMs: file.mtimeMs,
    more: read.more
  };
}
var claudeSource = {
  id: "claude",
  mode: "append",
  watchDir: (root) => path4.join(root, "projects"),
  match: (fileName) => fileName.endsWith(".jsonl"),
  parseFile: scanClaudeFile
};

// apps/collector/src/sources/codex.ts
import path5 from "node:path";
var SESSION_META_MARKER = Buffer.from('"session_meta"');
var TURN_CONTEXT_MARKER = Buffer.from('"turn_context"');
var TOKEN_COUNT_MARKER = Buffer.from('"token_count"');
var UUID_FILE_PATTERN = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
function emptyState() {
  return {
    version: 1,
    sessionId: "",
    cwd: "",
    model: "",
    provider: "",
    agent: "main",
    hasSessionMeta: false,
    lastTotal: null
  };
}
function readRawUsage(value) {
  return {
    input_tokens: nonNegativeInt(value.input_tokens),
    cached_input_tokens: nonNegativeInt(value.cached_input_tokens),
    cache_write_input_tokens: nonNegativeInt(value.cache_write_input_tokens),
    output_tokens: nonNegativeInt(value.output_tokens),
    reasoning_output_tokens: nonNegativeInt(value.reasoning_output_tokens),
    total_tokens: nonNegativeInt(value.total_tokens)
  };
}
function subtractUsage(total, previous) {
  return {
    input_tokens: Math.max(0, total.input_tokens - previous.input_tokens),
    cached_input_tokens: Math.max(0, total.cached_input_tokens - previous.cached_input_tokens),
    cache_write_input_tokens: Math.max(0, total.cache_write_input_tokens - previous.cache_write_input_tokens),
    output_tokens: Math.max(0, total.output_tokens - previous.output_tokens),
    reasoning_output_tokens: Math.max(0, total.reasoning_output_tokens - previous.reasoning_output_tokens),
    total_tokens: Math.max(0, total.total_tokens - previous.total_tokens)
  };
}
function normalizeUsage(raw) {
  return {
    inputTokens: Math.max(0, raw.input_tokens - raw.cached_input_tokens),
    outputTokens: raw.output_tokens,
    cacheReadTokens: raw.cached_input_tokens,
    cacheWriteTokens: raw.cache_write_input_tokens,
    reasoningTokens: raw.reasoning_output_tokens
  };
}
function fileUuid(filePath) {
  const match = UUID_FILE_PATTERN.exec(path5.basename(filePath));
  return match && match[1] ? match[1] : path5.basename(filePath, ".jsonl");
}
function loadParserState(raw) {
  if (!raw) return emptyState();
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord2(parsed)) return emptyState();
    const state = emptyState();
    state.sessionId = stringValue(parsed.sessionId);
    state.cwd = stringValue(parsed.cwd);
    state.model = stringValue(parsed.model);
    state.provider = stringValue(parsed.provider);
    state.agent = stringValue(parsed.agent) || "main";
    state.hasSessionMeta = parsed.hasSessionMeta === true;
    if (isRecord2(parsed.lastTotal)) state.lastTotal = readRawUsage(parsed.lastTotal);
    return state;
  } catch {
    return emptyState();
  }
}
function isSubagentSource(payload) {
  const source = payload.source;
  if (isRecord2(source)) {
    if (source.subagent !== void 0 && source.subagent !== null) {
      return source.subagent !== false;
    }
    return false;
  }
  if (typeof source === "string") return source === "subagent";
  return stringValue(payload.thread_source) === "subagent";
}
function applySessionMeta(state, payload, filePath) {
  if (state.hasSessionMeta) return;
  state.hasSessionMeta = true;
  const sessionId = stringValue(payload.session_id).trim();
  const ownId = stringValue(payload.id).trim();
  const subagent = isSubagentSource(payload);
  state.sessionId = subagent ? ownId || sessionId || fileUuid(filePath) : sessionId || ownId || fileUuid(filePath);
  const agentRole = stringValue(payload.agent_role).trim();
  state.agent = subagent ? agentRole || "subagent" : "main";
  const cwd = stringValue(payload.cwd);
  if (cwd) state.cwd = cwd;
  const provider = stringValue(payload.model_provider);
  if (provider) state.provider = provider;
  const model = stringValue(payload.model);
  if (model) state.model = model;
}
function applyTurnContext(state, payload) {
  const model = stringValue(payload.model).trim();
  if (model) state.model = model;
  const cwd = stringValue(payload.cwd);
  if (cwd) state.cwd = cwd;
  const agentRole = stringValue(payload.agent_role).trim();
  if (agentRole) state.agent = agentRole;
}
function handleLine(line, state, filePath, offsetAfter, ctx, events) {
  const hasMeta = line.indexOf(SESSION_META_MARKER) !== -1;
  const hasTurn = !hasMeta && line.indexOf(TURN_CONTEXT_MARKER) !== -1;
  const hasTokenCount = !hasMeta && !hasTurn && line.indexOf(TOKEN_COUNT_MARKER) !== -1;
  if (!hasMeta && !hasTurn && !hasTokenCount) return;
  let parsed;
  try {
    parsed = JSON.parse(line.toString("utf8"));
  } catch {
    return;
  }
  if (!isRecord2(parsed)) return;
  const payload = isRecord2(parsed.payload) ? parsed.payload : null;
  if (!payload) return;
  const type = stringValue(parsed.type);
  if (hasMeta && type === "session_meta") {
    applySessionMeta(state, payload, filePath);
    return;
  }
  if (hasTurn && type === "turn_context") {
    applyTurnContext(state, payload);
    return;
  }
  if (!hasTokenCount || type !== "event_msg" || payload.type !== "token_count") return;
  const info = isRecord2(payload.info) ? payload.info : null;
  if (!info) return;
  const lastUsage = isRecord2(info.last_token_usage) ? info.last_token_usage : null;
  const totalUsage = isRecord2(info.total_token_usage) ? info.total_token_usage : null;
  const totalRaw = totalUsage ? readRawUsage(totalUsage) : null;
  let raw = lastUsage ? readRawUsage(lastUsage) : null;
  if (!raw && totalRaw) {
    raw = state.lastTotal ? subtractUsage(totalRaw, state.lastTotal) : totalRaw;
  }
  if (totalRaw) state.lastTotal = totalRaw;
  if (!raw) return;
  const counts = normalizeUsage(raw);
  if (sumTokens(counts) <= 0) return;
  const ts = parseTimestamp(parsed.timestamp);
  if (ts === null) return;
  const ordinal = Number(parsed.ordinal);
  const ordinalKey = Number.isFinite(ordinal) ? String(Math.floor(ordinal)) : `offset${offsetAfter}`;
  const sessionId = state.sessionId || fileUuid(filePath);
  events.push(
    buildUsageEvent(
      {
        id: `codex:${sessionId}:${ordinalKey}`,
        source: "codex",
        sessionId,
        ts,
        model: state.model || "unknown",
        provider: state.provider,
        agent: state.agent,
        cwd: state.cwd,
        counts
      },
      ctx
    )
  );
}
async function scanCodexFile(input) {
  const { file, ctx } = input;
  const state = loadParserState(input.priorParserState);
  const events = [];
  const seen = /* @__PURE__ */ new Set();
  const read = await readLinesFromOffset(file.path, {
    start: startOffsetFor(file, input.prior),
    maxBytes: input.maxBytes,
    sizeHint: file.size,
    onLine: (line, nextOffset) => {
      const before = events.length;
      handleLine(line, state, file.path, nextOffset, ctx, events);
      if (events.length === before) return;
      const event = events[events.length - 1];
      if (!event) return;
      if (seen.has(event.id)) events.pop();
      else seen.add(event.id);
    }
  });
  return {
    events,
    offset: read.nextOffset,
    size: file.size,
    mtimeMs: file.mtimeMs,
    more: read.more,
    parserState: JSON.stringify(state)
  };
}
var codexSource = {
  id: "codex",
  mode: "append",
  watchDir: (root) => path5.join(root, "sessions"),
  match: (fileName) => fileName.startsWith("rollout-") && fileName.endsWith(".jsonl"),
  parseFile: scanCodexFile
};

// apps/collector/src/sources/dsh.ts
import path6 from "node:path";

// apps/collector/src/zstd.ts
import { spawn } from "node:child_process";
import { existsSync, readFileSync as readFileSync2 } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
var ZstdUnavailableError = class extends Error {
  constructor() {
    super("zstd binary not found");
    this.name = "ZstdUnavailableError";
  }
};
var DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
var DEFAULT_TIMEOUT_MS = 12e4;
function zstdCandidates() {
  const candidates = [];
  const override = process.env.TOKEN_ISLAND_ZSTD;
  if (typeof override === "string" && override.trim().length > 0) candidates.push(override.trim());
  for (const candidate of ["/opt/homebrew/bin/zstd", "/usr/local/bin/zstd", "/usr/bin/zstd"]) {
    if (existsSync(candidate)) candidates.push(candidate);
  }
  candidates.push("zstd");
  return candidates;
}
var resolvedBinary = null;
function runZstd(binary, filePath, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const chunks = [];
    const stderr = [];
    let total = 0;
    const child = spawn(binary, ["-dc", "--quiet", filePath], { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`zstd timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref();
    function finish(error, data) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(data ?? Buffer.alloc(0));
    }
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        child.kill("SIGKILL");
        finish(new Error(`decompressed output exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16) stderr.push(chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      if (error.code === "ENOENT") finish(new ZstdUnavailableError());
      else finish(error);
    });
    child.on("close", (code) => {
      const data = Buffer.concat(chunks);
      if (code === 0 || data.length > 0) {
        finish(null, data);
        return;
      }
      finish(new Error(`zstd exited with code ${code}: ${stderr.join("").trim().slice(0, 300)}`));
    });
  });
}
async function spawnZstd(filePath, maxBytes, timeoutMs) {
  const candidates = resolvedBinary ? [resolvedBinary] : zstdCandidates();
  let unavailable = null;
  for (const candidate of candidates) {
    try {
      const data = await runZstd(candidate, filePath, maxBytes, timeoutMs);
      resolvedBinary = candidate;
      return data;
    } catch (error) {
      if (error instanceof ZstdUnavailableError) {
        unavailable = error;
        continue;
      }
      throw error;
    }
  }
  throw unavailable ?? new ZstdUnavailableError();
}
function fallbackDecompress(filePath) {
  return zstdDecompressSync(readFileSync2(filePath));
}
async function decompressZstdFile(filePath, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const data = await spawnZstd(filePath, maxBytes, timeoutMs);
    return { data, fallback: false };
  } catch (error) {
    if (error instanceof ZstdUnavailableError) {
      return { data: fallbackDecompress(filePath), fallback: true };
    }
    throw error;
  }
}

// apps/collector/src/sources/dsh.ts
var DSH_SESSION_FILE = "session.v4.jsonl.zstd";
function parseDshLines(text, fallbackSessionId, ctx) {
  const events = [];
  const seen = /* @__PURE__ */ new Set();
  const header = { sessionId: fallbackSessionId, cwd: "", agentPreset: "" };
  let model = "";
  let provider = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord2(parsed)) continue;
    const type = stringValue(parsed.type);
    if (type === "session") {
      const id = stringValue(parsed.id).trim();
      if (id.length > 0) header.sessionId = id;
      const cwd = stringValue(parsed.cwd);
      if (cwd.length > 0) header.cwd = cwd;
      const preset = stringValue(parsed.agentPreset);
      if (preset.length > 0) header.agentPreset = preset;
      continue;
    }
    if (type === "model/selection") {
      const data2 = isRecord2(parsed.data) ? parsed.data : null;
      if (!data2) continue;
      const dataProvider = stringValue(data2.provider).trim();
      const dataModel = stringValue(data2.model).trim();
      if (dataProvider.length > 0) provider = dataProvider;
      if (dataModel.length > 0) model = dataModel;
      continue;
    }
    if (type === "request/header") {
      const data2 = isRecord2(parsed.data) ? parsed.data : null;
      const headerData = data2 && isRecord2(data2.header) ? data2.header : null;
      const config = headerData && isRecord2(headerData.config) ? headerData.config : null;
      if (!config) continue;
      if (provider.length === 0) provider = stringValue(config.provider).trim();
      if (model.length === 0) model = stringValue(config.model).trim();
      continue;
    }
    if (type !== "assistant/message") continue;
    const data = isRecord2(parsed.data) ? parsed.data : null;
    const usage = data && isRecord2(data.usage) ? data.usage : null;
    if (!usage) continue;
    const counts = {
      inputTokens: nonNegativeInt(usage.inputTokens),
      outputTokens: nonNegativeInt(usage.outputTokens),
      cacheReadTokens: nonNegativeInt(usage.cacheReadTokens),
      cacheWriteTokens: nonNegativeInt(usage.cacheWriteTokens),
      reasoningTokens: nonNegativeInt(usage.reasoningTokens)
    };
    if (sumTokens(counts) <= 0) continue;
    const seq = Number(parsed.seq);
    if (!Number.isFinite(seq)) continue;
    const ts = parseTimestamp(parsed.time);
    if (ts === null) continue;
    const event = buildUsageEvent(
      {
        id: `dsh:${header.sessionId}:${Math.floor(seq)}`,
        source: "dsh",
        sessionId: header.sessionId,
        ts,
        model: model || "unknown",
        provider,
        cwd: header.cwd,
        counts
      },
      ctx
    );
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }
  return { events, header, model, provider };
}
async function scanDshFile(input) {
  const { file, ctx } = input;
  const fallbackSessionId = path6.basename(path6.dirname(file.path));
  const decompressed = await decompressZstdFile(file.path);
  const { events } = parseDshLines(decompressed.data.toString("utf8"), fallbackSessionId, ctx);
  return {
    events,
    offset: file.size,
    size: file.size,
    mtimeMs: file.mtimeMs,
    more: false,
    warning: decompressed.fallback ? "zstd binary not found; DSH log truncated to first frame (install zstd for full data)" : null
  };
}
var dshSource = {
  id: "dsh",
  mode: "whole",
  watchDir: (root) => path6.join(root, "sessions"),
  match: (fileName) => fileName === DSH_SESSION_FILE,
  parseFile: scanDshFile
};

// apps/collector/src/sources/opencode.ts
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";
var OPENCODE_OVERLAP_MS = 10 * 60 * 1e3;
var MESSAGE_SELECT = "SELECT id, session_id, time_created, time_updated, data FROM message";
function queryMessages(db, since) {
  try {
    return db.prepare(
      `${MESSAGE_SELECT}
         WHERE time_updated >= ?
           AND json_extract(data, '$.role') = 'assistant'
           AND json_extract(data, '$.tokens') IS NOT NULL
         ORDER BY time_updated ASC`
    ).all(since);
  } catch {
    const rows = db.prepare(`${MESSAGE_SELECT} WHERE time_updated >= ? ORDER BY time_updated ASC`).all(since);
    return rows.filter((row) => {
      const data = parseData(row.data);
      return data.role === "assistant" && isRecord2(data.tokens);
    });
  }
}
function parseData(value) {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord2(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function nestedRecord(value) {
  return isRecord2(value) ? value : null;
}
function parseMessageRow(row, ctx) {
  const id = stringValue(row.id);
  const sessionId = stringValue(row.session_id);
  const timeUpdated = nonNegativeInt(row.time_updated);
  const data = parseData(row.data);
  const tokens = nestedRecord(data.tokens);
  if (id.length === 0 || !tokens) return { event: null, timeUpdated };
  const cache = nestedRecord(tokens.cache) ?? {};
  const reasoning = nonNegativeInt(tokens.reasoning);
  const counts = {
    inputTokens: nonNegativeInt(tokens.input),
    outputTokens: nonNegativeInt(tokens.output) + reasoning,
    cacheReadTokens: nonNegativeInt(cache.read),
    cacheWriteTokens: nonNegativeInt(cache.write),
    reasoningTokens: reasoning
  };
  if (sumTokens(counts) <= 0) return { event: null, timeUpdated };
  const time = nestedRecord(data.time);
  const ts = parseTimestamp(time?.created) ?? parseTimestamp(row.time_created) ?? (timeUpdated > 0 ? timeUpdated : null);
  if (ts === null) return { event: null, timeUpdated };
  const pathInfo = nestedRecord(data.path);
  const model = stringValue(data.modelID).trim() || "unknown";
  const event = buildUsageEvent(
    {
      id: `opencode:${id}`,
      source: "opencode",
      sessionId,
      messageId: id,
      ts,
      model,
      provider: stringValue(data.providerID),
      agent: stringValue(data.agent) || stringValue(data.mode) || "main",
      cwd: stringValue(pathInfo?.cwd),
      counts
    },
    ctx
  );
  const reportedCost = Number(data.cost);
  if (Number.isFinite(reportedCost) && reportedCost > 0) {
    event.costUsd = reportedCost;
  }
  return { event, timeUpdated };
}
var scanOpencodeDatabase = async (ctx, watermark) => {
  const since = Math.max(0, Math.floor(watermark) - OPENCODE_OVERLAP_MS);
  const db = new DatabaseSync2(ctx.dbPath, { readOnly: true });
  try {
    const rows = queryMessages(db, since);
    const events = [];
    const seen = /* @__PURE__ */ new Set();
    let nextWatermark = Math.max(0, Math.floor(watermark));
    for (const row of rows) {
      const { event, timeUpdated } = parseMessageRow(row, ctx);
      if (timeUpdated > nextWatermark) nextWatermark = timeUpdated;
      if (!event || seen.has(event.id)) continue;
      seen.add(event.id);
      events.push(event);
    }
    return { events, watermark: nextWatermark };
  } finally {
    db.close();
  }
};

// apps/collector/src/sources/index.ts
var JSONL_SOURCES = [claudeSource, codexSource, dshSource];
var JSONL_BY_ID = new Map(
  JSONL_SOURCES.map((spec) => [spec.id, spec])
);
var opencodeDatabaseParser = scanOpencodeDatabase;
function sourceTargets(paths) {
  return [
    { id: "claude", root: paths.claude, watchPath: path7.join(paths.claude, "projects") },
    { id: "codex", root: paths.codex, watchPath: path7.join(paths.codex, "sessions") },
    { id: "opencode", root: paths.opencode, watchPath: path7.join(paths.opencode, "opencode.db") },
    { id: "dsh", root: paths.dsh, watchPath: path7.join(paths.dsh, "sessions") }
  ];
}

// apps/collector/src/scanner.ts
var MAX_ERROR_LENGTH = 300;
var MAX_WALK_DEPTH = 8;
function truncateError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}\u2026` : message;
}
async function discoverFiles(dir, match) {
  const files = [];
  const stack = [{ dir, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries;
    try {
      entries = await fs.readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path8.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < MAX_WALK_DEPTH) stack.push({ dir: fullPath, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile() || !match(entry.name)) continue;
      try {
        const stat = await fs.stat(fullPath);
        files.push({ path: fullPath, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) });
      } catch {
      }
    }
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return files;
}
async function runPool(items, limit, worker) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === void 0) continue;
      results[index] = await worker(item);
    }
  });
  await Promise.all(runners);
  return results;
}
var Scanner = class {
  constructor(store, aggregator, config, options = {}) {
    this.store = store;
    this.aggregator = aggregator;
    this.config = config;
    this.options = options;
    for (const source of SOURCE_IDS) {
      this.statuses.set(source, {
        source,
        // Seed from configuration so /api/health is meaningful before the first
        // scan pass reaches this source (the pass then refines it to "root
        // exists and is enabled").
        enabled: this.config.sources[source] === true,
        lastEventAt: null,
        events: 0,
        error: null
      });
    }
  }
  store;
  aggregator;
  config;
  options;
  statuses = /* @__PURE__ */ new Map();
  running = false;
  /** Seeds per-source counters from SQLite so health is correct before the first scan. */
  init() {
    const stats = this.store.sourceEventStats();
    for (const [source, sourceStats] of stats) {
      const status = this.statuses.get(source);
      if (!status) continue;
      status.events = sourceStats.events;
      status.lastEventAt = sourceStats.lastEventAt;
    }
  }
  getStatuses() {
    return SOURCE_IDS.map((source) => ({ ...this.statuses.get(source) }));
  }
  /** Existing watch roots, exposed in the collector metadata for debugging. */
  watchRoots() {
    return sourceTargets(this.config.paths).filter((target) => existsSync2(target.watchPath)).map((target) => target.watchPath);
  }
  stats() {
    let events = 0;
    let lastEventAt = null;
    for (const status of this.statuses.values()) {
      events += status.events;
      if (status.lastEventAt !== null && (lastEventAt === null || status.lastEventAt > lastEventAt)) {
        lastEventAt = status.lastEventAt;
      }
    }
    return { events, lastEventAt };
  }
  get isRunning() {
    return this.running;
  }
  /** Repeated scan passes until the bounded backlog is fully consumed (`--once`). */
  async drain(maxPasses = 50) {
    const passes = [];
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const result = await this.scanAll();
      passes.push(result);
      if (!result.pending || result.bytesRead <= 0) break;
    }
    return passes;
  }
  async scanAll(only) {
    const startedAt = Date.now();
    if (this.running) {
      return {
        startedAt,
        durationMs: 0,
        newEvents: 0,
        pending: false,
        bytesRead: 0,
        sources: [],
        busy: true
      };
    }
    this.running = true;
    try {
      const ctx = {
        timezone: this.config.timezone,
        prices: this.config.prices,
        now: startedAt
      };
      const cutoff = startedAt - this.config.backfillDays * 864e5;
      const sources = [];
      for (const spec of JSONL_SOURCES) {
        if (only && spec.id !== only) continue;
        sources.push(await this.scanJsonlSource(spec, ctx, cutoff));
      }
      if ((!only || only === "opencode") && this.config.sources.opencode) {
        sources.push(await this.scanOpencode(ctx));
      } else if (!only || only === "opencode") {
        const status = this.statusFor("opencode");
        status.enabled = false;
        sources.push(this.emptyStats("opencode"));
      }
      const newEvents = sources.reduce((sum, source) => sum + source.newEvents, 0);
      const pending = sources.some((source) => source.filesPending > 0);
      const bytesRead = sources.reduce((sum, source) => sum + source.bytesRead, 0);
      return { startedAt, durationMs: Date.now() - startedAt, newEvents, pending, bytesRead, sources, busy: false };
    } finally {
      this.running = false;
    }
  }
  statusFor(source) {
    const status = this.statuses.get(source);
    if (!status) throw new Error(`unknown source ${source}`);
    return status;
  }
  emptyStats(source) {
    const status = this.statusFor(source);
    return {
      source,
      enabled: status.enabled,
      newEvents: 0,
      filesScanned: 0,
      filesPending: 0,
      bytesRead: 0,
      error: status.error,
      durationMs: 0
    };
  }
  async scanOpencode(ctx) {
    const startedAt = Date.now();
    const status = this.statusFor("opencode");
    const watchPath = path8.join(this.config.paths.opencode, "opencode.db");
    if (!existsSync2(watchPath)) {
      status.enabled = false;
      status.error = null;
      return this.emptyStats("opencode");
    }
    status.enabled = true;
    const watermarkRaw = this.store.getKv("opencode.watermark");
    const watermark = watermarkRaw ? Number.parseInt(watermarkRaw, 10) : 0;
    let newEvents = 0;
    let error = null;
    try {
      const result = await opencodeDatabaseParser(
        { ...ctx, dbPath: watchPath },
        Number.isFinite(watermark) ? watermark : 0
      );
      const inserted = this.store.insertEvents(result.events);
      if (inserted.inserted.length > 0) {
        this.aggregator.addMany(inserted.inserted);
        newEvents = inserted.inserted.length;
        const latest = inserted.inserted.reduce((max, event) => Math.max(max, event.ts), 0);
        status.events += newEvents;
        status.lastEventAt = status.lastEventAt === null ? latest : Math.max(status.lastEventAt, latest);
      }
      this.store.setKv("opencode.watermark", String(result.watermark));
      status.error = null;
    } catch (caught) {
      error = truncateError(caught);
      status.error = error;
    }
    return {
      source: "opencode",
      enabled: true,
      newEvents,
      filesScanned: 1,
      filesPending: 0,
      bytesRead: 0,
      error,
      durationMs: Date.now() - startedAt
    };
  }
  async scanJsonlSource(spec, ctx, cutoff) {
    const startedAt = Date.now();
    const status = this.statusFor(spec.id);
    const root = this.config.paths[spec.id];
    const watchPath = spec.watchDir(root);
    if (!this.config.sources[spec.id] || !existsSync2(watchPath)) {
      status.enabled = false;
      status.error = null;
      return this.emptyStats(spec.id);
    }
    status.enabled = true;
    const files = await discoverFiles(watchPath, spec.match);
    const jobs = [];
    for (const file of files) {
      const prior = this.store.getFileState(file.path);
      if (prior) {
        const fullyConsumed = spec.mode === "append" ? prior.offset >= file.size : true;
        if (fullyConsumed && prior.mtimeMs === file.mtimeMs && prior.size === file.size) continue;
      } else if (file.mtimeMs < cutoff) {
        continue;
      }
      jobs.push({ file, prior });
    }
    const concurrency = this.options.concurrency ?? 4;
    const fileBudgetBytes = this.options.fileBudgetBytes ?? 64 * 1024 * 1024;
    let newEvents = 0;
    let filesScanned = 0;
    let filesPending = 0;
    let bytesRead = 0;
    let lastError = null;
    await runPool(jobs, concurrency, async (job) => {
      const truncated = job.prior !== null && job.file.size < job.prior.offset;
      const effectivePrior = truncated ? null : job.prior;
      const parserStateKey = `parser:${spec.id}:${job.file.path}`;
      const priorParserState = truncated ? null : this.store.getKv(parserStateKey);
      try {
        const result = await spec.parseFile({
          file: job.file,
          prior: effectivePrior,
          priorParserState,
          ctx,
          maxBytes: fileBudgetBytes
        });
        const startOffset = effectivePrior?.offset ?? 0;
        if (spec.mode === "append") bytesRead += Math.max(0, result.offset - startOffset);
        else bytesRead += job.file.size;
        const inserted = this.store.insertEvents(result.events);
        if (inserted.inserted.length > 0) {
          this.aggregator.addMany(inserted.inserted);
          newEvents += inserted.inserted.length;
          const latest = inserted.inserted.reduce((max, event) => Math.max(max, event.ts), 0);
          status.events += inserted.inserted.length;
          status.lastEventAt = status.lastEventAt === null ? latest : Math.max(status.lastEventAt, latest);
        }
        this.store.setFileState(job.file.path, {
          offset: result.offset,
          mtimeMs: result.mtimeMs,
          size: result.size
        });
        if (result.parserState !== void 0 && result.parserState !== null) {
          this.store.setKv(parserStateKey, result.parserState);
        }
        if (result.more) filesPending += 1;
        if (result.warning) lastError = result.warning;
        filesScanned += 1;
      } catch (caught) {
        lastError = truncateError(caught);
        filesScanned += 1;
      }
    });
    status.error = lastError;
    return {
      source: spec.id,
      enabled: true,
      newEvents,
      filesScanned,
      filesPending,
      bytesRead,
      error: lastError,
      durationMs: Date.now() - startedAt
    };
  }
};

// apps/collector/src/server.ts
import { createServer } from "node:http";
var MAX_BODY_BYTES = 2 * 1024 * 1024;
var DEFAULT_DAILY_DAYS2 = 14;
var IMPLEMENTED_SOURCES = ["claude", "codex", "opencode", "dsh"];
var HttpError = class extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "HttpError";
  }
  status;
  code;
};
function baseHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store"
  };
}
function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...baseHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  response.end(payload);
}
function sendError(response, status, code, message) {
  sendJson(response, status, { error: { code, message } });
}
function isRange(value) {
  return RANGES.includes(value);
}
function parseRange(url) {
  const raw = url.searchParams.get("range") ?? "today";
  if (!isRange(raw)) {
    throw new HttpError(400, "invalid_range", `range must be one of: ${RANGES.join(", ")}`);
  }
  return raw;
}
function parseDailyDays(url) {
  const raw = url.searchParams.get("days");
  if (raw === null || raw.trim().length === 0) return DEFAULT_DAILY_DAYS2;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, "invalid_days", "days must be a number");
  }
  return Math.min(366, Math.max(1, Math.floor(parsed)));
}
function collectorMeta(ctx, now) {
  return {
    version: ctx.version,
    uptimeSec: Math.max(0, Math.floor((now - ctx.startedAt) / 1e3)),
    dbPath: ctx.dbPath,
    watchRoots: ctx.watchRoots(),
    sources: ctx.sources(),
    cloud: ctx.cloudStatus()
  };
}
function buildSummary(ctx, url, now) {
  const range = parseRange(url);
  const dailyDays = parseDailyDays(url);
  return ctx.aggregator.finalize({
    range,
    dailyDays,
    now,
    liveWindowMs: ctx.liveWindowMs,
    collector: collectorMeta(ctx, now)
  });
}
function methodNotAllowed(response, allowed) {
  response.setHeader("Allow", allowed);
  sendError(response, 405, "method_not_allowed", `method not allowed (allowed: ${allowed})`);
}
async function handleRequest(ctx, request, response, port, cleanups) {
  const nowFn = ctx.now ?? Date.now;
  const method = (request.method ?? "GET").toUpperCase();
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (method === "OPTIONS") {
    response.writeHead(204, baseHeaders());
    response.end();
    return;
  }
  if (method === "POST") {
    const declared = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      request.destroy();
      sendError(response, 413, "payload_too_large", `body must be at most ${MAX_BODY_BYTES} bytes`);
      return;
    }
    request.resume();
  }
  const pathname = url.pathname;
  if (pathname === "/api/health") {
    if (method !== "GET") return methodNotAllowed(response, "GET");
    const now = nowFn();
    const stats = ctx.stats();
    sendJson(response, 200, {
      ok: true,
      version: ctx.version,
      uptimeSec: Math.max(0, Math.floor((now - ctx.startedAt) / 1e3)),
      port,
      demo: ctx.demo,
      dbPath: ctx.dbPath,
      sources: ctx.sources(),
      events: stats.events,
      lastEventAt: stats.lastEventAt,
      startedAt: ctx.startedAt
    });
    return;
  }
  if (pathname === "/api/summary") {
    if (method !== "GET") return methodNotAllowed(response, "GET");
    const summary = buildSummary(ctx, url, nowFn());
    sendJson(response, 200, summary);
    return;
  }
  if (pathname === "/api/version") {
    if (method !== "GET") return methodNotAllowed(response, "GET");
    sendJson(response, 200, { version: ctx.version, demo: ctx.demo });
    return;
  }
  if (pathname === "/api/cloud/sync") {
    if (method !== "POST") return methodNotAllowed(response, "POST");
    if (!ctx.sync) {
      sendJson(response, 200, {
        ok: false,
        lastSyncAt: ctx.cloudStatus().lastSyncAt,
        disabled: true,
        error: "cloud sync is disabled in demo mode"
      });
      return;
    }
    const result = await ctx.sync();
    if (result.ok) {
      sendJson(response, 200, { ok: true, lastSyncAt: result.lastSyncAt });
      return;
    }
    if (result.disabled) {
      sendJson(response, 200, {
        ok: false,
        lastSyncAt: result.lastSyncAt,
        disabled: true,
        error: result.error
      });
      return;
    }
    sendJson(response, 502, {
      error: { code: "cloud_sync_failed", message: result.error ?? "cloud sync failed" }
    });
    return;
  }
  if (pathname === "/api/rescan") {
    if (method !== "POST") return methodNotAllowed(response, "POST");
    const source = url.searchParams.get("source");
    if (source !== null && !IMPLEMENTED_SOURCES.includes(source)) {
      throw new HttpError(
        400,
        "invalid_source",
        `source must be one of: ${IMPLEMENTED_SOURCES.join(", ")}`
      );
    }
    ctx.scan(source ? source : void 0);
    sendJson(response, 202, { ok: true });
    return;
  }
  if (pathname === "/api/events/stream") {
    if (method !== "GET") return methodNotAllowed(response, "GET");
    const range = parseRange(url);
    const days = parseDailyDays(url);
    response.writeHead(200, {
      ...baseHeaders(),
      "Content-Type": "text/event-stream; charset=utf-8",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    const push = () => {
      try {
        const summary = ctx.aggregator.finalize({
          range,
          dailyDays: days,
          now: nowFn(),
          liveWindowMs: ctx.liveWindowMs,
          collector: collectorMeta(ctx, nowFn())
        });
        response.write(`event: summary
data: ${JSON.stringify(summary)}

`);
      } catch {
      }
    };
    push();
    const timer = setInterval(push, 2e3);
    timer.unref?.();
    const cleanup = () => {
      clearInterval(timer);
      try {
        response.end();
      } catch {
      }
    };
    cleanups.add(cleanup);
    request.on("close", () => {
      cleanups.delete(cleanup);
      clearInterval(timer);
    });
    return;
  }
  sendError(response, 404, "not_found", `no route for ${method} ${pathname}`);
}
async function createCollectorServer(ctx, options) {
  const host = options.host ?? "127.0.0.1";
  const cleanups = /* @__PURE__ */ new Set();
  let boundPort = options.port;
  const server = createServer((request, response) => {
    void handleRequest(ctx, request, response, boundPort, cleanups).catch((error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof HttpError) {
        sendError(response, error.status, error.code, error.message);
        return;
      }
      sendError(
        response,
        500,
        "internal_error",
        error instanceof Error ? error.message : "internal error"
      );
    });
  });
  server.on("clientError", (_error, socket) => {
    try {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } catch {
    }
  });
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (address && typeof address === "object") boundPort = address.port;
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, host);
  });
  return {
    server,
    port: boundPort,
    close: async () => {
      for (const cleanup of [...cleanups]) cleanup();
      cleanups.clear();
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
  };
}

// apps/collector/src/version.ts
import { readFileSync as readFileSync3 } from "node:fs";
function readVersion() {
  try {
    const url = new URL("../package.json", import.meta.url);
    const parsed = JSON.parse(readFileSync3(url, "utf8"));
    if (typeof parsed.version === "string" && parsed.version.length > 0) return parsed.version;
  } catch {
  }
  return "0.4.0";
}
var VERSION = readVersion();

// apps/collector/src/sync.ts
var MAX_ERROR_LENGTH2 = 300;
var DEBOUNCE_MS = 6e4;
var REQUEST_TIMEOUT_MS = 3e4;
function truncate(message) {
  return message.length > MAX_ERROR_LENGTH2 ? `${message.slice(0, MAX_ERROR_LENGTH2)}\u2026` : message;
}
var CloudSync = class {
  constructor(options) {
    this.options = options;
    this.cloud = options.cloud;
    const storedSyncAt = Number.parseInt(options.store.getKv("cloud.lastSyncAt") ?? "", 10);
    this.lastSyncAtValue = Number.isFinite(storedSyncAt) && storedSyncAt > 0 ? storedSyncAt : null;
    this.lastErrorValue = options.store.getKv("cloud.lastError") || null;
  }
  options;
  cloud;
  lastSyncAtValue = null;
  lastErrorValue = null;
  dirty = false;
  syncing = false;
  intervalTimer = null;
  debounceTimer = null;
  intervalMs = 0;
  /** Re-reads the cloud section from disk; keeps the previous config on read errors. */
  reload() {
    const { cloud, error } = readCloudSettings(this.options.configPath);
    if (error) return;
    this.cloud = cloud;
  }
  isEnabled() {
    return this.cloud.enabled && this.cloud.url.length > 0 && this.cloud.apiKey.length > 0;
  }
  status() {
    this.reload();
    const username = this.cloud.username || this.options.store.getKv("cloud.username") || null;
    return {
      enabled: this.isEnabled(),
      lastSyncAt: this.lastSyncAtValue,
      lastError: this.lastErrorValue,
      username,
      endpoint: this.cloud.url.length > 0 ? this.cloud.url : null
    };
  }
  /** Marks new events so the auto-sync interval / debounce actually pushes them. */
  onNewEvents() {
    this.dirty = true;
    this.reload();
    if (!this.isEnabled() || !this.cloud.autoSync) return;
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.performSync(false);
    }, DEBOUNCE_MS);
    this.debounceTimer.unref?.();
  }
  start() {
    this.reload();
    this.armInterval();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }
  stop() {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.intervalTimer = null;
    this.debounceTimer = null;
  }
  armInterval() {
    const nextIntervalMs = Math.max(1, this.cloud.intervalMinutes) * 6e4;
    if (this.intervalTimer && this.intervalMs === nextIntervalMs) return;
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalMs = nextIntervalMs;
    this.intervalTimer = setInterval(() => {
      void this.tick();
    }, nextIntervalMs);
    this.intervalTimer.unref?.();
  }
  async tick() {
    this.reload();
    if (!this.isEnabled() || !this.cloud.autoSync) return;
    if (this.intervalMs !== Math.max(1, this.cloud.intervalMinutes) * 6e4) this.armInterval();
    if (!this.dirty) return;
    await this.performSync(false);
  }
  /** Manual or forced sync (also used by `POST /api/cloud/sync`). */
  async syncNow() {
    this.reload();
    if (!this.isEnabled()) {
      return {
        ok: false,
        lastSyncAt: this.lastSyncAtValue,
        error: "cloud sync disabled (cloud.enabled/url/apiKey missing in config.json)",
        disabled: true
      };
    }
    return this.performSync(true);
  }
  async performSync(manual) {
    if (this.syncing) {
      return { ok: false, lastSyncAt: this.lastSyncAtValue, error: "sync already in progress", disabled: false };
    }
    this.syncing = true;
    const now = this.options.now ?? Date.now;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      const days = this.options.getDays();
      if (days.length === 0) {
        this.dirty = false;
        return { ok: true, lastSyncAt: this.lastSyncAtValue, error: null, disabled: false };
      }
      const endpoint = `${this.cloud.url.replace(/\/+$/, "")}/api/v1/ingest`;
      const body = {
        version: this.options.version ?? VERSION,
        client: "collector",
        days,
        meta: {
          timezone: this.options.timezone(),
          rangeStart: days[0]?.date ?? "",
          ...manual ? { manual: true } : {}
        }
      };
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.cloud.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) {
        let detail = "";
        try {
          detail = (await response.text()).slice(0, 160);
        } catch {
        }
        throw new Error(`cloud responded ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      let parsed = {};
      try {
        parsed = await response.json();
      } catch {
        parsed = {};
      }
      this.lastSyncAtValue = now();
      this.lastErrorValue = null;
      this.dirty = false;
      this.options.store.setKv("cloud.lastSyncAt", String(this.lastSyncAtValue));
      this.options.store.setKv("cloud.lastError", "");
      const username = typeof parsed.username === "string" && parsed.username.length > 0 ? parsed.username : this.cloud.username;
      if (username.length > 0) {
        this.cloud = { ...this.cloud, username };
        this.options.store.setKv("cloud.username", username);
      }
      return { ok: true, lastSyncAt: this.lastSyncAtValue, error: null, disabled: false };
    } catch (caught) {
      const message = truncate(caught instanceof Error ? caught.message : String(caught));
      this.lastErrorValue = message;
      this.options.store.setKv("cloud.lastError", message);
      return { ok: false, lastSyncAt: this.lastSyncAtValue, error: message, disabled: false };
    } finally {
      this.syncing = false;
    }
  }
};

// apps/collector/src/collector.ts
function clock() {
  const now = /* @__PURE__ */ new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
}
function applyBackfillOverride(config, backfillDays) {
  if (backfillDays === void 0) return;
  if (!Number.isFinite(backfillDays) || backfillDays < 1) return;
  config.backfillDays = Math.min(3650, Math.floor(backfillDays));
}
function sourceStatusesFromEvents(events) {
  const counts = /* @__PURE__ */ new Map();
  for (const event of events) {
    const current = counts.get(event.source) ?? { events: 0, lastEventAt: null };
    current.events += 1;
    current.lastEventAt = current.lastEventAt === null ? event.ts : Math.max(current.lastEventAt, event.ts);
    counts.set(event.source, current);
  }
  return SOURCE_IDS.map((source) => {
    const found = counts.get(source);
    return {
      source,
      enabled: source === "claude" || source === "codex" || source === "opencode" || source === "dsh",
      lastEventAt: found?.lastEventAt ?? null,
      events: found?.events ?? 0,
      error: null
    };
  });
}
function eventsFromStore(store, config) {
  const aggregator = new EventAggregator({ timezone: config.timezone, liveWindowMs: config.liveWindowMs });
  let count = 0;
  for (const event of store.iterateEvents()) {
    aggregator.add(event);
    count += 1;
  }
  return { aggregator, count };
}
function logScanPass(pass, totalEvents) {
  const changed = pass.sources.filter((source) => source.newEvents > 0);
  if (pass.newEvents > 0) {
    const parts = changed.map((source) => `${source.source} +${source.newEvents}`).join(", ");
    console.log(
      `[${clock()}] +${pass.newEvents} events (${parts}) \xB7 ${formatTokens(totalEvents)} events total \xB7 ${pass.durationMs}ms`
    );
    return;
  }
  if (pass.pending) {
    console.log(`[${clock()}] backfill continues (${pass.durationMs}ms)`);
  }
}
function printOnceSummary(summary, label) {
  const totals = summary.totals;
  console.log(
    `totals (${label}): ${formatTokens(totals.totalTokens)} tokens \xB7 ${formatCost(totals.costUsd, { approx: true })} \xB7 ${totals.messages} messages \xB7 ${totals.sessions} sessions`
  );
  const sources = summary.sources.filter((row) => row.totalTokens > 0).slice(0, 4).map((row) => `${row.label} ${formatPercent(row.share)}`).join(" \xB7 ");
  if (sources.length > 0) console.log(`top sources: ${sources}`);
  const models = summary.models.filter((row) => row.totalTokens > 0).slice(0, 5).map((row) => `${row.key} ${formatPercent(row.share)}`).join(" \xB7 ");
  if (models.length > 0) console.log(`top models: ${models}`);
}
async function runOnce(config, store) {
  const startedAt = Date.now();
  const aggregator = new EventAggregator({ timezone: config.timezone, liveWindowMs: config.liveWindowMs });
  let bootEvents = 0;
  for (const event of store.iterateEvents()) {
    aggregator.add(event);
    bootEvents += 1;
  }
  const scanner = new Scanner(store, aggregator, config, {
    concurrency: 4,
    fileBudgetBytes: 128 * 1024 * 1024
  });
  scanner.init();
  console.log(
    `token-island collector ${VERSION} \xB7 once scan (backfillDays=${config.backfillDays}, db ${store.path}, ${bootEvents} existing events)`
  );
  const passes = await scanner.drain();
  const elapsedMs = Date.now() - startedAt;
  const newEvents = passes.reduce((sum, pass) => sum + pass.newEvents, 0);
  const statuses = scanner.getStatuses();
  const total = scanner.stats();
  for (const status of statuses) {
    const meta = SOURCE_META[status.source];
    const sourcePasses = passes.flatMap((pass) => pass.sources).filter((source) => source.source === status.source);
    const files = sourcePasses.reduce((sum, source) => sum + source.filesScanned, 0);
    const newForSource = sourcePasses.reduce((sum, source) => sum + source.newEvents, 0);
    const enabledLabel = status.enabled ? `+${newForSource} new \xB7 ${files} files` : "disabled";
    console.log(`  ${meta.short.padEnd(9)} ${enabledLabel} \xB7 total ${status.events}`);
    if (status.error) console.log(`  ${"".padEnd(9)} warning: ${status.error}`);
  }
  const cloud = new CloudSync({
    configPath: config.configPath,
    cloud: config.cloud,
    store,
    getDays: () => aggregator.cloudDays({ maxDays: 400 }),
    timezone: () => config.timezone
  });
  const windowSummary = aggregator.finalize({
    range: config.backfillDays <= 7 ? "7d" : "30d",
    now: Date.now(),
    dailyDays: 30,
    collector: {
      version: VERSION,
      dbPath: config.dbPath,
      watchRoots: scanner.watchRoots(),
      sources: statuses,
      cloud: cloud.status()
    }
  });
  const allSummary = aggregator.finalize({
    range: "all",
    now: Date.now(),
    dailyDays: 30,
    collector: {
      version: VERSION,
      dbPath: config.dbPath,
      watchRoots: scanner.watchRoots(),
      sources: statuses,
      cloud: cloud.status()
    }
  });
  console.log(
    `scan: ${newEvents} new events in ${(elapsedMs / 1e3).toFixed(2)}s \xB7 ${total.events} events in db \xB7 ${passes.length} pass(es)`
  );
  if (passes.some((pass) => pass.pending)) {
    console.log("warning: scan budget reached before EOF; run again to finish the backfill");
  }
  printOnceSummary(windowSummary, config.backfillDays <= 7 ? "7d" : "30d");
  printOnceSummary(allSummary, "all-time");
  console.log(`db: ${store.path}`);
  return 0;
}
function createSync(config, store, aggregator) {
  return new CloudSync({
    configPath: config.configPath,
    cloud: config.cloud,
    store,
    getDays: () => aggregator.cloudDays({ maxDays: 400 }),
    timezone: () => config.timezone
  });
}
async function runDaemon(config, store) {
  const startedAt = Date.now();
  const { aggregator, count: bootEvents } = eventsFromStore(store, config);
  const scanner = new Scanner(store, aggregator, config, {
    concurrency: 4,
    fileBudgetBytes: 32 * 1024 * 1024
  });
  scanner.init();
  const cloud = createSync(config, store, aggregator);
  let shuttingDown = false;
  let scanTimer = null;
  const notifiedError = /* @__PURE__ */ new Map();
  const scanNow = async (source) => {
    if (scanner.isRunning) return;
    try {
      const pass = await scanner.scanAll(source);
      if (pass.busy) return;
      logScanPass(pass, scanner.stats().events);
      if (pass.newEvents > 0) cloud.onNewEvents();
      for (const sourceStat of pass.sources) {
        const previous = notifiedError.get(sourceStat.source) ?? null;
        if (sourceStat.error && sourceStat.error !== previous) {
          console.error(`[${clock()}] ${sourceStat.source} parser error: ${sourceStat.error}`);
        }
        notifiedError.set(sourceStat.source, sourceStat.error);
      }
    } catch (error) {
      if (shuttingDown) return;
      console.error(`[${clock()}] scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const context = {
    version: VERSION,
    demo: false,
    dbPath: config.dbPath,
    startedAt,
    timezone: config.timezone,
    liveWindowMs: config.liveWindowMs,
    aggregator,
    sources: () => scanner.getStatuses(),
    watchRoots: () => scanner.watchRoots(),
    cloudStatus: () => cloud.status(),
    stats: () => scanner.stats(),
    scan: (source) => {
      void scanNow(source);
    },
    sync: () => cloud.syncNow()
  };
  const server = await createCollectorServer(context, { port: config.port });
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[${clock()}] ${signal} received, shutting down`);
    if (scanTimer) clearInterval(scanTimer);
    cloud.stop();
    try {
      await server.close();
      const deadline = Date.now() + 3e3;
      while (scanner.isRunning && Date.now() < deadline) {
        await new Promise((done) => setTimeout(done, 25));
      }
    } finally {
      store.close();
    }
  };
  return await new Promise((resolve) => {
    const onSignal = (signal) => {
      void shutdown(signal).then(() => resolve(0));
    };
    process.once("SIGINT", () => onSignal("SIGINT"));
    process.once("SIGTERM", () => onSignal("SIGTERM"));
    console.log(
      `token-island collector ${VERSION} listening on http://127.0.0.1:${server.port} (db ${config.dbPath}, ${bootEvents} events, tz ${config.timezone})`
    );
    cloud.start();
    scanTimer = setInterval(() => {
      void scanNow();
    }, config.scanIntervalMs);
    scanTimer.unref?.();
    void scanNow();
  });
}
async function runDemoServer(config) {
  const startedAt = Date.now();
  const events = generateDemoEvents({ days: 120, timezone: config.timezone });
  const aggregator = new EventAggregator({ timezone: config.timezone, liveWindowMs: config.liveWindowMs });
  aggregator.addMany(events);
  const statuses = sourceStatusesFromEvents(events);
  const lastEventAt = events.reduce((max, event) => Math.max(max, event.ts), 0);
  const watchRoots = sourceTargets(config.paths).map((target) => target.watchPath);
  const demoCloud = {
    enabled: false,
    lastSyncAt: null,
    lastError: null,
    username: config.cloud.username || null,
    endpoint: config.cloud.url || null
  };
  const context = {
    version: VERSION,
    demo: true,
    dbPath: config.demoDbPath,
    startedAt,
    timezone: config.timezone,
    liveWindowMs: config.liveWindowMs,
    aggregator,
    sources: () => statuses,
    watchRoots: () => watchRoots,
    cloudStatus: () => demoCloud,
    stats: () => ({ events: events.length, lastEventAt }),
    scan: () => {
    },
    sync: null
  };
  const server = await createCollectorServer(context, { port: config.demoPort });
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[${clock()}] ${signal} received, shutting down`);
    await server.close();
  };
  return await new Promise((resolve) => {
    process.once("SIGINT", () => {
      void shutdown("SIGINT").then(() => resolve(0));
    });
    process.once("SIGTERM", () => {
      void shutdown("SIGTERM").then(() => resolve(0));
    });
    console.log(
      `token-island collector ${VERSION} demo mode on http://127.0.0.1:${server.port} (${events.length} demo events, no SQLite writes)`
    );
  });
}
async function runCollect(options) {
  const config = loadConfig();
  applyBackfillOverride(config, options.backfillDays);
  if (options.port && Number.isInteger(options.port) && options.port >= 1 && options.port <= 65535) {
    if (options.demo) config.demoPort = options.port;
    else config.port = options.port;
  }
  if (options.demo) return runDemoServer(config);
  if (config.configError) console.error(`config: ${config.configError}`);
  if (options.reset) {
    Store.removeDatabaseFiles(config.dbPath);
    console.log(`reset: removed ${config.dbPath}`);
  }
  const store = new Store(config.dbPath);
  try {
    if (options.once) return await runOnce(config, store);
    return await runDaemon(config, store);
  } finally {
    store.close();
  }
}
async function runSyncOnce() {
  const config = loadConfig();
  if (config.configError) console.error(`config: ${config.configError}`);
  const store = new Store(config.dbPath);
  try {
    const { aggregator } = eventsFromStore(store, config);
    const cloud = createSync(config, store, aggregator);
    const result = await cloud.syncNow();
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          disabled: result.disabled,
          lastSyncAt: result.lastSyncAt,
          error: result.error
        },
        null,
        2
      )
    );
    if (result.ok || result.disabled) return 0;
    return 1;
  } finally {
    store.close();
  }
}
async function runStatus() {
  const config = loadConfig();
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/health`, {
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    console.log(JSON.stringify(health, null, 2));
    return 0;
  } catch {
    console.log("offline");
    return 0;
  }
}

// apps/collector/src/index.ts
var USAGE = `Token Island collector ${VERSION}

Usage:
  tokenisland collect [--foreground] [--once] [--demo] [--reset] [--backfill-days N]
      Run the collector daemon (foreground). --once scans once, prints counts and exits.
      --demo serves deterministic demo data on port 47119 without SQLite writes.
      --reset deletes the local SQLite database and file-offset state, then rescans.
      --backfill-days N overrides config.backfillDays for this run.
  tokenisland sync       Push current daily rollups to the cloud once.
  tokenisland status     Print the running collector /api/health JSON (or "offline").
`;
function parsePositiveInteger(value) {
  if (value === void 0) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
}
function parseCollectArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--foreground") {
      options.foreground = true;
      continue;
    }
    if (arg === "--once") {
      options.once = true;
      continue;
    }
    if (arg === "--demo") {
      options.demo = true;
      continue;
    }
    if (arg === "--reset") {
      options.reset = true;
      continue;
    }
    if (arg === "--port") {
      const value = parsePositiveInteger(args[index + 1]);
      if (value === null || value > 65535) return { error: "--port requires an integer 1..65535" };
      options.port = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      const value = parsePositiveInteger(arg.slice("--port=".length));
      if (value === null || value > 65535) return { error: "--port requires an integer 1..65535" };
      options.port = value;
      continue;
    }
    if (arg === "--backfill-days") {
      const value = parsePositiveInteger(args[index + 1]);
      if (value === null) return { error: "--backfill-days requires a positive integer" };
      options.backfillDays = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--backfill-days=")) {
      const value = parsePositiveInteger(arg.slice("--backfill-days=".length));
      if (value === null) return { error: "--backfill-days requires a positive integer" };
      options.backfillDays = value;
      continue;
    }
    return { error: `unknown option: ${arg}` };
  }
  return { options };
}
async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === void 0 || command === "help" || command === "--help" || command === "-h") {
    console.log(USAGE);
    return 0;
  }
  switch (command) {
    case "collect": {
      const parsed = parseCollectArgs(argv.slice(1));
      if (parsed.error) {
        console.error(parsed.error);
        console.error(USAGE);
        return 2;
      }
      if (parsed.help) {
        console.log(USAGE);
        return 0;
      }
      return await runCollect(parsed.options ?? {});
    }
    case "sync":
      return await runSyncOnce();
    case "status":
      return await runStatus();
    default:
      console.error(`unknown command: ${command}`);
      console.error(USAGE);
      return 2;
  }
}
try {
  const code = await main();
  if (code !== 0) process.exitCode = code;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
