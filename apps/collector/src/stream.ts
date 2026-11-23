/**
 * Incremental JSONL reader.
 *
 * Reads a file from a persisted byte offset, exposes complete lines as Buffers
 * and reports the offset *after the last consumed newline*, so a trailing
 * partial line is never consumed.  Files can be hundreds of megabytes: nothing
 * is accumulated except the current line, and a per-scan byte budget keeps the
 * daemon responsive while it catches up in the background.
 */

import { createReadStream } from 'node:fs';

const NEWLINE = 0x0a;
const DEFAULT_CHUNK_SIZE = 1 << 20;

export interface ReadLinesOptions {
  /** Byte offset to start reading from (0 = beginning). */
  start: number;
  /** Stop after roughly this many bytes, at a line boundary only. */
  maxBytes?: number;
  /** Current file size, used to report whether unread bytes remain. */
  sizeHint?: number;
  onLine: (line: Buffer, nextOffset: number) => void;
}

export interface ReadLinesResult {
  /** Offset after the last complete line consumed (safe checkpoint). */
  nextOffset: number;
  /** True when the byte budget stopped the read before EOF. */
  more: boolean;
  bytesRead: number;
}

export async function readLinesFromOffset(
  filePath: string,
  options: ReadLinesOptions,
): Promise<ReadLinesResult> {
  const start = Math.max(0, Math.floor(options.start));
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  let offset = start;
  let stopped = false;
  const pending: Buffer[] = [];
  const stream = createReadStream(filePath, { start, highWaterMark: DEFAULT_CHUNK_SIZE });

  try {
    for await (const chunk of stream) {
      const data = chunk as Buffer;
      let cursor = 0;
      while (true) {
        const newline = data.indexOf(NEWLINE, cursor);
        if (newline === -1) {
          if (cursor < data.length) pending.push(data.subarray(cursor));
          break;
        }
        let line: Buffer;
        if (pending.length > 0) {
          pending.push(data.subarray(cursor, newline));
          line = Buffer.concat(pending);
          pending.length = 0;
        } else {
          line = data.subarray(cursor, newline);
        }
        offset += line.length + 1;
        options.onLine(line, offset);
        cursor = newline + 1;
        // Only ever stop between lines: a single huge line is consumed whole.
        if (offset - start >= maxBytes) {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }
  } finally {
    stream.destroy();
  }

  const size = options.sizeHint;
  const more = stopped && (size === undefined ? true : offset < size);
  return { nextOffset: offset, more, bytesRead: offset - start };
}
