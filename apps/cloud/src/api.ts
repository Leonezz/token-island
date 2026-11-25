/**
 * Shared request handlers for both cloud runtimes (`worker.ts` & `node.ts`).
 *
 * Pure Web API: `Request` in, `Response` out.
 *
 * Routes:
 *   GET  /                                  landing page
 *   GET  /healthz                           service health
 *   POST /api/v1/register                   legacy/self-hosted profile registration
 *   POST /api/v1/auth/github/start          start GitHub OAuth Device Flow (RFC 8628)
 *   POST /api/v1/auth/github/poll           poll GitHub Device Flow & issue per-device token
 *   GET  /api/v1/me                         bearer-authenticated account, devices & totals
 *   GET  /api/v1/me/summary                 bearer-authenticated full stats JSON (Remote Mode)
 *   POST /api/v1/me/settings                update profile visibility / displayName
 *   POST /api/v1/me/devices/revoke          revoke a per-device token
 *   POST /api/v1/ingest                     per-device daily aggregates -> additive user rollup
 *   GET  /api/v1/u/:user                    public stats JSON (respects visibility)
 *   GET  /u/:user[/badge.svg|chart.svg|card.svg]
 *   GET  /fonts/*                           bundled fonts (ASSETS / static dir)
 *   GET  /robots.txt                        disallow indexing
 */

import {
  generateApiKey,
  generateDeviceApiKey,
  generateDeviceId,
  generateOAuthSessionId,
  hashApiKey,
  isVisibility,
  normalizeGitHubUsername,
  parseBearer,
  randomHex,
  randomUsername,
  safeEqual,
  sanitizeDeviceId,
  sanitizeDeviceName,
  sanitizeDisplayName,
  sanitizePlatform,
  sha256Hex,
  USERNAME_PATTERN,
} from './auth.js';
import { renderChart, renderUnknownChart } from './render/chart.js';
import { renderBadge, renderUnknownBadge, type BadgeOptions } from './render/badge.js';
import { renderCard, renderUnknownCard } from './render/card.js';
import { pageTheme, renderDashboardPage, renderLandingPage, renderNotFoundPage } from './render/pages.js';
import { parseSvgTheme, parseIntParam } from './render/tokens.js';
import { chartSeries, computeUserStats, publicStatsJson, type UserStats } from './stats.js';
import {
  DuplicateUsernameError,
  type AuthenticatedPrincipal,
  type CloudStore,
  type UserRecord,
  type UserVisibility,
} from './store/types.js';
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
  /** GitHub OAuth App Client ID (Device Flow enabled). */
  githubClientId?: string | null;
  /** Override for tests (default `https://github.com`). */
  githubOAuthBaseUrl?: string;
  /** Override for tests (default `https://api.github.com`). */
  githubApiBaseUrl?: string;
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
  fetchImpl?: typeof fetch;
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

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const HTML_CSP =
  "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
  "font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const SVG_CACHE = 'public, max-age=300, s-maxage=300';
