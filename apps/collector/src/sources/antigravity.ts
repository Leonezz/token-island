/**
 * Google Antigravity parser — Desktop App, IDE & CLI (`agy`).
 *
 * Antigravity persists local session telemetry across surface directories under
 * `~/.gemini/` (`antigravity`, `antigravity-cli`, `antigravity-ide`, etc.):
 *
 * 1. `conversations/<sessionId>.db` (SQLite, WAL mode — authoritative):
 *    Protobuf blobs in `gen_metadata` (and optional `steps`) carry exact
 *    per-request uncached input, completion, prompt-cache read/write and
 *    thinking token counts, model ids/enums, timestamps and message ids.
 *    `trajectory_metadata_blob` supplies fallback timestamps and workspace
 *    `file://` URIs (`cwd`/`project`), while `parent_references` flags
 *    spawned subagents.
 *
 * 2. `brain/<sessionId>/.system_generated/logs/transcript.jsonl` (fallback):
 *    Streamed incrementally from a byte offset ONLY when no non-empty
 *    conversation SQLite database produced events for `<sessionId>`.
 */

import { existsSync, promises as fs, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { UsageEvent } from '@token-island/core';
import { readLinesFromOffset } from '../stream.js';
import type { DiscoveredFile, FileScanInput, FileScanResult, SourceContext } from './types.js';
import {
  buildUsageEvent,
  isRecord,
  nonNegativeInt,
  parseTimestamp,
  startOffsetFor,
  stringValue,
  sumTokens,
} from './util.js';

const MAX_WALK_DEPTH = 8;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_EPOCH_SEC = 1_000_000_000; // 2001-09-09
const MAX_EPOCH_SEC = 10_000_000_000; // 2286-11-20

const DEFAULT_GEMINI_SURFACES = [
  'antigravity',
  'antigravity-cli',
  'antigravity-ide',
  'antigravity-backup',
  'antigravity-acp',
] as const;

const API_PROVIDER_GOOGLE_VERTEX = 3;
const API_PROVIDER_GOOGLE_GEMINI = 24;
const API_PROVIDER_GOOGLE_EVERGREEN = 30;

const UNRESOLVED_PLACEHOLDER_PREFIX = 'model_placeholder_m';
const UNRESOLVED_ID_PREFIX = 'antigravity-model-';
const DEFAULT_MODEL = 'unknown';

const MODEL_SLUG_RE = /\b(?:gemini|claude|gpt)-[a-z0-9][a-z0-9._-]{1,63}\b/gi;
const FILE_URI_RE = /file:\/\/\/([^\x00-\x20\x7f"'<>\\]+)/i;

// ---------------------------------------------------------------------------
// Minimal zero-dependency Protobuf wire-format reader
// ---------------------------------------------------------------------------

interface ProtoField {
  number: number;
  wire: number;
  varint?: bigint;
  bytes?: Uint8Array;
}

function readVarint(buf: Uint8Array, startPos: number): [bigint, number] | null {
  let value = 0n;
  let shift = 0n;
  let pos = startPos;
  for (let i = 0; i < 10; i += 1) {
    const byte = buf[pos];
    if (byte === undefined) return null;
    pos += 1;
    const payload = BigInt(byte & 0x7f);
    if (shift === 63n && payload > 1n) return null;
    value |= payload << shift;
    if ((byte & 0x80) === 0) return [value, pos];
    shift += 7n;
  }
  return null;
}

function decodeProtoFields(buf: Uint8Array): ProtoField[] | null {
  const fields: ProtoField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const tagPair = readVarint(buf, pos);
    if (!tagPair) return null;
    const [tag, afterTag] = tagPair;
    pos = afterTag;
    const wire = Number(tag & 7n);
    const numBig = tag >> 3n;
    if (numBig <= 0n || numBig > 536_870_911n) return null;
    const number = Number(numBig);

    if (wire === 0) {
      const valPair = readVarint(buf, pos);
      if (!valPair) return null;
      fields.push({ number, wire, varint: valPair[0] });
      pos = valPair[1];
    } else if (wire === 1) {
      if (pos + 8 > buf.length) return null;
      pos += 8;
      fields.push({ number, wire });
    } else if (wire === 2) {
      const lenPair = readVarint(buf, pos);
      if (!lenPair) return null;
      const [lenBig, afterLen] = lenPair;
      if (lenBig < 0n || lenBig > BigInt(buf.length - afterLen)) return null;
      const len = Number(lenBig);
      fields.push({ number, wire, bytes: buf.subarray(afterLen, afterLen + len) });
      pos = afterLen + len;
    } else if (wire === 5) {
      if (pos + 4 > buf.length) return null;
      pos += 4;
      fields.push({ number, wire });
    } else {
      return null;
    }
  }
  return fields;
}

/** Converts unsigned protobuf varints into safe JS integers; negative sentinels (> 2^53-1) become 0. */
function safeNonNegVarint(value: bigint | undefined): number {
  if (value === undefined || value <= 0n || value > MAX_SAFE_BIGINT) return 0;
  return Number(value);
}

function fieldVarint(fields: readonly ProtoField[], number: number): bigint | undefined {
  for (let i = fields.length - 1; i >= 0; i -= 1) {
    const field = fields[i];
    if (field && field.number === number && field.wire === 0 && field.varint !== undefined) {
      return field.varint;
    }
  }
  return undefined;
}

function fieldBytes(fields: readonly ProtoField[], number: number): Uint8Array | undefined {
  for (const field of fields) {
    if (field.number === number && field.wire === 2 && field.bytes !== undefined) {
      return field.bytes;
    }
  }
  return undefined;
}

function fieldBytesAll(fields: readonly ProtoField[], number: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const field of fields) {
    if (field.number === number && field.wire === 2 && field.bytes !== undefined) {
      out.push(field.bytes);
    }
  }
  return out;
}

function fieldText(fields: readonly ProtoField[], number: number): string | null {
  for (let i = fields.length - 1; i >= 0; i -= 1) {
    const field = fields[i];
    if (field && field.number === number && field.wire === 2 && field.bytes !== undefined) {
      const text = Buffer.from(field.bytes.buffer, field.bytes.byteOffset, field.bytes.byteLength)
        .toString('utf8')
        .trim();
      if (text.length > 0 && !text.includes('\ufffd')) return text;
    }
  }
  return null;
}

function parseTimestampMessage(blob: Uint8Array): number | null {
  const fields = decodeProtoFields(blob);
  if (!fields) return null;
  const seconds = safeNonNegVarint(fieldVarint(fields, 1));
  if (seconds < MIN_EPOCH_SEC || seconds > MAX_EPOCH_SEC) return null;
  const nanos = Math.min(999_999_999, safeNonNegVarint(fieldVarint(fields, 2)));
  return seconds * 1_000 + Math.floor(nanos / 1_000_000);
}

function parseStepIndices(fields: readonly ProtoField[]): number[] {
  const indices: number[] = [];
  for (const field of fields) {
    if (field.number !== 2) continue;
    if (field.wire === 0 && field.varint !== undefined && field.varint <= MAX_SAFE_BIGINT) {
      indices.push(Number(field.varint));
    } else if (field.wire === 2 && field.bytes) {
      let pos = 0;
      while (pos < field.bytes.length) {
        const pair = readVarint(field.bytes, pos);
        if (!pair) break;
        const [val, next] = pair;
        pos = next;
        if (val <= MAX_SAFE_BIGINT) indices.push(Number(val));
      }
    }
  }
  return indices;
}

// ---------------------------------------------------------------------------
// Antigravity model id / placeholder / display-name normalization
// ---------------------------------------------------------------------------

const GEMINI_FLASH_EFFORT_FAMILIES = new Set([
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
]);
const GEMINI_FLASH_EFFORTS = new Set(['high', 'medium', 'low']);

function geminiFlashEffortVariant(lowerDisplay: string): string | null {
  const openIdx = lowerDisplay.indexOf(' (');
  if (openIdx === -1 || !lowerDisplay.endsWith(')')) return null;
  const base = lowerDisplay.slice(0, openIdx).trim();
  const effort = lowerDisplay.slice(openIdx + 2, -1).trim();
  if (base.includes('-') || !GEMINI_FLASH_EFFORTS.has(effort)) return null;
  const family = base.replace(/\s+/g, '-');
  if (!GEMINI_FLASH_EFFORT_FAMILIES.has(family)) return null;
  return `${family}-${effort}`;
}

const STATIC_MODEL_ALIASES: Record<string, string> = {
  'gemini 3.8 flash': 'gemini-3.8-flash',
  'gemini 3.8 flash thinking': 'gemini-3.8-flash',
  'gemini 3.7 flash': 'gemini-3.7-flash',
  'gemini 3.7 flash thinking': 'gemini-3.7-flash',
  'gemini 3.7 pro': 'gemini-3.7-pro',
  'gemini 3.7 pro thinking': 'gemini-3.7-pro',
  'gemini 3.6 flash': 'gemini-3.6-flash',
  'gemini 3 flash': 'gemini-3.6-flash',
  'gemini 3.6 pro': 'gemini-3.6-pro',
  'gemini 3.5 flash': 'gemini-3.5-flash',
  'gemini 3.1 pro': 'gemini-3.1-pro',
  'gemini 3 pro': 'gemini-3-pro',
  'gemini 3 pro thinking': 'gemini-3-pro',
  'gemini 2.5 flash': 'gemini-2.5-flash',
  'gemini 2.5 pro': 'gemini-2.5-pro',
  'gemini 2.0 flash': 'gemini-2.0-flash',
  'gemini 2 flash': 'gemini-2.0-flash',
  'gemini 2.0 pro': 'gemini-2.0-pro',
  'gemini 1.5 flash': 'gemini-1.5-flash',
  'gemini 1.5 pro': 'gemini-1.5-pro',
  model_placeholder_m318: 'gemini-3.8-flash-high',
  model_placeholder_m319: 'gemini-3.8-flash-medium',
  model_placeholder_m320: 'gemini-3.8-flash-low',
  model_placeholder_m298: 'gemini-3.7-flash-high',
  model_placeholder_m299: 'gemini-3.7-flash-medium',
  model_placeholder_m300: 'gemini-3.7-flash-low',
  model_placeholder_m71: 'gemini-3.6-flash-high',
  model_placeholder_m72: 'gemini-3.6-flash-medium',
  model_placeholder_m73: 'gemini-3.6-flash-low',
  model_placeholder_m417: 'gemini-4-argon',
  model_placeholder_m418: 'gemini-4-argon',
  model_placeholder_m419: 'gemini-4-argon',
  model_placeholder_m402: 'claude-opus-5-5',
  model_placeholder_m50: 'gemini-3.1-flash-lite',
  model_placeholder_m26: 'claude-opus-4-6',
  model_placeholder_m35: 'claude-sonnet-4-6',
  model_placeholder_m36: 'gemini-3.1-pro',
  model_placeholder_m37: 'gemini-3.1-pro',
  model_placeholder_m16: 'gemini-3.1-pro',
  model_placeholder_m18: 'gemini-3-flash-preview',
  model_placeholder_m84: 'gemini-3-flash-preview',
  model_placeholder_m47: 'gemini-3-flash-preview',
  model_placeholder_m132: 'gemini-3.5-flash-high',
  model_placeholder_m133: 'gemini-3.5-flash-high',
  model_placeholder_m187: 'gemini-3.5-flash-extra-low',
  model_placeholder_m20: 'gemini-3.5-flash-medium',
  model_openai_gpt_oss_120b_medium: 'gpt-oss-120b-medium',
  'gemini-pro-default': 'gemini-3.1-pro',
  'gemini-pro-agent': 'gemini-3.1-pro',
  'gemini-3-flash-agent': 'gemini-3.5-flash-high',
  'gemini-3-flash-agent-a': 'gemini-3.5-flash-high',
  'gemini-3-flash-agent-b': 'gemini-3.5-flash-high',
  'gemini-3-flash-a': 'gemini-3.5-flash-high',
  'gemini-3-flash-b': 'gemini-3.5-flash-high',
  'gemini-3-flash-c': 'gemini-3-flash-preview',
  'gemini-3-flash': 'gemini-3-flash-preview',
  'gemini-3.5-flash-low': 'gemini-3.5-flash-medium',
  'gemini-3.1-pro-high': 'gemini-3.1-pro',
  'gemini-3.1-pro-low': 'gemini-3.1-pro',
  'gemini-3-pro-high': 'gemini-3-pro',
  'gemini-3-pro-low': 'gemini-3-pro',
  'claude sonnet 4.6': 'claude-sonnet-4-6',
  'claude opus 4.6': 'claude-opus-4-6',
  'claude haiku 4.5': 'claude-haiku-4-5',
  'claude sonnet 5.5': 'claude-sonnet-5-5',
  'claude opus 5.5': 'claude-opus-5-5',
  'claude 3.7 sonnet': 'claude-3-7-sonnet',
  'claude 3.7 sonnet thinking': 'claude-3-7-sonnet',
  'claude 3.5 sonnet': 'claude-3-5-sonnet',
  'claude 3.5 haiku': 'claude-3-5-haiku',
  'claude 3 opus': 'claude-3-opus',
};

export function normalizeAntigravityModel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const lower = trimmed.toLowerCase();
  const effortVariant = geminiFlashEffortVariant(lower);
  if (effortVariant) return effortVariant;

  const parenIdx = lower.indexOf('(');
  const base = (parenIdx === -1 ? lower : lower.slice(0, parenIdx)).trim();
  const alias = STATIC_MODEL_ALIASES[base];
  if (alias) return alias;

  const hyphenated = base.replace(/\s+/g, '-');
  if (
    hyphenated.startsWith('gemini-') ||
    hyphenated.startsWith('claude-') ||
    hyphenated.startsWith('gpt-')
  ) {
    return hyphenated.replace(/\./g, (dot, offset, str) => {
      // Normalize `claude-sonnet-4.6` -> `claude-sonnet-4-6` while keeping `gemini-3.8-flash`
      return str.startsWith('claude-') && /\d/.test(str[offset - 1] ?? '') && /\d/.test(str[offset + 1] ?? '')
        ? '-'
        : dot;
    });
  }
  return trimmed;
}

