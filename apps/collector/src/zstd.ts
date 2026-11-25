/**
 * Zstandard helpers for DeepSeek Harness session files.
 *
 * DSH appends a new zstd frame per event, which makes the file "multi-frame".
 * `zlib.zstdDecompressSync` only decodes the first frame, so the authoritative
 * path spawns the `zstd` CLI; a single-frame `zlib` fallback keeps the collector
 * working on machines without it (the caller surfaces a warning, never silent
 * under-counting).
 *
 * The collector is often started by a LaunchAgent with a minimal PATH, so the
 * binary is resolved from explicit candidates first and remembered.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as zlib from 'node:zlib';

export interface ZstdDecompressOptions {
  /** Hard cap on decompressed bytes (guards against corrupt/hostile files). */
  maxBytes?: number;
  timeoutMs?: number;
}

export interface ZstdDecompressResult {
  data: Buffer;
  /** True when the `zstd` binary was unavailable and single-frame zlib was used. */
  fallback: boolean;
}

class ZstdUnavailableError extends Error {
  constructor() {
    super('zstd binary not found');
    this.name = 'ZstdUnavailableError';
  }
}

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

/** Candidate locations, in priority order; `zstd` last means "whatever PATH has". */
export function zstdCandidates(): string[] {
  const candidates: string[] = [];
  const override = process.env.TOKEN_ISLAND_ZSTD;
  if (typeof override === 'string' && override.trim().length > 0) candidates.push(override.trim());
  for (const candidate of ['/opt/homebrew/bin/zstd', '/usr/local/bin/zstd', '/usr/bin/zstd']) {
    if (existsSync(candidate)) candidates.push(candidate);
  }
  candidates.push('zstd');
  return candidates;
}

let resolvedBinary: string | null = null;

function runZstd(binary: string, filePath: string, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const chunks: Buffer[] = [];
    const stderr: string[] = [];
    let total = 0;

    const child = spawn(binary, ['-dc', '--quiet', filePath], { stdio: ['ignore', 'pipe', 'pipe'] });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`zstd timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref();

    function finish(error: Error | null, data?: Buffer): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(data ?? Buffer.alloc(0));
    }

    child.stdout.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        child.kill('SIGKILL');
        finish(new Error(`decompressed output exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 16) stderr.push(chunk.toString('utf8'));
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') finish(new ZstdUnavailableError());
      else finish(error);
    });

    child.on('close', (code: number | null) => {
      const data = Buffer.concat(chunks);
      // A live DSH session can be appended to mid-frame; zstd then exits
      // non-zero even though every earlier frame decoded fine.  Keep it.
      if (code === 0 || data.length > 0) {
        finish(null, data);
        return;
      }
      finish(new Error(`zstd exited with code ${code}: ${stderr.join('').trim().slice(0, 300)}`));
    });
  });
}

async function spawnZstd(filePath: string, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  const candidates = resolvedBinary ? [resolvedBinary] : zstdCandidates();
  let unavailable: ZstdUnavailableError | null = null;
  for (const candidate of candidates) {
    try {
      const data = await runZstd(candidate, filePath, maxBytes, timeoutMs);
      resolvedBinary = candidate;
      return data;
    } catch (error) {
      if (error instanceof ZstdUnavailableError) {
        unavailable = error;
        continue;
      }
      throw error;
    }
  }
  throw unavailable ?? new ZstdUnavailableError();
}

function fallbackDecompress(filePath: string): Buffer {
  const decompress = (zlib as { zstdDecompressSync?: (input: Buffer) => Buffer }).zstdDecompressSync;
  if (typeof decompress !== 'function') {
    throw new Error(
      'zstd binary not found and current Node.js lacks zlib.zstdDecompressSync (install zstd or upgrade to Node.js 22.15+)',
    );
  }
  return decompress(readFileSync(filePath));
}

export async function decompressZstdFile(
  filePath: string,
  options: ZstdDecompressOptions = {},
): Promise<ZstdDecompressResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const data = await spawnZstd(filePath, maxBytes, timeoutMs);
    return { data, fallback: false };
  } catch (error) {
    if (error instanceof ZstdUnavailableError) {
      return { data: fallbackDecompress(filePath), fallback: true };
    }
    throw error;
  }
}
