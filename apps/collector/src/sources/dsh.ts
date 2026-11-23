/**
 * DeepSeek Harness parser — `~/.dsh/sessions/*\/*\/session.v4.jsonl.zstd`.
 *
 * The session log is compressed JSONL with one zstd frame per appended event,
 * so it is decompressed as a whole (`zstd -dc` child process) and re-parsed
 * only when (size, mtime) changes.  Session files are small; dedupe is by
 * `dsh:${sessionId}:${seq}`.
 */

import path from 'node:path';
import type { UsageEvent } from '@token-island/core';
import { decompressZstdFile } from '../zstd.js';
import type { FileScanInput, FileScanResult, JsonlSourceSpec, SourceContext } from './types.js';
import { buildUsageEvent, isRecord, nonNegativeInt, parseTimestamp, stringValue, sumTokens } from './util.js';

export const DSH_SESSION_FILE = 'session.v4.jsonl.zstd';

export interface DshSessionHeader {
  sessionId: string;
  cwd: string;
  agentPreset: string;
}

export function parseDshLines(
  text: string,
  fallbackSessionId: string,
  ctx: SourceContext,
): { events: UsageEvent[]; header: DshSessionHeader; model: string; provider: string } {
  const events: UsageEvent[] = [];
  const seen = new Set<string>();
  const header: DshSessionHeader = { sessionId: fallbackSessionId, cwd: '', agentPreset: '' };
  let model = '';
  let provider = '';

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const type = stringValue(parsed.type);

    if (type === 'session') {
      const id = stringValue(parsed.id).trim();
      if (id.length > 0) header.sessionId = id;
      const cwd = stringValue(parsed.cwd);
      if (cwd.length > 0) header.cwd = cwd;
      const preset = stringValue(parsed.agentPreset);
      if (preset.length > 0) header.agentPreset = preset;
      continue;
    }

    if (type === 'model/selection') {
      const data = isRecord(parsed.data) ? parsed.data : null;
      if (!data) continue;
      const dataProvider = stringValue(data.provider).trim();
      const dataModel = stringValue(data.model).trim();
      if (dataProvider.length > 0) provider = dataProvider;
      if (dataModel.length > 0) model = dataModel;
      continue;
    }

    if (type === 'request/header') {
      const data = isRecord(parsed.data) ? parsed.data : null;
      const headerData = data && isRecord(data.header) ? data.header : null;
      const config = headerData && isRecord(headerData.config) ? headerData.config : null;
      if (!config) continue;
      if (provider.length === 0) provider = stringValue(config.provider).trim();
      if (model.length === 0) model = stringValue(config.model).trim();
      continue;
    }

    if (type !== 'assistant/message') continue;
    const data = isRecord(parsed.data) ? parsed.data : null;
    const usage = data && isRecord(data.usage) ? data.usage : null;
    if (!usage) continue;

    const counts = {
      inputTokens: nonNegativeInt(usage.inputTokens),
      outputTokens: nonNegativeInt(usage.outputTokens),
      cacheReadTokens: nonNegativeInt(usage.cacheReadTokens),
      cacheWriteTokens: nonNegativeInt(usage.cacheWriteTokens),
      reasoningTokens: nonNegativeInt(usage.reasoningTokens),
    };
    if (sumTokens(counts) <= 0) continue;

    const seq = Number(parsed.seq);
    if (!Number.isFinite(seq)) continue;
    const ts = parseTimestamp(parsed.time);
    if (ts === null) continue;

    const event = buildUsageEvent(
      {
        id: `dsh:${header.sessionId}:${Math.floor(seq)}`,
        source: 'dsh',
        sessionId: header.sessionId,
        ts,
        model: model || 'unknown',
        provider,
        cwd: header.cwd,
        counts,
      },
      ctx,
    );
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }

  return { events, header, model, provider };
}

export async function scanDshFile(input: FileScanInput): Promise<FileScanResult> {
  const { file, ctx } = input;
  const fallbackSessionId = path.basename(path.dirname(file.path));
  const decompressed = await decompressZstdFile(file.path);
  const { events } = parseDshLines(decompressed.data.toString('utf8'), fallbackSessionId, ctx);
  return {
    events,
    offset: file.size,
    size: file.size,
    mtimeMs: file.mtimeMs,
    more: false,
    warning: decompressed.fallback
      ? 'zstd binary not found; DSH log truncated to first frame (install zstd for full data)'
      : null,
  };
}

export const dshSource: JsonlSourceSpec = {
  id: 'dsh',
  mode: 'whole',
  watchDir: (root) => path.join(root, 'sessions'),
  match: (fileName) => fileName === DSH_SESSION_FILE,
  parseFile: scanDshFile,
};
