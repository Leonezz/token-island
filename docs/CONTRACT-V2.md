# Token Island — V2 contract: pixel UI · native macOS app · Cloudflare deploy

This contract amends and overrides `docs/CONTRACT.md` (v1) **only** for:

1. the visual language (pixel / 8-bit style everywhere),
2. the macOS distribution (a real native app: icon, bundle, DMG, preferences, About, login item),
3. the cloud runtime (Cloudflare Workers + D1 as a first-class target, with the
   existing Node runtime kept for local dev and Docker).

The HTTP contracts, data model, collector behaviour, CLI command names and
privacy rules from v1 stay unchanged. Read v1 first, then this file fully.
Shared design code already exists in `packages/core/src/pixel.ts` (tested,
38 core tests green) and `packages/core/src/pixel-font.generated.ts`.

---

## 0. Foundations that are DONE (Lead-owned, do not edit)

| Path | What it is |
| --- | --- |
| `packages/core/src/pixel.ts` | palette, bitmap text → SVG, pixel panels, insets, dither defs, segmented bars, sprites, heat levels |
| `packages/core/src/pixel-font.generated.ts` | Silkscreen glyph bitmaps on the native 8px grid (generated) |
| `assets/fonts/Silkscreen-{Regular,Bold}.ttf` | real Silkscreen TTF (OFL) — `@font-face` / `Font.custom` |
| `assets/fonts/VT323-Regular.ttf` | terminal face for long prose in HTML (OFL) |
| `assets/fonts/OFL-*.txt` | font licenses — must ship alongside the fonts |
| `assets/appicon/AppIcon.icns`, `icon-1024.png`, `icon-128.png` | finished pixel app icon |
| `assets/fonts/extract_pixel_font.py` | regenerates the bitmap glyph table |

Colors, glyphs and icon are **decided**. Do not invent a second palette.

### Design law (applies to every surface)

- **Integers only**: every SVG coordinate, layout offset, border width and
  shadow offset is an integer number of design pixels.
- **No curves, no gradients, no blur**: corners are staircase-chamfered
  (`pixelRectPath` / `pixelPanel`), depth comes from 2–4px hard offset shadows
  and checkerboard dither patterns. `border-radius` is only used on the outer
  window shape of the native app (macOS requires a window shape), 0 everywhere
  else.
- **2px borders** (`PIXEL.border`, highlight `PIXEL.borderHi`), **panel fill**
  `PIXEL.surface`, page background `PIXEL.bg`, inset wells `PIXEL.inset`.
- **Typography**:
  - SVG (badges/charts/cards/pages-inline-SVG): only `pixelTextSvg()` /
    `pixelTextPath()` (Silkscreen bitmaps). Never `<text>` with a font stack.
    Scale steps: 1 = micro (5px caps), 2 = small (10px), 3 = body (15px),
    4 = large (20px), 6 = hero (30px). Horizontal runs are already merged;
    `shape-rendering="crispEdges"` is emitted by the helpers.
  - Native app + HTML: the real Silkscreen TTF. Native sizes must be
    **multiples of 8pt** (8 micro / 16 small / 24 body / 32 large / 48 hero) so
    glyph pixels land on the Retina grid; body prose in HTML may use VT323 at
    20px where legibility matters.
  - All labels are UPPERCASE in pixel surfaces (the bitmap font is uppercase
    shaped); sanitize with `sanitizePixelText()` (maps `· ▲ ▼ → ×` etc).
- **Palette roles**: teal = tokens/live/success, blue = cache, purple = output/
  cost, amber = streak/warning, red = error/negative, ink/inkDim/inkFaint =
  text hierarchy.
- **Sprites** (`pixelSpriteSvg`): `dot heart flame bolt cloud pin check cross
  arrowUp arrowDown pulse coin chart clock gear`. Use them instead of emoji.
- **Motion**: step-wise. Live dot blinks at ~1.6Hz (2 frames), hover/expand
  transitions 120–200ms linear/ease-out, never long springs.
