# Token Island — architecture (V2)

This document explains how the apps fit together. The normative specs are
[`docs/CONTRACT.md`](./CONTRACT.md) (v1: HTTP/data model/collector/CLI),
[`docs/CONTRACT-V2.md`](./CONTRACT-V2.md) (V2: pixel design system, native app
packaging, dual-runtime cloud) and [`docs/CONTRACT-V3.md`](./CONTRACT-V3.md)
(V3: selective dot-matrix data marks). When in doubt, the contracts win.

## 1. Shape of the system

```text
agent session logs (read-only, local)
        │
        ▼
┌─────────────────────────────┐    SQLite (~/.token-island/data.db)
│ apps/collector              │◀─────────────────────────────────┐
│ - incremental source parsers│                                  │
│ - EventAggregator           │    GET /api/summary              │
│ - HTTP API :47118           │──────────────▶ apps/island-macos │
│ - optional cloud sync       │                (pixel NSPanel,    │
└─────────────────────────────┘                menu bar, DMG)    │
        │ daily rollups (optional)                              │
        ▼                                                       │
┌───────────────────────────────────────────────────────────────┴─────────────┐
│ apps/cloud — ONE codebase, TWO runtimes                                      │
│                                                                              │
│  src/api.ts + src/render/* + @token-island/core/pixel.ts (shared)            │
│        │                        │                                            │
│        ▼                        ▼                                            │
│  Node + SQLite (:47117)     Cloudflare Worker + D1 (src/worker.ts)          │
│  src/node.ts + node-store   D1 binding DB + ASSETS fonts                     │
│  Docker / Railway / local   `wrangler dev` :47131 / `wrangler deploy`        │
│        │                        │                                            │
│        └────────────┬───────────┘                                            │
│                     ▼                                                        │
│   badge.svg · chart.svg · card.svg · /u/:user dashboard · / landing          │
└──────────────────────────────────────────────────────────────────────────────┘
```

`packages/core` is the only shared code package: types, pricing, aggregation,
timezone helpers, formatting, demo generators and the **pixel design system**
(`pixel.ts` + generated Silkscreen bitmap glyph table). All apps and the e2e
script import it via `@token-island/core`; nothing re-implements these functions.

## 2. Component responsibilities

| Component | Owns | Must never |
| --- | --- | --- |
| `packages/core` | `UsageEvent`, `Summary`, `CloudDay`, pricing, `EventAggregator`, formatting, demo data, pixel palette/text/panels/sprites, **V3 dot-matrix data-mark API** (`dotmatrix.ts`) | touch the network / filesystem / clock implicitly (deterministic, injectable `now`); use dot marks for text |
| `apps/collector` | source parsers, SQLite persistence, in-memory aggregation, local HTTP API, cloud sync | send raw prompts/paths/session ids to the cloud; bind anything but `127.0.0.1` |
| `apps/island-macos` | pixel NSPanel UI (224×44 / 448×400), DotRenderer (`DotMatrix.swift`) for hero/chart/LED data marks, menu bar, Preferences/About, LaunchAgent, DMG packaging, `ImageRenderer` snapshots | write user data; require screen-recording permission (snapshots use `ImageRenderer`); render labels as dots |
| `apps/cloud/src/api.ts` + `render/*` | routes, validation, user/day storage semantics, pixel SVG/HTML rendering, V3 dot data marks + `doticons.ts` badge icons | trust client aggregates; return an API key twice; render text as dots |
| `apps/cloud/src/node.ts` + `store/node-store.ts` | Node HTTP adapter, static pixel fonts, `node:sqlite` storage (local/Docker) | leak Node APIs into the shared render/api layer |
| `apps/cloud/src/worker.ts` + `store/d1-store.ts` | Cloudflare Worker entry, D1 storage, ASSETS font binding (production) | import `node:*` modules into the Worker bundle |
| `bin/tokenisland.mjs` | dependency-free CLI dispatch, config merge, doctor, static SVG export, wrangler wrappers, LaunchAgent install | import npm packages; write outside the state dir on its own |
| `scripts/*` | dev orchestration, e2e verification, fixture/screenshot generation | be imported by apps |

