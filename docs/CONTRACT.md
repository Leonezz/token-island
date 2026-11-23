# Token Island — build contract v1

This document is the single source of truth for parallel implementation. Read it fully
before writing code, then read `packages/core/src/*.ts` (already implemented, tested).
Do not re-implement aggregation/pricing/formatting: import `@token-island/core`.

## 1. Product

Token Island is a **local-first token consumption tracker for AI coding agents**:

1. **Collector** (`apps/collector`): daemon that incrementally parses agent session logs
   (Claude Code, OpenAI Codex, OpenCode, DeepSeek Harness) into SQLite, exposes a local
   HTTP API, and optionally syncs daily aggregates to the cloud.
2. **Dynamic Island widget** (`apps/island-macos`): native SwiftUI macOS app that floats at
   the notch / top center and shows live token + cost data from the collector.
3. **Cloud** (`apps/cloud`): dependency-free Node HTTP service that stores daily aggregates
   and renders GitHub-README-ready SVG badges, charts, profile cards and a dashboard.

## 2. Repo layout & ownership

```
token-island/
├── package.json, pnpm-workspace.yaml, tsconfig.base.json, .npmrc   # Lead
├── packages/core/                                                  # Lead (DONE)
├── docs/CONTRACT.md                                                # Lead (this file)
├── fixtures/                                                       # Lead
├── apps/collector/                                                 # collector-dev
├── apps/cloud/                                                     # cloud-dev
├── apps/island-macos/                                              # island-dev
├── scripts/ (e2e, dev, snapshot, gen-fixtures)                     # Lead + qa-docs
├── bin/tokenisland.mjs                                             # qa-docs
└── README.md, docs/images/                                         # qa-docs
```

**Only touch files inside your own scope.** Shared files (`package.json` at root,
`packages/core`, `fixtures`, `docs/CONTRACT.md`) are owned by the Lead. If you believe a
shared file must change, report it instead of editing it.

## 3. Golden rules

- **TypeScript ESM**: `"type": "module"`, relative imports MUST end in `.js`
  (e.g. `import { x } from './db.js'`), imports of core use `@token-island/core`.
  Follow `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`).
- **Zero runtime dependencies unless approved**. Node 22 built-ins only: `node:http`,
  `node:sqlite` (`DatabaseSync`), `node:fs`, `node:path`, `node:zlib`, `node:crypto`,
  `node:url`, `node:child_process`. Dev-only: `tsx`, `typescript`, `@types/node`
  (already installed at the repo root).
- **No prompt content, secrets or absolute user paths leave the machine.** The collector
  stores `cwd`/`project` locally; the cloud only receives daily aggregates.
- **All timestamps are epoch milliseconds.** Dates are `YYYY-MM-DD` in the configured
  local timezone. Never use `toISOString().slice(0,10)` for local dates — use
  `dateKey(ts, tz)` from core.
- **Use core for**: types (`UsageEvent`, `Summary`, `CloudDay`, ...), timezone/date
  helpers (`dateKey`, `addDays`, `startOfLocalDay`, `resolveTimezone`), pricing
  (`estimateCostUsd`, `PriceOverride`), aggregation (`EventAggregator`, `assembleSummary`,
  `computeStreak`, `mergeCloudDays`), formatting (`formatTokens`, `formatCost`, ...),
  demo data (`generateDemoEvents`, `generateDemoSummary`, `generateDemoCloudDays`),
  source metadata (`SOURCE_META`, `SOURCE_IDS`).
- **Tests**: `node --import tsx --test test/*.test.ts` (node:test + `assert/strict`).
  Typecheck: `tsc --noEmit` (each package has a `typecheck` script). Both must pass.
- **Determinism**: no `Math.random()` in fixtures/tests; pass fixed `now`/`seed`.
- **Servers bind**: collector `127.0.0.1` only; cloud `0.0.0.0` (container-friendly).
- **Errors**: JSON `{ "error": { "code": "...", "message": "..." } }` with proper status.
- **No interactive prompts** in servers/daemons.
- **Formatting**: 2-space indent, single quotes, trailing commas, `const` by default.
  Prefer small modules with a single responsibility.

## 4. Ports, paths, configuration

| what | value |
| --- | --- |
| collector HTTP (real data) | `http://127.0.0.1:47118` |
| collector HTTP (`--demo`) | `http://127.0.0.1:47119` |
| cloud HTTP (local dev) | `http://127.0.0.1:47117` |
| local state dir | `~/.token-island/` |
| collector DB | `~/.token-island/data.db` (`demo.db` in demo mode) |
| config file | `~/.token-island/config.json` |
| env: state dir | `TOKEN_ISLAND_HOME` |
| env: collector port | `TOKEN_ISLAND_PORT` |