- Accessibility/quality: SVGs keep `role="img"` + `<title>` + `<desc>`, HTML
  keeps semantic tags, contrast ≥ 4.5:1 for text on its background.

---

## 1. macOS app (`apps/island-macos`) — owner: island-dev

Rewrite the visuals as pixel art **and** ship it as a proper native app.

### 1.1 Window sizes / panel

| state | size | position |
| --- | --- | --- |
| collapsed | 224 × 44 pt | horizontally centred on the notch, top edge = `screen.frame.maxY - 44 + 2` (hangs just below the menu bar) |
| expanded | 448 × 400 pt | centred, top edge ≈ `screen.frame.maxY - 400 + 2`, grows downward with a step-ish 160ms animation |
| offline | same as expanded | amber `OFFLINE` chrome, stale data at 45% opacity |

The NSPanel setup from v1 stays (borderless/nonactivating, `.statusBar`,
all-spaces + fullScreenAuxiliary, clear background, no shadow, no focus steal).
The window itself must be invisible except the pixel panel (transparent margins).

### 1.2 Pixel layout — collapsed (224×44, content inset 8)

`[blink dot 6×6 teal] 8 [TODAY TOKEN COUNT 16pt ink] 6 [TODAY 8pt inkDim] … [~$6.11 8pt inkDim]`

- Panel: `pixelPanel` equivalent in SwiftUI — fill `#14121d`, 2pt border
  `#332d4a`, 1pt top highlight `#57507a`, staircase corner (2 steps), and a
  2pt hard bottom shadow `#050509`.
- Live dot: 3×3 sprite at scale 2 (6pt), blinking 2 frames when live, static
  `inkFaint` grey when idle.
- Token count: Silkscreen 16pt, monospaced digits, `ink`; `formatTokens`.
- `TODAY` micro-label 8pt `inkDim`, tracking 1.
- Cost right-aligned 8pt `inkDim` (`formatCostApprox`), hidden when too narrow.

### 1.3 Pixel layout — expanded (448×400, padding 12, rows in design px)

1. **Header (h 20)**: `TOKEN ISLAND` 8pt ink tracking 1 · LIVE/IDLE/OFFLINE
   badge (panel 56×16: border teal/amber, text 8pt) · right: `cloud` sprite +
   `SYNCED 1M AGO` 8pt inkDim, or `LOCAL` when cloud disabled; pin sprite.
2. **Hero (h 64)**: today tokens 32pt ink (`formatTokens`); `TODAY` 8pt inkDim
   under it; right column: `EST` 8pt inkFaint, `~$6.11` 16pt purple, trend
   `▲ 12% VS YESTERDAY` 8pt green/red (arrow drawn as sprite, not text).
3. **Split bar (h 48)**: 3-cell segmented strip: IN/CACHE/OUT. Each cell =
   label 8pt, value 8pt ink, 6pt-tall segmented bar (16 segments) in teal / blue
   / purple. Legend row under it.
4. **14-day chart (h 74)**: 14 bars, 8px wide, 4px gap, 56px tall max; today =
   teal + 1px ink cap, others = `surfaceAlt` fill + `border` top; `MAX 1.64B`
   right label 8pt inkFaint; `14 DAYS` left label.
5. **Top models (h 66)**: up to 3 rows: rank chip 12×12 (panel, 8pt) · model
   name 8pt ink uppercase (truncate 22) · segmented bar 140×8 · tokens 8pt ·
   share 8pt inkDim.
6. **Live sessions (h 44)**: up to 2 rows: blink dot · project 8pt ink · model
   8pt inkDim · tokens 8pt · relative time 8pt inkDim; empty state
   `NO ACTIVE SESSIONS` 8pt inkFaint.
7. **Footer (h 16)**: 2px `pixelDivider` + `STREAK 9D` amber (flame sprite),
   `58 TURNS TODAY` inkDim, right `COLLECTOR 0.1.0` inkFaint.
8. Offline: hero shows `--` (or `OFFLINE` 24pt amber), keep stale content at
   45% opacity, footer `COLLECTOR NOT REACHABLE · 127.0.0.1:47118` amber +
   `AUTO RETRY`.

