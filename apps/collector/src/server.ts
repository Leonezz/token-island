/**
 * Local read-only HTTP API for the widget / CLI (`127.0.0.1:47118`, demo `47119`).
 *
 * Every response is JSON with `Access-Control-Allow-Origin: *` and
 * `Cache-Control: no-store`.  `/api/summary` is served from the in-memory
 * `EventAggregator` (microseconds, no SQL scans).
 */

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  CloudSyncStatus,
  CollectorMeta,
  Range,
  SourceStatus,
  Summary,
} from '@token-island/core';
import { RANGES } from '@token-island/core';
import type { EventAggregator } from '@token-island/core';
import { renderCollectorDashboardHtml } from './dashboard.js';
import type { CollectorSourceId } from './sources/types.js';
import type { SyncResult } from './sync.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_DAILY_DAYS = 14;
const IMPLEMENTED_SOURCES: CollectorSourceId[] = ['claude', 'codex', 'opencode', 'dsh'];

export interface CollectorServerContext {
  version: string;
  demo: boolean;
  dbPath: string;
  startedAt: number;
  /** IANA timezone. */
  timezone: string;
  liveWindowMs: number;
  aggregator: EventAggregator;
  sources: () => SourceStatus[];
  watchRoots: () => string[];
  cloudStatus: () => CloudSyncStatus;
  stats: () => { events: number; lastEventAt: number | null };
  /** Kicks off a background rescan; never awaited by the HTTP handler. */
  scan: (source?: CollectorSourceId) => void;
  /** Manual cloud sync trigger; null in demo mode. */
  sync: (() => Promise<SyncResult>) | null;
  now?: () => number;
}

export interface CollectorServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function baseHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...baseHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function sendHtml(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    ...baseHeaders(),
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
  });
  response.end(html);
}

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  sendJson(response, status, { error: { code, message } });
}

function isRange(value: string): value is Range {
  return (RANGES as string[]).includes(value);
}

function parseRange(url: URL): Range {
  const raw = url.searchParams.get('range') ?? 'today';
  if (!isRange(raw)) {
    throw new HttpError(400, 'invalid_range', `range must be one of: ${RANGES.join(', ')}`);
  }
  return raw;
}

function parseDailyDays(url: URL): number {
  const raw = url.searchParams.get('days');
  if (raw === null || raw.trim().length === 0) return DEFAULT_DAILY_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new HttpError(400, 'invalid_days', 'days must be a number');
  }
  return Math.min(366, Math.max(1, Math.floor(parsed)));
}

function collectorMeta(ctx: CollectorServerContext, now: number): CollectorMeta {
  return {
    version: ctx.version,
    uptimeSec: Math.max(0, Math.floor((now - ctx.startedAt) / 1000)),
    dbPath: ctx.dbPath,
    watchRoots: ctx.watchRoots(),
    sources: ctx.sources(),
    cloud: ctx.cloudStatus(),
  };
}

function buildSummary(ctx: CollectorServerContext, url: URL, now: number): Summary {
  const range = parseRange(url);
  const dailyDays = parseDailyDays(url);
  return ctx.aggregator.finalize({
    range,
    dailyDays,
    now,
    liveWindowMs: ctx.liveWindowMs,
    collector: collectorMeta(ctx, now),
  });
}

function methodNotAllowed(response: ServerResponse, allowed: string): void {
  response.setHeader('Allow', allowed);
  sendError(response, 405, 'method_not_allowed', `method not allowed (allowed: ${allowed})`);
}

