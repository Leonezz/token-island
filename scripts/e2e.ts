#!/usr/bin/env node
/**
 * scripts/e2e.ts — Token Island end-to-end verification.
 *
 *   node --import tsx scripts/e2e.ts [--skip-core-tests]
 *
 * Phases:
 *   0  root `pnpm typecheck` + `pnpm test` (skippable for a fast run)
 *   1  collector demo mode (:47121, env E2E_COLLECTOR_PORT) → /api/health + summary shape
 *   2  Node cloud runtime (:47120, env E2E_CLOUD_PORT) → seed, /healthz, pixel SVGs, dashboard
 *   3  Cloudflare Worker + local D1 (:47131, env E2E_WORKER_PORT) → migrations, wrangler dev,
 *      register/ingest over HTTP, pixel SVGs, dashboard (SKIP when wrangler is absent)
 *   4  pixel island snapshots via the built .app (SKIP when it has not been built)
 *   5  PASS/FAIL/SKIP summary; non-zero exit on a hard failure
 *
 * The script only manages child processes it spawns itself (including the
 * wrangler dev process group) and never touches the real demo services on
 * :47117 / :47118.
 *
 * Every child process is killed in a finally block, every wait is bounded, and
 * unavailable runtimes are reported as SKIP instead of crashing.
 * Runtime state lives under <repo>/.runtime/e2e.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDemoCloudDays } from '@token-island/core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = join(ROOT, '.runtime/e2e');
const COLLECTOR_HOME = join(RUNTIME, 'collector');
const CLOUD_HOME = join(RUNTIME, 'cloud');
const ISLAND_OUT = join(RUNTIME, 'island');

const COLLECTOR_ENTRY = join(ROOT, 'apps/collector/src/index.ts');
const CLOUD_APP_DIR = join(ROOT, 'apps/cloud');
const CLOUD_ENTRY = join(CLOUD_APP_DIR, 'src/node.ts');
const CLOUD_SEED_ENTRY = join(CLOUD_APP_DIR, 'src/seed.ts');
const CLOUD_WORKER_ENTRY = join(CLOUD_APP_DIR, 'src/worker.ts');
const WRANGLER_CONFIG = join(CLOUD_APP_DIR, 'wrangler.toml');
const ISLAND_APP = join(ROOT, 'apps/island-macos/build/TokenIsland.app');
const ISLAND_BIN = join(ISLAND_APP, 'Contents/MacOS/TokenIsland');
const FIXTURE_SUMMARY = join(ROOT, 'fixtures/summary.example.json');
const WORKER_PERSIST = join(RUNTIME, 'wrangler-state');

// Dedicated e2e ports: keep the real demo services (cloud :47117, collector
// :47118) out of the way. Override with E2E_CLOUD_PORT / E2E_COLLECTOR_PORT /
// E2E_WORKER_PORT. Worker port candidates never overlap the Node cloud ones.
const CLOUD_PORT_PREFERRED = Number.parseInt(process.env.E2E_CLOUD_PORT ?? '47120', 10);
const CLOUD_PORT_CANDIDATES = [CLOUD_PORT_PREFERRED, 47140, 47141, 47142];
const COLLECTOR_PORT_PREFERRED = Number.parseInt(process.env.E2E_COLLECTOR_PORT ?? '47121', 10);
// The collector's --demo mode used to hard-code 47119; keep it as a discovery
// fallback for older builds.
const COLLECTOR_PORT_CANDIDATES = [COLLECTOR_PORT_PREFERRED, 47119];
const WORKER_PORT_PREFERRED = Number.parseInt(process.env.E2E_WORKER_PORT ?? '47131', 10);
const WORKER_PORT_CANDIDATES = [WORKER_PORT_PREFERRED, 47151, 47152];
const TSX_FLAGS = ['--import', 'tsx'];

const FLAGS = new Set(process.argv.slice(2));
const SKIP_CORE_TESTS = FLAGS.has('--skip-core-tests');

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const COLOR = Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env);
const paint = (code: number) => (text: string) => (COLOR ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = paint(1);
const dim = paint(2);
const red = paint(31);
const green = paint(32);
const yellow = paint(33);
const cyan = paint(36);

type Status = 'PASS' | 'FAIL' | 'SKIP';
type Result = { phase: string; name: string; status: Status; detail: string };

const results: Result[] = [];
let currentPhase = 'setup';

function phaseHeader(title: string): void {
  currentPhase = title;
  console.log(`\n${bold(title)}`);
}

function record(status: Status, name: string, detail = ''): void {
  results.push({ phase: currentPhase, name, status, detail });
  const symbol = status === 'PASS' ? green('✓') : status === 'FAIL' ? red('✗') : yellow('–');
  const suffix = detail ? dim(`  ${detail.replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 240)}`) : '';
  console.log(`  ${symbol} ${name}${suffix}`);
}

function pass(name: string, detail = ''): void {
  record('PASS', name, detail);
}

function fail(name: string, detail = ''): void {
  record('FAIL', name, detail);
}

function skip(name: string, detail = ''): void {
  record('SKIP', name, detail);
}

function check(name: string, condition: unknown, detail = ''): boolean {
  if (condition) {
    pass(name);
    return true;
  }
  fail(name, detail);
  return false;
}

function firstLine(text: string, max = 200): string {
  const line = (text ?? '').split('\n').find((candidate) => candidate.trim().length > 0) ?? '';
  return line.trim().slice(0, max);
}

/** Last few non-empty lines of a command/process output, for failure details. */
function outputTail(stdout: string, stderr: string, lines = 12): string {
  const combined = `${stderr}\n${stdout}`.split('\n').filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('> ') && !trimmed.startsWith('$ ');
  });
  return combined.slice(-lines).join('\n').slice(0, 2000);
}