Animations: only discrete/step transitions; the 14-day chart and bars animate
value updates by snapping. No CSS-like gradients.

### 1.4 Real native app packaging

- Bundle `build/TokenIsland.app` must include:
  - `Contents/Resources/AppIcon.icns` (copy from `assets/appicon/AppIcon.icns`)
  - `Contents/Resources/fonts/Silkscreen-{Regular,Bold}.ttf` + the two `OFL-*.txt`
  - `Contents/Resources/summary.example.json` (existing)
  - Info.plist additions: `CFBundleIconFile=AppIcon`,
    `LSApplicationCategoryType=public.app-category.developer-tools`,
    `CFBundleShortVersionString 0.1.0`, `CFBundleVersion 1`,
    `NSHumanReadableCopyright Token Island · MIT`.
  - **Ad-hoc codesign** the bundle (`codesign --force --deep --sign -`) so
    `codesign --verify` passes and Gatekeeper is quiet locally.
- Register the bundled fonts at launch (`CTFontManagerRegisterFontsForURL`) and
  resolve the exact PostScript names once; `Font.custom("Silkscreen", size:)`
  (use the resolved name). Add a tiny `PixelFont` helper in Design/.
- **Native application chrome**:
  - `NSApplication` main menu: About Token Island (custom About window with
    icon + version + GitHub/MIT line), Preferences… (⌘,), Hide (⌘H), Hide
    Others, Show All, Quit (⌘Q). Activation policy `.accessory` (no Dock icon).
  - **Preferences window** (native NSWindow hosting SwiftUI, pixel-styled,
    460×380): collector port (number field, default 47118), refresh interval
    picker (1s / 2s / 5s), "launch at login" toggle (writes/removes the
    LaunchAgent via a helper — see below), "Open dashboard" button (opens cloud
    URL / `http://127.0.0.1:47117/u/<user>` when configured), version + data
    paths line. Persist UI settings in UserDefaults; never crash on bad config.
  - **Menu bar item**: pixel-art template NSImage generated at runtime from the
    `chart` sprite (18×18 at 2x, `isTemplate = true`) with menu: Show/Hide
    Island, Open Dashboard, Sync Cloud Now, Preferences…, About Token Island,
    Quit. Fallback to SF Symbol if template image fails.
  - Standard behavior: app stays alive when island hidden; reopening from the
    menu restores it; `applicationShouldHandleReopen` shows the island.
- **Packaging scripts**:
  - `scripts/build-app.sh` (update): build → assemble bundle → copy icon/fonts →
    ad-hoc codesign → verify with `codesign --verify --deep --strict` → print
    path; fail loudly if the icon or fonts are missing.
  - `scripts/package-dmg.sh` (new): build, then create
    `build/TokenIsland-0.1.0.dmg` (UDZO) with a staging folder containing
    `TokenIsland.app` and an `Applications` symlink; verify with
    `hdiutil verify` and print size.
  - `scripts/install.sh` (update): prefer the built `.app`, copy to
    `~/Applications`, keep the LaunchAgent (widget) install, and optionally
    install the collector LaunchAgent via the repo CLI (document in header,
    do not duplicate logic). `uninstall.sh` reverses everything.
- **Sandbox note for the builder**: you cannot write `~/Library` or
  `~/Applications` from the agent shell. Verify packaging with `--dry-run`-style
  paths or workspace-local targets (`--destination <repo>/.runtime/...`), and
  have the scripts print exactly what they would do. Do not claim you executed
  `install.sh`.
- Keep `--snapshot <out.png> --state collapsed|expanded|offline --fixture
  <path> --scale 1|2 --background wallpaper|transparent` and `--snapshot-all
  <dir>` (v1 §7.5). Snapshot output must use the pixel UI and include the
  app-icon-style wallpaper. `--demo` keeps working with the bundled fixture.
  Snapshot mode must not create a visible window and exits 0.
- Geometry logging from v1 stays (`[island] ...` on stderr).

### 1.5 Verification (report actual results)