async function handleRequest(
  ctx: CollectorServerContext,
  request: IncomingMessage,
  response: ServerResponse,
  port: number,
  cleanups: Set<() => void>,
): Promise<void> {
  const nowFn = ctx.now ?? Date.now;
  const method = (request.method ?? 'GET').toUpperCase();
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);

  if (method === 'OPTIONS') {
    response.writeHead(204, baseHeaders());
    response.end();
    return;
  }

  if (method === 'POST') {
    const declared = Number(request.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      request.destroy();
      sendError(response, 413, 'payload_too_large', `body must be at most ${MAX_BODY_BYTES} bytes`);
      return;
    }
    request.resume();
  }

  const pathname = url.pathname;

  if (pathname === '/' || pathname === '/dashboard') {
    if (method !== 'GET' && method !== 'HEAD') return methodNotAllowed(response, 'GET, HEAD');
    const html = renderCollectorDashboardHtml({ version: ctx.version, demo: ctx.demo });
    if (method === 'HEAD') {
      response.writeHead(200, {
        ...baseHeaders(),
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html),
      });
      response.end();
      return;
    }
    sendHtml(response, 200, html);
    return;
  }

  if (pathname === '/favicon.ico') {
    response.writeHead(204, baseHeaders());
    response.end();
    return;
  }

  if (pathname === '/api/health') {
    if (method !== 'GET') return methodNotAllowed(response, 'GET');
    const now = nowFn();
    const stats = ctx.stats();
    sendJson(response, 200, {
      ok: true,
      version: ctx.version,
      uptimeSec: Math.max(0, Math.floor((now - ctx.startedAt) / 1000)),
      port,
      demo: ctx.demo,
      dbPath: ctx.dbPath,
      sources: ctx.sources(),
      events: stats.events,
      lastEventAt: stats.lastEventAt,
      startedAt: ctx.startedAt,
    });
    return;
  }

  if (pathname === '/api/summary') {
    if (method !== 'GET') return methodNotAllowed(response, 'GET');
    const summary = buildSummary(ctx, url, nowFn());
    sendJson(response, 200, summary);
    return;
  }

  if (pathname === '/api/version') {
    if (method !== 'GET') return methodNotAllowed(response, 'GET');
    sendJson(response, 200, { version: ctx.version, demo: ctx.demo });
    return;
  }

  if (pathname === '/api/cloud/sync') {
    if (method !== 'POST') return methodNotAllowed(response, 'POST');
    if (!ctx.sync) {
      sendJson(response, 200, {
        ok: false,
        lastSyncAt: ctx.cloudStatus().lastSyncAt,
        disabled: true,
        error: 'cloud sync is disabled in demo mode',
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
        error: result.error,
      });
      return;
    }
    sendJson(response, 502, {
      error: { code: 'cloud_sync_failed', message: result.error ?? 'cloud sync failed' },
    });
    return;
  }

  if (pathname === '/api/rescan') {
    if (method !== 'POST') return methodNotAllowed(response, 'POST');
    const source = url.searchParams.get('source');
    if (source !== null && !IMPLEMENTED_SOURCES.includes(source as CollectorSourceId)) {
      throw new HttpError(
        400,
        'invalid_source',
        `source must be one of: ${IMPLEMENTED_SOURCES.join(', ')}`,
      );
    }
    ctx.scan(source ? (source as CollectorSourceId) : undefined);
    sendJson(response, 202, { ok: true });
    return;
  }

  if (pathname === '/api/events/stream') {
    if (method !== 'GET') return methodNotAllowed(response, 'GET');
    const range = parseRange(url);
    const days = parseDailyDays(url);
    response.writeHead(200, {
      ...baseHeaders(),
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const push = (): void => {
      try {
        const summary = ctx.aggregator.finalize({
          range,
          dailyDays: days,
          now: nowFn(),
          liveWindowMs: ctx.liveWindowMs,
          collector: collectorMeta(ctx, nowFn()),
        });
        response.write(`event: summary\ndata: ${JSON.stringify(summary)}\n\n`);
      } catch {
        // Never let a stale stream crash the server.
      }
    };
    push();
    const timer = setInterval(push, 2_000);
    timer.unref?.();
    const cleanup = (): void => {
      clearInterval(timer);
      try {
        response.end();
      } catch {
        // Already closed.
      }
    };
    cleanups.add(cleanup);
    request.on('close', () => {
      cleanups.delete(cleanup);
      clearInterval(timer);
    });
    return;
  }

  sendError(response, 404, 'not_found', `no route for ${method} ${pathname}`);
}

export async function createCollectorServer(
  ctx: CollectorServerContext,
  options: { host?: string; port: number },
): Promise<CollectorServer> {
  const host = options.host ?? '127.0.0.1';
  const cleanups = new Set<() => void>();
  let boundPort = options.port;
  const server = createServer((request, response) => {
    void handleRequest(ctx, request, response, boundPort, cleanups).catch((error: unknown) => {
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
        'internal_error',
        error instanceof Error ? error.message : 'internal error',
      );
    });
  });
  server.on('clientError', (_error, socket) => {
    try {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    } catch {
      // Ignore.
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      const address = server.address();
      if (address && typeof address === 'object') boundPort = (address as AddressInfo).port;
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, host);
  });

  return {
    server,
    port: boundPort,
    close: async (): Promise<void> => {
      for (const cleanup of [...cleanups]) cleanup();
      cleanups.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
