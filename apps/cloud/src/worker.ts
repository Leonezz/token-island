/**
 * Cloudflare Workers entrypoint (`wrangler dev` / `wrangler deploy`).
 *
 * Web APIs only: the request goes straight into the shared `handleRequest()`,
 * storage is Cloudflare D1 behind the same `CloudStore` interface the Node
 * runtime uses, and `/fonts/*` is served by the static ASSETS binding.
 *
 * Bindings (wrangler.toml):
 *   DB                       D1 database `token-island-cloud`
 *   ASSETS                   static assets in ./public (pixel fonts + OFL)
 *   TOKEN_ISLAND_ADMIN_TOKEN optional secret: locks down registration
 *   TOKEN_ISLAND_ALLOW_REGISTER / TOKEN_ISLAND_PUBLIC_URL optional vars
 */

import { handleRequest, type AppEnv, type AssetFetcher, type CloudRuntimeConfig } from './api.js';
import { D1Store, type D1Database } from './store/d1-store.js';

export interface Env {
  DB: D1Database;
  ASSETS?: AssetFetcher;
  TOKEN_ISLAND_ADMIN_TOKEN?: string;
  TOKEN_ISLAND_ALLOW_REGISTER?: string;
  TOKEN_ISLAND_PUBLIC_URL?: string;
}

/** Worker isolates restart freely, so uptime is per active isolate. */
const STARTED_AT = Date.now();

function boolValue(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const normal = raw.trim().toLowerCase();
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normal)) return false;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normal)) return true;
  return fallback;
}

export function runtimeConfig(env: Env): CloudRuntimeConfig {
  return {
    adminToken: env.TOKEN_ISLAND_ADMIN_TOKEN?.trim() || null,
    allowRegister: boolValue(env.TOKEN_ISLAND_ALLOW_REGISTER, true),
    publicUrl: env.TOKEN_ISLAND_PUBLIC_URL?.trim().replace(/\/+$/, '') || null,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const appEnv: AppEnv = {
      store: new D1Store(env.DB),
      config: runtimeConfig(env),
      startedAt: STARTED_AT,
      assets: env.ASSETS ?? null,
    };
    return handleRequest(request, appEnv);
  },
};