```bash
bash apps/island-macos/scripts/build-app.sh
codesign --verify --deep --strict apps/island-macos/build/TokenIsland.app && echo signed-ok
bash apps/island-macos/scripts/package-dmg.sh
hdiutil verify apps/island-macos/build/TokenIsland-0.1.0.dmg
APP=apps/island-macos/build/TokenIsland.app/Contents/MacOS/TokenIsland
$APP --snapshot .runtime/island-expanded.png --state expanded --scale 2 --background wallpaper
$APP --snapshot-all .runtime/island-shots --scale 2
```

Inspect every snapshot yourself with `read_image` (iterate until it looks
intentionally pixel-perfect: no clipped text, no blurred edges, no rounded
corners except the window shape), then run the app with `--demo` for ≥3s,
confirm no crash, kill it, and report the geometry log + the screenshot paths.

---

## 2. Cloudflare-first cloud (`apps/cloud`) — owner: cloud-dev

Two runtimes, one codebase and one visual language:

- **Cloudflare Workers + D1** = the production target (`src/worker.ts`).
- **Node + SQLite** = local dev / Docker / tests (`src/node.ts`), must stay green.

Everything user-facing (SVG, pages) is shared pure code.

### 2.1 Structure

```
apps/cloud/
├── wrangler.toml                 # Workers config (name token-island-cloud, D1 binding DB, assets)
├── migrations/0001_init.sql      # D1 schema (users, days, meta)
├── public/fonts/                 # Silkscreen + VT323 + OFL (copied from assets/fonts)
├── src/
│   ├── worker.ts                 # export default { fetch } — Web APIs only
│   ├── node.ts                   # existing node:http entry (renamed from index.ts)
│   ├── store/
│   │   ├── types.ts              # CloudStore interface (async)
│   │   ├── d1-store.ts           # D1 implementation
│   │   └── node-store.ts         # node:sqlite implementation
│   ├── api.ts                    # shared request handlers (register/ingest/me/stats)
│   ├── auth.ts                   # hashing + api keys (WebCrypto, works in both runtimes)
│   ├── stats.ts                  # UserStats projection (pure)
│   ├── validate.ts
│   ├── render/
│   │   ├── badge.ts  chart.ts  card.ts  pages.ts  tokens.ts  frame.ts
│   └── seed.ts                   # node-only seeding (tsx)
└── test/                         # node:test suites (rendering + node store + api)
```

- `wrangler.toml`: `main = "src/worker.ts"`, `compatibility_date` recent,
  `[[d1_databases]] binding = "DB" database_name = "token-island-cloud"`,
  `[assets] directory = "./public" binding = "ASSETS"` (fonts/icon only).
- Worker routes must match v1 §6.3 exactly (register/me/ingest/badge/chart/
  card/dashboard/landing/healthz/api-v1-u-user). Collector sync code must work
  against a Worker URL unchanged.
- Auth: SHA-256 via `crypto.subtle.digest`; API keys `ti_<32 hex>` from
  `crypto.getRandomValues`. No node:crypto in the worker path.
- D1 SQL: keep the v1 schema (users, days), `INSERT … ON CONFLICT DO UPDATE`,
  batch upserts via `env.DB.batch([...])` for ingest. Include indexes.
- Node store keeps identical behaviour; both stores share one interface.
- CLI/package scripts: `worker:dev` (wrangler dev --local --port 47131),
  `worker:migrate` (wrangler d1 migrations apply --local), `worker:deploy`
  (wrangler deploy), `worker:dry-run` (wrangler deploy --dry-run --outdir dist),
  `worker:seed` (node seed against local D1 via wrangler dev? — instead allow
  `node src/seed.ts` for the Node runtime and document seeding the Worker by
  HTTP register+ingest; a small `scripts/seed-worker.ts` may POST to
  `http://127.0.0.1:47131`).
