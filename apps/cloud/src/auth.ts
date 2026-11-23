/** API key generation / hashing and bearer-token helpers. */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Keys look like `ti_<32 lowercase hex>`. */
export const API_KEY_PATTERN = /^ti_[0-9a-f]{32}$/;

export const USERNAME_PATTERN = /^[a-z0-9_-]{3,32}$/;

/** Creates a fresh API key.  Only its sha256 hash is ever persisted. */
export function generateApiKey(): string {
  return `ti_${randomBytes(16).toString('hex')}`;
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

/** Random placeholder username, e.g. `ti-1a2b3c`. */
export function randomUsername(): string {
  return `ti-${randomBytes(3).toString('hex')}`;
}

/** Extracts the token from an `Authorization: Bearer <token>` header. */
export function parseBearer(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const match = /^\s*bearer\s+([A-Za-z0-9_.~+/-]{1,4096})\s*$/i.exec(raw);
  return match?.[1] ?? null;
}

/** Constant-time string comparison (hashed first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
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