function modelNameFromEnum(modelId: number): string {
  switch (modelId) {
    case 246:
      return 'gemini-2.5-pro';
    case 312:
      return 'gemini-2.5-flash';
    case 313:
    case 329:
      return 'gemini-2.5-flash-thinking';
    case 330:
      return 'gemini-2.5-flash-lite';
    case 281:
    case 282:
      return 'claude-sonnet-4';
    case 290:
    case 291:
      return 'claude-opus-4';
    case 333:
    case 334:
      return 'claude-4.5-sonnet';
    case 340:
    case 341:
      return 'claude-4.5-haiku';
    case 342:
      return 'model_openai_gpt_oss_120b_medium';
    default:
      if (modelId >= 1_000) return `${UNRESOLVED_PLACEHOLDER_PREFIX}${modelId - 1_000}`;
      return `${UNRESOLVED_ID_PREFIX}${modelId}`;
  }
}

export function modelFromEnumId(modelId: number | null): string | null {
  if (!modelId || modelId <= 0) return null;
  return normalizeAntigravityModel(modelNameFromEnum(modelId));
}

function modelResolutionRank(model: string): number {
  if (!model || model === DEFAULT_MODEL) return 0;
  const lower = model.toLowerCase();
  if (lower.startsWith(UNRESOLVED_PLACEHOLDER_PREFIX) || lower.startsWith(UNRESOLVED_ID_PREFIX)) {
    return 1;
  }
  return 2;
}

