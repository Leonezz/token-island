# Deploying the Token Island cloud on Cloudflare Workers + D1

The Cloudflare Worker is the **production** runtime. It shares every route,
renderer and storage semantic with the Node runtime (`src/node.ts`) through
`src/api.ts`; only the storage adapter changes (D1 instead of SQLite) and the
pixel fonts are served from the static `ASSETS` binding.

```
apps/cloud/
├── wrangler.toml            # Worker + D1 (binding DB) + assets (binding ASSETS)
├── migrations/0001_init.sql # users / days / meta schema (same as the Node DB)
├── public/fonts/            # Silkscreen Regular+Bold, VT323, OFL licenses
└── src/worker.ts            # export default { fetch } — Web APIs only
```

## 0. Prerequisites

- Node 22.23+, pnpm 10
- a Cloudflare account with Workers + D1 enabled
- `wrangler` (this repo was verified with 4.120.1; `npm i -g wrangler@4`)

```bash
cd apps/cloud
wrangler --version
```

> **Local sandbox note (this repo / CI):** keep wrangler state inside the repo so
> nothing is written to `$HOME`:
> `export XDG_CONFIG_HOME=$PWD/../../.runtime/xdg XDG_CACHE_HOME=$PWD/../../.runtime/xdg-cache`
> and pass `--persist-to ../../.runtime/wrangler-state`. The `package.json`
> scripts below already do this by default. Do **not** run `wrangler login` in a
> non-interactive shell — it needs a browser.

## 1. Log in

```bash
wrangler login
# or, CI-friendly: set CLOUDFLARE_API_TOKEN (Workers Scripts:Edit + D1:Edit)
# export CLOUDFLARE_API_TOKEN=...
wrangler whoami
```

## 2. Create the D1 database

```bash
wrangler d1 create token-island-cloud
```

Copy the printed `database_id` into [`wrangler.toml`](./wrangler.toml):

```toml
[[d1_databases]]
binding = "DB"
database_name = "token-island-cloud"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"   # <- paste here
migrations_dir = "migrations"
```

`database_name` must stay `token-island-cloud` (that is what the scripts use).

## 3. Apply the schema

Local (used by `wrangler dev`):

```bash
pnpm --filter @token-island/cloud worker:migrate
# == wrangler d1 migrations apply token-island-cloud --local --persist-to ...
```

Remote (production D1):

```bash
wrangler d1 migrations apply token-island-cloud --remote
# verify:
wrangler d1 execute token-island-cloud --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
# -> users, days, meta, d1_migrations
```

Migrations are forward-only; add `migrations/0002_*.sql` for schema changes.

## 4. Deploy

```bash
pnpm --filter @token-island/cloud worker:dry-run   # bundle + bindings check (no auth)
pnpm --filter @token-island/cloud worker:deploy    # wrangler deploy
```

`wrangler deploy` prints the Worker URL, e.g.
`https://token-island-cloud.<your-subdomain>.workers.dev`.
Open `/` and `/healthz` to confirm the Worker is live, then smoke-test the
pixel assets:

```bash
BASE=https://token-island-cloud.<your-subdomain>.workers.dev
curl -s "$BASE/healthz"
curl -sI "$BASE/u/demo/badge.svg"        # 404 until you seed/register
curl -s  "$BASE/" | head -20             # landing page
```

## 5. Optional custom domain

Cloudflare Dashboard → **Workers & Pages → token-island-cloud → Settings →
Domains & Routes → Add custom domain** (e.g. `token-island.example.com`; the
zone must be on Cloudflare). Or in `wrangler.toml`:

```toml
[[routes]]
pattern = "token-island.example.com"
custom_domain = true
```

Then set the public base URL used by generated snippets:

```toml
[vars]
TOKEN_ISLAND_PUBLIC_URL = "https://token-island.example.com"
```

(or `wrangler secret put TOKEN_ISLAND_PUBLIC_URL` if you prefer a secret).

