#!/usr/bin/env node
/**
 * scripts/e2e.ts — Token Island end-to-end verification.
 *
 *   node --import tsx scripts/e2e.ts [--skip-core-tests]
 *
 * Phases:
 *   0  root `pnpm typecheck` + `pnpm test` (skippable for a fast run)
 *   1  collector demo mode (:47121, env E2E_COLLECTOR_PORT) → /api/health + summary shape
 *   2  cloud (:47120, env E2E_CLOUD_PORT) with a temp DB → seed, /healthz, SVGs, dashboard
 *   3  island snapshot via the built .app (skipped when it has not been built)
 *   4  PASS/FAIL/SKIP summary; non-zero exit on a hard failure
 *
 * The script only manages child processes it spawns itself and never touches the
 * real demo services on :47117 / :47118.
 *
 * Every child process is killed in a finally block, every wait is bounded, and
 * missing app implementations are reported as SKIP instead of crashing.
 * Runtime state lives under <repo>/.runtime/e2e.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = join(ROOT, '.runtime/e2e');
const COLLECTOR_HOME = join(RUNTIME, 'collector');
const CLOUD_HOME = join(RUNTIME, 'cloud');
const ISLAND_OUT = join(RUNTIME, 'island');

const COLLECTOR_ENTRY = join(ROOT, 'apps/collector/src/index.ts');
const CLOUD_ENTRY = join(ROOT, 'apps/cloud/src/index.ts');
const CLOUD_SEED_ENTRY = join(ROOT, 'apps/cloud/src/seed.ts');
const ISLAND_APP = join(ROOT, 'apps/island-macos/build/TokenIsland.app');
const ISLAND_BIN = join(ISLAND_APP, 'Contents/MacOS/TokenIsland');
const FIXTURE_SUMMARY = join(ROOT, 'fixtures/summary.example.json');

// Dedicated e2e ports: keep the real demo services (cloud :47117, collector
// :47118) out of the way. Override with E2E_CLOUD_PORT / E2E_COLLECTOR_PORT.
const CLOUD_PORT_PREFERRED = Number.parseInt(process.env.E2E_CLOUD_PORT ?? '47120', 10);
const CLOUD_PORT_CANDIDATES = [CLOUD_PORT_PREFERRED, 47131, 47132, 47133];
const COLLECTOR_PORT_PREFERRED = Number.parseInt(process.env.E2E_COLLECTOR_PORT ?? '47121', 10);
// The collector's --demo mode has historically used a fixed 47119; keep it as
// a discovery fallback so the phase still works if TOKEN_ISLAND_PORT is ignored.
const COLLECTOR_PORT_CANDIDATES = [COLLECTOR_PORT_PREFERRED, 47119];
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

async function request(url: string, timeoutMs = 5000): Promise<HttpResult> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
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

async function stopAll(): Promise<void> {
  const alive = (child: ChildProcess): boolean => child.exitCode === null && child.signalCode === null;
  for (const child of children) {
    if (alive(child)) {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && children.some(alive)) {
    await sleep(100);
  }
  for (const child of children) {
    if (alive(child)) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
  const killDeadline = Date.now() + 2000;
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
  phaseHeader('Phase 2 · cloud seed + SVGs + dashboard');
  if (!existsSync(CLOUD_ENTRY) || !existsSync(CLOUD_SEED_ENTRY)) {
    skip('cloud API', 'apps/cloud/src/{index,seed}.ts not found');
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
      check(
        `badge.svg?metric=${metric} is a 200 SVG`,
        badge.status === 200 && badge.contentType.includes('svg') && badge.body.includes('<svg'),
        `status ${badge.status}, content-type ${badge.contentType || 'none'}`,
      );
    }

    for (const type of ['line', 'bar', 'heatmap']) {
      const chart = await request(`${base}/u/demo/chart.svg?type=${type}&days=30&theme=dark`);
      check(
        `chart.svg?type=${type} is a 200 SVG`,
        chart.status === 200 && chart.contentType.includes('svg') && chart.body.includes('<svg'),
        `status ${chart.status}, content-type ${chart.contentType || 'none'}`,
      );
    }

    const card = await request(`${base}/u/demo/card.svg?theme=dark`);
    check(
      'card.svg is a 200 SVG',
      card.status === 200 && card.contentType.includes('svg') && card.body.includes('<svg'),
      `status ${card.status}, content-type ${card.contentType || 'none'}`,
    );

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
  } catch (error) {
    fail('cloud startup', (error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Phase 3 — island snapshot (skipped when the app is not built)
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
  phaseHeader('Phase 3 · island snapshot');
  if (!existsSync(ISLAND_BIN)) {
    skip('island snapshot', 'apps/island-macos/build/TokenIsland.app not built (pnpm island:build)');
    return;
  }
  if (!existsSync(FIXTURE_SUMMARY)) {
    skip('island snapshot', `fixture missing: ${relative(ROOT, FIXTURE_SUMMARY)}`);
    return;
  }

  mkdirSync(ISLAND_OUT, { recursive: true });
  const outFile = join(ISLAND_OUT, 'island-expanded.png');
  rmSync(outFile, { force: true });

  const snapshot = await runCommand(
    ISLAND_BIN,
    ['--snapshot', outFile, '--state', 'expanded', '--scale', '2', '--background', 'wallpaper', '--fixture', FIXTURE_SUMMARY],
    { cwd: ROOT, timeoutMs: 60_000 },
  );
  check(
    'island --snapshot exits 0',
    snapshot.code === 0,
    snapshot.timedOut ? 'timed out after 60s' : firstLine(outputTail(snapshot.stdout, snapshot.stderr)),
  );

  if (existsSync(outFile)) {
    let size = 0;
    try {
      size = statSync(outFile).size;
    } catch {
      size = 0;
    }
    const dimensions = pngSize(outFile);
    check(
      'island snapshot is a non-empty PNG',
      size > 1000 && dimensions !== null,
      `${size} bytes${dimensions ? `, ${dimensions.width}x${dimensions.height}` : ''}`,
    );
    if (dimensions) {
      pass('island snapshot dimensions', `${dimensions.width}x${dimensions.height}px (scale 2)`);
    }
  } else {
    fail('island snapshot file exists', `missing ${relative(ROOT, outFile)}`);
  }
}

// ---------------------------------------------------------------------------
// Phase 4 — summary
// ---------------------------------------------------------------------------

function printSummary(): number {
  phaseHeader('Phase 4 · summary');
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
      `  ports: collector ${COLLECTOR_PORT_PREFERRED} (env E2E_COLLECTOR_PORT), ` +
        `cloud ${CLOUD_PORT_PREFERRED} (env E2E_CLOUD_PORT)`,
    ),
  );

  rmSync(RUNTIME, { recursive: true, force: true });
  mkdirSync(RUNTIME, { recursive: true });

  try {
    await phaseCore();
    await phaseCollector();
    await phaseCloud();
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