function resolveProviderName(providerId: number | null, model: string): string {
  if (providerId === API_PROVIDER_GOOGLE_VERTEX) return 'vertex';
  if (providerId === API_PROVIDER_GOOGLE_GEMINI || providerId === API_PROVIDER_GOOGLE_EVERGREEN) {
    return 'google';
  }
  const lower = model.toLowerCase();
  if (lower.includes('claude')) return 'anthropic';
  if (lower.includes('gpt')) return 'openai';
  if (lower.includes('gemini')) return 'google';
  return 'google';
}

// ---------------------------------------------------------------------------
// Protobuf domain structures (`ModelUsage`, `GeneratorMetadata`, `StepMetadata`)
// ---------------------------------------------------------------------------

interface DecodedModelUsage {
  modelId: number | null;
  inputTokens: number;
  totalOutputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  visibleOutputTokens: number;
  providerId: number | null;
  messageId: string | null;
  responseId: string | null;
  providerAssignedMessageId: string | null;
}

interface DecodedGeneratorMetadata {
  model: string | null;
  modelId: number | null;
  usage: DecodedModelUsage | null;
  retryUsages: DecodedModelUsage[];
  timestamp: number | null;
  stepIndices: number[];
  executionId: string | null;
}

interface DecodedStepMetadata {
  model: string | null;
  modelId: number | null;
  providerId: number | null;
  usage: DecodedModelUsage | null;
  retryUsages: DecodedModelUsage[];
  timestamp: number | null;
}

function hasTokenUsage(u: DecodedModelUsage): boolean {
  return (
    u.inputTokens > 0 ||
    u.totalOutputTokens > 0 ||
    u.cacheCreationTokens > 0 ||
    u.cacheReadTokens > 0 ||
    u.reasoningTokens > 0 ||
    u.visibleOutputTokens > 0
  );
}

function usageIdentityKeys(u: DecodedModelUsage): string[] {
  const keys: string[] = [];
  if (u.responseId) keys.push(`response:${u.responseId}`);
  if (u.providerAssignedMessageId) keys.push(`provider:${u.providerAssignedMessageId}`);
  if (u.messageId) keys.push(`message:${u.messageId}`);
  return keys;
}

function preferredMessageId(u: DecodedModelUsage): { id: string; rank: number } {
  if (u.responseId) return { id: u.responseId, rank: 3 };
  if (u.providerAssignedMessageId) return { id: u.providerAssignedMessageId, rank: 2 };
  if (u.messageId) return { id: u.messageId, rank: 1 };
  return { id: '', rank: 0 };
}

function isMirrorUsage(candidate: DecodedModelUsage, primary: DecodedModelUsage): boolean {
  if (
    candidate.modelId !== primary.modelId ||
    candidate.inputTokens !== primary.inputTokens ||
    candidate.totalOutputTokens !== primary.totalOutputTokens ||
    candidate.cacheCreationTokens !== primary.cacheCreationTokens ||
    candidate.cacheReadTokens !== primary.cacheReadTokens ||
    candidate.reasoningTokens !== primary.reasoningTokens ||
    candidate.visibleOutputTokens !== primary.visibleOutputTokens
  ) {
    return false;
  }
  const primaryIds = usageIdentityKeys(primary);
  return usageIdentityKeys(candidate).every((id) => primaryIds.includes(id));
}

function dropPrimaryMirror(primary: DecodedModelUsage | null, retries: DecodedModelUsage[]): void {
  if (!primary || retries.length === 0) return;
  const idx = retries.findIndex((retry) => isMirrorUsage(retry, primary));
  if (idx !== -1) retries.splice(idx, 1);
}

