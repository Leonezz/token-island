/**
 * Shared request handlers for both cloud runtimes.
 *
 * This module is pure Web API: `Request` in, `Response` out.  The Cloudflare
 * Worker (`worker.ts`) and the Node `node:http` adapter (`node.ts`) only differ
 * in how they build the `Request`, which store they hand over, and how fonts are
 * served — every route, status code, header and cache rule lives here once, so
 * the two runtimes cannot drift.
 *
 * Routes (docs/CONTRACT.md §6.3, unchanged):
 *   GET  /                                  landing page
 *   GET  /healthz                           service health
 *   POST /api/v1/register                   create profile, returns API key once
 *   GET  /api/v1/me                         bearer-authenticated totals
 *   POST /api/v1/ingest                     daily aggregates, latest-wins upsert
 *   GET  /api/v1/u/:user                    public stats JSON
 *   GET  /u/:user[/badge.svg|chart.svg|card.svg]
 *   GET  /fonts/*                           pixel fonts (ASSETS / static dir)
 *   GET  /robots.txt                        disallow indexing (privacy)
 */

import {
  generateApiKey,
  hashApiKey,
  parseBearer,
  randomUsername,
  safeEqual,
  sanitizeDisplayName,
  sha256Hex,
  USERNAME_PATTERN,
} from './auth.js';
import { renderChart, renderUnknownChart } from './render/chart.js';
import { renderBadge, renderUnknownBadge, type BadgeOptions } from './render/badge.js';
import { renderCard, renderUnknownCard } from './render/card.js';
import { pageTheme, renderDashboardPage, renderLandingPage, renderNotFoundPage } from './render/pages.js';
import { parseSvgTheme, parseIntParam } from './render/tokens.js';
import { chartSeries, computeUserStats, publicStatsJson, type UserStats } from './stats.js';
import { DuplicateUsernameError, type CloudStore, type UserRecord } from './store/types.js';
import { CLOUD_VERSION } from './version.js';
import {
  CloudValidationError,
  MAX_BODY_BYTES,
  MAX_REGISTER_BODY_BYTES,
  parseCloudDays,
  parseRegisterBody,
} from './validate.js';

export { CLOUD_VERSION } from './version.js';

/** Environment-driven knobs shared by both runtimes. */
export interface CloudRuntimeConfig {
  /** When set, registration requires `Authorization: Bearer <admin token>`. */
  adminToken: string | null;
  /** `TOKEN_ISLAND_ALLOW_REGISTER=0` disables open registration. */
  allowRegister: boolean;
  /** Absolute base URL used in generated snippets (optional). */
  publicUrl: string | null;
}

/** Minimal static-asset binding shape (`env.ASSETS` on Workers). */
export interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