## 3. Pixel design system

V2 replaces every visual surface with one pixel language, defined once in
`packages/core/src/pixel.ts`:

- **integers only** — all SVG coordinates, offsets, border widths and shadow
  offsets are whole design pixels;
- **no curves / gradients / blur** — corners are staircase-chamfered
  (`pixelRectPath` / `pixelPanel`), depth comes from 2–4 px hard offset shadows
  and checkerboard dither patterns; only the native window shape uses a radius;
- **2 px borders** (`PIXEL.border`, highlight `PIXEL.borderHi`), panel fill
  `PIXEL.surface`, page background `PIXEL.bg`, inset wells `PIXEL.inset`;
- **bitmap typography** — SVG surfaces only use `pixelTextSvg()` /
  `pixelTextPath()` (never `<text>` + font stack); the native app and HTML use the
  real Silkscreen TTF at 8/16/24/32/48 pt or 20 px VT323 body prose;
- **sprites** instead of emoji; uppercase labels via `sanitizePixelText()`;
- **step-wise motion** (live dot blinks 2 frames, 120–200 ms transitions);
- accessibility kept: `role="img"`, `<title>`/`<desc>`, contrast ≥ 4.5:1.

`apps/cloud/src/render/*` builds badges/charts/card/pages exclusively from these
helpers, which is why the Node and Worker runtimes are visually identical.

## 3b. V3 selective dot-matrix boundary

V3 adds readability-first dot-matrix **data marks** on top of the V2 pixel base:

> **读字用清晰字形，数据用点阵元素** — labels stay bitmap/Silkscreen text; dots are
> reserved for values and data marks.

- `packages/core/src/dotmatrix.ts` owns the shared API: `dotTextSvg` / `dotFigureSvg`
  (hero digits + optional halo), `dotColumnsSvg`, `dotSparklineSvg`,
  `dotRatioStripSvg`, `dotLedSvg`, `dotTextureSvg`. **Only `dotLedSvg` may emit a
  glow**; everything else is flat dots on the integer grid.
- **Boundary rule**: dot marks are for numbers/data/indicators, never for labels,
  body prose, model/project names, tables, footers or button text. Dot digits must
  be ≥24 px tall; LED glow only on ≤8 px status dots; bitmap text keeps V2 sizes
  and ≥4.5:1 contrast (no glow on text).
- **Island**: `Design/DotMatrix.swift` renders the hero tokens + 14-day bars +
  collapsed sparkline + ratio strips + live LED from `assets/fonts/pixel-glyphs.json`
  in a SwiftUI `Canvas`; a feature flag / Reduce Motion / load failure falls back to
  the V2 Silkscreen text renderer. Panels, labels, layout, wallpapers,
  Preferences/About and the menu bar are unchanged from V2.
- **Cloud**: `render/chart.ts` uses dot points + 1 px stepped connectors (line),
  dot columns (bar), dot segments (models) and **keeps square cells for heatmap
  density** with a dot legend; `render/badge.ts` keeps bitmap text, adds
  `doticons.ts` dot icons and an `opacity 0.10` dot texture; dashboard stat numbers
  are dot SVGs. SVG output stays self-contained: no `<text>`, no external fonts,
  valid XML, bitmap axis labels and empty-state text preserved.

## 4. Native macOS app packaging

- `scripts/build-app.sh`: `swift build -c release` → assemble
  `build/TokenIsland.app` (`Contents/MacOS/TokenIsland`, `Info.plist`,
  `Resources/AppIcon.icns`, `Resources/fonts/Silkscreen-*.ttf` + OFL licenses,
  bundled `summary.example.json`) → ad-hoc `codesign --force --deep --sign -` →
  verify. Fails loudly when icon/fonts are missing.
