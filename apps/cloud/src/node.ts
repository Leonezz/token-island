#!/usr/bin/env node
/**
 * Node + SQLite runtime for the Token Island cloud (local dev, Docker, tests).
 *
 *   PORT=47117 TOKEN_ISLAND_CLOUD_DB=./data/cloud.db node --import tsx src/node.ts
 *
 * This file is the only node-specific runtime glue: it adapts `node:http`
 * requests to the Web `Request`/`Response` handler in `api.ts`, wires the
 * `NodeStore` (built-in `node:sqlite`) and serves `public/fonts/*` from disk.
 * The Cloudflare Worker entry (`worker.ts`) shares everything above that.
 *
 * Exits non-zero on boot failure (port in use, unwritable database) and shuts
 * down gracefully on SIGINT/SIGTERM.
 */

import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleRequest, type AppEnv, type AssetFetcher, type CloudRuntimeConfig } from './api.js';
import { loadConfig } from './config.js';
import { MAX_BODY_BYTES, MAX_REGISTER_BODY_BYTES } from './validate.js';
import { NodeStore } from './store/node-store.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const FONTS_DIR = resolve(PUBLIC_DIR, 'fonts');
/** Node buffers request bodies itself; this hard cap precedes the api.ts limits. */
const BODY_HARD_LIMIT = Math.max(MAX_BODY_BYTES, MAX_REGISTER_BODY_BYTES) + 64 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
};

/** Static `/fonts/*` server with traversal protection. */
export function createStaticAssets(): AssetFetcher {
  const base = FONTS_DIR + sep;
  return {
    async fetch(request: Request): Promise<Response> {
      let pathname: string;
      try {
        pathname = new URL(request.url).pathname;
      } catch {
        return new Response(null, { status: 400 });
      }
      if (!pathname.startsWith('/fonts/')) return new Response(null, { status: 404 });
      let relative: string;
      try {
        relative = decodeURIComponent(pathname.slice('/fonts/'.length));
      } catch {
        return new Response(null, { status: 400 });
      }
      if (relative === '' || relative.includes('..') || relative.includes('\\') || relative.includes('\0')) {
        return new Response(null, { status: 404 });
      }
      const filePath = resolve(FONTS_DIR, relative);
      if (!filePath.startsWith(base)) return new Response(null, { status: 404 });
      try {
        const data = await readFile(filePath);
        return new Response(data, {
          status: 200,
          headers: {
            'Content-Type': CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
          },
        });
      } catch {
        return new Response(null, { status: 404 });
      }
    },
  };
}

export interface CloudAppOptions {
  dbPath: string;
  host?: string;
  port?: number;
  adminToken?: string | null;
  allowRegister?: boolean;
  publicUrl?: string | null;
  now?: () => number;
  assets?: AssetFetcher | null;
}

export interface ListenResult {
  host: string;
  port: number;
}

