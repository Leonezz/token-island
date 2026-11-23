# syntax=docker/dockerfile:1
#
# Token Island cloud — dependency-free Node HTTP service.
#
# Build context is the REPOSITORY ROOT (not apps/cloud), because the service
# imports the workspace package @token-island/core:
#
#   docker build -f apps/cloud/Dockerfile -t token-island-cloud .
#   docker run --rm -p 8080:8080 -v token-island-data:/data token-island-cloud
#
FROM node:22-alpine

# pnpm is pinned by the root package.json ("packageManager": "pnpm@10.33.0").
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Workspace manifests first so `pnpm install` is cacheable.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc ./
COPY packages/core/package.json packages/core/package.json
COPY apps/cloud/package.json apps/cloud/package.json

# tsx/typescript/@types/node live in the root devDependencies; --prod=false keeps
# them available for the runtime (the service runs TypeScript through tsx).
RUN corepack pnpm install --prod=false --frozen-lockfile

# Sources (only what the cloud service and its workspace dependency need).
COPY packages/core/src packages/core/src
COPY apps/cloud/tsconfig.json apps/cloud/tsconfig.json
COPY apps/cloud/src apps/cloud/src

ENV NODE_ENV=production \
    NODE_OPTIONS=--no-warnings \
    PORT=8080 \
    HOST=0.0.0.0 \
    TOKEN_ISLAND_CLOUD_DB=/data/cloud.db

# SQLite lives on a volume: mount /data to keep users and daily aggregates.
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(function(r){if(!r.ok)process.exit(1);process.exit(0)}).catch(function(){process.exit(1)})"

CMD ["node", "--import", "tsx", "apps/cloud/src/index.ts"]