- Keep `Dockerfile`, `DEPLOY.md` (Node/Docker) and add
  `apps/cloud/DEPLOY-CLOUDFLARE.md` with copy-paste commands:
  `wrangler login`, `wrangler d1 create token-island-cloud`,
  set `database_id`, `wrangler d1 migrations apply --remote`,
  `wrangler deploy`, optional custom domain, `wrangler secret put
  TOKEN_ISLAND_ADMIN_TOKEN`, and how to point the collector
  (`tokenisland register --cloud https://<worker>.workers.dev`).
- Agent sandbox: point wrangler state and caches inside the repo:
  `XDG_CONFIG_HOME=<repo>/.runtime/xdg XDG_CACHE_HOME=<repo>/.runtime/xdg-cache`,
  `--persist-to <repo>/.runtime/wrangler-state`, and add `.wrangler/` to
  `.gitignore`-worthy local paths (Lead owns .gitignore; just use repo-local
  state). `wrangler` 4.120.1 is installed globally; `wrangler dev` is the
  intended local verification. `wrangler login` needs interactive auth — do NOT
  attempt it; `wrangler deploy --dry-run` is the deploy-time check you can run.

### 2.2 Pixel SVG design

Use `@token-island/core` pixel helpers only (palette, `pixelTextSvg`,
`pixelPanel`, `pixelInset`, `pixelDivider`, `pixelSegmentedBar`, `pixelBar`,
`pixelSpriteSvg`, `pixelDitherDefs`, `pixelHeatColor`). All output must be
self-contained (no webfonts, no external refs) and valid XML.

**Badge** (`/u/:user/badge.svg?metric=…&theme=dark|light&style=flat|flat-square&label=&days=`):
- height 24 (flat) / 22 (flat-square), 2px border `#57507a` (dark) or
  `#b9b3d0` (light), staircase corners, 2px hard shadow beneath (dark theme).
- layout: 6px padding · icon sprite (metric-specific: coin/chart/flame/bolt/
  clock) at scale 1 (7px tall) · label text scale 2 `inkDim` · 8px · value
  text scale 2 in accent-filled block (accent = metric color; text `#0b0b12`
  on bright accents, `ink` on purple/blue).
- width = 6 + icon + 6 + labelWidth + 10 + valueWidth + 8 (integer).
- Metrics/colors as v1 (tokens teal, cost purple, streak amber, messages blue,
  day/status blue, model blue).
- Unknown user: keep the 404 badge, pixel-styled `NO DATA`.

**Charts** (`chart.svg?type=line|bar|heatmap|models&days=&theme=&width=&height=`):
- Panel: `PIXEL.bg` fill, 2px `border` frame, 2px corner steps, optional
  1px dither grid; header row: title scale 3 · right summary scale 2 inkDim.
- line: staircase polyline drawn as 2px thick vertical/horizontal rects
  (no `<polyline>` with joins), area under the line filled with a dither
  pattern (2px checker), y-grid 1px dashed `#241f38`, y labels scale 2
  inkFaint (0 / mid / max), x labels scale 2 (`MMM D`) first/mid/last.
  Missing days are zero. Empty data → pixel "NO DATA YET" centered.
- bar: 10px-wide bars, 3px gap, today highlighted teal with an ink cap.
- heatmap: 7 rows × weeks, 12px cells with 3px gaps, 4 intensity levels via
  `pixelHeatColor`, month labels scale 1? use scale 2 for legibility, weekday
  labels MON/WED/FRI scale 2, legend LESS→MORE.
- models: top-5 model names scale 2 · segmented bar 200×8 · tokens + share
  scale 2; color per model family (teal/purple/blue/amber/red rotation).
- Default sizes: line/bar 760×220, heatmap 840×190, models 760×260; `width`
  320–1200, `height` 120–400, clamped and snapped to integers.
- Theme: dark default; light uses `PIXEL.bg`→`#f4f2ff`, text `#1b1928`,
  surfaces lighter, same accents (darkened one step where needed).