const SVG_CACHE_UNKNOWN = 'public, max-age=60';
const FONT_CACHE = 'public, max-age=3600';

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function withSecurity(headers: Headers): Headers {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
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

function fetchOf(env: AppEnv): typeof fetch {
  return env.fetchImpl ?? fetch;
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
// Auth & Visibility helpers
// ---------------------------------------------------------------------------

async function loadUserAndStats(
  env: AppEnv,
  username: string,
): Promise<{ user: UserRecord; stats: UserStats } | null> {
  const user = await env.store.getUser(username);
  if (!user) return null;
  const days = await env.store.listDays(username);
  return { user, stats: computeUserStats(user, days, { now: nowOf(env) }) };
}

async function optionalPrincipal(request: Request, env: AppEnv): Promise<AuthenticatedPrincipal | null> {
  const token = parseBearer(request.headers.get('authorization'));
  if (!token) return null;
  return env.store.authenticateByKeyHash(await hashApiKey(token));
}

async function requirePrincipal(request: Request, env: AppEnv): Promise<AuthenticatedPrincipal> {
  const token = parseBearer(request.headers.get('authorization'));
  if (!token) throw new HttpError(401, 'unauthorized', 'missing bearer API key');
  const principal = await env.store.authenticateByKeyHash(await hashApiKey(token));
  if (!principal) throw new HttpError(401, 'unauthorized', 'invalid or revoked API key');
  return principal;
}

async function canReadUserAsset(
  request: Request,
  env: AppEnv,
  user: UserRecord,
  kind: 'page' | 'json' | 'svg',
): Promise<boolean> {
  if (user.visibility === 'public') return true;
  if (user.visibility === 'unlisted' && kind === 'svg') return true;
  const principal = await optionalPrincipal(request, env);
  return principal?.user.username === user.username;
}

// ---------------------------------------------------------------------------
// Handlers: GitHub OAuth Device Flow (RFC 8628)
// ---------------------------------------------------------------------------

async function handleGithubAuthStart(request: Request, env: AppEnv): Promise<Response> {
  const clientId = env.config.githubClientId?.trim();
  if (!clientId) {
    throw new HttpError(
      501,
      'github_oauth_not_configured',
      'GitHub login is not configured on this server (missing GITHUB_CLIENT_ID)',
    );
  }

  const body = asRecord(await readJsonBody(request, MAX_REGISTER_BODY_BYTES));
  const deviceId = sanitizeDeviceId(body.deviceId) ?? generateDeviceId();
  const deviceName = sanitizeDeviceName(body.deviceName, 'Mac');
  const platform = sanitizePlatform(body.platform);

  const oauthBase = (env.config.githubOAuthBaseUrl ?? 'https://github.com').replace(/\/+$/, '');
  const fetchFn = fetchOf(env);
  let ghResponse: Response;
  try {
    ghResponse = await fetchFn(`${oauthBase}/login/device/code`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Token-Island-Cloud',
      },
      body: JSON.stringify({
        client_id: clientId,
        scope: 'read:user',
      }),
    });
  } catch (error) {
    throw new HttpError(
      502,
      'github_unreachable',
      `Failed to contact GitHub OAuth: ${error instanceof Error ? error.message : 'network error'}`,
    );
  }

  const ghData = asRecord(await ghResponse.json().catch(() => ({})));
  if (
    !ghResponse.ok ||
    typeof ghData.device_code !== 'string' ||
    typeof ghData.user_code !== 'string' ||
    typeof ghData.verification_uri !== 'string'
  ) {
    const detail =
      typeof ghData.error_description === 'string'
        ? ghData.error_description
        : typeof ghData.error === 'string'
          ? ghData.error
          : `HTTP ${ghResponse.status}`;
    throw new HttpError(502, 'github_device_flow_error', `GitHub rejected device code request: ${detail}`);
  }

  const now = nowOf(env);
  const expiresIn =
    typeof ghData.expires_in === 'number' && ghData.expires_in > 0 ? Math.trunc(ghData.expires_in) : 900;
  const intervalSec =
    typeof ghData.interval === 'number' && ghData.interval > 0 ? Math.trunc(ghData.interval) : 5;
  const sessionId = generateOAuthSessionId();

  await env.store.saveOAuthSession({
    sessionId,
    githubDeviceCode: ghData.device_code,
    userCode: ghData.user_code,
    verificationUri: ghData.verification_uri,
    intervalSec,
    deviceId,
    deviceName,
    platform,
    expiresAt: now + expiresIn * 1000,
    createdAt: now,
  });

  return jsonResponse(200, {
    sessionId,
    userCode: ghData.user_code,
    verificationUri: ghData.verification_uri,
    ...(typeof ghData.verification_uri_complete === 'string'
      ? { verificationUriComplete: ghData.verification_uri_complete }
      : {}),
    expiresIn,
    interval: intervalSec,
    deviceId,
  });
}

async function allocateGithubUsername(store: CloudStore, githubLogin: string): Promise<string> {
  const base = normalizeGitHubUsername(githubLogin);
  if (!(await store.getUser(base))) return base;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `${base.slice(0, 26)}-${randomHex(2)}`;
    if (!(await store.getUser(candidate))) return candidate;
  }
  return randomUsername();
}

