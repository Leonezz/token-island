# Deploying the Token Island cloud

The cloud is a single dependency-free Node service: `node:http` + `node:sqlite`.
It stores only daily aggregates (tokens, cost, messages, per-model token maps) —
never prompts, paths, session ids or API keys in clear text (only sha256 hashes).

- **Container port**: `8080`
- **Health check**: `GET /healthz`
- **Persistent data**: one SQLite file at `TOKEN_ISLAND_CLOUD_DB` (default `/data/cloud.db`)
- **Replicas**: exactly **1**. SQLite is a single-writer database; do not scale
  horizontally unless you replace the storage layer.

## Build & run locally with Docker

The build context is the **repository root** (the service imports
`@token-island/core` from the pnpm workspace):

```bash
docker build -f apps/cloud/Dockerfile -t token-island-cloud .
docker run --rm -p 8080:8080 \
  -v token-island-data:/data \
  -e TOKEN_ISLAND_ADMIN_TOKEN="$(openssl rand -hex 24)" \
  token-island-cloud
```

Then seed the demo data inside the container (or run the seed against the same
database once):

```bash
docker exec -it <container> node --import tsx apps/cloud/src/seed.ts
```

## Railway

1. **Create a project** from this repository. Railway reads
   [`railway.json`](./railway.json): Dockerfile builder, health check `/healthz`,
   restart on failure. Leave the *Root Directory* at the repository root — the
   Dockerfile expects the full workspace as build context.
2. **Add a volume** and mount it at `/data` (service → *Volumes* → mount path
   `/data`). Without a volume the SQLite database is lost on every deploy.
3. **Set variables** (service → *Variables*):

   | Variable | Value | Notes |
   | --- | --- | --- |
   | `TOKEN_ISLAND_ADMIN_TOKEN` | a long random string | Required in production: `POST /api/v1/register` then needs `Authorization: Bearer <admin token>`. |
   | `TOKEN_ISLAND_PUBLIC_URL` | `https://<your-domain>` | Optional but recommended — used in generated badge/embed snippets. |
   | `TOKEN_ISLAND_CLOUD_DB` | `/data/cloud.db` | Already set in the image; override only if you mount elsewhere. |
   | `PORT` | `8080` | Already set in the image; Railway injects its own port only for non-Docker builders. |
   | `TOKEN_ISLAND_ALLOW_REGISTER` | `0` | Optional: disable open registration entirely. |

4. **Generate a domain** (Settings → Networking → *Generate Domain*) and open
   `https://<domain>/`. Seed the demo profile if you want the landing page to be
   populated:

   ```bash
   TOKEN_ISLAND_CLOUD_DB=/data/cloud.db node --import tsx apps/cloud/src/seed.ts
   ```

   The seed prints the API keys (only once — re-run with `--rotate` to issue new
   keys) and the copy-paste badge/chart/card URLs.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `47117` (`8080` in Docker) | HTTP port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `TOKEN_ISLAND_CLOUD_DB` | `./data/cloud.db` (relative to repo root) | SQLite database path; parent directories are created on boot. |
| `TOKEN_ISLAND_ADMIN_TOKEN` | unset | When set, registration requires this token as a bearer credential. |
| `TOKEN_ISLAND_ALLOW_REGISTER` | `1` | Set to `0`/`false` to disable open registration. |
| `TOKEN_ISLAND_PUBLIC_URL` | inferred from the request | Absolute base URL used in generated snippets. |

## Operations

- **Backups**: copy `/data/cloud.db` while the service is idle, or use
  `sqlite3 /data/cloud.db ".backup /data/backup.db"` (WAL mode is enabled; the
  `.backup` command is safe while running).
- **Restart/upgrade**: deploys restart the container; schema migrations run
  automatically on boot (`PRAGMA user_version`) and are forward-only.
- **Health**: `GET /healthz` returns `{ ok, users, days, uptimeSec }`. The
  Railway health check and the Docker `HEALTHCHECK` both use it.
- **Privacy**: the service exposes public profiles at `/u/:user`; it answers
  `robots.txt` with `Disallow: /` so profiles are not indexed. Keep the API keys
  secret — they are only shown once at registration.
