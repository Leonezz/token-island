/**
 * Zero-dependency HTTP server for the Token Island cloud.
 *
 * Routes (see docs/CONTRACT.md §6):
 *   GET  /                                  landing page
 *   GET  /healthz                           service health
 *   POST /api/v1/register                   create profile, returns API key once
 *   GET  /api/v1/me                         bearer-authenticated totals
 *   POST /api/v1/ingest                     daily aggregates, latest-wins upsert
 *   GET  /api/v1/u/:user                    public stats JSON
 *   GET  /u/:user[/badge.svg|chart.svg|card.svg]
 *   GET  /robots.txt                        disallow indexing (privacy)
 */

import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  hashApiKey,
  parseBearer,
  randomUsername,
  safeEqual,
  sanitizeDisplayName,
  generateApiKey,
  USERNAME_PATTERN,
} from './auth.js';
import { CloudDb, DuplicateUsernameError, type UserRecord } from './db.js';
import { renderDashboardPage, renderLandingPage, renderNotFoundPage, pageTheme } from './pages.js';
import { chartSeries, computeUserStats, publicStatsJson, type UserStats } from './stats.js';
import { renderBadge, renderUnknownBadge, type BadgeOptions } from './svg/badge.js';
import { renderCard, renderUnknownCard } from './svg/card.js';
import { renderChart, renderUnknownChart } from './svg/chart.js';
import { parseSvgTheme, parseIntParam } from './svg/util.js';
import {
  CloudValidationError,
  MAX_BODY_BYTES,
  MAX_REGISTER_BODY_BYTES,
  parseCloudDays,
  parseRegisterBody,
} from './validate.js';

export interface CloudAppOptions {
  dbPath: string;
  host?: string;
  port?: number;
  adminToken?: string | null;
  allowRegister?: boolean;
  publicUrl?: string | null;
  now?: () => number;
}

export interface ListenResult {
  host: string;
  port: number;
}

