#!/usr/bin/env node
/**
 * scripts/dev.ts — run the collector and the cloud service together.
 *
 * Usage:
 *   node --import tsx scripts/dev.ts [--demo] [--no-cloud] [--no-collector]
 *   pnpm dev -- --demo
 *
 * Local dev state lives under <repo>/.runtime/dev (never in ~/.token-island):
 *   .runtime/dev/collector/   TOKEN_ISLAND_HOME for the collector
 *   .runtime/dev/cloud.db     TOKEN_ISLAND_CLOUD_DB for the cloud
 *
 * Logs are prefixed and colourised per service; Ctrl+C/SIGTERM stops both
 * children (SIGTERM, then SIGKILL after a grace period).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = join(ROOT, '.runtime/dev');
const TSX_FLAGS = ['--import', 'tsx'];

const COLLECTOR_ENTRY = join(ROOT, 'apps/collector/src/index.ts');
const CLOUD_ENTRY = join(ROOT, 'apps/cloud/src/index.ts');

// Dedicated dev ports: never collide with the real demo services on
// collector :47118 / cloud :47117. Override with DEV_COLLECTOR_PORT /
// DEV_CLOUD_PORT (E2E_* env vars are accepted as aliases so both scripts
// agree on ports in CI).
const DEV_COLLECTOR_PORT = Number.parseInt(
  process.env.DEV_COLLECTOR_PORT ?? process.env.E2E_COLLECTOR_PORT ?? '47121',
  10,
);
const DEV_CLOUD_PORT = Number.parseInt(
  process.env.DEV_CLOUD_PORT ?? process.env.E2E_CLOUD_PORT ?? '47120',
  10,
);
const DEMO_COLLECTOR_PORT = 47119;

const COLOR = Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env);
const paint = (code: number) => (text: string) => (COLOR ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = paint(1);
const dim = paint(2);
const red = paint(31);
const green = paint(32);
const yellow = paint(33);
const cyan = paint(36);
const magenta = paint(35);

type Service = {
  name: string;
  prefix: string;
  child: ChildProcess;
  lines: string[];
};

const services: Service[] = [];
let shuttingDown = false;

function usage(): void {
  console.log(
    [
      'token-island dev runner',
      '',
      'Usage: node --import tsx scripts/dev.ts [flags]',
      '',
      '  --demo           run the collector with deterministic demo data (:47119)',
      '  --no-cloud       only start the collector',
      '  --no-collector   only start the cloud service',
      '  --help, -h       print this help',
      '',
      'State: .runtime/dev (collector home + cloud.db); nothing is written to ~.',
      '',
      'Ports: collector :47121 (demo binds :47119, the app hard-codes it), cloud :47120.',
      'Override with DEV_COLLECTOR_PORT / DEV_CLOUD_PORT.',
    ].join('\n'),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function tail(service: Service, lines = 25): string {
  return service.lines.slice(-lines).join('\n');
}

function log(service: Service, line: string): void {
  service.lines.push(line);
  if (service.lines.length > 400) service.lines.splice(0, service.lines.length - 400);
  console.log(`${service.prefix} ${line}`);
}

function attachLogs(service: Service): void {
  const attach = (stream: NodeJS.ReadableStream | null): void => {
    if (!stream) return;
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) log(service, line);
        newline = buffer.indexOf('\n');
      }
    });
  };
  attach(service.child.stdout);
  attach(service.child.stderr);
}

function launch(name: string, colour: (text: string) => string, entry: string, args: string[], env: NodeJS.ProcessEnv): Service {
  const child = spawn(process.execPath, [...TSX_FLAGS, entry, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const service: Service = {
    name,
    prefix: colour(`[${name}]`),
    child,
    lines: [],
  };
  attachLogs(service);
  child.once('error', (error) => {
    console.error(`${red(`[${name}]`)} failed to start: ${error.message}`);
    void shutdown(1);
  });
  child.once('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `${red(`[${name}]`)} exited unexpectedly (${signal ? `signal ${signal}` : `code ${code}`}).`,
    );
    const recent = tail(service);
    if (recent) console.error(dim(recent));
    void shutdown(code && code > 0 ? code : 1);
  });
  services.push(service);
  return service;
}

async function httpOk(url: string, child?: ChildProcess): Promise<boolean> {
  if (child && child.exitCode !== null) return false;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Poll a health endpoint until it answers, bounded by `timeoutMs`. */
async function waitForUrl(service: Service, url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (service.child.exitCode !== null || service.child.signalCode !== null) {
      throw new Error(`${service.name} exited before becoming ready.\n${tail(service)}`);
    }
    if (await httpOk(url, service.child)) return;
    await sleep(250);
  }
  throw new Error(`${service.name} did not answer ${url} within ${timeoutMs}ms.\n${tail(service)}`);
}

/** Poll several candidate ports and resolve with the first one that answers. */
async function waitForAnyUrl(
  service: Service,
  ports: number[],
  path: string,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (service.child.exitCode !== null || service.child.signalCode !== null) {
      throw new Error(`${service.name} exited before becoming ready.\n${tail(service)}`);
    }
    for (const port of ports) {
      if (await httpOk(`http://127.0.0.1:${port}${path}`, service.child)) return port;
    }
    await sleep(250);
  }
  throw new Error(
    `${service.name} did not answer ${path} on any of ${ports.join(', ')} within ${timeoutMs}ms.\n${tail(service)}`,
  );
}