function parseModelUsage(blob: Uint8Array): DecodedModelUsage | null {
  const fields = decodeProtoFields(blob);
  if (!fields) return null;
  const modelId = safeNonNegVarint(fieldVarint(fields, 1));
  const providerId = safeNonNegVarint(fieldVarint(fields, 6));
  return {
    modelId: modelId > 0 ? modelId : null,
    inputTokens: safeNonNegVarint(fieldVarint(fields, 2)),
    totalOutputTokens: safeNonNegVarint(fieldVarint(fields, 3)),
    cacheCreationTokens: safeNonNegVarint(fieldVarint(fields, 4)),
    cacheReadTokens: safeNonNegVarint(fieldVarint(fields, 5)),
    reasoningTokens: safeNonNegVarint(fieldVarint(fields, 9)),
    visibleOutputTokens: safeNonNegVarint(fieldVarint(fields, 10)),
    providerId: providerId > 0 ? providerId : null,
    messageId: fieldText(fields, 7),
    responseId: fieldText(fields, 11),
    providerAssignedMessageId: fieldText(fields, 12),
  };
}

function parseRetryInfo(blob: Uint8Array): DecodedModelUsage | null {
  const fields = decodeProtoFields(blob);
  if (!fields) return null;
  const usageBytes = fieldBytes(fields, 2);
  return usageBytes ? parseModelUsage(usageBytes) : null;
}

export function parseGeneratorMetadataBlob(blob: Uint8Array): DecodedGeneratorMetadata | null {
  const root = decodeProtoFields(blob);
  if (!root) return null;
  const chatModelBytes = fieldBytes(root, 1);
  if (!chatModelBytes) return null;
  const cm = decodeProtoFields(chatModelBytes);
  if (!cm) return null;

  const usageBytes = fieldBytes(cm, 4);
  const usage = usageBytes ? parseModelUsage(usageBytes) : null;
  const retryUsages: DecodedModelUsage[] = [];
  for (const retryBytes of fieldBytesAll(cm, 17)) {
    const parsed = parseRetryInfo(retryBytes);
    if (parsed) retryUsages.push(parsed);
  }
  dropPrimaryMirror(usage, retryUsages);

  let timestamp: number | null = null;
  const genInfoBytes = fieldBytes(cm, 9);
  if (genInfoBytes) {
    const genInfo = decodeProtoFields(genInfoBytes);
    const tsBytes = genInfo ? fieldBytes(genInfo, 4) : undefined;
    if (tsBytes) timestamp = parseTimestampMessage(tsBytes);
  }

  const model = fieldText(cm, 19) ?? fieldText(cm, 21);
  const modelIdRaw = safeNonNegVarint(fieldVarint(cm, 3));
  return {
    model,
    modelId: modelIdRaw > 0 ? modelIdRaw : null,
    usage,
    retryUsages,
    timestamp,
    stepIndices: parseStepIndices(root),
    executionId: fieldText(root, 4),
  };
}

export function parseStepMetadataBlob(blob: Uint8Array): DecodedStepMetadata | null {
  const fields = decodeProtoFields(blob);
  if (!fields) return null;
  const usageBytes = fieldBytes(fields, 9);
  const usage = usageBytes ? parseModelUsage(usageBytes) : null;
  const retryUsages: DecodedModelUsage[] = [];
  for (const retryBytes of fieldBytesAll(fields, 28)) {
    const parsed = parseRetryInfo(retryBytes);
    if (parsed) retryUsages.push(parsed);
  }
  dropPrimaryMirror(usage, retryUsages);

  let model: string | null = null;
  let modelId: number | null = null;
  let providerId: number | null = null;
  const modelInfoBytes = fieldBytes(fields, 24);
  if (modelInfoBytes) {
    const info = decodeProtoFields(modelInfoBytes);
    if (info) {
      model = fieldText(info, 12) ?? fieldText(info, 8);
      const mid = safeNonNegVarint(fieldVarint(info, 1));
      const pid = safeNonNegVarint(fieldVarint(info, 7));
      if (mid > 0) modelId = mid;
      if (pid > 0) providerId = pid;
    }
  }

  const tsBytes = fieldBytes(fields, 8) ?? fieldBytes(fields, 1);
  const timestamp = tsBytes ? parseTimestampMessage(tsBytes) : null;
  return { model, modelId, providerId, usage, retryUsages, timestamp };
}

function parseTrajectoryBlob(blob: Uint8Array): { timestamp: number | null; cwd: string } {
  let timestamp: number | null = null;
  const fields = decodeProtoFields(blob);
  if (fields) {
    const tsBytes = fieldBytes(fields, 2);
    if (tsBytes) timestamp = parseTimestampMessage(tsBytes);
  }
  let cwd = '';
  const text = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength).toString('utf8');
  const match = FILE_URI_RE.exec(text);
  if (match && match[1]) {
    try {
      let decoded = decodeURIComponent(match[1]).replace(/\/+$/, '');
      if (!/^[a-zA-Z]:\//.test(decoded)) decoded = `/${decoded}`;
      cwd = decoded;
    } catch {
      cwd = `/${match[1].replace(/\/+$/, '')}`;
    }
  }
  return { timestamp, cwd };
}

// ---------------------------------------------------------------------------
// SQLite conversation database parser + cross-table deduplication
// ---------------------------------------------------------------------------

interface MergedAntigravityEvent {
  identities: string[];
  fallbackKey: string;
  messageId: string;
  messageIdRank: number;
  ts: number;
  tsRank: number;
  model: string;
  providerId: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { ok?: unknown } | undefined;
  return Boolean(row?.ok);
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array && value.byteLength > 0) return value;
  return null;
}

function extractModelSlugFromBytes(blob: Uint8Array): string | null {
  const text = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength).toString('latin1');
  MODEL_SLUG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MODEL_SLUG_RE.exec(text)) !== null) {
    const normalized = normalizeAntigravityModel(match[0]);
    if (normalized && modelResolutionRank(normalized) >= 2) return normalized;
  }
  return null;
}

function resolveCandidateModel(
  usageModelId: number | null,
  rowModelRaw: string | null,
  rowModelId: number | null,
  fallbackModel: string | null,
): string {
  const idModel = modelFromEnumId(usageModelId);
  const rowModel = normalizeAntigravityModel(rowModelRaw) ?? modelFromEnumId(rowModelId);
  const sameId = rowModelId === usageModelId || usageModelId === null || rowModelId === null;

  if (idModel && modelResolutionRank(idModel) >= 2) return idModel;
  if (rowModel && sameId && modelResolutionRank(rowModel) >= 2) return rowModel;
  if (fallbackModel && modelResolutionRank(fallbackModel) >= 2) return fallbackModel;
  return idModel ?? rowModel ?? fallbackModel ?? DEFAULT_MODEL;
}

