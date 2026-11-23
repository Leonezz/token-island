import { readFileSync } from 'node:fs';

/** Package version, read from `apps/collector/package.json` with a hardcoded fallback. */
function readVersion(): string {
  try {
    const url = new URL('../package.json', import.meta.url);
    const parsed = JSON.parse(readFileSync(url, 'utf8')) as { version?: unknown };
    if (typeof parsed.version === 'string' && parsed.version.length > 0) return parsed.version;
  } catch {
    // Fall through to the static fallback: the collector must always start.
  }
  return '0.1.0';
}

export const VERSION: string = readVersion();