async function handleGithubAuthPoll(request: Request, env: AppEnv): Promise<Response> {
  const clientId = env.config.githubClientId?.trim();
  if (!clientId) {
    throw new HttpError(
      501,
      'github_oauth_not_configured',
      'GitHub login is not configured on this server (missing GITHUB_CLIENT_ID)',
    );
  }

  const body = asRecord(await readJsonBody(request, MAX_REGISTER_BODY_BYTES));
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) {
    throw new HttpError(400, 'invalid_session', 'sessionId is required');
  }

  const now = nowOf(env);
  const session = await env.store.getOAuthSession(sessionId, now);
  if (!session) {
    throw new HttpError(404, 'session_expired', 'GitHub device login session expired or does not exist');
  }

  const oauthBase = (env.config.githubOAuthBaseUrl ?? 'https://github.com').replace(/\/+$/, '');
  const apiBase = (env.config.githubApiBaseUrl ?? 'https://api.github.com').replace(/\/+$/, '');
  const fetchFn = fetchOf(env);

  let tokenRes: Response;
  try {
    tokenRes = await fetchFn(`${oauthBase}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Token-Island-Cloud',
      },
      body: JSON.stringify({
        client_id: clientId,
        device_code: session.githubDeviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
  } catch (error) {
    throw new HttpError(
      502,
      'github_unreachable',
      `Failed to poll GitHub OAuth: ${error instanceof Error ? error.message : 'network error'}`,
    );
  }

  const tokenJson = asRecord(await tokenRes.json().catch(() => ({})));
  const oauthError = typeof tokenJson.error === 'string' ? tokenJson.error : '';

  if (oauthError === 'authorization_pending') {
    return jsonResponse(200, { status: 'pending', interval: session.intervalSec });
  }
  if (oauthError === 'slow_down') {
    const nextInterval =
      typeof tokenJson.interval === 'number' && tokenJson.interval > 0
        ? Math.trunc(tokenJson.interval)
        : session.intervalSec + 5;
    await env.store.updateOAuthSessionInterval(sessionId, nextInterval);
    return jsonResponse(200, { status: 'pending', interval: nextInterval });
  }
  if (oauthError) {
    await env.store.deleteOAuthSession(sessionId);
    const desc =
      typeof tokenJson.error_description === 'string' ? tokenJson.error_description : oauthError;
    throw new HttpError(400, oauthError, desc);
  }

  const githubAccessToken = typeof tokenJson.access_token === 'string' ? tokenJson.access_token : '';
  if (!githubAccessToken) {
    throw new HttpError(502, 'github_token_missing', 'GitHub did not return an access_token');
  }

  let profileRes: Response;
  try {
    profileRes = await fetchFn(`${apiBase}/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Token-Island-Cloud',
      },
    });
  } catch (error) {
    throw new HttpError(
      502,
      'github_unreachable',
      `Failed to fetch GitHub user profile: ${error instanceof Error ? error.message : 'network error'}`,
    );
  }

  const ghProfile = asRecord(await profileRes.json().catch(() => ({})));
  const githubId = typeof ghProfile.id === 'number' ? Math.trunc(ghProfile.id) : null;
  const githubLogin = typeof ghProfile.login === 'string' ? ghProfile.login.trim() : '';
  if (!profileRes.ok || !githubId || !githubLogin) {
    throw new HttpError(502, 'github_profile_invalid', 'Could not verify GitHub user identity');
  }

  const avatarUrl = typeof ghProfile.avatar_url === 'string' ? ghProfile.avatar_url.slice(0, 300) : '';
  const ghDisplayName = sanitizeDisplayName(ghProfile.name, githubLogin);

  let user = await env.store.getUserByGithubId(githubId);
  if (user) {
    user =
      (await env.store.updateUserProfile(
        user.username,
        {
          avatarUrl: avatarUrl || user.avatarUrl,
          displayName: user.displayName || ghDisplayName,
        },
        now,
      )) ?? user;
  } else {
    const username = await allocateGithubUsername(env.store, githubLogin);
    const rootKey = await generateApiKey();
    user = await env.store.createUser({
      username,
      displayName: ghDisplayName,
      apiKeyHash: await hashApiKey(rootKey),
      githubId,
      avatarUrl,
      visibility: 'public',
      now,
    });
  }

  const deviceKey = await generateDeviceApiKey();
  const device = await env.store.upsertDevice({
    deviceId: session.deviceId || generateDeviceId(),
    userId: user.userId,
    username: user.username,
    deviceName: session.deviceName || 'Mac',
    platform: session.platform,
    keyHash: await hashApiKey(deviceKey),
    now,
  });

  await env.store.deleteOAuthSession(sessionId);

  const base = requestBaseUrl(request, env.config.publicUrl);
  return jsonResponse(200, {
    status: 'complete',
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    visibility: user.visibility,
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    apiKey: deviceKey,
    dashboardUrl: `${base}/u/${encodeURIComponent(user.username)}`,
  });
}