export interface AppEnv {
  store: CloudStore;
  config: CloudRuntimeConfig;
  now?: () => number;
  startedAt?: number;
  assets?: AssetFetcher | null;
  version?: string;
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
  "font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const SVG_CACHE = 'public, max-age=300, s-maxage=300';
const SVG_CACHE_UNKNOWN = 'public, max-age=60';
const FONT_CACHE = 'public, max-age=3600';

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function withSecurity(headers: Headers): Headers {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return headers;
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): Response {
  const out = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  return new Response(JSON.stringify(payload), { status, headers: withSecurity(out) });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(status, { error: { code, message } }, headers);
}

function htmlResponse(html: string): Response {
  const headers = withSecurity(
    new Headers({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': HTML_CSP,
    }),
  );
  return new Response(html, { status: 200, headers });
}

function textResponse(text: string, contentType: string): Response {
  const headers = withSecurity(
    new Headers({ 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' }),
  );
  return new Response(text, { status: 200, headers });
}

/** SVG with a content hash ETag, `If-None-Match` 304 handling and cache headers. */
async function svgResponse(
  request: Request,
  status: number,
  svg: string,
  cacheControl: string,
): Promise<Response> {
  const etag = `"${await sha256Hex(svg)}"`;
  const headers = withSecurity(
    new Headers({
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': cacheControl,
      ETag: etag,
    }),
  );
  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch && ifNoneMatch.split(',').some((value) => value.trim() === etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(svg, { status, headers });
}

function notFoundAsset(): Response {
  return errorResponse(404, 'not_found', 'asset not found');
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

function normalizePath(rawPath: string): string {
  if (rawPath.length > 1 && rawPath.endsWith('/')) return rawPath.replace(/\/+$/, '') || '/';
  return rawPath;
}

function requestBaseUrl(request: Request, publicUrl: string | null): string {
  if (publicUrl) return publicUrl;
  try {
    const origin = new URL(request.url).origin;
    if (origin && origin !== 'null') return origin;
  } catch {
    // fall through
  }
  return 'http://127.0.0.1:47117';
}

function decodePathSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nowOf(env: AppEnv): number {
  return env.now ? env.now() : Date.now();
}

async function readTextBody(request: Request, limit: number, allowEmpty: boolean): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && declared.trim() !== '') {
    const length = Number(declared);
    if (Number.isFinite(length) && length > limit) {
      throw new HttpError(413, 'payload_too_large', `request body must be at most ${limit} bytes`);
    }
  }
  let buffer: ArrayBuffer;
  try {
    buffer = await request.arrayBuffer();
  } catch {
    throw new HttpError(400, 'invalid_json', 'request body could not be read');
  }
  if (buffer.byteLength > limit) {
    throw new HttpError(413, 'payload_too_large', `request body must be at most ${limit} bytes`);
  }
  const raw = new TextDecoder().decode(buffer);
  if (raw.trim() === '') {
    if (allowEmpty) return '';
    throw new HttpError(400, 'invalid_json', 'request body must be JSON');
  }
  return raw;
}

async function readJsonBody(request: Request, limit: number): Promise<unknown> {
  const raw = await readTextBody(request, limit, true);
  if (raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, 'invalid_json', 'request body is not valid JSON');
  }
}

function mapValidationError(error: CloudValidationError): HttpError {
  return new HttpError(400, error.code, error.message);
}

// ---------------------------------------------------------------------------
// Stats loading
// ---------------------------------------------------------------------------

async function loadStats(env: AppEnv, username: string): Promise<UserStats | null> {
  const user = await env.store.getUser(username);
  if (!user) return null;
  const days = await env.store.listDays(username);
  return computeUserStats(user, days, { now: nowOf(env) });
}

async function requireUser(request: Request, env: AppEnv): Promise<UserRecord> {
  const token = parseBearer(request.headers.get('authorization'));
  if (!token) throw new HttpError(401, 'unauthorized', 'missing bearer API key');
  const user = await env.store.getUserByApiKeyHash(await hashApiKey(token));
  if (!user) throw new HttpError(401, 'unauthorized', 'invalid API key');
  return user;
}

// ---------------------------------------------------------------------------
// Handlers: register / me / ingest
// ---------------------------------------------------------------------------

async function handleRegister(request: Request, env: AppEnv): Promise<Response> {
  const { adminToken, allowRegister } = env.config;
  if (adminToken) {
    const token = parseBearer(request.headers.get('authorization'));
    if (!token || !(await safeEqual(token, adminToken))) {
      throw new HttpError(401, 'unauthorized', 'a valid admin token is required to register');
    }
  } else if (!allowRegister) {
    throw new HttpError(403, 'registration_disabled', 'registration is disabled on this server');
  }

  const parsed = parseRegisterBody(await readJsonBody(request, MAX_REGISTER_BODY_BYTES));
  let username = parsed.username;
  if (username !== undefined) {
    if (!USERNAME_PATTERN.test(username)) {
      throw new HttpError(
        400,
        'invalid_username',
        'username must be 3-32 characters of lowercase letters, digits, "_" or "-"',
      );
    }
    if (await env.store.getUser(username)) {
      throw new HttpError(409, 'username_taken', `username "${username}" is taken`);
    }
  } else {
    for (let attempt = 0; attempt < 12 && username === undefined; attempt += 1) {
      const candidate = randomUsername();
      if (!(await env.store.getUser(candidate))) username = candidate;
    }
    if (username === undefined) {
      throw new HttpError(500, 'internal_error', 'could not allocate a random username');
    }
  }

  const apiKey = await generateApiKey();
  const displayName = sanitizeDisplayName(parsed.displayName, username);
  const now = nowOf(env);
  let user: UserRecord;
  try {
    user = await env.store.createUser({
      username,
      displayName,
      apiKeyHash: await hashApiKey(apiKey),
      now,
    });
  } catch (error) {
    if (error instanceof DuplicateUsernameError) {
      throw new HttpError(409, 'username_taken', `username "${username}" is taken`);
    }
    throw error;
  }

  const base = requestBaseUrl(request, env.config.publicUrl);
  const badgeBase = `${base}/u/${encodeURIComponent(user.username)}`;
  return jsonResponse(201, {
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
  });
}

async function handleIngest(request: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(request, env);
  const body = asRecord(await readJsonBody(request, MAX_BODY_BYTES));
  const days = parseCloudDays(body.days);
  const now = nowOf(env);
  const result = await env.store.upsertDays(user.username, days, now);
  await env.store.touchLastSync(user.username, now);
  const dates = days.map((day) => day.date).sort();
  return jsonResponse(200, {
    ok: true,
    username: user.username,
    days: days.length,
    totalDays: result.totalDays,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    lastSyncAt: now,
  });
}

async function handleMe(request: Request, env: AppEnv): Promise<Response> {
  const user = await requireUser(request, env);
  const stats = computeUserStats(user, await env.store.listDays(user.username), { now: nowOf(env) });
  return jsonResponse(200, {
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

async function handlePublicStats(request: Request, env: AppEnv, rawUsername: string): Promise<Response> {
  const username = decodePathSegment(rawUsername);
  if (!USERNAME_PATTERN.test(username)) {
    throw new HttpError(404, 'not_found', 'user not found');
  }
  const stats = await loadStats(env, username);
  if (!stats) throw new HttpError(404, 'not_found', `no user named "${username}"`);
  return jsonResponse(200, publicStatsJson(stats, { now: nowOf(env) }));
}

// ---------------------------------------------------------------------------
// Handlers: GET routes
// ---------------------------------------------------------------------------

async function handleFonts(request: Request, env: AppEnv): Promise<Response> {
  if (!env.assets) throw new HttpError(404, 'not_found', 'fonts are not served on this deployment');
  let response: Response;
  try {
    response = await env.assets.fetch(request);
  } catch {
    throw new HttpError(404, 'not_found', 'font not found');
  }
  if (!response.ok) {
    if (response.status === 404) return notFoundAsset();
    return errorResponse(response.status, 'asset_error', 'could not load asset');
  }
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', FONT_CACHE);
  withSecurity(headers);
  return new Response(response.body, { status: 200, headers });
}

async function handleUserGet(
  request: Request,
  env: AppEnv,
  path: string,
  base: string,
  params: URLSearchParams,
): Promise<Response> {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  const username = decodePathSegment(segments[1] ?? '');
  const asset = segments[2];
  const theme = parseSvgTheme(params.get('theme'));
  const now = nowOf(env);
  const validUsername = USERNAME_PATTERN.test(username);
  const stats = validUsername ? await loadStats(env, username) : null;

  if (asset === undefined) {
    if (!stats) return new Response(renderNotFoundPage(theme, username || 'unknown'), {
      status: 404,
      headers: withSecurity(
        new Headers({
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': HTML_CSP,
        }),
      ),
    });
    return htmlResponse(renderDashboardPage({ stats, theme, baseUrl: base, now }));
  }

  if (asset === 'badge.svg') {
    const badgeOptions: BadgeOptions = {
      metric: params.get('metric') ?? undefined,
      theme,
      label: params.get('label'),
      days: parseIntParam(params.get('days'), 30, 1, 365),
      style: params.get('style') === 'flat-square' ? 'flat-square' : 'flat',
      now,
      idPrefix: 'ti-badge',
    };
    if (!stats) return svgResponse(request, 404, renderUnknownBadge(badgeOptions), SVG_CACHE_UNKNOWN);
    return svgResponse(request, 200, renderBadge(stats, badgeOptions), SVG_CACHE);
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
    if (!stats) return svgResponse(request, 404, renderUnknownChart(chartOptions), SVG_CACHE_UNKNOWN);
    const series = chartSeries(stats, chartOptions.days, { now });
    return svgResponse(request, 200, renderChart(series, chartOptions), SVG_CACHE);
  }

  if (asset === 'card.svg') {
    const cardOptions = { theme, width: params.get('width') ?? undefined, now, idPrefix: 'ti-card' };
    if (!stats) return svgResponse(request, 404, renderUnknownCard(cardOptions), SVG_CACHE_UNKNOWN);
    return svgResponse(request, 200, renderCard(stats, cardOptions), SVG_CACHE);
  }

  throw new HttpError(404, 'not_found', `no asset named "${asset}"`);
}

async function handleGet(request: Request, env: AppEnv, url: URL, path: string): Promise<Response> {
  const params = url.searchParams;
  const base = requestBaseUrl(request, env.config.publicUrl);

  if (path === '/') {
    const theme = pageTheme(params.get('theme'));
    const demo = await loadStats(env, 'demo');
    return htmlResponse(renderLandingPage({ theme, demo, baseUrl: base }));
  }
  if (path === '/healthz') {
    const counts = await env.store.counts();
    const startedAt = env.startedAt ?? nowOf(env);
    return jsonResponse(200, {
      ok: true,
      users: counts.users,
      days: counts.days,
      uptimeSec: Math.max(0, Math.round((nowOf(env) - startedAt) / 1000)),
      version: env.version ?? CLOUD_VERSION,
    });
  }
  if (path === '/robots.txt') {
    return textResponse('User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8');
  }
  if (path === '/favicon.ico') {
    return new Response(null, { status: 204, headers: withSecurity(new Headers()) });
  }
  if (path === '/api/v1/me') {
    return handleMe(request, env);
  }
  if (path.startsWith('/api/v1/u/')) {
    return handlePublicStats(request, env, path.slice('/api/v1/u/'.length));
  }
  if (path.startsWith('/api/')) {
    throw new HttpError(404, 'not_found', `no API route for ${path}`);
  }
  if (path.startsWith('/u/')) {
    return handleUserGet(request, env, path, base, params);
  }
  throw new HttpError(404, 'not_found', `no route for ${path}`);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function routeError(error: unknown): Response {
  if (error instanceof CloudValidationError) {
    const mapped = mapValidationError(error);
    return errorResponse(mapped.status, mapped.code, mapped.message);
  }
  if (error instanceof HttpError) {
    return errorResponse(error.status, error.code, error.message, error.headers);
  }
  console.error('[cloud] unhandled request error:', error);
  return errorResponse(500, 'internal_error', 'internal server error');
}

/**
 * Single entry point for both runtimes.
 *
 * The Node adapter has already buffered the body (bounded) before building the
 * `Request`; the Worker gets the streaming request straight from the platform.
 */
export async function handleRequest(request: Request, env: AppEnv): Promise<Response> {
  const method = (request.method || 'GET').toUpperCase();
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    url = new URL('http://127.0.0.1:47117/');
  }
  const path = normalizePath(url.pathname);

  let response: Response;
  try {
    if (path.startsWith('/fonts/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        throw new HttpError(405, 'method_not_allowed', `method ${method} is not allowed`, {
          Allow: 'GET, HEAD, POST',
        });
      }
      response = await handleFonts(request, env);
    } else if (method === 'GET' || method === 'HEAD') {
      response = await handleGet(request, env, url, path);
    } else if (method === 'POST') {
      if (path === '/api/v1/register') response = await handleRegister(request, env);
      else if (path === '/api/v1/ingest') response = await handleIngest(request, env);
      else throw new HttpError(404, 'not_found', `no route for POST ${path}`);
    } else {
      throw new HttpError(405, 'method_not_allowed', `method ${method} is not allowed`, {
        Allow: 'GET, HEAD, POST',
      });
    }
  } catch (error) {
    response = routeError(error);
  }

  if (method === 'HEAD') {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
}