export interface NodeApp {
  server: Server;
  store: NodeStore;
  startedAt: number;
  listen(): Promise<ListenResult>;
  close(): Promise<void>;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function buildRequestUrl(req: IncomingMessage, fallbackPort: number): string {
  const raw = req.url && req.url.startsWith('/') ? req.url : '/';
  const forwardedProto = firstHeader(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim();
  const forwardedHost = firstHeader(req.headers['x-forwarded-host'])?.split(',')[0]?.trim();
  const host = forwardedHost || firstHeader(req.headers.host) || `127.0.0.1:${fallbackPort}`;
  const proto = forwardedProto === 'https' ? 'https' : 'http';
  const safeHost = /^[a-zA-Z0-9.\-:[\]]{1,200}$/.test(host) ? host : `127.0.0.1:${fallbackPort}`;
  return `${proto}://${safeHost}${raw}`;
}

async function readRawBody(req: IncomingMessage, limit: number): Promise<Uint8Array | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buffer.length;
    if (size > limit) return null;
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Creates the cloud HTTP server (without binding a port yet).  Opening the
 * database happens eagerly so boot failures are visible immediately.
 */
export function createNodeApp(options: CloudAppOptions): NodeApp {
  const store = new NodeStore(options.dbPath);
  const startedAt = Date.now();
  const config: CloudRuntimeConfig = {
    adminToken: options.adminToken ?? null,
    allowRegister: options.allowRegister ?? true,
    publicUrl: options.publicUrl ?? null,
  };
  const env: AppEnv = {
    store,
    config,
    startedAt,
    now: options.now,
    assets: options.assets === undefined ? createStaticAssets() : options.assets,
  };

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const method = (req.method ?? 'GET').toUpperCase();
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (value === undefined) continue;
          try {
            headers.set(name, Array.isArray(value) ? value.join(',') : value);
          } catch {
            // ignore malformed header names/values
          }
        }
        let body: Uint8Array | undefined;
        if (method !== 'GET' && method !== 'HEAD') {
          const raw = await readRawBody(req, BODY_HARD_LIMIT);
          if (raw === null) {
            res.statusCode = 413;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: { code: 'payload_too_large', message: 'request body is too large' } }));
            return;
          }
          body = raw;
        }
        const request = new Request(buildRequestUrl(req, options.port ?? 47117), {
          method,
          headers,
          body,
        });
        const response = await handleRequest(request, env);
        res.statusCode = response.status;
        response.headers.forEach((value, name) => {
          try {
            res.setHeader(name, value);
          } catch {
            // ignore headers Node refuses
          }
        });
        if (method === 'HEAD' || response.status === 204 || response.status === 304) {
          res.end();
          return;
        }
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        console.error('[cloud] fatal request handler error:', error);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: { code: 'internal_error', message: 'internal server error' } }));
        } else {
          res.destroy();
        }
      }
    })();
  });

  return {
    server,
    store,
    startedAt,
    listen(): Promise<ListenResult> {
      return new Promise<ListenResult>((resolvePromise, rejectPromise) => {
        const port = options.port ?? 47117;
        const host = options.host ?? '0.0.0.0';
        const onError = (error: Error): void => {
          server.off('listening', onListening);
          rejectPromise(error);
        };
        const onListening = (): void => {
          server.off('error', onError);
          const address = server.address();
          if (address && typeof address === 'object') {
            resolvePromise({ host: address.address, port: address.port });
          } else {
            resolvePromise({ host, port });
          }
        };
        server.once('error', onError);
        server.once('listening', onListening);
        try {
          server.listen(port, host);
        } catch (error) {
          server.off('error', onError);
          server.off('listening', onListening);
          rejectPromise(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    close(): Promise<void> {
      return new Promise<void>((resolvePromise) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          try {
            store.close();
          } catch (error) {
            console.error('[cloud] failed to close database:', error);
          }
          resolvePromise();
        };
        if (!server.listening) {
          finish();
          return;
        }
        const timer = setTimeout(() => {
          server.closeAllConnections();
        }, 3_000);
        timer.unref();
        server.close(() => {
          clearTimeout(timer);
          finish();
        });
        server.closeIdleConnections();
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

function log(message: string): void {
  process.stdout.write(`[cloud] ${message}\n`);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function displayHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1';
  return host;
}

async function main(): Promise<void> {
  const config = loadConfig();

  let app: NodeApp;
  try {
    app = createNodeApp({
      dbPath: config.dbPath,
      host: config.host,
      port: config.port,
      adminToken: config.adminToken,
      allowRegister: config.allowRegister,
      publicUrl: config.publicUrl,
    });
  } catch (error) {
    process.stderr.write(`[cloud] failed to open database ${config.dbPath}: ${errorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const address = await app.listen();
    log(`listening on http://${displayHost(address.host)}:${address.port}`);
    log(`database: ${config.dbPath}`);
    log(`fonts: ${PUBLIC_DIR}fonts/`);
    log(`runtime: node (sqlite) — Cloudflare Worker entry: src/worker.ts`);
    log(
      config.adminToken
        ? 'registration requires TOKEN_ISLAND_ADMIN_TOKEN'
        : config.allowRegister
          ? 'open registration enabled (set TOKEN_ISLAND_ADMIN_TOKEN to lock it down)'
          : 'registration disabled',
    );
  } catch (error) {
    process.stderr.write(
      `[cloud] failed to bind ${config.host}:${config.port}: ${errorMessage(error)}\n`,
    );
    await app.close();
    process.exitCode = 1;
    return;
  }

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received — shutting down`);
    const timer = setTimeout(() => {
      process.stderr.write('[cloud] graceful shutdown timed out, forcing exit\n');
      process.exit(1);
    }, 3_000);
    timer.unref();
    void app.close().then(() => {
      clearTimeout(timer);
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[cloud] unhandled rejection: ${errorMessage(reason)}\n`);
  });
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPath !== '' && entryPath === fileURLToPath(import.meta.url)) {
  void main();
}
