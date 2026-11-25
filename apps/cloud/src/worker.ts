/**
 * Cloudflare Workers entrypoint (`wrangler dev` / `wrangler deploy`).
 *
 * Bindings (wrangler.toml):
 *   DB                       D1 database `token-island-cloud`
 *   ASSETS                   static assets in ./public (pixel fonts + OFL)
 *   GITHUB_CLIENT_ID         GitHub OAuth App Client ID (Device Flow enabled)
 *   TOKEN_ISLAND_ADMIN_TOKEN optional secret: locks down legacy open registration
 *   TOKEN_ISLAND_ALLOW_REGISTER / TOKEN_ISLAND_PUBLIC_URL optional vars
 */

import { handleRequest, type AppEnv, type AssetFetcher, type CloudRuntimeConfig } from './api.js';
import { D1Store, type D1Database } from './store/d1-store.js';

export interface Env {
  DB: D1Database;
  ASSETS?: AssetFetcher;
  GITHUB_CLIENT_ID?: string;
  TOKEN_ISLAND_GITHUB_CLIENT_ID?: string;
  TOKEN_ISLAND_ADMIN_TOKEN?: string;
  TOKEN_ISLAND_ALLOW_REGISTER?: string;
  TOKEN_ISLAND_PUBLIC_URL?: string;
}

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
    githubClientId:
      env.GITHUB_CLIENT_ID?.trim() || env.TOKEN_ISLAND_GITHUB_CLIENT_ID?.trim() || null,
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