function mergeCandidateInto(target: MergedAntigravityEvent, incoming: MergedAntigravityEvent): void {
  target.inputTokens = Math.max(target.inputTokens, incoming.inputTokens);
  target.outputTokens = Math.max(target.outputTokens, incoming.outputTokens);
  target.cacheReadTokens = Math.max(target.cacheReadTokens, incoming.cacheReadTokens);
  target.cacheWriteTokens = Math.max(target.cacheWriteTokens, incoming.cacheWriteTokens);
  target.reasoningTokens = Math.min(
    target.outputTokens,
    Math.max(target.reasoningTokens, incoming.reasoningTokens),
  );
  if (modelResolutionRank(incoming.model) > modelResolutionRank(target.model)) {
    target.model = incoming.model;
  }
  if (target.providerId === null && incoming.providerId !== null) {
    target.providerId = incoming.providerId;
  }
  if (
    incoming.tsRank > target.tsRank ||
    (incoming.tsRank === target.tsRank && incoming.ts < target.ts)
  ) {
    target.ts = incoming.ts;
    target.tsRank = incoming.tsRank;
  }
  if (incoming.messageIdRank > target.messageIdRank) {
    target.messageId = incoming.messageId;
    target.messageIdRank = incoming.messageIdRank;
  }
  for (const id of incoming.identities) {
    if (!target.identities.includes(id)) target.identities.push(id);
  }
}

export interface AntigravityDbScanResult {
  events: UsageEvent[];
  hasGenTable: boolean;
}