### `~/.token-island/config.json` (shared by collector, widget, CLI)

All keys optional; the collector may omit writing defaults until first run.

```jsonc
{
  "port": 47118,
  "timezone": "auto",              // "auto" = system timezone, or IANA id
  "backfillDays": 30,              // only scan session files modified in the last N days
  "scanIntervalMs": 2000,
  "liveWindowMs": 600000,          // sessions active within 10 min
  "sources": { "claude": true, "codex": true, "opencode": true, "dsh": true, "gemini": false },
  "paths": {                       // optional overrides, ~ is expanded
    "claude": "~/.claude",
    "codex": "~/.codex",
    "opencode": "~/.local/share/opencode",
    "dsh": "~/.dsh"
  },
  "prices": [                      // override/extend core pricing, USD per 1M tokens
    { "match": "my-internal-model", "input": 0.5, "output": 1.5 }
  ],
  "cloud": {
    "enabled": false,
    "url": "http://127.0.0.1:47117",
    "username": "demo",
    "apiKey": "ti_...",
    "autoSync": true,
    "intervalMinutes": 15
  }
}
```

The **widget only needs `port`** (default 47118) and, for the menu, `cloud.url`.
The CLI writes `cloud.url/apiKey/username` after registration.

## 5. Collector (`apps/collector`)

### 5.1 CLI

Entry `src/index.ts`, run with `tsx`:

```
tokenisland collect [--foreground] [--once] [--demo] [--reset] [--backfill-days N]
tokenisland sync            # push current daily rollups to the cloud once
tokenisland status          # print collector /api/health JSON (or "offline")
```

- `collect` runs in the foreground and logs one concise line per state change
  (not per event). `--once` scans once, prints counts, exits (used by tests/CI).
- `--demo`: seed `EventAggregator` from `generateDemoEvents()` (120 days), no SQLite
  writes, serve on port 47119; used for screenshots/demos.
- `--reset`: delete the SQLite DB and file-offset state, then rescan.
- Signals: `SIGINT`/`SIGTERM` → close server + DB, exit 0.

### 5.2 SQLite schema (`node:sqlite`)

Use `import { DatabaseSync } from 'node:sqlite'` (built in; it emits an
ExperimentalWarning once — set `NODE_OPTIONS=--no-warnings` in package scripts).
Enable `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;`.

```sql
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,            -- dedupe key (see 5.3)
  source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  ts INTEGER NOT NULL,
  date TEXT NOT NULL,             -- local YYYY-MM-DD
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
  cost_usd REAL,                  -- NULL = unpriced model
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
```

Dedupe: `INSERT ... ON CONFLICT(id) DO NOTHING`. Event ids are deterministic per source
(see 5.3), so re-reads and restarts are idempotent.

### 5.3 Source parsers (`src/sources/*.ts`)

Every parser is incremental. **Never re-read a whole multi-hundred-MB file on every
scan**: persist `file_state.offset` and only consume complete lines (`offset` advances to
the last `\n`; a trailing partial line is left for the next scan). If `size < offset`
(file rotated/truncated) reset offset to 0. On startup, parse all events of the DB back
into the aggregator (see 5.5).