- `scripts/package-dmg.sh`: builds, stages `TokenIsland.app` + `Applications`
  symlink, creates UDZO `build/TokenIsland-<version>.dmg`, runs `hdiutil verify`.
- `scripts/install.sh` / `tokenisland install`: copy app to `~/Applications`,
  write the widget LaunchAgent (`com.token-island.app`); the CLI additionally
  writes the collector LaunchAgent (`com.token-island.collector`, `RunAtLoad` +
  `KeepAlive`, log `<repo>/.runtime/collector/daemon.log`). No sudo.
- Snapshot mode (`--snapshot`, `--snapshot-all`) renders with `ImageRenderer`;
  wallpaper composites include a pixel desktop + menu bar (1920×1200 at 2x), the
  transparent variants expose the real panel geometry (224×44 pt collapsed,
  448×400 pt expanded/offline).

## 5. Data model pipeline

1. **Raw log line** (per agent) is parsed by
   `apps/collector/src/sources/<source>.ts`.
2. **`UsageEvent`** — normalized: `inputTokens` is *uncached* prompt tokens,
   `cacheReadTokens`/`cacheWriteTokens` are cache hits/writes, `outputTokens`
   includes billed reasoning, `reasoningTokens` is an informational subset, and
   `totalTokens` is always computed (never trusted from the provider).
3. Events dedupe by deterministic `id` (`claude:<message.id>`,
   `codex:<session>:<ordinal>`, `opencode:<id>`, `dsh:<session>:<seq>`) and are
   stored in SQLite (`INSERT … ON CONFLICT(id) DO NOTHING`).
4. At boot the DB is replayed into one `EventAggregator`; new events are appended
   as they are scanned.
5. `GET /api/summary` calls `aggregator.finalize()` — no SQL per request. The
   resulting `Summary` is the single document consumed by the widget.
6. Daily rollups (`CloudDay`) are optionally POSTed to the cloud, which upserts
   latest-wins per `(username, date)` and renders everything from those rows.
   The same `CloudStore` interface is implemented by D1 and SQLite.

## 6. Invariants

- **Local-first**: raw logs and `cwd`/`project` stay in `~/.token-island/data.db`.
  The cloud payload contains only `date`, token counts, `costUsd`, `messages`
  and `models: Record<model, tokens>`.
- **Read-only over user files**: parsers never write to agent directories.
- **Epoch milliseconds internally; local `YYYY-MM-DD` for dates** via
  `dateKey(ts, tz)` — never `toISOString().slice(0,10)`.
- **Idempotent**: rescans, re-ingests and restarts cannot double count.
- **Zero runtime dependencies** (Node built-ins + SwiftUI; Worker: Web APIs + D1).
  Dev-only: `tsx`, `typescript`, `@types/node`, `wrangler` (global, optional).
- **Fail soft**: a broken source records `SourceStatus.error` and keeps running;
  a failed cloud sync records `lastError` and retries later.
- **Bounded resources**: incremental file offsets, streamed parsing, at most
  4 concurrent file scans, no unbounded per-request SQL.
- **Sandbox-safe tooling**: dev/e2e/wrangler state lives under `<repo>/.runtime`
  (repo-local XDG dirs, `--persist-to`), never in `$HOME`.

## 7. Ports, paths, environment