export function scanAntigravityDbFile(
  dbPath: string,
  sessionId: string,
  ctx: SourceContext,
): AntigravityDbScanResult {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    try {
      db.exec('PRAGMA busy_timeout = 1000;');
      db.exec('PRAGMA query_only = ON;');
    } catch {
      // Read-only pragma best effort.
    }

    if (!tableExists(db, 'gen_metadata')) {
      return { events: [], hasGenTable: false };
    }

    let trajectoryTs: number | null = null;
    let cwd = '';
    if (tableExists(db, 'trajectory_metadata_blob')) {
      try {
        const rows = db.prepare('SELECT data FROM trajectory_metadata_blob ORDER BY rowid ASC').all() as Array<{
          data?: unknown;
        }>;
        for (const row of rows) {
          const blob = toUint8Array(row.data);
          if (!blob) continue;
          const parsed = parseTrajectoryBlob(blob);
          if (trajectoryTs === null && parsed.timestamp !== null) trajectoryTs = parsed.timestamp;
          if (!cwd && parsed.cwd) cwd = parsed.cwd;
        }
      } catch {
        // Optional metadata table.
      }
    }

    let agent = 'main';
    if (tableExists(db, 'parent_references')) {
      try {
        const parentRow = db.prepare('SELECT 1 AS sub FROM parent_references LIMIT 1').get() as
          | { sub?: unknown }
          | undefined;
        if (parentRow?.sub) agent = 'subagent';
      } catch {
        // Optional table.
      }
    }

    const executorStepModels = new Map<number, string>();
    let executorFallbackModel: string | null = null;
    if (tableExists(db, 'executor_metadata')) {
      try {
        const rows = db.prepare('SELECT idx, data FROM executor_metadata ORDER BY idx ASC').all() as Array<{
          idx?: unknown;
          data?: unknown;
        }>;
        for (const row of rows) {
          const blob = toUint8Array(row.data);
          if (!blob) continue;
          const slug = extractModelSlugFromBytes(blob);
          if (!slug) continue;
          const idx = typeof row.idx === 'number' ? row.idx : Number(row.idx);
          if (Number.isFinite(idx)) executorStepModels.set(idx, slug);
          executorFallbackModel = slug;
        }
      } catch {
        // Optional table.
      }
    }

    const stepRows: Array<{ idx: number; meta: DecodedStepMetadata }> = [];
    if (tableExists(db, 'steps')) {
      try {
        const rows = db
          .prepare('SELECT idx, metadata FROM steps WHERE metadata IS NOT NULL ORDER BY idx ASC')
          .all() as Array<{ idx?: unknown; metadata?: unknown }>;
        for (const row of rows) {
          const blob = toUint8Array(row.metadata);
          const idx = typeof row.idx === 'number' ? row.idx : Number(row.idx);
          if (!blob || !Number.isFinite(idx)) continue;
          const meta = parseStepMetadataBlob(blob);
          if (meta) stepRows.push({ idx, meta });
        }
      } catch {
        // Optional table.
      }
    }

    const genRows: Array<{ idx: number; meta: DecodedGeneratorMetadata }> = [];
    const rawGenRows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all() as Array<{
      idx?: unknown;
      data?: unknown;
    }>;
    for (const row of rawGenRows) {
      const blob = toUint8Array(row.data);
      const idx = typeof row.idx === 'number' ? row.idx : Number(row.idx);
      if (!blob || !Number.isFinite(idx)) continue;
      const meta = parseGeneratorMetadataBlob(blob);
      if (meta) genRows.push({ idx, meta });
    }

    // Seed cross-linked timestamps across step indices and message/response ids.
    const identityTimestamps = new Map<string, { ts: number; rank: number }>();
    const rememberTs = (keys: readonly string[], ts: number | null, rank: number): void => {
      if (ts === null || ts <= 0) return;
      for (const key of keys) {
        const prev = identityTimestamps.get(key);
        if (!prev || rank > prev.rank || (rank === prev.rank && ts < prev.ts)) {
          identityTimestamps.set(key, { ts, rank });
        }
      }
    };

    for (const { idx, meta } of stepRows) {
      const keys = [`step:${sessionId}:${idx}`];
      if (meta.usage) keys.push(...usageIdentityKeys(meta.usage));
      for (const retry of meta.retryUsages) keys.push(...usageIdentityKeys(retry));
      rememberTs(keys, meta.timestamp, 3);
    }
    for (const { idx, meta } of genRows) {
      const stepKeys =
        meta.stepIndices.length > 0
          ? meta.stepIndices.map((s) => `step:${sessionId}:${s}`)
          : [`gen:${sessionId}:${idx}`];
      const keys = [...stepKeys];
      if (meta.executionId) keys.push(`exec:${meta.executionId}`);
      if (meta.usage) keys.push(...usageIdentityKeys(meta.usage));
      for (const retry of meta.retryUsages) keys.push(...usageIdentityKeys(retry));
      rememberTs(keys, meta.timestamp, 3);
    }

    let latestGenModel: string | null = null;
    for (let i = genRows.length - 1; i >= 0; i -= 1) {
      const row = genRows[i];
      if (!row) continue;
      const m = normalizeAntigravityModel(row.meta.model) ?? modelFromEnumId(row.meta.modelId);
      if (m) {
        latestGenModel = m;
        break;
      }
    }

    const candidates: MergedAntigravityEvent[] = [];
    const pushUsage = (
      usage: DecodedModelUsage,
      opts: {
        rowModel: string | null;
        rowModelId: number | null;
        fallbackModel: string | null;
        providerId: number | null;
        directTs: number | null;
        fallbackIdentities: string[];
        fallbackKey: string;
      },
    ): void => {
      if (!hasTokenUsage(usage)) return;
      const ownKeys = usageIdentityKeys(usage);
      const identities = ownKeys.length > 0 ? [...ownKeys, ...opts.fallbackIdentities] : [...opts.fallbackIdentities];
      let resolvedTs: { ts: number; rank: number } | null =
        opts.directTs !== null && opts.directTs > 0 ? { ts: opts.directTs, rank: 3 } : null;
      if (!resolvedTs) {
        for (const key of identities) {
          const found = identityTimestamps.get(key);
          if (found) {
            resolvedTs = found;
            break;
          }
        }
      }
      if (!resolvedTs && trajectoryTs !== null && trajectoryTs > 0) {
        resolvedTs = { ts: trajectoryTs, rank: 1 };
      }
      if (!resolvedTs) return;

      rememberTs(identities, resolvedTs.ts, resolvedTs.rank);

      const outputTokens = Math.max(
        usage.totalOutputTokens,
        usage.visibleOutputTokens + usage.reasoningTokens,
      );
      const reasoningTokens =
        usage.reasoningTokens > 0 ? Math.min(outputTokens, usage.reasoningTokens) : 0;
      const model = resolveCandidateModel(
        usage.modelId,
        opts.rowModel,
        opts.rowModelId,
        opts.fallbackModel,
      );
      const msg = preferredMessageId(usage);

      candidates.push({
        identities,
        fallbackKey: opts.fallbackKey,
        messageId: msg.id,
        messageIdRank: msg.rank,
        ts: resolvedTs.ts,
        tsRank: resolvedTs.rank,
        model,
        providerId: usage.providerId ?? opts.providerId,
        inputTokens: usage.inputTokens,
        outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheCreationTokens,
        reasoningTokens,
      });
    };

    for (const { idx, meta } of stepRows) {
      const execModel = executorStepModels.get(idx) ?? latestGenModel ?? executorFallbackModel;
      const stepIdentity = `step:${sessionId}:${idx}`;
      if (meta.usage) {
        pushUsage(meta.usage, {
          rowModel: meta.model,
          rowModelId: meta.modelId,
          fallbackModel: execModel,
          providerId: meta.providerId,
          directTs: meta.timestamp,
          fallbackIdentities: [stepIdentity],
          fallbackKey: `step:${idx}`,
        });
      }
      meta.retryUsages.forEach((retry, retryIdx) => {
        pushUsage(retry, {
          rowModel: meta.model,
          rowModelId: meta.modelId,
          fallbackModel: execModel,
          providerId: meta.providerId,
          directTs: meta.timestamp,
          fallbackIdentities: [`step-retry:${sessionId}:${idx}:${retryIdx}`],
          fallbackKey: `step:${idx}:retry:${retryIdx}`,
        });
      });
    }

    let runningGenModel: string | null = executorFallbackModel;
    for (const { idx, meta } of genRows) {
      const explicitGenModel =
        normalizeAntigravityModel(meta.model) ??
        modelFromEnumId(meta.modelId) ??
        modelFromEnumId(meta.usage?.modelId ?? null);
      if (explicitGenModel) runningGenModel = explicitGenModel;

      const stepModel =
        meta.stepIndices
          .map((s) => executorStepModels.get(s))
          .find((m): m is string => Boolean(m)) ?? runningGenModel;
      const genIdentities =
        meta.stepIndices.length > 0
          ? meta.stepIndices.map((s) => `step:${sessionId}:${s}`)
          : [`gen:${sessionId}:${idx}`];
      if (meta.executionId) genIdentities.unshift(`exec:${meta.executionId}`);
      const primaryFallbackKey =
        meta.stepIndices[0] !== undefined ? `step:${meta.stepIndices[0]}` : `gen:${idx}`;

      if (meta.usage) {
        pushUsage(meta.usage, {
          rowModel: meta.model,
          rowModelId: meta.modelId,
          fallbackModel: stepModel,
          providerId: null,
          directTs: meta.timestamp,
          fallbackIdentities: genIdentities,
          fallbackKey: meta.executionId ? `exec:${meta.executionId}` : primaryFallbackKey,
        });
      }
      meta.retryUsages.forEach((retry, retryIdx) => {
        pushUsage(retry, {
          rowModel: meta.model,
          rowModelId: meta.modelId,
          fallbackModel: stepModel,
          providerId: null,
          directTs: meta.timestamp,
          fallbackIdentities: [`gen-retry:${sessionId}:${idx}:${retryIdx}`],
          fallbackKey: `gen:${idx}:retry:${retryIdx}`,
        });
      });
    }

    // Deduplicate overlapping step + gen_metadata records by shared identity keys.
    const slots: Array<MergedAntigravityEvent | null> = [];
    const keyToSlot = new Map<string, number>();
    for (const item of candidates) {
      const matched = new Set<number>();
      for (const id of item.identities) {
        const existing = keyToSlot.get(id);
        if (existing !== undefined) matched.add(existing);
      }
      if (matched.size === 0) {
        const slotIdx = slots.length;
        slots.push(item);
        for (const id of item.identities) keyToSlot.set(id, slotIdx);
        continue;
      }
      const ordered = [...matched].sort((a, b) => a - b);
      const targetIdx = ordered[0]!;
      const target = slots[targetIdx]!;
      for (let i = 1; i < ordered.length; i += 1) {
        const dupIdx = ordered[i]!;
        const dup = slots[dupIdx];
        if (dup) {
          mergeCandidateInto(target, dup);
          slots[dupIdx] = null;
        }
      }
      mergeCandidateInto(target, item);
      for (const id of target.identities) keyToSlot.set(id, targetIdx);
    }

    const events: UsageEvent[] = [];
    const seenIds = new Set<string>();
    for (const merged of slots) {
      if (!merged) continue;
      const id = merged.messageId
        ? `antigravity:${merged.messageId}`
        : `antigravity:${sessionId}:${merged.fallbackKey}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      events.push(
        buildUsageEvent(
          {
            id,
            source: 'antigravity',
            sessionId,
            messageId: merged.messageId,
            ts: merged.ts,
            model: merged.model,
            provider: resolveProviderName(merged.providerId, merged.model),
            agent,
            cwd,
            counts: {
              inputTokens: merged.inputTokens,
              outputTokens: merged.outputTokens,
              cacheReadTokens: merged.cacheReadTokens,
              cacheWriteTokens: merged.cacheWriteTokens,
              reasoningTokens: merged.reasoningTokens,
            },
          },
          ctx,
        ),
      );
    }
    events.sort((a, b) => a.ts - b.ts);
    return { events, hasGenTable: true };
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Incremental `brain/**/transcript.jsonl` fallback parser
// ---------------------------------------------------------------------------

interface TranscriptParserState {
  model: string;
  cwd: string;
}

function loadTranscriptState(raw: string | null): TranscriptParserState {
  if (!raw) return { model: '', cwd: '' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { model: '', cwd: '' };
    return {
      model: stringValue(parsed.model),
      cwd: stringValue(parsed.cwd),
    };
  } catch {
    return { model: '', cwd: '' };
  }
}

function pickFirstInt(obj: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const val = nonNegativeInt(obj[key]);
    if (val > 0) return val;
  }
  return 0;
}

function pickFirstString(obj: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const val = stringValue(obj[key]).trim();
    if (val.length > 0) return val;
  }
  return '';
}

function extractUsageRecord(obj: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ['usage', 'usageMetadata', 'tokenUsage', 'modelUsage']) {
    if (isRecord(obj[key])) return obj[key] as Record<string, unknown>;
  }
  if (isRecord(obj.generatorMetadata) && isRecord(obj.generatorMetadata.chatModel)) {
    const cm = obj.generatorMetadata.chatModel;
    if (isRecord(cm.usage)) return cm.usage;
  }
  if (isRecord(obj.metadata)) {
    const nested = extractUsageRecord(obj.metadata);
    if (nested) return nested;
  }
  if (
    obj.type === 'PLANNER_RESPONSE' ||
    obj.input_tokens !== undefined ||
    obj.inputTokens !== undefined ||
    obj.output_tokens !== undefined ||
    obj.outputTokens !== undefined ||
    obj.cache_read_tokens !== undefined ||
    obj.cacheReadTokens !== undefined
  ) {
    return obj;
  }
  return null;
}

export function parseAntigravityTranscriptLine(
  line: Buffer,
  sessionId: string,
  offsetAfter: number,
  state: TranscriptParserState,
  ctx: SourceContext,
): UsageEvent | null {
  const text = line.toString('utf8').trim();
  if (!text.startsWith('{')) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const cwdCandidate = pickFirstString(parsed, ['cwd', 'workspacePath', 'workspace_path']);
  if (cwdCandidate) state.cwd = cwdCandidate;
  if (!state.cwd && typeof parsed.content === 'string') {
    const uriMatch = FILE_URI_RE.exec(parsed.content);
    if (uriMatch && uriMatch[1]) {
      try {
        state.cwd = `/${decodeURIComponent(uriMatch[1]).replace(/\/+$/, '')}`;
      } catch {
        // Ignore malformed URIs.
      }
    }
  }

  const gm = isRecord(parsed.generatorMetadata) ? parsed.generatorMetadata : null;
  const cm = gm && isRecord(gm.chatModel) ? gm.chatModel : null;
  const explicitModel =
    pickFirstString(parsed, ['responseModel', 'response_model', 'model', 'modelDisplayName']) ||
    (cm ? pickFirstString(cm, ['responseModel', 'modelDisplayName', 'model']) : '');
  const normalizedExplicit = normalizeAntigravityModel(explicitModel);
  if (normalizedExplicit) state.model = normalizedExplicit;

  const usage = extractUsageRecord(parsed);
  if (!usage) return null;

  const inputTokens = pickFirstInt(usage, [
    'input_tokens',
    'inputTokens',
    'promptTokenCount',
    'prompt_tokens',
  ]);
  const rawOutput = pickFirstInt(usage, [
    'output_tokens',
    'outputTokens',
    'candidatesTokenCount',
    'completion_tokens',
  ]);
  const cacheReadTokens = pickFirstInt(usage, [
    'cache_read_tokens',
    'cacheReadTokens',
    'cachedContentTokenCount',
    'cache_read_input_tokens',
  ]);
  const cacheWriteTokens = pickFirstInt(usage, [
    'cache_creation_tokens',
    'cacheCreationTokens',
    'cache_write_tokens',
    'cache_creation_input_tokens',
  ]);
  const reasoningTokens = pickFirstInt(usage, [
    'thinking_tokens',
    'thinkingTokens',
    'reasoning_tokens',
    'reasoningTokens',
    'thinkingOutputTokens',
    'thoughtsTokenCount',
  ]);
  const outputTokens = Math.max(rawOutput, reasoningTokens);

  const counts = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens: Math.min(outputTokens, reasoningTokens),
  };
  if (sumTokens(counts) <= 0) return null;

  const ts =
    parseTimestamp(parsed.created_at) ??
    parseTimestamp(parsed.createdAt) ??
    parseTimestamp(parsed.timestamp) ??
    parseTimestamp(parsed.time);
  if (ts === null) return null;

  const usageModel = normalizeAntigravityModel(pickFirstString(usage, ['responseModel', 'model']));
  const model = normalizedExplicit ?? usageModel ?? (state.model || DEFAULT_MODEL);
  const messageId = pickFirstString(parsed, [
    'responseId',
    'response_id',
    'executionId',
    'execution_id',
    'messageId',
    'message_id',
    'callId',
    'id',
  ]);
  const stepIdxRaw = parsed.step_index ?? parsed.stepIndex ?? parsed.idx;
  const stepIdx = typeof stepIdxRaw === 'number' ? stepIdxRaw : Number(stepIdxRaw);
  const id = messageId
    ? `antigravity:${messageId}`
    : Number.isFinite(stepIdx) && stepIdx >= 0
      ? `antigravity:${sessionId}:step:${Math.floor(stepIdx)}`
      : `antigravity:${sessionId}:offset:${offsetAfter}`;

  return buildUsageEvent(
    {
      id,
      source: 'antigravity',
      sessionId,
      messageId,
      ts,
      model,
      provider: resolveProviderName(null, model),
      agent: parsed.source === 'subagent' || parsed.isSubagent === true ? 'subagent' : 'main',
      cwd: state.cwd,
      counts,
    },
    ctx,
  );
}

export async function scanAntigravityTranscriptFile(
  input: FileScanInput,
  sessionId: string,
): Promise<FileScanResult> {
  const { file, ctx } = input;
  const state = loadTranscriptState(input.priorParserState);
  const events: UsageEvent[] = [];
  const seen = new Set<string>();
  const read = await readLinesFromOffset(file.path, {
    start: startOffsetFor(file, input.prior),
    maxBytes: input.maxBytes,
    sizeHint: file.size,
    onLine: (line, nextOffset) => {
      const event = parseAntigravityTranscriptLine(line, sessionId, nextOffset, state, ctx);
      if (!event || seen.has(event.id)) return;
      seen.add(event.id);
      events.push(event);
    },
  });
  return {
    events,
    offset: read.nextOffset,
    size: file.size,
    mtimeMs: file.mtimeMs,
    more: read.more,
    parserState: JSON.stringify(state),
  };
}

// ---------------------------------------------------------------------------
// Multi-surface root resolution & file discovery
// ---------------------------------------------------------------------------

function canonicalKey(target: string): string {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * Resolves existing Antigravity data directories.
 *
 * When `explicitOverride` is false, `configuredRoot` defaults to
 * `<home>/.gemini/antigravity`; sibling surfaces (`antigravity-cli`,
 * `antigravity-ide`, `antigravity-backup`, `antigravity-acp`, plus
 * `<home>/.config/antigravity`) are automatically included when present.
 */
export function resolveAntigravityRoots(configuredRoot: string, explicitOverride: boolean): string[] {
  const candidates: string[] = [];
  if (explicitOverride) {
    candidates.push(configuredRoot);
    // Also support pointing `paths.antigravity` directly at `~/.gemini`.
    if (
      existsSync(configuredRoot) &&
      !existsSync(path.join(configuredRoot, 'conversations')) &&
      !existsSync(path.join(configuredRoot, 'brain'))
    ) {
      for (const surface of DEFAULT_GEMINI_SURFACES) {
        candidates.push(path.join(configuredRoot, surface));
      }
    }
  } else {
    const geminiDir = path.dirname(configuredRoot);
    const homeDir = path.dirname(geminiDir);
    for (const surface of DEFAULT_GEMINI_SURFACES) {
      candidates.push(path.join(geminiDir, surface));
    }
    candidates.push(path.join(homeDir, '.config', 'antigravity'));
  }

  const existing: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isDirectory()) continue;
    } catch {
      continue;
    }
    const key = canonicalKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    existing.push(candidate);
  }
  return existing;
}

export interface DiscoveredAntigravityDb extends DiscoveredFile {
  sessionId: string;
  rawDbSize: number;
}

export interface DiscoveredAntigravityTranscript extends DiscoveredFile {
  sessionId: string;
}

export function sessionIdFromTranscriptPath(filePath: string): string {
  const logsDir = path.dirname(filePath);
  const sysGenDir = path.dirname(logsDir);
  if (path.basename(logsDir) === 'logs' && path.basename(sysGenDir) === '.system_generated') {
    return path.basename(path.dirname(sysGenDir)) || 'unknown';
  }
  return path.basename(logsDir) || 'unknown';
}

export async function discoverAntigravityFiles(roots: readonly string[]): Promise<{
  dbFiles: DiscoveredAntigravityDb[];
  transcriptFiles: DiscoveredAntigravityTranscript[];
}> {
  const dbFiles: DiscoveredAntigravityDb[] = [];
  const transcriptFiles: DiscoveredAntigravityTranscript[] = [];
  const seenFiles = new Set<string>();

  for (const root of roots) {
    // 1. Conversation SQLite databases (`<root>/conversations/*.db` or direct `*.db`).
    const convDir = existsSync(path.join(root, 'conversations')) ? path.join(root, 'conversations') : root;
    const convStack: Array<{ dir: string; depth: number }> = [{ dir: convDir, depth: 0 }];
    while (convStack.length > 0) {
      const current = convStack.pop();
      if (!current) continue;
      let entries;
      try {
        entries = await fs.readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const fullPath = path.join(current.dir, entry.name);
        if (entry.isDirectory()) {
          // Do not descend into unrelated siblings when `convDir === root`.
          if (convDir !== root && current.depth < 3) {
            convStack.push({ dir: fullPath, depth: current.depth + 1 });
          }
          continue;
        }
        if (
          !entry.isFile() ||
          !entry.name.endsWith('.db') ||
          entry.name === 'conversation_summaries.db'
        ) {
          continue;
        }
        const key = canonicalKey(fullPath);
        if (seenFiles.has(key)) continue;
        try {
          const dbStat = await fs.stat(fullPath);
          let walSize = 0;
          let walMtime = 0;
          try {
            const walStat = await fs.stat(`${fullPath}-wal`);
            if (walStat.isFile() && walStat.size > 0) {
              walSize = walStat.size;
              walMtime = Math.floor(walStat.mtimeMs);
            }
          } catch {
            // No active WAL sidecar.
          }
          seenFiles.add(key);
          dbFiles.push({
            path: fullPath,
            rawDbSize: dbStat.size,
            size: dbStat.size + walSize,
            mtimeMs: Math.max(Math.floor(dbStat.mtimeMs), walMtime),
            sessionId: path.basename(entry.name, '.db'),
          });
        } catch {
          // File disappeared during scan.
        }
      }
    }

    // 2. Brain JSONL transcripts (`<root>/brain/**/transcript.jsonl`).
    const brainDir = path.join(root, 'brain');
    if (!existsSync(brainDir)) continue;
    const brainStack: Array<{ dir: string; depth: number }> = [{ dir: brainDir, depth: 0 }];
    while (brainStack.length > 0) {
      const current = brainStack.pop();
      if (!current) continue;
      let entries;
      try {
        entries = await fs.readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      const names = new Set(entries.map((e) => e.name));
      for (const entry of entries) {
        const fullPath = path.join(current.dir, entry.name);
        if (entry.isDirectory()) {
          if (current.depth < MAX_WALK_DEPTH) {
            brainStack.push({ dir: fullPath, depth: current.depth + 1 });
          }
          continue;
        }
        if (!entry.isFile()) continue;
        const isCompact = entry.name === 'transcript.jsonl';
        const isFullFallback = entry.name === 'transcript_full.jsonl' && !names.has('transcript.jsonl');
        if (!isCompact && !isFullFallback) continue;

        const key = canonicalKey(fullPath);
        if (seenFiles.has(key)) continue;
        try {
          const stat = await fs.stat(fullPath);
          seenFiles.add(key);
          transcriptFiles.push({
            path: fullPath,
            size: stat.size,
            mtimeMs: Math.floor(stat.mtimeMs),
            sessionId: sessionIdFromTranscriptPath(fullPath),
          });
        } catch {
          // File disappeared during scan.
        }
      }
    }
  }

  dbFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  transcriptFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { dbFiles, transcriptFiles };
}