// ---------------------------------------------------------------------------
// Bounded helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error: string;
};

/** Run a command to completion with a hard timeout (SIGKILL). */
function runCommand(
  command: string,
  args: string[],
  { cwd = ROOT, env = {}, timeoutMs = 120_000 }: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((done) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      done({ code: null, stdout, stderr, timedOut, error: (error as Error).message });
      return;
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      done({ code: null, stdout, stderr, timedOut, error: error.message });
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      done({
        code,
        stdout,
        stderr,
        timedOut,
        error: signal ? `killed by ${signal}` : '',
      });
    });
  });
}

type HttpResult = {
  status: number;
  contentType: string;
  body: string;
  json: any;
  error: string;
};

async function request(url: string, timeoutMs = 5000, init: RequestInit = {}): Promise<HttpResult> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.text();
    let json: any = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body,
      json,
      error: '',
    };
  } catch (error) {
    return { status: 0, contentType: '', body: '', json: null, error: (error as Error).message };
  }
}

async function portResponding(port: number): Promise<boolean> {
  const result = await request(`http://127.0.0.1:${port}/`, 600);
  return result.status > 0;
}

async function waitForHttp(
  label: string,
  url: string,
  child: ChildProcess | null,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(
        `${label} exited early (code ${child.exitCode}) before becoming ready.\n${tailOf(child)}`,
      );
    }
    const result = await request(url, 1000);
    if (result.status > 0 && result.status < 500) return;
    await sleep(250);
  }
  throw new Error(
    `${label} did not answer ${url} within ${timeoutMs}ms.${child ? `\n${tailOf(child)}` : ''}`,
  );
}

/** Poll several candidate ports and return the first one answering `path`. */
async function waitForAnyHttp(
  label: string,
  ports: number[],
  path: string,
  child: ChildProcess | null,
  timeoutMs = 30_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(
        `${label} exited early (code ${child.exitCode}) before becoming ready.\n${tailOf(child)}`,
      );
    }
    for (const port of ports) {
      const result = await request(`http://127.0.0.1:${port}${path}`, 800);
      if (result.status > 0 && result.status < 500) return port;
    }
    await sleep(250);
  }
  throw new Error(
    `${label} did not answer ${path} on any of ${ports.join(', ')} within ${timeoutMs}ms.` +
      (child ? `\n${tailOf(child)}` : ''),
  );
}

// ---------------------------------------------------------------------------
// Child process management (always killed in the outer finally)
// ---------------------------------------------------------------------------

const children: ChildProcess[] = [];
const processGroups = new Set<ChildProcess>();
const childLogs = new WeakMap<ChildProcess, string[]>();

