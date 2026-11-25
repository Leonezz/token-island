/**
 * API key, device token, user ID, and GitHub handle helpers.
 *
 * Pure Web APIs (`crypto.subtle.digest` for SHA-256, `crypto.getRandomValues`
 * for keys) so the *same* module runs inside a Cloudflare Worker and in Node 22
 * without a `node:crypto` import.
 */

import type { UserVisibility } from './store/types.js';

/** Keys look like `ti_<32 lowercase hex>` or `ti_dev_<32 lowercase hex>`. */
export const API_KEY_PATTERN = /^ti_(?:dev_)?[0-9a-f]{32}$/;

export const USERNAME_PATTERN = /^[a-z0-9_-]{3,32}$/;

export const DEVICE_ID_PATTERN = /^[a-zA-Z0-9_.:-]{2,80}$/;

export const VISIBILITY_VALUES: readonly UserVisibility[] = ['public', 'unlisted', 'private'];

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Hex token used for usernames / salts: `randomHex(3)` -> 6 chars. */
export function randomHex(bytes: number): string {
  return toHex(randomBytes(bytes));
}

/** Creates a fresh user API key (`ti_<32hex>`). Only its sha256 hash is persisted. */
export async function generateApiKey(): Promise<string> {
  return `ti_${toHex(randomBytes(16))}`;
}

/** Creates a fresh per-device token (`ti_dev_<32hex>`). Only its sha256 hash is persisted. */
export async function generateDeviceApiKey(): Promise<string> {
  return `ti_dev_${toHex(randomBytes(16))}`;
}

/** Immutable internal user ID (`usr_<20hex>`). */
export function generateUserId(): string {
  return `usr_${randomHex(10)}`;
}

/** Generated device ID (`dev_<16hex>`) when client omits one. */
export function generateDeviceId(): string {
  return `dev_${randomHex(8)}`;
}

/** Ephemeral OAuth Device Flow session ID (`ghs_<32hex>`). */
export function generateOAuthSessionId(): string {
  return `ghs_${randomHex(16)}`;
}

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

/** Lowercase hex sha256 of an API key or device key. */
export async function hashApiKey(apiKey: string): Promise<string> {
  return toHex(new Uint8Array(await sha256(apiKey)));
}

/** Hex sha256 of an arbitrary string (used for SVG ETags). */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await sha256(text)));
}

/** Random placeholder username, e.g. `ti-1a2b3c`. */
export function randomUsername(): string {
  return `ti-${randomHex(3)}`;
}

/** Normalizes a GitHub login into a valid 3..32 lowercase Token Island username. */
export function normalizeGitHubUsername(login: string): string {
  const cleaned = login
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28);
  if (cleaned.length >= 3) return cleaned;
  return `gh-${cleaned || randomHex(2)}`;
}

/** Sanitizes a client-supplied device identifier. */
export function sanitizeDeviceId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!DEVICE_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/** Sanitizes a human-readable device name (e.g. "Hanzhen's MacBook Pro"). */
export function sanitizeDeviceName(raw: unknown, fallback = 'Mac'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return cleaned || fallback;
}

/** Sanitizes a platform label (`darwin-arm64`, `linux-x64`, etc.). */
export function sanitizePlatform(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 32);
}

export function isVisibility(raw: unknown): raw is UserVisibility {
  return typeof raw === 'string' && (VISIBILITY_VALUES as readonly string[]).includes(raw);
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^\s*bearer\s+([A-Za-z0-9_.~+/-]{1,4096})\s*$/i.exec(header);
  return match?.[1] ?? null;
}

/** Constant-time string comparison (both sides hashed first so lengths never leak). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    new Uint8Array(await sha256(a)),
    new Uint8Array(await sha256(b)),
  ]);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}

/**
 * Display names come from users: strip control characters, collapse whitespace
 * and cap the length.  Empty input falls back to the username.
 */
export function sanitizeDisplayName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || fallback;
}