**Card** (`card.svg?theme=&width=`):
520×240 pixel panel: 48×48 avatar block with the uppercase initial (pixel
frame), `@user` scale 3, `AI AGENT TOKEN USAGE` scale 1 inkDim, big total
tokens scale 4/6, `~$` cost scale 2 purple, stats row (STREAK / ACTIVE DAYS /
AVG PER DAY) scale 2, 30-day sparkline (pixel bars 140×56), bottom model chips
(scale 1 panels), footer `TOKEN-ISLAND` scale 1 inkFaint + `SYNCED …`.

**HTML** (`/u/:user`, `/`):
- `@font-face` for Silkscreen (400/700) and VT323, served from `/fonts/*`
  (`ASSETS` binding on the Worker; static file server on Node).
- body: `PIXEL.bg` with a 4px checkerboard CSS pattern; panels as above
  (`border:2px solid`, `box-shadow:4px 4px 0 #05050c`, zero radius).
- Landing: keep the current information architecture (hero, live demo card,
  3 setup steps, API table, footer) but pixel-styled; hero headline in
  Silkscreen scale 6 (48–64px), a pixel "scanline" divider; buttons with hard
  shadow + `:active { transform: translate(2px,2px) }`.
- Dashboard: stats cards, charts inline (server-rendered SVG), tables, embed
  snippets with copy buttons (keep the working clipboard JS), sync info,
  theme switch links. All user text escaped, no external resources, no
  client-side framework.
- Keep Chinese copy where present; the UI language stays as shipped.

### 2.3 Verification (report actual results)

```bash
pnpm install                                   # picks up new package deps
pnpm --filter @token-island/cloud typecheck
pnpm --filter @token-island/cloud test         # ≥22 tests, pixel SVG assertions included
export XDG_CONFIG_HOME=$PWD/.runtime/xdg XDG_CACHE_HOME=$PWD/.runtime/xdg-cache
pnpm --filter @token-island/cloud worker:migrate   # local D1
pnpm --filter @token-island/cloud worker:dev       # port 47131 (background)
# curl register/ingest/badges/charts/card/pages + validate XML
pnpm --filter @token-island/cloud worker:dry-run   # bundle builds without auth
pnpm --filter @token-island/cloud start            # node runtime still works
```

Render your pixel output to PNG with the headless shell available on this
machine and inspect with `read_image`:

```
~/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell \
  --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --user-data-dir=<repo>/.runtime/chrome --force-device-scale-factor=2 \
  --window-size=W,H --screenshot=out.png <url>
```

Iterate until badges/charts/card/pages are visually consistent with the app
icon and palette. Report screenshot paths + what you saw.

---

## 3. Collector

**No changes required.** The cloud URL is configuration
(`config.cloud.url` + API key); a Worker URL works unchanged. Do not touch
`apps/collector`.

## 4. QA / docs — owner: qa-docs (spawned after §1/§2 land)

- Update `scripts/e2e.ts`: keep Node phases; add Cloudflare phase
  (wrangler available? → migrate local + `wrangler dev` on 47131 + assertions;
  skip cleanly when wrangler/D1 is unavailable), pixel-SVG sanity checks, and
  island snapshot dims.
- Re-capture `docs/images/`: island collapsed/expanded/offline (pixel),
  real-data variant, app icon, badges dark/light, charts, card, landing,
  dashboard dark/light (all <350KB).
- Re-export `docs/badges/` from the running cloud (pixel SVGs).
- README rewrite for V2: pixel screenshots, native app install (`DMG` / drag to
  Applications / menu bar / preferences / launch at login), Cloudflare deploy
  section at the same priority as Docker, config, privacy, FAQ.
- `docs/ARCHITECTURE.md`: add runtime diagram (Worker/D1 + Node dual runtime).
- CLI: `tokenisland cloud dev|deploy` helpers, `island` commands updated for
  DMG, `doctor` checks (wrangler presence, worker port), help text.
- Verify `pnpm typecheck`, `pnpm test`, `pnpm e2e` all green and no stray
  processes/ports after runs.

## 5. Reporting

Same as v1 §9 (≤30 lines): task id, files, commands + actual results,
deviations, limitations, integration notes. Never claim a verification you did
not run. Do not edit files outside your scope; if a shared change is needed,
message the Lead (`send_message agent:"lead"`).
