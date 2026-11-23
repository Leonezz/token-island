# Token Island — architecture

This document explains how the three apps fit together. The normative interface
spec is [`docs/CONTRACT.md`](./CONTRACT.md); when in doubt, the contract wins.

## 1. Shape of the system

```text
agent session logs (read-only, local)
        │
        ▼
┌─────────────────────┐    SQLite (~/.token-island/data.db)
│ apps/collector      │◀──────────────────────────────┐
│ - incremental parse │                               │
│ - EventAggregator   │    GET /api/summary           │
│ - HTTP API :47118   │───────────────▶ apps/island-macos (SwiftUI panel)
│ - optional sync     │    POST /api/v1/ingest
└─────────────────────┘───────────────▶ apps/cloud (Node HTTP :47117)
                                             │
                                             ├─ badge.svg / chart.svg / card.svg
                                             └─ /u/:user dashboard + landing page
```

`packages/core` is the only shared code package: types, pricing, aggregation,
timezone helpers and formatting. All three apps and the e2e script import it via
`@token-island/core`; nothing re-implements these functions.

## 2. Component responsibilities

| Component | Owns | Must never |
| --- | --- | --- |
| `packages/core` | `UsageEvent`, `Summary`, `CloudDay`, pricing, `EventAggregator`, `assembleSummary`, formatting, demo generators | touch the network / filesystem / clock implicitly (deterministic, injectable `now`) |
| `apps/collector` | source parsers, SQLite persistence, in-memory aggregation, local HTTP API, cloud sync | send raw prompts/paths/session ids to the cloud; bind anything but `127.0.0.1` |
| `apps/island-macos` | NSPanel UI, polling `/api/summary`, menu bar, snapshot rendering | write user data; require screen-recording permission (snapshots use `ImageRenderer`) |
| `apps/cloud` | users/API keys, ingest validation & upsert, SVG rendering, dashboard/landing HTML | trust client aggregates without validation; return an API key twice |
| `bin/tokenisland.mjs` | dependency-free CLI dispatch, config merge, doctor, static SVG export | import npm packages; write outside the state dir on its own |
| `scripts/*` | dev orchestration, e2e verification, fixture/screenshot generation | be imported by apps |

## 3. Data model pipeline

1. **Raw log line** (per agent, different formats) is parsed by
   `apps/collector/src/sources/<source>.ts`.
2. **`UsageEvent`** — normalized: `inputTokens` is *uncached* prompt tokens,
   `cacheReadTokens`/`cacheWriteTokens` are cache hits/writes, `outputTokens`
   includes billed reasoning, `reasoningTokens` is an informational subset, and
   `totalTokens` is always computed (never trusted from the provider). `costUsd`
   comes from `estimateCostUsd` or from OpenCode's own number.
3. Events are deduped by deterministic `id` (`claude:<message.id>`,
   `codex:<session>:<ordinal>`, `opencode:<id>`, `dsh:<session>:<seq>`) and stored
   in SQLite (`INSERT … ON CONFLICT(id) DO NOTHING`).
4. At boot the DB is replayed into one `EventAggregator` (per-day counters only,
   memory-light); new events are appended as they are scanned.
5. `GET /api/summary` calls `aggregator.finalize()` — no SQL per request.
   The resulting `Summary` is the single document consumed by the widget.
6. Daily rollups (`CloudDay`) are optionally POSTed to the cloud. The cloud
   upserts latest-wins per `(username, date)` and renders everything else from
   those rows; it never sees events.

## 4. Invariants

- **Local-first**: raw logs and `cwd`/`project` stay in `~/.token-island/data.db`.
  The cloud payload contains only `date`, token counts, `costUsd`, `messages`
  and `models: Record<model, tokens>`.
- **Read-only over user files**: parsers never write to agent directories.
- **Epoch milliseconds internally; local `YYYY-MM-DD` for dates** via
  `dateKey(ts, tz)` — never `toISOString().slice(0,10)`.
- **Idempotent**: rescans and restarts cannot double count.
- **Zero runtime dependencies** (Node built-ins + SwiftUI). Dev-only: `tsx`,
  `typescript`, `@types/node`.
- **Fail soft**: a broken source records `SourceStatus.error` and keeps running;
  a failed cloud sync records `lastError` and retries later.
- **Bounded resources**: incremental file offsets, streamed parsing, at most
  4 concurrent file scans, no unbounded per-request SQL.

## 5. Ports, paths, environment