async function shutdown(code: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${dim('stopping dev services…')}`);
  for (const service of services) {
    if (service.child.exitCode === null && service.child.signalCode === null) {
      service.child.kill('SIGTERM');
    }
  }
  const deadline = Date.now() + 5000;
  while (
    Date.now() < deadline &&
    services.some((service) => service.child.exitCode === null && service.child.signalCode === null)
  ) {
    await sleep(100);
  }
  for (const service of services) {
    if (service.child.exitCode === null && service.child.signalCode === null) {
      service.child.kill('SIGKILL');
    }
  }
  // Never hang the dev runner even if a child ignores every signal.
  setTimeout(() => process.exit(code), 2000).unref();
  console.log(dim('stopped.'));
  process.exit(code);
}

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  if (flags.has('--help') || flags.has('-h')) {
    usage();
    return;
  }
  const demo = flags.has('--demo');
  const withCloud = !flags.has('--no-cloud');
  const withCollector = !flags.has('--no-collector');

  if (!withCloud && !withCollector) {
    console.error(`${red('✗')} nothing to start: --no-cloud and --no-collector together`);
    usage();
    process.exit(1);
  }
  if (!existsSync(join(ROOT, 'node_modules/tsx'))) {
    console.error(`${red('✗')} dependencies are not installed — run: pnpm install`);
    process.exit(1);
  }

  // Preflight every enabled entry before spawning anything, so a missing app
  // can never leave one service running as an orphan.
  if (withCollector && !existsSync(COLLECTOR_ENTRY)) {
    console.error(
      `${red('✗')} collector entry is missing: apps/collector/src/index.ts\n` +
        `  Run without the collector: pnpm dev -- --no-collector`,
    );
    process.exit(1);
  }
  if (withCloud && !existsSync(CLOUD_ENTRY)) {
    console.error(
      `${red('✗')} cloud entry is missing: apps/cloud/src/index.ts\n` +
        `  Run without the cloud: pnpm dev -- --no-cloud`,
    );
    process.exit(1);
  }

  mkdirSync(RUNTIME, { recursive: true });

  const collectorHome = join(RUNTIME, 'collector');
  const collectorPort = Number.parseInt(
    withCollector && !demo ? (process.env.TOKEN_ISLAND_PORT ?? String(DEV_COLLECTOR_PORT)) : '',
    10,
  );
  const cloudPort = Number.isFinite(DEV_CLOUD_PORT) ? DEV_CLOUD_PORT : 47120;
  const cloudDb = join(RUNTIME, 'cloud.db');

  const expected: Array<Promise<void>> = [];

  if (withCollector) {
    mkdirSync(collectorHome, { recursive: true });
    const args = ['collect', '--foreground', ...(demo ? ['--demo'] : [])];
    const env: NodeJS.ProcessEnv = { TOKEN_ISLAND_HOME: collectorHome };
    if (!demo && Number.isFinite(collectorPort)) env.TOKEN_ISLAND_PORT = String(collectorPort);
    const service = launch('collector', cyan, COLLECTOR_ENTRY, args, env);
    if (demo) {
      // The collector demo server currently hard-codes :47119; discover which
      // port it actually used (the env port first, then the fixed demo port).
      expected.push(
        waitForAnyUrl(service, [DEV_COLLECTOR_PORT, DEMO_COLLECTOR_PORT], '/api/health', 30_000).then(
          () => {},
        ),
      );
    } else {
      expected.push(
        waitForUrl(
          service,
          `http://127.0.0.1:${Number.isFinite(collectorPort) ? collectorPort : DEV_COLLECTOR_PORT}/api/health`,
          30_000,
        ),
      );
    }
  }

  if (withCloud) {
    const env: NodeJS.ProcessEnv = {
      PORT: String(cloudPort),
      TOKEN_ISLAND_CLOUD_DB: cloudDb,
    };
    launch('cloud', magenta, CLOUD_ENTRY, [], env);
    expected.push(waitForUrl(services[services.length - 1]!, `http://127.0.0.1:${cloudPort}/healthz`, 30_000));
  }

  try {
    await Promise.all(expected);
  } catch (error) {
    console.error(`\n${red('✗')} ${(error as Error).message}`);
    await shutdown(1);
    return;
  }

  const collectorUrl = demo ? DEMO_COLLECTOR_PORT : Number.isFinite(collectorPort) ? collectorPort : DEV_COLLECTOR_PORT;
  console.log(`\n${green('✓')} dev services are up ${dim('(state: .runtime/dev; Ctrl+C to stop)')}`);
  if (withCollector) {
    console.log(`  collector  http://127.0.0.1:${collectorUrl}`);
    console.log(`             ${dim(`/api/health · /api/summary?range=today${demo ? ' · demo data' : ''}`)}`);
  }
  if (withCloud) {
    console.log(`  cloud      http://127.0.0.1:${cloudPort}`);
    console.log(`             ${dim(`/healthz · /u/demo · dashboard: http://127.0.0.1:${cloudPort}/u/demo`)}`);
    console.log(`  cloud db   ${dim('.runtime/dev/cloud.db')}`);
  }
  if (withCloud) {
    console.log(
      `\n${dim('First time? Seed the demo accounts in another terminal:')} ` +
        `${yellow('node bin/tokenisland.mjs cloud seed')}`,
    );
  }
  if (demo) {
    console.log(
      `${dim('Widget against demo data:')} ${yellow(`TOKEN_ISLAND_PORT=${DEMO_COLLECTOR_PORT} node bin/tokenisland.mjs island`)}`,
    );
  }

  // Keep the process alive; children plus signal handlers own the lifecycle.
  await new Promise<never>(() => {
    /* resolved only by shutdown()/exit */
  });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(0);
  });
}

main().catch((error: unknown) => {
  console.error(`${red('✗')} ${error instanceof Error ? error.message : String(error)}`);
  void shutdown(1);
});