export interface CloudApp {
  server: Server;
  db: CloudDb;
  startedAt: number;
  listen(): Promise<ListenResult>;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

const HTML_CSP =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
  "font-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const SVG_CACHE = 'public, max-age=300, s-maxage=300';
const SVG_CACHE_UNKNOWN = 'public, max-age=60';

function normalizePath(rawPath: string): string {
  if (rawPath.length > 1 && rawPath.endsWith('/')) return rawPath.replace(/\/+$/, '') || '/';
  return rawPath;
}

function setHeaders(res: ServerResponse, headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
}

function send(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string>,
): void {
  if (res.writableEnded) return;
  res.statusCode = status;
  setHeaders(res, SECURITY_HEADERS);
  setHeaders(res, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  send(req, res, status, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
}

function sendHtml(req: IncomingMessage, res: ServerResponse, status: number, html: string): void {
  send(req, res, status, html, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': HTML_CSP,
  });
}

function sendText(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  text: string,
  contentType: string,
): void {
  send(req, res, status, text, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=3600',
  });
}

function sendSvg(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  svg: string,
  cacheControl: string,
): void {
  const headers: Record<string, string> = {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': cacheControl,
    ETag: `"${createHash('sha1').update(svg).digest('base64url')}"`,
  };
  const ifNoneMatch = req.headers['if-none-match'];
  const etag = headers.ETag;
  if (etag && typeof ifNoneMatch === 'string' && ifNoneMatch.split(',').some((value) => value.trim() === etag)) {
    res.statusCode = 304;
    setHeaders(res, SECURITY_HEADERS);
    setHeaders(res, headers);
    res.end();
    return;
  }
  send(req, res, status, svg, headers);
}

async function readRawBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buffer.length;
    if (size > limit) {
      throw new HttpError(413, 'payload_too_large', `request body must be at most ${limit} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonBody(req: IncomingMessage, limit: number, allowEmpty = false): Promise<unknown> {
  const raw = await readRawBody(req, limit);
  if (raw.trim() === '') {
    if (allowEmpty) return {};
    throw new HttpError(400, 'invalid_json', 'request body must be JSON');
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, 'invalid_json', 'request body is not valid JSON');
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function requestBaseUrl(req: IncomingMessage, publicUrl: string | null): string {
  if (publicUrl) return publicUrl;
  const forwardedProto = headerValue(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim();
  const forwardedHost = headerValue(req.headers['x-forwarded-host'])?.split(',')[0]?.trim();
  const host = forwardedHost || headerValue(req.headers.host);
  const proto = forwardedProto === 'https' ? 'https' : 'http';
  if (host && /^[a-zA-Z0-9.\-:[\]]{1,200}$/.test(host)) return `${proto}://${host}`;
  return 'http://127.0.0.1:47117';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapValidationError(error: CloudValidationError): HttpError {
  const status = error.code.startsWith('invalid_username') || error.code === 'invalid_display_name' ? 400 : 400;
  return new HttpError(status, error.code, error.message);
}

/**
 * Creates the cloud HTTP server (without binding a port yet).  Opening the
 * database happens eagerly so boot failures are visible immediately.
 */
export function createCloudApp(options: CloudAppOptions): CloudApp {
  const db = new CloudDb(options.dbPath);
  const startedAt = Date.now();
  const nowFn = options.now ?? Date.now;
  const adminToken = options.adminToken ?? null;
  const allowRegister = options.allowRegister ?? true;
  const publicUrl = options.publicUrl ?? null;

  function requireUser(req: IncomingMessage): UserRecord {
    const token = parseBearer(req.headers.authorization);
    if (!token) throw new HttpError(401, 'unauthorized', 'missing bearer API key');
    const user = db.getUserByApiKeyHash(hashApiKey(token));
    if (!user) throw new HttpError(401, 'unauthorized', 'invalid API key');
    return user;
  }

  function loadStats(username: string): UserStats | null {
    const user = db.getUser(username);
    if (!user) return null;
    return computeUserStats(user, db.listDays(username), { now: nowFn() });
  }

  function routeError(req: IncomingMessage, res: ServerResponse, error: unknown): void {
    if (error instanceof CloudValidationError) {
      const mapped = mapValidationError(error);
      sendJson(req, res, mapped.status, { error: { code: mapped.code, message: mapped.message } });
      return;
    }
    if (error instanceof HttpError) {
      sendJson(req, res, error.status, { error: { code: error.code, message: error.message } }, error.headers);
      return;
    }
    console.error('[cloud] unhandled request error:', error);
    sendJson(req, res, 500, { error: { code: 'internal_error', message: 'internal server error' } });
  }

  async function handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (adminToken) {
      const token = parseBearer(req.headers.authorization);
      if (!token || !safeEqual(token, adminToken)) {
        throw new HttpError(401, 'unauthorized', 'a valid admin token is required to register');
      }
    } else if (!allowRegister) {
      throw new HttpError(403, 'registration_disabled', 'registration is disabled on this server');
    }

    let parsed: ReturnType<typeof parseRegisterBody>;
    try {
      const raw = await readJsonBody(req, MAX_REGISTER_BODY_BYTES, true);
      parsed = parseRegisterBody(raw);
    } catch (error) {
      if (error instanceof CloudValidationError) throw mapValidationError(error);
      throw error;
    }

    let username = parsed.username;
    if (username !== undefined) {
      if (!USERNAME_PATTERN.test(username)) {
        throw new HttpError(
          400,
          'invalid_username',
          'username must be 3-32 characters of lowercase letters, digits, "_" or "-"',
        );
      }
      if (db.getUser(username)) throw new HttpError(409, 'username_taken', `username "${username}" is taken`);
    } else {
      for (let attempt = 0; attempt < 12 && username === undefined; attempt += 1) {
        const candidate = randomUsername();
        if (!db.getUser(candidate)) username = candidate;
      }
      if (username === undefined) {
        throw new HttpError(500, 'internal_error', 'could not allocate a random username');
      }
    }

    const apiKey = generateApiKey();
    const displayName = sanitizeDisplayName(parsed.displayName, username);
    let user: UserRecord;
    try {
      user = db.createUser({ username, displayName, apiKeyHash: hashApiKey(apiKey), now: nowFn() });
    } catch (error) {
      if (error instanceof DuplicateUsernameError) {
        throw new HttpError(409, 'username_taken', `username "${username}" is taken`);
      }
      throw error;
    }

    const base = requestBaseUrl(req, publicUrl);
    const badgeBase = `${base}/u/${encodeURIComponent(user.username)}`;
    sendJson(
      req,
      res,
      201,
      {
        username: user.username,
        displayName: user.displayName,
        apiKey,
        badges: {
          tokens: `${badgeBase}/badge.svg?metric=tokens`,
          cost: `${badgeBase}/badge.svg?metric=cost`,
          streak: `${badgeBase}/badge.svg?metric=streak`,
          chart: `${badgeBase}/chart.svg`,
          card: `${badgeBase}/card.svg`,
        },
        ingest: `${base}/api/v1/ingest`,
        docs: `/u/${user.username}`,
      },
      { 'Cache-Control': 'no-store' },
    );
  }

  async function handleIngest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const user = requireUser(req);
    const body = asRecord(await readJsonBody(req, MAX_BODY_BYTES));
    const days = parseCloudDays(body.days);
    const now = nowFn();
    const result = db.upsertDays(user.username, days, now);
    db.touchLastSync(user.username, now);
    const dates = days.map((day) => day.date).sort();
    sendJson(req, res, 200, {
      ok: true,
      username: user.username,
      days: days.length,
      totalDays: result.totalDays,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      lastSyncAt: now,
    });
  }

  function handleMe(req: IncomingMessage, res: ServerResponse): void {
    const user = requireUser(req);
    const stats = computeUserStats(user, db.listDays(user.username), { now: nowFn() });
    sendJson(req, res, 200, {
      username: stats.username,
      displayName: stats.displayName,
      days: stats.totalDays,
      firstDate: stats.firstDate,
      lastDate: stats.lastDate,
      lastSyncAt: stats.lastSyncAt,
      totals: stats.totals,
      streak: stats.streak,
      activeDays: stats.activeDays,
    });
  }

  function handlePublicStats(req: IncomingMessage, res: ServerResponse, rawUsername: string): void {
    const username = decodeURIComponent(rawUsername);
    if (!USERNAME_PATTERN.test(username)) {
      throw new HttpError(404, 'not_found', 'user not found');
    }
    const stats = loadStats(username);
    if (!stats) throw new HttpError(404, 'not_found', `no user named "${username}"`);
    sendJson(req, res, 200, publicStatsJson(stats, { now: nowFn() }));
  }

  async function handleGet(req: IncomingMessage, res: ServerResponse, url: URL, path: string): Promise<void> {
    const params = url.searchParams;
    const base = requestBaseUrl(req, publicUrl);

    if (path === '/') {
      const theme = pageTheme(params.get('theme'));
      const demo = loadStats('demo');
      sendHtml(req, res, 200, renderLandingPage({ theme, demo, baseUrl: base }));
      return;
    }
    if (path === '/healthz') {
      const counts = db.counts();
      sendJson(req, res, 200, {
        ok: true,
        users: counts.users,
        days: counts.days,
        uptimeSec: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
      });
      return;
    }
    if (path === '/robots.txt') {
      sendText(req, res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8');
      return;
    }
    if (path === '/favicon.ico') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (path === '/api/v1/me') {
      handleMe(req, res);
      return;
    }
    if (path.startsWith('/api/v1/u/')) {
      handlePublicStats(req, res, path.slice('/api/v1/u/'.length));
      return;
    }
    if (path.startsWith('/api/')) {
      throw new HttpError(404, 'not_found', `no API route for ${path}`);
    }
    if (path.startsWith('/u/')) {
      await handleUserGet(req, res, path, base, params);
      return;
    }
    throw new HttpError(404, 'not_found', `no route for ${path}`);
  }

  async function handleUserGet(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    base: string,
    params: URLSearchParams,
  ): Promise<void> {
    const segments = path.split('/').filter((segment) => segment.length > 0);
    const rawUsername = segments[1] ?? '';
    let username: string;
    try {
      username = decodeURIComponent(rawUsername);
    } catch {
      username = rawUsername;
    }
    const asset = segments[2];
    const theme = parseSvgTheme(params.get('theme'));
    const validUsername = USERNAME_PATTERN.test(username);
    const stats = validUsername ? loadStats(username) : null;

    if (asset === undefined) {
      if (!stats) {
        sendHtml(req, res, 404, renderNotFoundPage(theme, username || 'unknown'));
        return;
      }
      sendHtml(
        req,
        res,
        200,
        renderDashboardPage({
          stats,
          theme,
          baseUrl: base,
          now: nowFn(),
        }),
      );
      return;
    }

    if (asset === 'badge.svg') {
      const badgeOptions: BadgeOptions = {
        metric: params.get('metric') ?? undefined,
        theme,
        label: params.get('label'),
        days: parseIntParam(params.get('days'), 30, 1, 365),
        style: params.get('style') === 'flat-square' ? 'flat-square' : 'flat',
        now: nowFn(),
        idPrefix: 'ti-badge',
      };
      if (!stats) {
        sendSvg(req, res, 404, renderUnknownBadge(badgeOptions), SVG_CACHE_UNKNOWN);
        return;
      }
      sendSvg(req, res, 200, renderBadge(stats, badgeOptions), SVG_CACHE);
      return;
    }

    if (asset === 'chart.svg') {
      const chartOptions = {
        type: params.get('type') ?? undefined,
        theme,
        days: parseIntParam(params.get('days'), 30, 7, 365),
        width: params.get('width') ?? undefined,
        height: params.get('height') ?? undefined,
        idPrefix: 'ti-chart',
      };
      if (!stats) {
        sendSvg(req, res, 404, renderUnknownChart(chartOptions), SVG_CACHE_UNKNOWN);
        return;
      }
      const series = chartSeries(stats, chartOptions.days, { now: nowFn() });
      sendSvg(req, res, 200, renderChart(series, chartOptions), SVG_CACHE);
      return;
    }

    if (asset === 'card.svg') {
      const cardOptions = {
        theme,
        width: params.get('width') ?? undefined,
        now: nowFn(),
        idPrefix: 'ti-card',
      };
      if (!stats) {
        sendSvg(req, res, 404, renderUnknownCard(cardOptions), SVG_CACHE_UNKNOWN);
        return;
      }
      sendSvg(req, res, 200, renderCard(stats, cardOptions), SVG_CACHE);
      return;
    }

    throw new HttpError(404, 'not_found', `no asset named "${asset}"`);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    let path = '/';
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
      path = normalizePath(url.pathname);
    } catch {
      url = new URL('http://localhost/');
    }

    try {
      if (method === 'GET' || method === 'HEAD') {
        await handleGet(req, res, url, path);
        return;
      }
      if (method === 'POST') {
        if (path === '/api/v1/register') {
          await handleRegister(req, res);
          return;
        }
        if (path === '/api/v1/ingest') {
          await handleIngest(req, res);
          return;
        }
        throw new HttpError(404, 'not_found', `no route for POST ${path}`);
      }
      throw new HttpError(405, 'method_not_allowed', `method ${method} is not allowed`, {
        Allow: 'GET, HEAD, POST',
      });
    } catch (error) {
      routeError(req, res, error);
    }
  }

  const server = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      console.error('[cloud] fatal request handler error:', error);
      if (!res.headersSent) {
        sendJson(req, res, 500, {
          error: { code: 'internal_error', message: 'internal server error' },
        });
      } else {
        res.destroy();
      }
    });
  });

  const app: CloudApp = {
    server,
    db,
    startedAt,
    listen(): Promise<ListenResult> {
      return new Promise<ListenResult>((resolve, reject) => {
        const port = options.port ?? 47117;
        const host = options.host ?? '0.0.0.0';
        const onError = (error: Error): void => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          server.off('error', onError);
          const address = server.address();
          if (address && typeof address === 'object') {
            resolve({ host: address.address, port: address.port });
          } else {
            resolve({ host, port });
          }
        };
        server.once('error', onError);
        server.once('listening', onListening);
        try {
          server.listen(port, host);
        } catch (error) {
          server.off('error', onError);
          server.off('listening', onListening);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    },
    close(): Promise<void> {
      return new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          try {
            db.close();
          } catch (error) {
            console.error('[cloud] failed to close database:', error);
          }
          resolve();
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

  return app;
}
