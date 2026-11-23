/**
 * Cloud sync: pushes daily rollups (`CloudDay[]`) to the Token Island cloud.
 *
 * - Enabled only when config `cloud.enabled && url && apiKey`.
 * - The `cloud` section of `config.json` is re-read on every tick and manual
 *   sync, so `tokenisland register` takes effect without restarting the daemon.
 * - Auto-sync every `intervalMinutes` when new events arrived, plus a 60 s
 *   debounce after the first new event.
 * - Failures are stored (truncated) and never break collection.
 */

import type { CloudDay, CloudSyncStatus } from '@token-island/core';
import { readCloudSettings, type CollectorCloudConfig } from './config.js';
import { VERSION } from './version.js';

const MAX_ERROR_LENGTH = 300;
const DEBOUNCE_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

export interface SyncKeyValueStore {
  getKv(key: string): string | null;
  setKv(key: string, value: string): void;
}

export interface CloudSyncOptions {
  configPath: string;
  /** Boot-time cloud config; runtime ticks re-read the file. */
  cloud: CollectorCloudConfig;
  store: SyncKeyValueStore;
  getDays: () => CloudDay[];
  timezone: () => string;
  version?: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

export interface SyncResult {
  ok: boolean;
  lastSyncAt: number | null;
  error: string | null;
  disabled: boolean;
}

interface IngestResponse {
  ok?: unknown;
  username?: unknown;
}

function truncate(message: string): string {
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message;
}

export class CloudSync {
  private cloud: CollectorCloudConfig;
  private lastSyncAtValue: number | null = null;
  private lastErrorValue: string | null = null;
  private dirty = false;
  private syncing = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private intervalMs = 0;

  constructor(private readonly options: CloudSyncOptions) {
    this.cloud = options.cloud;
    const storedSyncAt = Number.parseInt(options.store.getKv('cloud.lastSyncAt') ?? '', 10);
    this.lastSyncAtValue = Number.isFinite(storedSyncAt) && storedSyncAt > 0 ? storedSyncAt : null;
    this.lastErrorValue = options.store.getKv('cloud.lastError') || null;
  }

  /** Re-reads the cloud section from disk; keeps the previous config on read errors. */
  reload(): void {
    const { cloud, error } = readCloudSettings(this.options.configPath);
    if (error) return;
    this.cloud = cloud;
  }

  isEnabled(): boolean {
    return this.cloud.enabled && this.cloud.url.length > 0 && this.cloud.apiKey.length > 0;
  }

  status(): CloudSyncStatus {
    this.reload();
    const username = this.cloud.username || this.options.store.getKv('cloud.username') || null;
    return {
      enabled: this.isEnabled(),
      lastSyncAt: this.lastSyncAtValue,
      lastError: this.lastErrorValue,
      username,
      endpoint: this.cloud.url.length > 0 ? this.cloud.url : null,
    };
  }

  /** Marks new events so the auto-sync interval / debounce actually pushes them. */
  onNewEvents(): void {
    this.dirty = true;
    this.reload();
    if (!this.isEnabled() || !this.cloud.autoSync) return;
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.performSync(false);
    }, DEBOUNCE_MS);
    this.debounceTimer.unref?.();
  }

  start(): void {
    this.reload();
    this.armInterval();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  stop(): void {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.intervalTimer = null;
    this.debounceTimer = null;
  }

  private armInterval(): void {
    const nextIntervalMs = Math.max(1, this.cloud.intervalMinutes) * 60_000;
    if (this.intervalTimer && this.intervalMs === nextIntervalMs) return;
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalMs = nextIntervalMs;
    this.intervalTimer = setInterval(() => {
      void this.tick();
    }, nextIntervalMs);
    this.intervalTimer.unref?.();
  }

  private async tick(): Promise<void> {
    this.reload();
    if (!this.isEnabled() || !this.cloud.autoSync) return;
    if (this.intervalMs !== Math.max(1, this.cloud.intervalMinutes) * 60_000) this.armInterval();
    if (!this.dirty) return;
    await this.performSync(false);
  }

  /** Manual or forced sync (also used by `POST /api/cloud/sync`). */
  async syncNow(): Promise<SyncResult> {
    this.reload();
    if (!this.isEnabled()) {
      return {
        ok: false,
        lastSyncAt: this.lastSyncAtValue,
        error: 'cloud sync disabled (cloud.enabled/url/apiKey missing in config.json)',
        disabled: true,
      };
    }
    return this.performSync(true);
  }

  private async performSync(manual: boolean): Promise<SyncResult> {
    if (this.syncing) {
      return { ok: false, lastSyncAt: this.lastSyncAtValue, error: 'sync already in progress', disabled: false };
    }
    this.syncing = true;
    const now = this.options.now ?? Date.now;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    try {
      const days = this.options.getDays();
      if (days.length === 0) {
        this.dirty = false;
        return { ok: true, lastSyncAt: this.lastSyncAtValue, error: null, disabled: false };
      }
      const endpoint = `${this.cloud.url.replace(/\/+$/, '')}/api/v1/ingest`;
      const body = {
        version: this.options.version ?? VERSION,
        client: 'collector',
        days,
        meta: {
          timezone: this.options.timezone(),
          rangeStart: days[0]?.date ?? '',
          ...(manual ? { manual: true } : {}),
        },
      };
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cloud.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        let detail = '';
        try {
          detail = (await response.text()).slice(0, 160);
        } catch {
          // Ignore unreadable error bodies.
        }
        throw new Error(`cloud responded ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      let parsed: IngestResponse = {};
      try {
        parsed = (await response.json()) as IngestResponse;
      } catch {
        parsed = {};
      }
      this.lastSyncAtValue = now();
      this.lastErrorValue = null;
      this.dirty = false;
      this.options.store.setKv('cloud.lastSyncAt', String(this.lastSyncAtValue));
      this.options.store.setKv('cloud.lastError', '');
      const username =
        typeof parsed.username === 'string' && parsed.username.length > 0
          ? parsed.username
          : this.cloud.username;
      if (username.length > 0) {
        this.cloud = { ...this.cloud, username };
        this.options.store.setKv('cloud.username', username);
      }
      return { ok: true, lastSyncAt: this.lastSyncAtValue, error: null, disabled: false };
    } catch (caught) {
      const message = truncate(caught instanceof Error ? caught.message : String(caught));
      this.lastErrorValue = message;
      this.options.store.setKv('cloud.lastError', message);
      return { ok: false, lastSyncAt: this.lastSyncAtValue, error: message, disabled: false };
    } finally {
      this.syncing = false;
    }
  }
}