function capture(child: ChildProcess): void {
  const lines: string[] = [];
  childLogs.set(child, lines);
  const attach = (stream: NodeJS.ReadableStream | null): void => {
    if (!stream) return;
    stream.setEncoding('utf8');
    let buffer = '';
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const line of parts) {
        lines.push(line);
        if (lines.length > 300) lines.splice(0, lines.length - 300);
      }
    });
  };
  attach(child.stdout);
  attach(child.stderr);
}

function tailOf(child: ChildProcess, count = 20): string {
  const lines = childLogs.get(child) ?? [];
  return lines.slice(-count).join('\n').slice(0, 2000);
}

function startEntry(label: string, entry: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(process.execPath, [...TSX_FLAGS, entry, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  capture(child);
  children.push(child);
  child.once('error', (error) => {
    console.error(`${red('✗')} failed to start ${label}: ${error.message}`);
  });
  return child;
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    // wrangler spawns workerd; signal the whole process group so the child
    // runtime dies with it. Non-detached children are signalled directly.
    if (processGroups.has(child) && typeof child.pid === 'number') {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch {
    /* already gone */
  }
}

async function stopAll(): Promise<void> {
  const alive = (child: ChildProcess): boolean => child.exitCode === null && child.signalCode === null;
  for (const child of children) {
    if (alive(child)) signalChild(child, 'SIGTERM');
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && children.some(alive)) {
    await sleep(100);
  }
  for (const child of children) {
    if (alive(child)) signalChild(child, 'SIGKILL');
  }
  const killDeadline = Date.now() + 3000;
  while (Date.now() < killDeadline && children.some(alive)) {
    await sleep(100);
  }
}

// ---------------------------------------------------------------------------
// Phase 0 — core typecheck + tests
// ---------------------------------------------------------------------------

async function phaseCore(): Promise<void> {
  phaseHeader('Phase 0 · core typecheck + tests');
  if (SKIP_CORE_TESTS) {
    skip('pnpm typecheck', '--skip-core-tests');
    skip('pnpm test', '--skip-core-tests');
    return;
  }
  if (!existsSync(join(ROOT, 'node_modules'))) {
    skip('pnpm typecheck', 'node_modules missing — run pnpm install first');
    skip('pnpm test', 'node_modules missing — run pnpm install first');
    return;
  }

  const pnpmCheck = await runCommand('pnpm', ['--version'], { timeoutMs: 15_000 });
  if (pnpmCheck.code !== 0) {
    skip('pnpm typecheck', 'pnpm is not available on PATH');
    skip('pnpm test', 'pnpm is not available on PATH');
    return;
  }

  const typecheck = await runCommand('pnpm', ['typecheck'], { timeoutMs: 300_000 });
  check(
    'pnpm typecheck',
    typecheck.code === 0,
    typecheck.timedOut ? 'timed out after 300s' : firstLine(outputTail(typecheck.stdout, typecheck.stderr)),
  );

  const tests = await runCommand('pnpm', ['test'], { timeoutMs: 300_000 });
  check(
    'pnpm test',
    tests.code === 0,
    tests.timedOut
      ? 'timed out after 300s'
      : firstLine(outputTail(tests.stdout, tests.stderr)),
  );
}

// ---------------------------------------------------------------------------
// Phase 1 — collector demo API
// ---------------------------------------------------------------------------

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function phaseCollector(): Promise<void> {
  phaseHeader('Phase 1 · collector demo API');
  if (!existsSync(COLLECTOR_ENTRY)) {
    skip('collector demo API', 'apps/collector/src/index.ts not found');
    return;
  }
  const busy = [];
  for (const candidate of COLLECTOR_PORT_CANDIDATES) {
    if (await portResponding(candidate)) busy.push(candidate);
  }
  if (busy.length > 0) {
    skip(
      'collector demo API',
      `port(s) ${busy.join(', ')} already in use — not touching another process; ` +
        `free them or set E2E_COLLECTOR_PORT`,
    );
    return;
  }

  rmSync(COLLECTOR_HOME, { recursive: true, force: true });
  mkdirSync(COLLECTOR_HOME, { recursive: true });

  const child = startEntry('collector', COLLECTOR_ENTRY, ['collect', '--demo'], {
    TOKEN_ISLAND_HOME: COLLECTOR_HOME,
    // Demo mode has its own port (documented default 47119); honour the e2e
    // override so parallel runs never collide with a real collector.
    TOKEN_ISLAND_DEMO_PORT: String(COLLECTOR_PORT_PREFERRED),
  });

  try {
    const collectorPort = await waitForAnyHttp(
      'collector',
      COLLECTOR_PORT_CANDIDATES,
      '/api/health',
      child,
      30_000,
    );
    if (collectorPort !== COLLECTOR_PORT_PREFERRED) {
      console.log(
        dim(`  · collector demo bound :${collectorPort} (expected :${COLLECTOR_PORT_PREFERRED})`),
      );
    }
    const base = `http://127.0.0.1:${collectorPort}`;
    pass(`collector answers :${collectorPort}/api/health`);

    const health = await request(`${base}/api/health`);
    check(
      '/api/health is 200 JSON with ok=true',
      health.status === 200 && health.json !== null && health.json.ok === true,
      `status ${health.status}${health.error ? ` (${health.error})` : ''}`,
    );

    const summaryResponse = await request(`${base}/api/summary?range=today`);
    const summary = summaryResponse.json;
    check(
      '/api/summary?range=today returns 200 JSON',
      summaryResponse.status === 200 && summary !== null && typeof summary === 'object',
      `status ${summaryResponse.status}${summaryResponse.error ? ` (${summaryResponse.error})` : ''}`,
    );
    if (summaryResponse.status !== 200 || summary === null) {
      skip('summary document shape', 'summary endpoint did not return JSON');
      return;
    }

    check('summary.version === 1', summary.version === 1, `got ${JSON.stringify(summary.version)}`);
    check(
      'summary.daily has 14 entries',
      asArray(summary.daily).length === 14,
      `got ${asArray(summary.daily).length}`,
    );
    check(
      'summary.hourly has 24 entries',
      asArray(summary.hourly).length === 24,
      `got ${asArray(summary.hourly).length}`,
    );
    const todayTokens = asNumber(summary.today?.totalTokens);
    check(
      'summary.today.totalTokens > 0 (demo data)',
      todayTokens > 0,
      `got ${todayTokens}`,
    );
    check(
      'summary.collector.sources is an array',
      Array.isArray(summary.collector?.sources),
      `got ${typeof summary.collector?.sources}`,
    );
  } catch (error) {
    fail('collector demo startup', (error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Phase 2 — cloud seed + SVG / dashboard endpoints
// ---------------------------------------------------------------------------

async function phaseCloud(): Promise<void> {
  phaseHeader('Phase 2 · Node cloud runtime (:47120) · pixel SVGs + dashboard');
  if (!existsSync(CLOUD_ENTRY) || !existsSync(CLOUD_SEED_ENTRY)) {
    skip('cloud API', 'apps/cloud/src/{node,seed}.ts not found');
    return;
  }

  let cloudPort = 0;
  for (const candidate of CLOUD_PORT_CANDIDATES) {
    if (!(await portResponding(candidate))) {
      cloudPort = candidate;
      break;
    }
  }
  if (cloudPort === 0) {
    skip('cloud API', `ports ${CLOUD_PORT_CANDIDATES.join(', ')} are all in use — stop a server and re-run`);
    return;
  }
  if (cloudPort !== CLOUD_PORT_PREFERRED) {
    console.log(
      `  ${dim(`· port ${CLOUD_PORT_PREFERRED} is busy, using :${cloudPort} for the temp cloud`)}`,
    );
  }

  rmSync(CLOUD_HOME, { recursive: true, force: true });
  mkdirSync(CLOUD_HOME, { recursive: true });
  const dbPath = join(CLOUD_HOME, 'cloud.db');
  const env: NodeJS.ProcessEnv = {
    TOKEN_ISLAND_CLOUD_DB: dbPath,
    PORT: String(cloudPort),
  };
  const base = `http://127.0.0.1:${cloudPort}`;

  const seed = await runCommand(process.execPath, [...TSX_FLAGS, CLOUD_SEED_ENTRY], {
    env,
    timeoutMs: 120_000,
  });
  check(
    'cloud seed exits 0',
    seed.code === 0,
    seed.timedOut ? 'timed out after 120s' : firstLine(outputTail(seed.stdout, seed.stderr)),
  );
  const seedOk = seed.code === 0;

  const child = startEntry('cloud', CLOUD_ENTRY, [], env);
  try {
    await waitForHttp('cloud', `${base}/healthz`, child, 30_000);
    pass(`cloud answers :${cloudPort}/healthz`);

    const health = await request(`${base}/healthz`);
    check(
      '/healthz is 200 JSON with ok=true',
      health.status === 200 && health.json !== null && health.json.ok === true,
      `status ${health.status}${health.error ? ` (${health.error})` : ''}`,
    );

    if (!seedOk) {
      skip('badge SVGs', 'cloud seed failed, no demo user to query');
      skip('chart SVGs', 'cloud seed failed, no demo user to query');
      skip('profile card SVG', 'cloud seed failed, no demo user to query');
      skip('dashboard HTML', 'cloud seed failed, no demo user to query');
      return;
    }

    for (const metric of ['tokens', 'cost', 'streak']) {
      const badge = await request(`${base}/u/demo/badge.svg?metric=${metric}&theme=dark`);
      const svgOk =
        badge.status === 200 && badge.contentType.includes('svg') && badge.body.includes('<svg');
      check(
        `badge.svg?metric=${metric} is a 200 SVG`,
        svgOk,
        `status ${badge.status}, content-type ${badge.contentType || 'none'}`,
      );
      if (svgOk && metric === 'tokens') pixelSvgChecks('node badge', badge.body);
    }

    for (const type of ['line', 'bar', 'heatmap']) {
      const chart = await request(`${base}/u/demo/chart.svg?type=${type}&days=30&theme=dark`);
      const svgOk =
        chart.status === 200 && chart.contentType.includes('svg') && chart.body.includes('<svg');
      check(
        `chart.svg?type=${type} is a 200 SVG`,
        svgOk,
        `status ${chart.status}, content-type ${chart.contentType || 'none'}`,
      );
      if (svgOk && type === 'line') pixelSvgChecks('node line chart', chart.body);
    }

    const card = await request(`${base}/u/demo/card.svg?theme=dark`);
    const cardOk =
      card.status === 200 && card.contentType.includes('svg') && card.body.includes('<svg');
    check(
      'card.svg is a 200 SVG',
      cardOk,
      `status ${card.status}, content-type ${card.contentType || 'none'}`,
    );
    if (cardOk) pixelSvgChecks('node profile card', card.body);

    const dashboard = await request(`${base}/u/demo`);
    const dashboardOk =
      dashboard.status === 200 &&
      dashboard.contentType.includes('text/html') &&
      dashboard.body.includes('<svg') &&
      dashboard.body.includes('badge.svg');
    check(
      'dashboard /u/demo is HTML with inline SVGs + embed snippets',
      dashboardOk,
      `status ${dashboard.status}, content-type ${dashboard.contentType || 'none'}`,
    );
    check(
      'dashboard uses pixel fonts (@font-face + Silkscreen)',
      dashboard.body.includes('@font-face') && dashboard.body.includes('Silkscreen'),
    );
    check(
      'dashboard inline SVGs use pixel crispEdges',
      dashboard.body.includes('crispEdges'),
    );
  } catch (error) {
    fail('cloud startup', (error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Phase 3 — Cloudflare Worker + local D1 (wrangler dev)
// ---------------------------------------------------------------------------

function wranglerEnv(): NodeJS.ProcessEnv {
  // Repo-local XDG dirs: wrangler must never write to $HOME in this sandbox.
  return {
    XDG_CONFIG_HOME: join(ROOT, '.runtime/xdg'),
    XDG_CACHE_HOME: join(ROOT, '.runtime/xdg-cache'),
  };
}

function wranglerVersion(): string | null {
  const result = spawnSync('wrangler', ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, ...wranglerEnv() },
  });
  if (result.error || result.status !== 0) return null;
  const match = /(\d+\.\d+\.\d+)/.exec(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  return match?.[1] ?? 'unknown';
}

/** Start `wrangler dev` detached so stopAll() can kill its workerd child too. */
function startWrangler(label: string, args: string[]): ChildProcess {
  const child = spawn('wrangler', args, {
    cwd: CLOUD_APP_DIR,
    env: { ...process.env, ...wranglerEnv() },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  capture(child);
  children.push(child);
  processGroups.add(child);
  child.once('error', (error) => {
    console.error(`${red('✗')} failed to start ${label}: ${error.message}`);
  });
  return child;
}

/** Pixel-SVG sanity: bitmap text only, crisp edges, 2px pixel borders. */
function pixelSvgChecks(label: string, svg: string): void {
  check(`${label} uses bitmap text (no <text>)`, !svg.includes('<text'));
  check(`${label} sets shape-rendering="crispEdges"`, svg.includes('crispEdges'));
  check(`${label} uses 2px pixel borders`, svg.includes('stroke-width="2"'));
}

async function phaseWorker(): Promise<void> {
  phaseHeader('Phase 3 · Cloudflare Worker + local D1 (wrangler dev)');
  if (!existsSync(CLOUD_WORKER_ENTRY) || !existsSync(WRANGLER_CONFIG)) {
    skip('Cloudflare Worker', 'apps/cloud/src/worker.ts + wrangler.toml not found');
    return;
  }
  const version = wranglerVersion();
  if (!version) {
    skip('Cloudflare Worker', 'wrangler is not on PATH — install with `npm i -g wrangler@4` to run this phase');
    return;
  }

  let workerPort = 0;
  for (const candidate of WORKER_PORT_CANDIDATES) {
    if (!(await portResponding(candidate))) {
      workerPort = candidate;
      break;
    }
  }
  if (workerPort === 0) {
    skip('Cloudflare Worker', `ports ${WORKER_PORT_CANDIDATES.join(', ')} are all in use — stop one and re-run`);
    return;
  }
  if (workerPort !== WORKER_PORT_PREFERRED) {
    console.log(dim(`  · port ${WORKER_PORT_PREFERRED} busy, using :${workerPort} for wrangler dev`));
  }

  rmSync(WORKER_PERSIST, { recursive: true, force: true });
  mkdirSync(join(ROOT, '.runtime/xdg'), { recursive: true });
  mkdirSync(join(ROOT, '.runtime/xdg-cache'), { recursive: true });

  const migrate = await runCommand(
    'wrangler',
    ['d1', 'migrations', 'apply', 'token-island-cloud', '--local', '--persist-to', WORKER_PERSIST],
    { cwd: CLOUD_APP_DIR, env: wranglerEnv(), timeoutMs: 240_000 },
  );
  check(
    'wrangler d1 migrations apply --local',
    migrate.code === 0,
    migrate.timedOut ? 'timed out after 240s' : firstLine(outputTail(migrate.stdout, migrate.stderr)),
  );
  if (migrate.code !== 0) {
    skip('Cloudflare Worker API', 'local D1 migration failed — skipping HTTP assertions');
    return;
  }

  const child = startWrangler('wrangler dev', [
    'dev',
    '--port',
    String(workerPort),
    '--persist-to',
    WORKER_PERSIST,
  ]);
  const base = `http://127.0.0.1:${workerPort}`;
  try {
    await waitForHttp('wrangler dev', `${base}/healthz`, child, 90_000);
    pass(`wrangler dev (v${version}) answers :${workerPort}/healthz`);

    const health = await request(`${base}/healthz`);
    check(
      'worker /healthz is 200 JSON with ok=true',
      health.status === 200 && health.json !== null && health.json.ok === true,
      `status ${health.status}${health.error ? ` (${health.error})` : ''}`,
    );

    const register = await request(`${base}/api/v1/register`, 8000, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'e2e-worker', displayName: 'E2E Worker' }),
    });
    const apiKey = register.json && typeof register.json.apiKey === 'string' ? register.json.apiKey : '';
    check(
      'worker register returns 201 + API key',
      register.status === 201 && apiKey.length > 0,
      `status ${register.status}`,
    );
    if (!apiKey) {
      skip('Cloudflare Worker API', 'registration failed, no API key to ingest with');
      return;
    }

    const days = generateDemoCloudDays({ days: 30, seed: 7 });
    const ingest = await request(`${base}/api/v1/ingest`, 15_000, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ version: '0.2.0', client: 'e2e', days }),
    });
    check(
      'worker ingest accepts demo days',
      ingest.status === 200 && ingest.json !== null && ingest.json.ok === true,
      `status ${ingest.status}${ingest.error ? ` (${ingest.error})` : ''}`,
    );

    const assets = [
      { label: 'badge (dark tokens)', path: '/u/e2e-worker/badge.svg?metric=tokens&theme=dark' },
      { label: 'badge (light cost)', path: '/u/e2e-worker/badge.svg?metric=cost&theme=light' },
      { label: 'chart (line)', path: '/u/e2e-worker/chart.svg?type=line&days=30&theme=dark' },
      { label: 'chart (heatmap)', path: '/u/e2e-worker/chart.svg?type=heatmap&days=182&theme=dark' },
      { label: 'card', path: '/u/e2e-worker/card.svg?theme=dark' },
    ];
    for (const asset of assets) {
      const result = await request(`${base}${asset.path}`, 8000);
      const ok =
        result.status === 200 && result.contentType.includes('svg') && result.body.includes('<svg');
      check(
        `worker ${asset.label} is a 200 SVG`,
        ok,
        `status ${result.status}, content-type ${result.contentType || 'none'}`,
      );
      if (ok) pixelSvgChecks(`worker ${asset.label}`, result.body);
    }

    const dashboard = await request(`${base}/u/e2e-worker`);
    check(
      'worker dashboard is HTML with pixel fonts + embed snippets',
      dashboard.status === 200 &&
        dashboard.contentType.includes('text/html') &&
        dashboard.body.includes('Silkscreen') &&
        dashboard.body.includes('@font-face') &&
        dashboard.body.includes('badge.svg'),
      `status ${dashboard.status}, content-type ${dashboard.contentType || 'none'}`,
    );
    check(
      'worker dashboard inline SVGs use pixel crispEdges',
      dashboard.body.includes('crispEdges'),
    );

    const stats = await request(`${base}/api/v1/u/e2e-worker`);
    const totalDays = stats.json && typeof stats.json.totalDays === 'number' ? stats.json.totalDays : 0;
    check(
      'worker /api/v1/u/:user returns ingested days',
      stats.status === 200 && totalDays > 0,
      `status ${stats.status}, totalDays=${totalDays}`,
    );
  } catch (error) {
    fail('Cloudflare Worker startup', (error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Phase 4 — pixel island snapshots (skipped when the app is not built)
// ---------------------------------------------------------------------------

function pngSize(file: string): { width: number; height: number } | null {
  try {
    const buffer = readFileSync(file);
    const signature = buffer.subarray(0, 8).toString('hex');
    if (signature !== '89504e470d0a1a0a') return null;
    if (buffer.length < 24) return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  } catch {
    return null;
  }
}

async function phaseIsland(): Promise<void> {
  phaseHeader('Phase 4 · pixel island snapshots (--snapshot-all)');
  if (!existsSync(ISLAND_BIN)) {
    skip('island snapshots', 'apps/island-macos/build/TokenIsland.app not built (pnpm island:build)');
    return;
  }
  if (!existsSync(FIXTURE_SUMMARY)) {
    skip('island snapshots', `fixture missing: ${relative(ROOT, FIXTURE_SUMMARY)}`);
    return;
  }

  rmSync(ISLAND_OUT, { recursive: true, force: true });
  mkdirSync(ISLAND_OUT, { recursive: true });
  const snapshot = await runCommand(
    ISLAND_BIN,
    ['--snapshot-all', ISLAND_OUT, '--scale', '2', '--fixture', FIXTURE_SUMMARY],
    { cwd: ROOT, timeoutMs: 120_000 },
  );
  check(
    'island --snapshot-all exits 0',
    snapshot.code === 0,
    snapshot.timedOut ? 'timed out after 120s' : firstLine(outputTail(snapshot.stdout, snapshot.stderr)),
  );

  // Wallpaper composites are a fixed 1920x1200 canvas at scale 2; the
  // transparent variants expose the real pixel geometry: collapsed 224x44 pt
  // and expanded/offline 448x400 pt → >=448x88 / >=896x800 at scale 2.
  const wallpapers = ['island-collapsed.png', 'island-expanded.png', 'island-offline.png'];
  const canvasSizes: Array<{ width: number; height: number }> = [];
  for (const name of wallpapers) {
    const file = join(ISLAND_OUT, name);
    const dims = pngSize(file);
    let bytes = 0;
    try {
      bytes = statSync(file).size;
    } catch {
      bytes = 0;
    }
    check(
      `${name} is a non-empty PNG`,
      dims !== null && bytes > 1000,
      dims ? `${dims.width}x${dims.height}, ${bytes} bytes` : 'missing/invalid',
    );
    if (dims) canvasSizes.push(dims);
  }
  if (canvasSizes.length === wallpapers.length) {
    const [first] = canvasSizes;
    check(
      'wallpaper snapshots share one canvas size',
      first !== undefined &&
        canvasSizes.every((dims) => dims.width === first.width && dims.height === first.height),
      `${first?.width}x${first?.height}`,
    );
  }

  const geometry = [
    { name: 'island-collapsed-transparent.png', label: 'collapsed', minWidth: 448, minHeight: 88 },
    { name: 'island-expanded-transparent.png', label: 'expanded', minWidth: 896, minHeight: 800 },
    { name: 'island-offline-transparent.png', label: 'offline', minWidth: 896, minHeight: 800 },
  ];
  for (const item of geometry) {
    const dims = pngSize(join(ISLAND_OUT, item.name));
    check(
      `${item.label} transparent snapshot has ${item.minWidth}x${item.minHeight}px (scale 2) geometry`,
      dims !== null && dims.width >= item.minWidth && dims.height >= item.minHeight,
      dims ? `${dims.width}x${dims.height}` : 'missing/invalid',
    );
  }
}

// ---------------------------------------------------------------------------
// Phase 4 — summary
// ---------------------------------------------------------------------------

function printSummary(): number {
  phaseHeader('Phase 5 · summary');
  const passed = results.filter((entry) => entry.status === 'PASS').length;
  const failed = results.filter((entry) => entry.status === 'FAIL');
  const skipped = results.filter((entry) => entry.status === 'SKIP').length;

  console.log(
    `  ${green(`${passed} passed`)} · ${red(`${failed.length} failed`)} · ${yellow(`${skipped} skipped`)}` +
      dim(`  (runtime: ${relative(ROOT, RUNTIME)})`),
  );

  if (failed.length > 0) {
    console.log(`\n${red('Failures:')}`);
    for (const entry of failed) {
      console.log(`  ${red('✗')} [${entry.phase}] ${entry.name}`);
      if (entry.detail) {
        for (const line of entry.detail.split('\n').slice(0, 10)) {
          console.log(`      ${dim(line.slice(0, 300))}`);
        }
      }
    }
  }

  const skippedEntries = results.filter((entry) => entry.status === 'SKIP');
  if (skippedEntries.length > 0) {
    console.log(`\n${yellow('Skipped (not failures):')}`);
    for (const entry of skippedEntries) {
      console.log(`  ${yellow('–')} ${entry.name}${entry.detail ? dim(` — ${firstLine(entry.detail)}`) : ''}`);
    }
  }

  console.log(`\n${bold(failed.length === 0 ? green('E2E PASS') : red('E2E FAIL'))}`);
  return failed.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(bold('Token Island e2e'));
  console.log(dim(`  repo: ${ROOT}`));
  console.log(dim(`  mode: ${SKIP_CORE_TESTS ? 'core tests skipped' : 'core typecheck + tests'}`));
  console.log(
    dim(
      `  ports: collector ${COLLECTOR_PORT_PREFERRED} (E2E_COLLECTOR_PORT), ` +
        `node cloud ${CLOUD_PORT_PREFERRED} (E2E_CLOUD_PORT), worker ${WORKER_PORT_PREFERRED} (E2E_WORKER_PORT)`,
    ),
  );

  rmSync(RUNTIME, { recursive: true, force: true });
  mkdirSync(RUNTIME, { recursive: true });

  try {
    await phaseCore();
    await phaseCollector();
    await phaseCloud();
    await phaseWorker();
    await phaseIsland();
  } finally {
    await stopAll();
  }

  process.exitCode = printSummary();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stopAll().then(() => {
      console.error(`\n${yellow('interrupted')} — child processes stopped`);
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  });
}

main().catch(async (error: unknown) => {
  console.error(`${red('✗')} e2e crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  await stopAll();
  process.exitCode = 1;
});