Normalized event fields for every source (see `UsageEvent`):
`inputTokens` = **uncached** prompt tokens, `cacheReadTokens` = cache hits,
`cacheWriteTokens` = cache writes, `outputTokens` = completion tokens (**including**
reasoning where the provider bills it as output), `reasoningTokens` = informational
subset, `totalTokens` = input + output + cacheRead + cacheWrite (compute it, never trust
the provider's total). `costUsd = estimateCostUsd({...}, model, provider, config.prices)`
(`null` → unpriced). `date = dateKey(ts, tz)`, `hour = localHour(ts, tz)`,
`project` = basename of cwd (fall back to `unknown`).

#### Claude Code — `~/.claude/projects/**/*.jsonl`

- JSONL, one JSON object per line. Only lines with `"type": "assistant"` and
  `message.usage` carry tokens.
- Fields: `message.id` (dedupe key → `claude:${message.id}`), `message.model`,
  `message.usage.{input_tokens, output_tokens, cache_creation_input_tokens,
  cache_read_input_tokens}`, top-level `timestamp` (ISO-8601 Z), `sessionId`, `cwd`,
  `isSidechain` (true → `agent = 'subagent'`), `message.usage.output_tokens_details.thinking_tokens`.
- The same `message.id` appears ~2x (identical usage) → dedupe by id, first wins.
- Skip lines whose usage is missing/zero-only or whose model is `<synthetic>`.
- Backfill: skip files whose mtime is older than `backfillDays` (default 30). Files can
  be 300 MB+ → stream with `createReadStream({start: offset})` + `readline`.
- Concurrency: scan at most 4 files at once; background backfill must not block the API.

#### OpenAI Codex — `~/.codex/sessions/**/rollout-*.jsonl`

- JSONL events. Usage lives in `type === "event_msg"` with `payload.type === "token_count"`;
  use `payload.info.last_token_usage` (per-turn delta, not cumulative
  `total_token_usage`). If `last_token_usage` is absent, compute the delta of
  `total_token_usage`.
- Model: maintain "latest" from `type === "turn_context"` → `payload.model`; fall back to
  `session_meta.payload.model_provider`/`model`. `cwd` from `session_meta.payload.cwd` or
  latest `turn_context.payload.cwd`. `session_id` from `session_meta.payload.session_id`
  (fall back to the file's uuid). Sub-agent rollouts have
  `session_meta.payload.source.subagent` → `agent = 'subagent'` (use `agent_role` when present).
- Normalization (OpenAI reports cached input *inside* input):
  `cacheReadTokens = cached_input_tokens`, `cacheWriteTokens = cache_write_input_tokens`,
  `inputTokens = input_tokens - cached_input_tokens`,
  `outputTokens = output_tokens`, `reasoningTokens = reasoning_output_tokens`.
- Dedupe key: `codex:${sessionId}:${ordinal}` where `ordinal` is the top-level event
  ordinal (stable and unique per file).
- Timestamp: top-level `timestamp` ISO-8601.

#### OpenCode — `~/.local/share/opencode/opencode.db` (SQLite)

- Open read-only (`new DatabaseSync(path, { readOnly: true })`); use a 10 minute overlap
  watermark based on `message.time_updated` to catch late updates; dedupe by message id.
- `SELECT id, session_id, time_created, data FROM message` where the JSON `data.role` is
  `assistant` and `data.tokens` exists.
- Fields: `data.modelID`, `data.providerID`, `data.tokens.{input, output, reasoning,
  cache:{read, write}}`, `data.cost` (already computed by OpenCode — use it as `costUsd`
  when > 0, otherwise fall back to `estimateCostUsd`), `data.time.created`,
  `data.path.cwd`, `data.agent` / `data.mode`.
- Normalization: `outputTokens = output + reasoning`,
  `reasoningTokens = reasoning`; cache fields as reported; `inputTokens = input`.
- Dedupe key: `opencode:${id}`.

#### DeepSeek Harness — `~/.dsh/sessions/*/*/session.v4.jsonl.zstd`

- Compressed JSONL, **multi-frame zstd**: `zlib.zstdDecompressSync` only decodes the first
  frame. Spawn `zstd -dc <file>` (present at `/opt/homebrew/bin/zstd`; also try `PATH`) and
  parse its stdout; fall back to `zlib.zstdDecompressSync` (single frame) when `zstd` is
  unavailable. Files are small → re-parse on `(size, mtime)` change only.
- Session id: first line `{"type":"session","id":"session-...","cwd":..., "agentPreset":...}`.
- Model: track latest `{"type":"model/selection","data":{"provider","model"}}`
  (fall back to `request/header` `data.header.config.{provider,model}`).
- Usage: `{"type":"assistant/message","seq":n,"time":epochMs,"data":{"usage":{
  "inputTokens","outputTokens","cacheReadTokens","cacheWriteTokens","totalTokens"}}}`.
  `reasoningTokens` = 0 unless reported. `provider` from model selection.
- Dedupe key: `dsh:${sessionId}:${seq}`. Skip events without usage.
- Timestamp: event `time` (epoch ms). `cwd`/`project` from the session line.

If a source's path does not exist, mark it disabled with no error (the tool must work for
users who only use one agent). Surface parse errors in `SourceStatus.error` (last error,
truncated) and keep going.

### 5.4 HTTP API (collector, `src/server.ts`)

`node:http`, JSON responses, `Access-Control-Allow-Origin: *` (local read-only data),
`Cache-Control: no-store`, 1-2 MB max body.

```
GET /api/health
  -> 200 { ok: true, version, uptimeSec, port, demo, dbPath, sources: SourceStatus[],
           events: number, lastEventAt, startedAt }

GET /api/summary?range=today|7d|30d|90d|all&days=14
  -> 200 Summary (see packages/core/src/types.ts, and fixtures/summary.example.json)
     The server builds it from the in-memory EventAggregator:
       aggregator.finalize({ range, dailyDays: days, collector: { ...meta } })
  -> 400 on invalid range

GET /api/events/stream                    (optional, nice-to-have)
  -> text/event-stream, sends `event: summary` with a fresh Summary every 2 s

POST /api/cloud/sync       -> 200 { ok, lastSyncAt } | 502 { error }
POST /api/rescan?source=claude             -> 202 { ok }  (force re-scan)
GET  /api/version          -> { version, demo }
```

`collector.sources[].error` must never contain raw prompt content, only parser messages.

### 5.5 Aggregation lifecycle

1. Open SQLite, `SELECT * FROM events ORDER BY ts` streaming into one
   `EventAggregator({ timezone })` (memory-light: per-day counters only).
2. Scanner appends new events → insert into SQLite → `aggregator.add(event)`.
3. `/api/summary` = `aggregator.finalize({...})` (microseconds; no per-request SQL scans).
4. `collector` metadata: `version` from package.json (hardcode fallback `0.1.0`),
   `uptimeSec`, `dbPath`, `watchRoots` (existing source roots), `sources` status array,
   `cloud` status read from kv.
5. On `--reset`, delete DB + state and rebuild.

### 5.6 Cloud sync (`src/sync.ts`)

- Active only when `config.cloud.enabled && url && apiKey`.
- `POST ${cloud.url}/api/v1/ingest`, header `Authorization: Bearer <apiKey>`, body:
  ```json
  { "version": "0.1.0", "client": "collector", "days": [CloudDay, ...],
    "meta": { "timezone": "Asia/Singapore", "rangeStart": "2026-08-01" } }
  ```
  `days` = `aggregator.cloudDays({ maxDays: 400 })` (all days).
- Auto-sync every `intervalMinutes` (default 15) when there are new events, plus a
  debounce of 60 s after new events. Persist `lastSyncAt`, `lastError`, `username` in kv.
- Failure must never break collection; store the error (truncated 300 chars) and retry
  on the next tick. Manual sync endpoint above.

### 5.7 Tests to write

- Per-source unit tests with **hand-written fixture lines** in
  `apps/collector/test/fixtures/` (small, no user data): one happy path + dedupe +
  normalization (e.g. Codex cached-token subtraction) per source.
- Incremental scan test: write a temp JSONL, scan, append lines, rescan, assert no
  duplicate rows and correct offsets (use a temp dir under `os.tmpdir()`).
- HTTP test: start the server on port 0, hit `/api/health` + `/api/summary`, assert JSON.
- Never read the developer's real `~/.claude` etc. in tests; use fixtures/temp dirs.

### 5.8 Acceptance commands

```bash
pnpm --filter @token-island/collector typecheck
pnpm --filter @token-island/collector test
pnpm --filter @token-island/collector exec tsx src/index.ts collect --once --backfill-days 7
pnpm --filter @token-island/collector exec tsx src/index.ts collect --demo   # port 47119
curl -s http://127.0.0.1:47118/api/health | head -c 800
curl -s 'http://127.0.0.1:47118/api/summary?range=today' | head -c 800
```

Report: event counts per source from real local data, scan duration, any parser caveats.

## 6. Cloud (`apps/cloud`)

### 6.1 Run

```
tsx src/index.ts         # server on PORT (default 47117)
tsx src/seed.ts          # idempotent demo seed, prints API key + example URLs
```

Env: `PORT`, `TOKEN_ISLAND_CLOUD_DB` (default `./data/cloud.db` relative to repo root;
create dir), `TOKEN_ISLAND_ADMIN_TOKEN` (default: registration allowed for local dev;
when set, `POST /api/v1/register` requires `Authorization: Bearer <admin token>`),
`TOKEN_ISLAND_ALLOW_REGISTER` (`1` default).

### 6.2 SQLite schema

```sql
CREATE TABLE users (
  username TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  api_key_hash TEXT NOT NULL,        -- sha256 hex of the api key
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_sync_at INTEGER
);
CREATE UNIQUE INDEX idx_users_key ON users(api_key_hash);
CREATE TABLE days (
  username TEXT NOT NULL,
  date TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  unpriced_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  models_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (username, date)
);
```

### 6.3 API

```
POST /api/v1/register
  body { "username"?: "demo", "displayName"?: "Demo" }
  - username: 3-32 chars, [a-z0-9_-], lowercase; omitted -> random "ti-xxxxxx"
  - 409 if taken
  -> 201 { username, apiKey: "ti_<32 hex>", badges: {tokens, cost, streak, chart, card},
           ingest: "…/api/v1/ingest", docs: "/u/<username>" }
  (apiKey is returned ONCE; only its sha256 is stored)

GET /api/v1/me
  Authorization: Bearer <apiKey>
  -> 200 { username, displayName, days: n, firstDate, lastDate, lastSyncAt, totals: {...} }
  -> 401 { error: { code: "unauthorized", ... } }

POST /api/v1/ingest
  Authorization: Bearer <apiKey>
  body { version?, client?, days: CloudDay[], meta? }
  - 400 if days missing/not array/ > 400 entries/invalid date or negative numbers
  - upsert latest-wins per (username, date); update users.last_sync_at
  -> 200 { ok: true, username, days: n, firstDate, lastDate, lastSyncAt }

GET /u/:user/badge.svg
  query: metric=tokens|cost|streak|messages|day|model|status (default tokens)
         theme=dark|light|auto (default dark)
         label=<override left label>  days=1..365 (window for tokens/cost, default 30)
         style=flat|flat-square (default flat)
  -> image/svg+xml; 404 for unknown user (render an "unknown" badge, HTTP 404)

GET /u/:user/chart.svg
  query: type=line|bar|heatmap|models (default line), days=7..365 (default 30),
         theme=dark|light|auto (default dark), width, height (optional, sane clamps)
  -> image/svg+xml

GET /u/:user/card.svg
  query: theme, width (default 495)
  -> image/svg+xml profile card

GET /u/:user                -> HTML dashboard (inline SVG charts, embed snippets)
GET /                       -> HTML landing page with live demo badges + setup docs
GET /healthz                -> { ok, users, days, uptimeSec }
GET /api/v1/u/:user         -> JSON stats (public; no key required) used by dashboard/tests
```

Response headers for SVG: `Content-Type: image/svg+xml; charset=utf-8`,
`Cache-Control: public, max-age=300, s-maxage=300`.

### 6.4 SVG design requirements (GitHub README-safe)

- Hand-written SVG strings (no libraries). Valid XML, `xmlns`, `role="img"`,
  `<title>` + `<desc>` for accessibility.
- No external fonts/scripts/images: font stack
  `-apple-system,BlinkMacSystemFont,'Segoe UI',Ubuntu,'Helvetica Neue',sans-serif`;
  every text must set `font-family` on the root `<g>`.
- **Badges**: height 20 (flat) or 18 (flat-square), radius 4/0, two-tone background
  (`#4A4A55` left / accent right for dark theme; light theme `#555`/`#007ec6`-style),
  1 px translucent inner border, label/value 11 px Verdana-ish (`font-family` above),
  value bold; text width estimated (no DOM measuring) with a safe char-width table —
  make the width generous enough to avoid clipping (test with long values).
  Metrics map:
  - `tokens` → value `formatTokens(sum of days)` label `tokens`
  - `cost` → `~$72.99` label `est. spend`
  - `streak` → `9d` label `streak`
  - `messages` → `12.4K` label `agent turns`
  - `day` → today's tokens label `today`
  - `model` → top model short id (truncate 22 chars) label `top model`
  - `status` → `live` / `idle` (last sync < 24 h) label `token-island`
  Colors per metric (dark theme): tokens `#5EEAD4` w/ dark text, cost `#A78BFA`,
  streak `#FBBF24`, others `#60A5FA`; keep contrast ≥ 4.5:1.
- **Charts**: `viewBox` responsive, width default 760/height 220 (line/bar),
  heatmap 840×160, models 760×240. Dark theme background `#0D1117` with `#161B22`
  grid/panel and `#8B949E` labels; light theme `#FFFFFF`/`#F6F8FA`/`#57606A`.
  Line chart: area fill gradient (accent → transparent), 2 px line, dots on hover not
  needed, y-axis max label + 0, x-axis first/mid/last date labels (`MMM d`),
  subtle horizontal grid lines. Handle empty data with an "no data yet" centered label.
  Heatmap: GitHub-style 7 rows × N weeks, 11 px cells with 3 px gap, 4 intensity levels
  of the accent color, month labels on top, weekday labels (Mon/Wed/Fri) on the left.
  Models chart: horizontal bars (top 5) with model colors (reuse palette), label
  `model 12.4K 42%`.
- **Card** (495×~210): rounded 12 panel, left: `@username`, "AI agent token usage",
  big total tokens + `~$` cost, small stats row (streak / active days / avg/day);
  right: 30-day sparkline; bottom: top model + source chips + `token-island` footer.
- All numbers must be formatted through `@token-island/core` (`formatTokens`,
  `formatCost`, `formatPercent`).

### 6.5 Pages

- **Dashboard** `/u/:user`: same visual language as charts (dark/light via `?theme`,
  default dark); shows totals, 30/90-day charts, heatmap, model table, sources,
  "Embed in your README" section with copyable snippets (plain HTML `<img>` per badge,
  chart, card, and a Markdown block listing all), last sync time, API sync instructions.
  Vanilla HTML/CSS/JS only, inline SVGs generated by the same functions, no network calls.
- **Landing** `/`: one-screen hero ("Token Island — your agent token usage, at a glance"),
  live badges/charts for the seeded `demo` user, 3 setup steps, endpoint table, footer
  linking `/u/demo`. Must degrade gracefully when `demo` is missing (show a seed hint).
- Both pages must escape user-controlled text (username/displayName) — use a small
  `escapeHtml`.

### 6.6 Seed (`src/seed.ts`)

- Idempotent: creates/updates users `demo` (display "Demo Agent", 120 days from
  `generateDemoCloudDays({ days: 120, seed: 42 })`) and `alice` (60 days, seed 7).
- Prints username, api key (re-created only if missing — store printed key once; on rerun
  print "already seeded, key unknown" or rotate with `--rotate`), and copy-paste URLs:
  `http://127.0.0.1:47117/u/demo/badge.svg`, chart, card, dashboard.
- Must work with `TOKEN_ISLAND_CLOUD_DB` pointing to a temp file (tests).

### 6.7 Deploy artifacts (inside `apps/cloud/`)

- `Dockerfile` (build context **repo root**): `node:22-alpine`, enable pnpm via corepack,
  `COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc`, the
  workspace packages (`packages/core`, `apps/cloud`), `pnpm install --prod=false --frozen-lockfile`,
  `ENV PORT=8080 TOKEN_ISLAND_CLOUD_DB=/data/cloud.db`,
  `VOLUME /data`, `EXPOSE 8080`, `CMD ["node","--import","tsx","apps/cloud/src/index.ts"]`.
- `railway.json`: build from the Dockerfile, healthcheck `/healthz`, restart policy.
- `apps/cloud/DEPLOY.md`: short deployment + env var + volume notes.
- Ensure the server creates the DB directory, migrates on boot, and exits non-zero on
  port bind failure.

### 6.8 Tests

- `ingest.test.ts`: register → ingest → me; idempotent re-ingest; validation errors; auth
  401; unknown user 404.
- `svg.test.ts`: every badge metric/theme produces well-formed SVG containing expected
  formatted label; chart types produce `<svg` with non-empty path/rect counts; card
  contains username; empty-user charts render the empty state.
- Use temp DB (`TOKEN_ISLAND_CLOUD_DB` + `mkdtemp`) and port `0`.

### 6.9 Acceptance commands

```bash
pnpm --filter @token-island/cloud typecheck
pnpm --filter @token-island/cloud test
TOKEN_ISLAND_CLOUD_DB=/tmp/ti-cloud-test.db pnpm --filter @token-island/cloud seed
PORT=47117 pnpm --filter @token-island/cloud start      # background job
curl -sI http://127.0.0.1:47117/u/demo/badge.svg | head -3
curl -s http://127.0.0.1:47117/u/demo/chart.svg?type=heatmap | head -c 400
```

Report: route list, seed output (username + example URLs), test summary.

## 7. macOS widget (`apps/island-macos`)

### 7.1 Build & bundle

`Package.swift`: `swift-tools-version:5.9`, `platforms: [.macOS(.v13)]`,
executable target `TokenIsland`, `swiftLanguageModes: [.v5]` (avoid Swift 6 strict
concurrency friction), **no external dependencies**.

`scripts/build-app.sh`:
1. `swift build -c release --package-path apps/island-macos`
2. Assemble `apps/island-macos/build/TokenIsland.app`:
   `Contents/MacOS/TokenIsland` (binary), `Contents/Info.plist`, `Contents/Resources/`.
   Info.plist keys: `CFBundleIdentifier com.token-island.app`, `CFBundleName TokenIsland`,
   `CFBundleDisplayName Token Island`, `CFBundleShortVersionString 0.1.0`,
   `CFBundleVersion 1`, `CFBundlePackageType APPL`, `CFBundleExecutable TokenIsland`,
   `LSMinimumSystemVersion 13.0`, `LSUIElement true` (menu-bar app, no Dock icon),
   `NSHighResolutionCapable true`, `NSHumanReadableCopyright MIT`.
3. Copy `fixtures/summary.example.json` (repo root, may be regenerated) to
   `Contents/Resources/summary.example.json` when present.
4. `xattr -dr com.apple.quarantine` (ignore failures), print the .app path.

`scripts/install.sh`: copy to `~/Applications/TokenIsland.app`, create
`~/Library/LaunchAgents/com.token-island.app.plist` (`RunAtLoad`, `KeepAlive` false,
`LimitLoadToSessionType Aqua`) loading the binary, then `launchctl load -w`. Also kill a
running instance first. `scripts/uninstall.sh` reverses it. Do not require sudo.

### 7.2 Window behaviour (this is the "Dynamic Island")

- `NSPanel` subclass, `styleMask: [.borderless, .nonactivatingPanel]`,
  `level = .statusBar` (above normal + menu bar), `isOpaque = false`,
  `backgroundColor = .clear`, `hasShadow = false`, `hidesOnDeactivate = false`,
  `collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]`,
  `isMovableByWindowBackground = false`, `animationBehavior = .none`,
  `becomesKeyOnlyIfNeeded = true`.
- Target screen: the notched built-in display when present (detect
  `NSScreen.screens.first { $0.safeAreaInsets.top > 0 }`), else `NSScreen.main`.
  Notch geometry from `auxiliaryTopLeftArea` / `auxiliaryTopRightArea` (macOS 12+ API
  shown below) — center the island on the notch, otherwise on the screen center.
- **Collapsed**: 210×(notchHeight? use 36) rounded pill, top edge 1 pt below the screen
  top (`y = screen.frame.maxY - height - 1`), horizontally centred. It must look like a
  black island attached to the top edge (rounded bottom corners are acceptable and look
  native; use a rounded rect with radius 18).
- **Expanded** (hover 120 ms or click): animate the window frame to
  width 430, height 352 (`NSAnimationContext`, 0.28 s, `.easeOut` or spring via
  `NSAnimationContext` + `CAMediaTimingFunction`), then cross-fade content. Collapse on
  mouse-exit after 400 ms delay unless pinned by a click. Escape collapses.
- Clicking the pill: expand + pin (click again / click "×"/outside? keep simple: click
  toggles pin). Right-click anywhere → NSMenu (Open dashboard, Sync cloud now, Snapshot
  demo, Hide island, Quit).
- Menu bar: `NSStatusItem` with SF Symbol `bolt.horizontal.circle.fill`; menu items
  Show/Hide island, Sync cloud now, Open dashboard, Launch at login (uses the
  LaunchAgent presence, text only), Quit. Status menu must work even if the window is hidden.
- No focus stealing: never call `makeKeyAndOrderFront` without `.nonactivatingPanel`
  semantics; use `orderFrontRegardless()`.
- The window must appear above full-screen apps and on every Space.

```swift
// Notch geometry (macOS 12+)
if let screen = NSScreen.screens.first(where: { $0.safeAreaInsets.top > 0 }) ?? NSScreen.main,
   let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
  let notchWidth = screen.frame.width - left.width - right.width
  let notchCenterX = screen.frame.minX + left.width + notchWidth / 2
}
```

### 7.3 Data

- Read `~/.token-island/config.json` (or `TOKEN_ISLAND_CONFIG`) at launch for `port`
  (default 47118) and `cloud.url`; allow env `TOKEN_ISLAND_PORT` override.
- Poll `GET http://127.0.0.1:<port>/api/summary?range=today&days=14` every 2.0 s with
  `URLSession` (timeout 1.5 s, `cachePolicy = .reloadIgnoringLocalCacheData`).
- Decode into Codable structs matching `Summary` (camelCase as-is; all fields optional
  except `totals`, `today`, `daily`, `streak`; tolerate unknown fields).
- Keep the last successful snapshot; after 3 consecutive failures show the offline state
  (still display stale numbers dimmed). Recovery is automatic.
- Menu action "Sync cloud now" → `POST /api/summary`? No: `POST http://127.0.0.1:<port>/api/cloud/sync`
  (fire and forget, show a transient toast in the island).
- Add a `--demo` launch flag: use `fixtures/summary.example.json` (bundled resource) and
  skip networking, so `TokenIsland --demo` can be demoed standalone.

### 7.4 Visual design (keep it premium, follow exactly)

- Background: near-black `#050507` at 96% opacity, 1 px inner stroke
  `white.opacity(0.08)`, radius 18 (collapsed) / 28 (expanded), subtle outer glow
  `black.opacity(0.35)` blur 24. Text: primary `white.opacity(0.94)`, secondary
  `white.opacity(0.52)`, tertiary `white.opacity(0.32)`.
- Fonts: SF Pro via `.system(size:design:.rounded)` for numbers (`.monospacedDigit()`
  for anything that changes every poll), `.system(size:weight:)` for labels; uppercase
  micro-labels 9 pt `.semibold` with `.tracking(1.1)`.
- Accents: live `#34D399`, tokens `#5EEAD4`, cost `#A78BFA`, cache `#60A5FA`,
  warning `#FBBF24`, error `#F87171`; source colors from core `SOURCE_META`.
- **Collapsed** content (HStack, 12 pt horizontal padding):
  live pulse dot 7 px (animated opacity/scale when live, grey when idle) ·
  `formatTokens(today.totalTokens)` 15 pt rounded semibold monospaced ·
  `TODAY` 8.5 pt secondary · tiny 30×12 sparkline of `daily` (bar or line) ·
  trailing `~$x.xx` 10 pt secondary (hidden when width tight).
- **Expanded** content (VStack spacing 14, padding 20):
  1. Header: `TOKEN ISLAND` micro-label + status pill (`LIVE`, `IDLE`, `OFFLINE`) +
     right: cloud sync icon (`cloud.fill` / `arrow.triangle.2.circlepath`) + last sync.
  2. Hero: today tokens 40 pt rounded bold monospaced + `TODAY` label; right block:
     est. cost (16 pt) and delta vs yesterday (`▲ 12%` green / `▼ 4%` red, computed from
     `daily` last two entries).
  3. Token split: one 8 pt tall stacked bar (input `#5EEAD4`, cache read `#60A5FA`,
     output `#A78BFA`) with legend row: `IN 1.2M · CACHE 8.4M · OUT 340K`.
  4. 14-day sparkline: bars with today highlighted, baseline label "14 DAYS" left and
     max value right; animate when new data arrives.
  5. Top models: up to 3 rows, colored 3 px leading bar, model short name, token count,
     percent; no row if empty.
  6. Live sessions: up to 2 rows: pulse dot, project label, model, `formatTokens` session
     total, relative time ("just now"); "No active sessions" empty state.
  7. Footer: `🔥 9d streak · 2.3B all-time` left, `collector 0.1.0` right (terse).
- Offline state: expanded keeps layout, hero shows `--` and a `OFFLINE` amber pill plus
  `Collector not reachable · 127.0.0.1:47118` caption; retry automatically.
- Hover: pointer inside pill → expand; pointer leaves → collapse after 400 ms; clicking
  pins (a small pin icon appears in header). Animations must be interruptible.
- Accessibility: `NSAccessibility` labels for the panel and value texts.

### 7.5 Snapshot mode (mandatory — this is how the Lead verifies rendering)

```
TokenIsland --snapshot <out.png> [--state collapsed|expanded|offline] [--fixture <path>]
             [--scale 1|2] [--background wallpaper|transparent]
TokenIsland --snapshot-all <dir> [--fixture <path>] [--scale 2]
```

- Renders the island content with `ImageRenderer` to a PNG (no screen recording
  permission needed). `--background wallpaper` composites the island over a synthetic
  macOS-like gradient wallpaper (dark blue/purple, 16:10) so README screenshots look real;
  `--background transparent` keeps alpha.
- `--fixture` loads `Summary` JSON (default: bundled `summary.example.json`); `--state
  offline` renders with the offline styling. Snapshot mode must not create a visible
  window and must `exit(0)` after writing the file (print the absolute path).
- `--snapshot-all` writes `island-collapsed.png`, `island-expanded.png`,
  `island-offline.png` (and `-transparent` variants) at scale 2.

### 7.6 Acceptance

```bash
bash apps/island-macos/scripts/build-app.sh
apps/island-macos/build/TokenIsland.app/Contents/MacOS/TokenIsland \
  --snapshot /tmp/island-expanded.png --state expanded --scale 2 --background wallpaper
octet-stream check: file /tmp/island-expanded.png   # PNG image data, 2x
```

Then inspect the PNG yourself (`read_image` equivalent: use `sips` to confirm dimensions;
report that the file exists and the layout looks correct based on your own inspection of
the rendered values — do NOT claim visual QA you did not do).
Also verify the app launches and doesn't crash: run it for 3 s in the background with
`--demo`, then kill it; report stderr.

## 8. Cross-cutting acceptance (Lead + qa-docs)

- `pnpm install && pnpm typecheck && pnpm test` from a clean checkout.
- Collector demo mode serves a summary whose `today.totalTokens > 0`.
- Cloud seeded demo serves badges/charts/card/dashboard that render (SVG well-formed,
  HTTP 200) and visually look good (Lead reviews screenshots).
- Widget snapshot PNGs reviewed by the Lead.
- `scripts/e2e.ts` (qa-docs) exits 0 and covers: core tests, collector demo API, cloud
  seed + badge/chart/card endpoints, widget snapshot generation.
- README (Chinese) documents install, run, GitHub badge usage, cloud deploy, privacy.

## 9. Reporting format (for teammates)

When done, post a short report: task id, files created/changed, commands run with results,
deviations from this contract (if any), known limitations, and anything the Lead must
integrate. Keep it under 30 lines. Do not edit files outside your scope.
