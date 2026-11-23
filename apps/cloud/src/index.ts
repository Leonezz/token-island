#!/usr/bin/env node
/**
 * Cloud server entrypoint.
 *
 *   PORT=47117 TOKEN_ISLAND_CLOUD_DB=./data/cloud.db tsx src/index.ts
 *
 * Exits non-zero on boot failure (port in use, unwritable database) and shuts
 * down gracefully on SIGINT/SIGTERM.
 */

import { loadConfig } from './config.js';
import { createCloudApp } from './server.js';

function log(message: string): void {
  process.stdout.write(`[cloud] ${message}\n`);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function displayHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1';
  return host;
}

async function main(): Promise<void> {
  const config = loadConfig();

  let app: ReturnType<typeof createCloudApp>;
  try {
    app = createCloudApp({
      dbPath: config.dbPath,
      host: config.host,
      port: config.port,
      adminToken: config.adminToken,
      allowRegister: config.allowRegister,
      publicUrl: config.publicUrl,
    });
  } catch (error) {
    process.stderr.write(`[cloud] failed to open database ${config.dbPath}: ${errorMessage(error)}\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const address = await app.listen();
    log(`listening on http://${displayHost(address.host)}:${address.port}`);
    log(`database: ${config.dbPath}`);
    log(
      config.adminToken
        ? 'registration requires TOKEN_ISLAND_ADMIN_TOKEN'
        : config.allowRegister
          ? 'open registration enabled (set TOKEN_ISLAND_ADMIN_TOKEN to lock it down)'
          : 'registration disabled',
    );
  } catch (error) {
    process.stderr.write(
      `[cloud] failed to bind ${config.host}:${config.port}: ${errorMessage(error)}\n`,
    );
    await app.close();
    process.exitCode = 1;
    return;
  }

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received — shutting down`);
    const timer = setTimeout(() => {
      process.stderr.write('[cloud] graceful shutdown timed out, forcing exit\n');
      process.exit(1);
    }, 3_000);
    timer.unref();
    void app.close().then(() => {
      clearTimeout(timer);
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[cloud] unhandled rejection: ${errorMessage(reason)}\n`);
  });
}

void main();