| Thing | Default | Override |
| --- | --- | --- |
| collector HTTP (real) | `127.0.0.1:47118` | `TOKEN_ISLAND_PORT`, `config.port` |
| collector HTTP (demo) | `127.0.0.1:47119` | `TOKEN_ISLAND_DEMO_PORT` |
| Node cloud HTTP | `0.0.0.0:47117` | `PORT` |
| Worker local dev (`wrangler dev`) | `127.0.0.1:47131` | `TOKEN_ISLAND_WORKER_PORT`, `cloud dev --port` |
| dev/e2e collector | `:47121` | `E2E_COLLECTOR_PORT` / `DEV_COLLECTOR_PORT` |
| dev/e2e Node cloud | `:47120` | `E2E_CLOUD_PORT` / `DEV_CLOUD_PORT` |
| dev/e2e Worker | `:47131` | `E2E_WORKER_PORT` |
| state dir | `~/.token-island` | `TOKEN_ISLAND_HOME` |
| collector DB | `~/.token-island/data.db` | state dir / `--demo` in-memory |
| config | `~/.token-island/config.json` | `TOKEN_ISLAND_HOME` |
| Node cloud DB | `./data/cloud.db` (repo root) | `TOKEN_ISLAND_CLOUD_DB` |
| Worker D1 state | `apps/cloud` local D1, persisted via `--persist-to <repo>/.runtime/wrangler-state` | `cloud dev --persist-to` |
| widget config lookup | `~/.token-island/config.json` | `TOKEN_ISLAND_CONFIG`; `TOKEN_ISLAND_PORT` for the port |
| dev/e2e state | `.runtime/dev`, `.runtime/e2e` | repo-local runtime dirs, never `~` |

Dev/e2e use dedicated ports so they can run beside the real local services
(`:47118` collector, `:47117` Node cloud) without touching them. `scripts/e2e.ts`
picks free ports from candidate lists, kills only processes it spawned (including
the `wrangler dev` process group), and SKIPs the Worker phase when `wrangler` is
not installed.

## 8. CLI surface (`bin/tokenisland.mjs`)

- Plain ESM JavaScript, Node built-ins only, executable with shebang.
- Resolves the repo root from `import.meta.url`, runs TypeScript entries with
  `process.execPath --import tsx <entry>` so it never depends on `PATH`/globals.
- Reads `${TOKEN_ISLAND_HOME:-~/.token-island}/config.json`; `register` merges
  `cloud.*` into it and writes atomically (`0600`).
- Human output uses `✓/✗/·` and ANSI colour only on a TTY (`NO_COLOR` honoured).
- Commands: `collect`, `sync`, `status`, `register`, `export`,
  `cloud start|seed|migrate|dev|deploy`, `island`, `install`, `uninstall`,
  `doctor`, `help`.
- `cloud dev|deploy` wrap `wrangler` with repo-local XDG dirs and `--persist-to`;
  `dev` applies local D1 migrations first, `deploy --dry-run` bundles without
  login, real `deploy` refuses to run until `wrangler whoami` succeeds and then
  prints the remaining production steps.
- `island --dmg` verifies/locates the packaged DMG and prints drag-to-
  Applications instructions; `island --snapshot/--snapshot-all` render pixel PNGs.
- `install` sets up two user-level LaunchAgents (no sudo): the widget
  (`com.token-island.app`) and the collector daemon
  (`com.token-island.collector`: `node --import tsx <repo>/apps/collector/src/index.ts collect`,
  `RunAtLoad`, `KeepAlive`, `WorkingDirectory=<repo>`, PATH with `/opt/homebrew/bin`,
  log `<repo>/.runtime/collector/daemon.log`). `uninstall` removes both and keeps
  `~/.token-island`. `--dry-run` prints without writing.
- `doctor` reports node/deps, apps, collector/cloud reachability, wrangler version,
  worker port, pixel app assets (AppIcon + Silkscreen/OFL), DMG, codesign, config
  and agent data sources.
- `export` exists because github.com cannot load `http://127.0.0.1` images: it
  downloads the cloud's pixel SVGs into a directory (default `docs/badges`) and
  prints a Markdown snippet with repo-relative paths. The alternative is a
  publicly deployed cloud with live URLs.

## 9. Failure handling / degradation