// ---------------------------------------------------------------------------
// Handlers: register / me / settings / devices / ingest
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
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    visibility: user.visibility,
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
  const principal = await requirePrincipal(request, env);
  const { user, device } = principal;
  const body = asRecord(await readJsonBody(request, MAX_BODY_BYTES));
  const days = parseCloudDays(body.days);
  const now = nowOf(env);

  // Device-scoped tokens always write strictly to their own device slice;
  // legacy user-level keys allow optional `body.deviceId` (default `'legacy'`).
  const effectiveDeviceId = device
    ? device.deviceId
    : (sanitizeDeviceId(body.deviceId) ?? 'legacy');

  const result = await env.store.upsertDays(user.username, days, now, {
    deviceId: effectiveDeviceId,
    deviceName: sanitizeDeviceName(body.deviceName, device?.deviceName ?? 'Mac'),
    platform: sanitizePlatform(body.platform),
  });
  await env.store.touchLastSync(user.username, now, device?.deviceId ?? null);

  const dates = days.map((day) => day.date).sort();
  return jsonResponse(200, {
    ok: true,
    username: user.username,
    deviceId: effectiveDeviceId,
    days: days.length,
    totalDays: result.totalDays,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    lastSyncAt: now,
  });
}

async function handleMe(request: Request, env: AppEnv): Promise<Response> {
  const { user, device } = await requirePrincipal(request, env);
  const [days, devices] = await Promise.all([
    env.store.listDays(user.username),
    env.store.listDevices(user.username),
  ]);
  const stats = computeUserStats(user, days, { now: nowOf(env) });
  return jsonResponse(200, {
    userId: user.userId,
    username: stats.username,
    displayName: stats.displayName,
    avatarUrl: user.avatarUrl,
    githubConnected: user.githubId !== null,
    visibility: user.visibility,
    currentDeviceId: device?.deviceId ?? null,
    devices: devices.map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      platform: d.platform,
      createdAt: d.createdAt,
      lastSyncAt: d.lastSyncAt,
      current: device?.deviceId === d.deviceId,
    })),
    days: stats.totalDays,
    firstDate: stats.firstDate,
    lastDate: stats.lastDate,
    lastSyncAt: stats.lastSyncAt,
    totals: stats.totals,
    streak: stats.streak,
    activeDays: stats.activeDays,
  });
}

async function handleMeSummary(request: Request, env: AppEnv): Promise<Response> {
  const { user } = await requirePrincipal(request, env);
  const days = await env.store.listDays(user.username);
  const stats = computeUserStats(user, days, { now: nowOf(env) });
  return jsonResponse(200, {
    ...publicStatsJson(stats, { now: nowOf(env) }),
    visibility: user.visibility,
    githubConnected: user.githubId !== null,
  });
}

async function handleMeSettings(request: Request, env: AppEnv): Promise<Response> {
  const { user } = await requirePrincipal(request, env);
  const body = asRecord(await readJsonBody(request, MAX_REGISTER_BODY_BYTES));
  const patch: { visibility?: UserVisibility; displayName?: string } = {};

  if (body.visibility !== undefined) {
    if (!isVisibility(body.visibility)) {
      throw new HttpError(400, 'invalid_visibility', 'visibility must be public, unlisted or private');
    }
    patch.visibility = body.visibility;
  }
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string') {
      throw new HttpError(400, 'invalid_display_name', 'displayName must be a string');
    }
    patch.displayName = sanitizeDisplayName(body.displayName, user.username);
  }

  const updated = (await env.store.updateUserProfile(user.username, patch, nowOf(env))) ?? user;
  return jsonResponse(200, {
    ok: true,
    username: updated.username,
    displayName: updated.displayName,
    visibility: updated.visibility,
  });
}

async function handleRevokeDevice(request: Request, env: AppEnv): Promise<Response> {
  const { user } = await requirePrincipal(request, env);
  const body = asRecord(await readJsonBody(request, MAX_REGISTER_BODY_BYTES));
  const deviceId = sanitizeDeviceId(body.deviceId);
  if (!deviceId) {
    throw new HttpError(400, 'invalid_device_id', 'deviceId is required');
  }
  const revoked = await env.store.revokeDevice(user.username, deviceId, nowOf(env));
  return jsonResponse(200, { ok: true, deviceId, revoked });
}