| Thing | Default | Override |
| --- | --- | --- |
| collector HTTP (real) | `127.0.0.1:47118` | `TOKEN_ISLAND_PORT`, `config.port` |
| collector HTTP (demo) | `127.0.0.1:47119` | — |
| cloud HTTP | `0.0.0.0:47117` | `PORT` |
| state dir | `~/.token-island` | `TOKEN_ISLAND_HOME` |
| collector DB | `~/.token-island/data.db` | state dir / `--demo` in-memory |
| config | `~/.token-island/config.json` | `TOKEN_ISLAND_HOME` |
| cloud DB | `./data/cloud.db` (repo root) | `TOKEN_ISLAND_CLOUD_DB` |
| widget config lookup | `~/.token-island/config.json` | `TOKEN_ISLAND_PORT` for the port |

Dev/e2e state is never written to `~`: `scripts/dev.ts` uses `.runtime/dev`,
`scripts/e2e.ts` uses `.runtime/e2e` (repo-local runtime dirs, not committed).

## 6. CLI surface (`bin/tokenisland.mjs`)

- Plain ESM JavaScript, Node built-ins only, executable with shebang.
- Resolves the repo root from `import.meta.url`, runs TypeScript entries with
  `process.execPath --import tsx <entry>` so it never depends on `PATH`/globals.
- Reads `${TOKEN_ISLAND_HOME:-~/.token-island}/config.json`; `register` merges
  `cloud.*` into it and writes atomically (`0600`).
- Human output uses `✓/✗/·` and ANSI colour only on a TTY (`NO_COLOR` honoured).
- Commands: `collect`, `sync`, `status`, `register`, `export`, `cloud start|seed`,
  `island`, `install`, `uninstall`, `doctor`, `help`.

`export` exists because github.com cannot load `http://127.0.0.1` images: it
downloads the cloud's SVGs into a directory (default `docs/badges`) and prints a
Markdown snippet with repo-relative paths, so a README can embed committed
static files. The alternative is a publicly deployed cloud with live URLs.

## 7. Failure handling / degradation

| Failure | Behaviour |
| --- | --- |
| source directory missing | source disabled silently (doctor lists it as not found) |
| parser error on a line/file | recorded in `SourceStatus.error` (truncated), rest continues |
| collector offline | widget shows stale data dimmed, then `OFFLINE` after 3 failed polls; recovers automatically |
| cloud unreachable from collector | sync error stored, collection unaffected, retried on next tick |
| cloud has no demo user | landing page shows a seed hint instead of demo badges |
| island app not built | `tokenisland island` fails with the build command; e2e SKIPs the snapshot phase |
| apps not implemented | CLI exits 1 with the missing path; `scripts/e2e.ts` reports SKIP and does not crash |
| port in use | server exits non-zero; dev/e2e report the conflict instead of hanging |

## 8. Verification strategy

- `packages/core` and each app have unit tests (`node --import tsx --test`).
- `scripts/e2e.ts` is the integration gate:
  `pnpm typecheck` + `pnpm test` → collector demo API on `:47119` (summary shape,
  `today.totalTokens > 0`) → cloud on `:47117` with a temp DB (seed, `/healthz`,
  badge/chart/card SVGs, dashboard markers) → island snapshot via the built app
  (SKIP if not built). All waits are bounded, children are killed in `finally`,
  and missing apps produce SKIP instead of a crash.
- `scripts/snapshot-island.sh` regenerates fixtures and renders the README PNGs
  at 2x (collapsed/expanded/offline/transparent). It SKIPs when the app is not
  built.

## 9. Extending

**New log source**: add `apps/collector/src/sources/<name>.ts` implementing the
same incremental parser shape, register it in the collector's source list,
extend `SourceId`/`SOURCE_META` in `packages/core` (contract change — coordinate
with the Lead first), and add fixture-line unit tests. No other layer changes.

**New badge metric**: add the value/label mapping in `apps/cloud`'s badge
renderer and an e2e assertion; core formatting helpers should be reused.

**Widget change**: the widget only depends on the `Summary` JSON shape and
`collector.port`/`cloud.url`. Keep the decoding tolerant (unknown fields
ignored, fields optional except `totals`, `today`, `daily`, `streak`).

## 10. Non-goals

- Reading prompt content, auth tokens or billing APIs of the providers.
- Multi-tenant cloud with teams/billing; keys are single-user accounts.
- Cross-device realtime sync — sync is a periodic push of daily aggregates.
- App Store distribution / code signing for the widget.