| Failure | Behaviour |
| --- | --- |
| source directory missing | source disabled silently (doctor lists it as not found) |
| parser error on a line/file | recorded in `SourceStatus.error` (truncated), rest continues |
| collector offline | widget shows stale data dimmed, then `OFFLINE` after 3 failed polls; recovers automatically |
| cloud unreachable from collector | sync error stored, collection unaffected, retried on next tick |
| cloud has no demo user | landing page shows a seed hint instead of demo badges |
| island app not built | `tokenisland island` fails with the build command; e2e SKIPs the snapshot phase |
| dot-matrix glyph/load failure | island DotRenderer falls back to the V2 Silkscreen text hero (feature flag / Reduce Motion) |
| wrangler missing / not logged in | `cloud dev/deploy` print install/login instructions; e2e SKIPs the Worker phase |
| D1 read/write failure | Worker returns JSON 5xx; collector records `lastError` and retries; no data loss locally |
| port in use | server exits non-zero; dev/e2e report/avoid the conflict instead of hanging |

## 10. Verification strategy

- `packages/core` and each app have unit tests (`node --import tsx --test`):
  47 core + 29 collector + 33 cloud = **109 tests** (V3 dot-matrix tests included).
- `scripts/e2e.ts` is the integration gate (89 assertions): `pnpm typecheck` +
  `pnpm test` → collector demo API → Node cloud on `:47120` with a temp SQLite
  DB (seed, `/healthz`, V3 dot-matrix badges/charts/card: `<circle>` data marks,
  0.10 texture, still no `<text>`, dashboard dot stats + font/version markers) →
  Cloudflare Worker on `:47131` (local D1 migrations, `wrangler dev`, HTTP
  register/ingest, the same dot assertions) → dot-matrix island `--snapshot-all`
  geometry (224×44 / 448×400 at scale 2, 1920×1200 wallpaper canvas) →
  PASS/FAIL/SKIP summary. All waits are bounded; children (including workerd) are
  killed in `finally`; unavailable runtimes produce SKIP, not a crash; ports can
  be overridden with `E2E_CLOUD_PORT` / `E2E_COLLECTOR_PORT` / `E2E_WORKER_PORT`.
- `scripts/snapshot-island.sh` renders README PNGs at 2x (`--no-fixtures` skips
  fixture regeneration, `--real <summary.json>` adds the real-data variant) and
  writes a 512 px app icon. Cloud screenshots in `docs/images/` are rendered with
  headless Chrome from the running V3 cloud; `docs/badges/` holds static dot-matrix
  SVGs produced by `tokenisland export`. `docs/images/dot-matrix-before-after.png`
  composes the V2 screenshot (from git history) and the V3 dot island for the
  README's "读字清晰 / 数据点阵" boundary section.
- `wrangler deploy --dry-run` validates the Worker bundle + D1/ASSETS bindings
  without authentication; `hdiutil verify` and `codesign --verify --deep --strict`
  validate the DMG/app; `tokenisland doctor` summarises all of it.

## 11. Extending

**New log source**: add `apps/collector/src/sources/<name>.ts` implementing the
same incremental parser shape, register it in the collector's source list,
extend `SourceId`/`SOURCE_META` in `packages/core` (contract change — coordinate
with the Lead first), and add fixture-line unit tests. No other layer changes.

**New badge metric / chart type**: extend `packages/core` formatting helpers if
needed, add the mapping in `apps/cloud/src/render/*`, and add SVG assertions
(bitmap text + dot data marks where applicable) to `apps/cloud/test` +
`scripts/e2e.ts`. Follow the V3 boundary: values may use `dotmatrix.ts`, labels
must stay bitmap text.

**New cloud runtime**: implement the async `CloudStore` interface
(`apps/cloud/src/store/types.ts`) plus a thin entrypoint; reuse `api.ts` and
`render/*` unchanged. Both current runtimes share every route and renderer.

**Widget change**: the widget only depends on the `Summary` JSON shape,
`collector.port` and `cloud.url`. Keep decoding tolerant (unknown fields ignored,
fields optional except `totals`, `today`, `daily`, `streak`).

## 12. Non-goals

- Reading prompt content, auth tokens or billing APIs of the providers.
- Multi-tenant cloud with teams/billing; keys are single-user accounts.
- Cross-device realtime sync — sync is a periodic push of daily aggregates.
- App Store distribution / notarization (the app is ad-hoc signed by design).