async function handlePublicStats(request: Request, env: AppEnv, rawUsername: string): Promise<Response> {
  const username = decodePathSegment(rawUsername);
  if (!USERNAME_PATTERN.test(username)) {
    throw new HttpError(404, 'not_found', 'user not found');
  }
  const loaded = await loadUserAndStats(env, username);
  if (!loaded || !(await canReadUserAsset(request, env, loaded.user, 'json'))) {
    throw new HttpError(404, 'not_found', `no user named "${username}"`);
  }
  return jsonResponse(200, publicStatsJson(loaded.stats, { now: nowOf(env) }));
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
  const loaded = validUsername ? await loadUserAndStats(env, username) : null;

  if (asset === undefined) {
    const allowed = loaded ? await canReadUserAsset(request, env, loaded.user, 'page') : false;
    if (!loaded || !allowed) {
      return new Response(renderNotFoundPage(theme, username || 'unknown'), {
        status: 404,
        headers: withSecurity(
          new Headers({
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': HTML_CSP,
          }),
        ),
      });
    }
    return htmlResponse(renderDashboardPage({ stats: loaded.stats, theme, baseUrl: base, now }));
  }

  const svgAllowed = loaded ? await canReadUserAsset(request, env, loaded.user, 'svg') : false;
  const stats = loaded && svgAllowed ? loaded.stats : null;
  const cacheHeader =
    loaded && loaded.user.visibility !== 'public' ? 'private, no-store' : SVG_CACHE;

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
    return svgResponse(request, 200, renderBadge(stats, badgeOptions), cacheHeader);
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
    return svgResponse(request, 200, renderChart(series, chartOptions), cacheHeader);
  }

  if (asset === 'card.svg') {
    const cardOptions = { theme, width: params.get('width') ?? undefined, now, idPrefix: 'ti-card' };
    if (!stats) return svgResponse(request, 404, renderUnknownCard(cardOptions), SVG_CACHE_UNKNOWN);
    return svgResponse(request, 200, renderCard(stats, cardOptions), cacheHeader);
  }

  throw new HttpError(404, 'not_found', `no asset named "${asset}"`);
}

async function handleGet(request: Request, env: AppEnv, url: URL, path: string): Promise<Response> {
  const params = url.searchParams;
  const base = requestBaseUrl(request, env.config.publicUrl);

  if (path === '/') {
    const theme = pageTheme(params.get('theme'));
    const demoLoaded = await loadUserAndStats(env, 'demo');
    const demo = demoLoaded && demoLoaded.user.visibility === 'public' ? demoLoaded.stats : null;
    return htmlResponse(renderLandingPage({ theme, demo, baseUrl: base }));
  }
  if (path === '/healthz') {
    const counts = await env.store.counts();
    const startedAt = env.startedAt ?? nowOf(env);
    return jsonResponse(200, {
      ok: true,
      users: counts.users,
      days: counts.days,
      githubAuthEnabled: Boolean(env.config.githubClientId?.trim()),
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
  if (path === '/api/v1/me/summary') {
    return handleMeSummary(request, env);
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

export async function handleRequest(request: Request, env: AppEnv): Promise<Response> {
  const method = (request.method || 'GET').toUpperCase();
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    url = new URL('http://127.0.0.1:47117/');
  }
  const path = normalizePath(url.pathname);

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: withSecurity(new Headers()) });
  }

  let response: Response;
  try {
    if (path.startsWith('/fonts/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        throw new HttpError(405, 'method_not_allowed', `method ${method} is not allowed`, {
          Allow: 'GET, HEAD, POST, OPTIONS',
        });
      }
      response = await handleFonts(request, env);
    } else if (method === 'GET' || method === 'HEAD') {
      response = await handleGet(request, env, url, path);
    } else if (method === 'POST') {
      if (path === '/api/v1/register') response = await handleRegister(request, env);
      else if (path === '/api/v1/auth/github/start') response = await handleGithubAuthStart(request, env);
      else if (path === '/api/v1/auth/github/poll') response = await handleGithubAuthPoll(request, env);
      else if (path === '/api/v1/me/settings') response = await handleMeSettings(request, env);
      else if (path === '/api/v1/me/devices/revoke') response = await handleRevokeDevice(request, env);
      else if (path === '/api/v1/ingest') response = await handleIngest(request, env);
      else throw new HttpError(404, 'not_found', `no route for POST ${path}`);
    } else {
      throw new HttpError(405, 'method_not_allowed', `method ${method} is not allowed`, {
        Allow: 'GET, HEAD, POST, OPTIONS',
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