## 6. Lock down registration (admin secret)

Open registration is the default for local dev. In production set an admin
token — `POST /api/v1/register` then requires
`Authorization: Bearer <TOKEN_ISLAND_ADMIN_TOKEN>`:

```bash
wrangler secret put TOKEN_ISLAND_ADMIN_TOKEN
# paste a long random string, e.g. `openssl rand -hex 24`
```

Other Worker variables (plain `[vars]` in wrangler.toml or `wrangler secret put`):

| Name | Default | Meaning |
| --- | --- | --- |
| `TOKEN_ISLAND_ALLOW_REGISTER` | `1` | `0` disables open registration entirely. |
| `TOKEN_ISLAND_PUBLIC_URL` | request origin | absolute base URL in generated badge/embed snippets. |
| `TOKEN_ISLAND_ADMIN_TOKEN` | unset | when set, registration needs this bearer token (**use a secret**). |

## 7. Seed demo data / register the collector

The Worker has no filesystem, so seed it over HTTP (or just use the real
collector). Demo profile:

```bash
pnpm --filter @token-island/cloud worker:seed
# == node --import tsx scripts/seed-worker.ts --url http://127.0.0.1:47131
# prints the demo API key + URLs; against production:
#   node --import tsx apps/cloud/scripts/seed-worker.ts --url https://<worker-url>
```

Register a real profile and point the collector at the Worker URL (the
collector/cLI code is unchanged — it only needs a URL + API key):

```bash
curl -s -X POST https://<worker-url>/api/v1/register \
  -H 'content-type: application/json' \
  -d '{"username":"you","displayName":"You"}'
# -> { "username":"you", "apiKey":"ti_<32 hex>", ... }  (shown once)

# ~/.token-island/config.json
# { "cloud": { "enabled": true, "url": "https://<worker-url>",
#              "username": "you", "apiKey": "ti_…", "autoSync": true } }
tokenisland sync
```

Or use `tokenisland register --cloud https://<worker-url>` (writes the collector
config) and then `tokenisland sync`.

## 8. Local Worker development

```bash
# from apps/cloud (or with -w via pnpm --filter)
pnpm --filter @token-island/cloud worker:migrate   # local D1
pnpm --filter @token-island/cloud worker:dev       # http://127.0.0.1:47131
pnpm --filter @token-island/cloud worker:seed      # demo profile over HTTP
```

Local D1 data persists under `.runtime/wrangler-state/` (repo-relative, ignored
by git). `wrangler dev` hot-reloads on source changes; `Ctrl-C` stops it.

The Worker bundle must stay dependency-free (Web APIs + D1 only). `wrangler dev`
runs `src/worker.ts`; Node-only modules (`src/node.ts`, `node:sqlite`,
`node:http`) are never imported by it.

## 9. Tests / verification

```bash
pnpm --filter @token-island/cloud typecheck
pnpm --filter @token-island/cloud test        # node:test, shared api+renderers
pnpm --filter @token-island/cloud worker:migrate
pnpm --filter @token-island/cloud worker:dry-run
# then run worker:dev and curl /healthz + badge/chart/card/pages as in §4
```

## 10. Limits & notes

- `compatibility_date = "2026-08-01"`: newer dates are rejected by the local
  workerd bundled with wrangler 4.120.1; bump it when you upgrade wrangler.
- D1 free-plan query limits can throttle very large backfills (a 400-day ingest
  is ~401 upsert queries, chunked into batches of 100). Paid plans are fine;
  for free plans reduce the collector backfill window.
- D1 is single-writer-per-database; latest-wins upserts are idempotent and safe
  to retry.
- Static assets are only the fonts (`public/`), served with a 1h cache. Every
  SVG/HTML response is rendered by the Worker and cached via
  `Cache-Control: public, max-age=300, s-maxage=300`.
- Privacy is unchanged: only daily aggregate numbers are stored, API keys only
  as sha256 hashes, `robots.txt` disallows indexing.
