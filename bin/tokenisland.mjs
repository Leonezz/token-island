#!/usr/bin/env node
/**
 * Token Island CLI — zero-dependency command dispatcher.
 *
 * This file is intentionally plain ESM JavaScript with Node built-ins only
 * (`node:child_process`, `node:fs`, `node:os`, `node:path`, `node:url`), so it
 * works before/without any build step. TypeScript apps are launched through
 * `node --import tsx <entry>` using the repository's own dev dependencies.
 *
 * Repo layout it expects (full checkout):
 *   apps/collector/src/index.ts          collector daemon + CLI
 *   apps/cloud/src/index.ts|seed.ts      cloud server + seed script
 *   apps/island-macos/build/TokenIsland.app/Contents/MacOS/TokenIsland
 *   apps/island-macos/scripts/install.sh|uninstall.sh
 *
 * See docs/CONTRACT.md §4, §5.1, §6.1, §7.5 for the interfaces implemented here.
 */

import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
// --no-warnings hides node:sqlite's experimental warning for CLI-launched apps
// (the app package scripts set the same via NODE_OPTIONS).
const TSX_FLAGS = ['--no-warnings', '--import', 'tsx'];

const COLLECTOR_ENTRY = join(ROOT, 'apps/collector/src/index.ts');
const CLOUD_APP_DIR = join(ROOT, 'apps/cloud');
const CLOUD_ENTRY = join(CLOUD_APP_DIR, 'src/node.ts');
const CLOUD_WORKER_ENTRY = join(CLOUD_APP_DIR, 'src/worker.ts');
const CLOUD_SEED_ENTRY = join(CLOUD_APP_DIR, 'src/seed.ts');
const CLOUD_WORKER_SEED = join(CLOUD_APP_DIR, 'scripts/seed-worker.ts');
const ISLAND_APP = join(ROOT, 'apps/island-macos/build/TokenIsland.app');
const ISLAND_BIN = join(ISLAND_APP, 'Contents/MacOS/TokenIsland');
const ISLAND_BUILD_DIR = join(ROOT, 'apps/island-macos/build');
const ISLAND_DMG_SCRIPT = join(ROOT, 'apps/island-macos/scripts/package-dmg.sh');
const ISLAND_INSTALL = join(ROOT, 'apps/island-macos/scripts/install.sh');
const ISLAND_UNINSTALL = join(ROOT, 'apps/island-macos/scripts/uninstall.sh');
const WIDGET_AGENT_LABEL = 'com.token-island.app';
const COLLECTOR_AGENT_LABEL = 'com.token-island.collector';
const LAUNCH_AGENT_PLIST = join(homedir(), `Library/LaunchAgents/${WIDGET_AGENT_LABEL}.plist`);
const COLLECTOR_LOG_DIR = join(ROOT, '.runtime/collector');
const COLLECTOR_LOG_FILE = join(COLLECTOR_LOG_DIR, 'daemon.log');

const DEFAULT_COLLECTOR_PORT = 47118;
const DEMO_COLLECTOR_PORT = 47119;
const DEFAULT_CLOUD_PORT = 47117;
const DEFAULT_CLOUD_URL = `http://127.0.0.1:${DEFAULT_CLOUD_PORT}`;
const DEFAULT_WORKER_PORT = Number.parseInt(process.env.TOKEN_ISLAND_WORKER_PORT ?? '47131', 10) || 47131;
const WORKER_PERSIST_DIR = join(ROOT, '.runtime/wrangler-state');
const WORKER_DIST_DIR = join(ROOT, '.runtime/worker-dist');
const WRANGLER_XDG_CONFIG = join(ROOT, '.runtime/xdg');
const WRANGLER_XDG_CACHE = join(ROOT, '.runtime/xdg-cache');
const FALLBACK_VERSION = '0.4.0';
const MIN_NODE = { major: 22, minor: 5 };

const DEFAULT_SOURCE_PATHS = {
  claude: '~/.claude/projects',
  codex: '~/.codex/sessions',
  opencode: '~/.local/share/opencode/opencode.db',
  dsh: '~/.dsh/sessions',
  antigravity: '~/.gemini/antigravity',
  gemini: '~/.gemini',
};

// ---------------------------------------------------------------------------
// Tiny terminal helpers (no dependency, respects NO_COLOR / non-TTY)
// ---------------------------------------------------------------------------

const COLOR = Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env);
const paint = (code) => (text) => (COLOR ? `\u001b[${code}m${text}\u001b[0m` : text);
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');
const magenta = paint('35');

const OK = green('✓');
const BAD = red('✗');
const WARN = yellow('!');
const INFO = dim('·');

/** Print an error and exit non-zero. */
function die(message, code = 1) {
  console.error(`${BAD} ${message}`);
  process.exit(code);
}

function warn(message) {
  console.error(`${WARN} ${message}`);
}

function note(message) {
  console.log(`${INFO} ${dim(message)}`);
}

/** Path relative to the repo root (or first two segments for absolute paths). */
function shortPath(target) {
  const resolved = resolve(target);
  if (resolved === ROOT) return '.';
  if (resolved.startsWith(ROOT + '/')) return resolved.slice(ROOT.length + 1);
  const home = homedir();
  if (resolved === home) return '~';
  if (resolved.startsWith(home + '/')) return '~' + resolved.slice(home.length);
  return resolved;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function nodeVersion() {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  return { major, minor, patch };
}

function nodeVersionOk() {
  const v = nodeVersion();
  return v.major > MIN_NODE.major || (v.major === MIN_NODE.major && v.minor >= MIN_NODE.minor);
}

// ---------------------------------------------------------------------------
// Config / paths (~/.token-island/config.json, overridable with TOKEN_ISLAND_HOME)
// ---------------------------------------------------------------------------

function stateHome() {
  return process.env.TOKEN_ISLAND_HOME || join(homedir(), '.token-island');
}

function configPath() {
  return join(stateHome(), 'config.json');
}

/** Read config.json; returns {} when missing, throws on unparseable JSON. */
function readConfig({ lenient = false } = {}) {
  const file = configPath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (lenient) return {};
    throw new Error(`cannot parse ${shortPath(file)}: ${error.message}`);
  }
}

/**
 * Atomically merge config.json. Creates the state dir (0700) and writes the
 * file with mode 0600 via a temp file + rename, so a crash cannot truncate the
 * existing config. Returns the config path.
 */
function mergeConfig(updater) {
  const home = stateHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = join(home, 'config.json');
  let existing = {};
  if (existsSync(file)) {
    try {
      existing = JSON.parse(readFileSync(file, 'utf8'));
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) existing = {};
    } catch (error) {
      warn(`existing ${shortPath(file)} is not valid JSON; it will be replaced (${error.message})`);
      existing = {};
    }
  }
  const next = updater({ ...existing });
  const temp = join(home, `.config.json.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  try {
    chmodSync(temp, 0o600);
  } catch {
    /* best effort */
  }
  renameSync(temp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    /* best effort */
  }
  return file;
}

function configPort() {
  const envPort = Number.parseInt(process.env.TOKEN_ISLAND_PORT ?? '', 10);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  const config = readConfig({ lenient: true });
  const port = Number.parseInt(String(config.port ?? ''), 10);
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_COLLECTOR_PORT;
}

function configCloudUrl() {
  const config = readConfig({ lenient: true });
  const url = config.cloud && typeof config.cloud.url === 'string' ? config.cloud.url.trim() : '';
  return url || DEFAULT_CLOUD_URL;
}

/** Expand a leading `~` using the current HOME (sandbox-friendly). */
function expandHome(input) {
  if (!input) return input;
  if (input === '~') return homedir();
  if (input.startsWith('~/')) return join(homedir(), input.slice(2));
  return input;
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

function ensureTsx() {
  if (!existsSync(join(ROOT, 'node_modules/tsx'))) {
    die(
      `dependencies are not installed in ${shortPath(ROOT)}.\n` +
        `  Run: cd ${shortPath(ROOT)} && pnpm install`,
    );
  }
}

function ensureEntry(entry, label, hint) {
  if (existsSync(entry)) return;
  die(
    `${label} is not available in this checkout.\n` +
      `  Missing: ${shortPath(entry)}\n` +
      (hint ? `  ${hint}` : `  Make sure you are running from a full token-island repository checkout.`),
  );
}

/** Run a repo TypeScript entry through the local tsx loader with inherited stdio. */
function runNodeEntry(entry, args, env = {}) {
  return new Promise((done) => {
    const child = spawn(NODE, [...TSX_FLAGS, entry, ...args], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    const forward = (signal) => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill(signal);
        } catch {
          /* ignore */
        }
      }
    };
    const onInt = () => forward('SIGINT');
    const onTerm = () => forward('SIGTERM');
    process.once('SIGINT', onInt);
    process.once('SIGTERM', onTerm);
    child.once('error', (error) => {
      process.removeListener('SIGINT', onInt);
      process.removeListener('SIGTERM', onTerm);
      die(`failed to start ${shortPath(entry)}: ${error.message}`);
    });
    child.once('exit', (code, signal) => {
      process.removeListener('SIGINT', onInt);
      process.removeListener('SIGTERM', onTerm);
      done(code ?? (signal ? 1 : 0));
    });
  });
}

/** Run an arbitrary binary with inherited stdio, resolving to its exit code. */
function runBinary(binary, args, { cwd = process.cwd(), env = {} } = {}) {
  return new Promise((done) => {
    const child = spawn(binary, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.once('error', (error) => {
      die(`failed to start ${shortPath(binary)}: ${error.message}`);
    });
    child.once('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP = `
${bold('tokenisland')} — local-first token usage tracker for AI coding agents

${bold('Usage')}
  tokenisland <command> [options]
  tokenisland help <command>

${bold('Commands')}
  ${cyan('collect')}     Run the collector daemon; parses local agent logs into SQLite + local API
  ${cyan('sync')}        Push the current daily aggregates to the configured cloud (once)
  ${cyan('status')}      Query the running collector and print its /api/health JSON ("offline" if down)
  ${cyan('login')}       Sign in with GitHub (OAuth Device Flow) & bind this machine
  ${cyan('register')}    Register this machine with a Token Island cloud and store its API key
  ${cyan('export')}      Download your badge/chart/card SVGs for a static GitHub README
  ${cyan('cloud')}       Cloud: ${dim('start|seed')} (Node+SQLite) or ${dim('migrate|dev|deploy')} (Cloudflare Workers+D1)
  ${cyan('island')}      Launch the dot-matrix widget, render PNG snapshots, or ${dim('--dmg')} install info
  ${cyan('install')}     Install the native app + collector login items (no sudo)
  ${cyan('uninstall')}   Remove the login items / app (local data is kept)
  ${cyan('doctor')}      Diagnose: services, wrangler, app icon/fonts, DMG, codesign, data sources
  ${cyan('help')}        Show this help (or ${dim('tokenisland help <command>')})

${bold('Examples')}
  tokenisland doctor
  tokenisland collect --foreground
  tokenisland collect --demo                  ${dim('# demo data on :47119, no user files touched')}
  tokenisland cloud start                     ${dim('# Node+SQLite runtime on :47117, another terminal')}
  tokenisland cloud seed                      ${dim('# demo/alice users + example URLs')}
  tokenisland cloud dev                       ${dim('# Cloudflare Worker + local D1 on :47131')}
  tokenisland cloud deploy --dry-run          ${dim('# verify the Worker bundle (no login needed)')}
  tokenisland register --cloud http://127.0.0.1:47117 --username myname
  tokenisland export --user myname                 ${dim('# static SVGs in docs/badges/')}
  tokenisland island --snapshot docs/images/island-expanded.png --state expanded --scale 2
  tokenisland island --dmg                    ${dim('# DMG path + drag-to-Applications steps')}

${bold('Environment')}
  TOKEN_ISLAND_HOME         state dir (default ~/.token-island; config.json, data.db)
  TOKEN_ISLAND_PORT         collector port override (default 47118)
  TOKEN_ISLAND_DEMO_PORT    collector demo port (default 47119)
  TOKEN_ISLAND_WORKER_PORT  wrangler dev port (default 47131)

${dim('Docs: docs/CONTRACT.md · README: README.md')}
`.trim();

const COMMAND_HELP = {
  collect: `
${bold('tokenisland collect')} [--foreground] [--once] [--demo] [--reset] [--backfill-days N]

Run the collector daemon: watches the supported agent session logs, normalizes
usage into SQLite and serves the local JSON API on http://127.0.0.1:47118.

  --foreground        run in the foreground (default)
  --once              scan once, print counts and exit (tests / CI)
  --demo              serve deterministic demo data on :47119 (no user files, no DB writes)
  --reset             delete the local DB + file offsets, then rescan
  --backfill-days N   only scan session files modified in the last N days (default 30)

State: TOKEN_ISLAND_HOME (default ~/.token-island), DB ~/.token-island/data.db.
Signals: SIGINT/SIGTERM shut the server and DB down cleanly (exit 0).
`.trim(),
  sync: `
${bold('tokenisland sync')}

Push the collector's daily aggregates to the cloud configured in
~/.token-island/config.json (${dim('cloud.enabled && url && apiKey')}) once, then exit.
Requires the collector to be reachable (or its CLI handles the sync directly).
`.trim(),
  status: `
${bold('tokenisland status')} [--port N] [--demo] [--json]

Query the running collector's GET /api/health and print the JSON document.
Prints ${dim('offline')} (and exits 1) when no collector answers.

  --port N   collector port (default: config port, 47118)
  --demo     query the demo port 47119
  --json     machine-readable output (default when stdout is not a TTY)
`.trim(),
  register: `
${bold('tokenisland register')} --cloud <url> --username <name> [--display-name <name>] [--admin-token <token>]

Create a cloud account (POST /api/v1/register) and merge the returned API key into
${dim('${TOKEN_ISLAND_HOME:-~/.token-island}/config.json')} (existing keys are preserved,
the file is written atomically with mode 600). The key is printed once and can never
be retrieved again.

  --cloud <url>        cloud base URL (default: config.cloud.url or http://127.0.0.1:47117)
  --username <name>    3-32 chars, [a-z0-9_-]; omit to let the cloud generate one
  --display-name <s>   optional display name
  --admin-token <t>    admin token if the cloud sets TOKEN_ISLAND_ADMIN_TOKEN
  --json               print the raw registration response

Next: restart the collector, then run ${dim('tokenisland sync')}.
`.trim(),
  export: `
${bold('tokenisland export')} [--cloud <url>] [--user <name>] [--out docs/badges] [--days 30] [--theme dark]

GitHub READMEs cannot load images from http://127.0.0.1, so there are two options:
deploy the cloud publicly and use live SVG URLs, or export the SVGs once and commit
the static files (this command). Re-run it after sync to refresh the numbers.

Downloads /u/<user>/badge.svg for the 7 metrics, /u/<user>/chart.svg for the 4 chart
types and /u/<user>/card.svg, and then prints a Markdown snippet with repo-relative
paths. Requires the cloud service to be reachable.

  --cloud <url>     cloud base URL (default: config.cloud.url or http://127.0.0.1:47117)
  --user <name>     3-32 char username (default: config.cloud.username)
  --out <dir>       output directory (default docs/badges, relative to the current dir)
  --days <n>        window for badge/chart queries, 7..365 (default 30)
  --theme <mode>    dark | light | auto (default dark)
`.trim(),
  cloud: `
${bold('tokenisland cloud')} <start|seed|migrate|dev|deploy> [options]

${bold('Node + SQLite runtime')} ${dim('(local dev / Docker / tests)')}
  ${bold('start')} [--port N] [--db <path>]   HTTP server (default :47117, db ./data/cloud.db)
  ${bold('seed')}  [--db <path>]              seed demo + alice, print API keys / URLs

${bold('Cloudflare Workers + D1 runtime')} ${dim('(production target)')}
  ${bold('migrate')} [--remote] [--persist-to <dir>]  apply D1 migrations (local by default)
  ${bold('dev')} [--port N] [--persist-to <dir>] [--skip-migrate]
                                              local D1 migrate + wrangler dev (default :47131)
  ${bold('deploy')} [--dry-run] [--outdir <dir>]      wrangler deploy; --dry-run bundles only
                                              (no login required for --dry-run)

Sandbox-safe state is kept under <repo>/.runtime (XDG dirs + --persist-to), never $HOME.
Real deploy needs \`wrangler login\` or CLOUDFLARE_API_TOKEN (Workers Scripts:Edit + D1:Edit).
Docs: apps/cloud/DEPLOY.md (Node) · apps/cloud/DEPLOY-CLOUDFLARE.md (Workers).
`.trim(),
  island: `
${bold('tokenisland island')} [--snapshot <out.png> [--state collapsed|expanded|offline]
                    [--fixture <summary.json>] [--scale 1|2] [--background wallpaper|transparent]]
                    | [--snapshot-all <dir> [--scale 2]] | [--demo] | [--dmg]

Dot-matrix data marks (V3) inside the pixel app: collapsed 224×44 pt, expanded 448×400 pt.
Hero numbers / charts / LED use dot-matrix; every label stays crisp Silkscreen text.
With no arguments: launch the built app. When an installed LaunchAgent is present it
is kick-started; otherwise the bundled binary is spawned detached.

Snapshot mode renders dot-matrix PNGs with ImageRenderer and exits — no screen recording
permission needed (wallpaper mode composites a pixel desktop + menu bar).

  --demo   launch against bundled fixtures/summary.example.json
  --dmg    print the built DMG path, verify it with hdiutil and show the
           drag-to-/Applications install steps (build: bash apps/island-macos/scripts/package-dmg.sh)
`.trim(),
  install: `
${bold('tokenisland install')} [--dry-run]

Installs both login items (no sudo required):
  • the native dot-matrix app — TokenIsland.app → ~/Applications, LaunchAgent
    com.token-island.app (builds the bundle first if needed). DMG alternative:
    tokenisland island --dmg; and
  • the collector daemon — LaunchAgent com.token-island.collector with
    RunAtLoad + KeepAlive, so token capture starts automatically at login.

The collector agent writes its log to ${dim('<repo>/.runtime/collector/daemon.log')}.
If TOKEN_ISLAND_HOME is set when installing, it is baked into the agent's
environment (production default stays ~/.token-island).

  --dry-run   print the planned files/plist without writing or loading anything
`.trim(),
  uninstall: `
${bold('tokenisland uninstall')} [--dry-run]

Unloads and removes both LaunchAgents (com.token-island.app and
com.token-island.collector) and deletes ~/Applications/TokenIsland.app.
Local data in ~/.token-island is kept on purpose.
`.trim(),
  doctor: `
${bold('tokenisland doctor')}

Prints a compact ✓/✗ table: node version, installed dependencies, collector/cloud
reachability, built dot-matrix app (binary, AppIcon.icns, bundled Silkscreen fonts),
DMG + ad-hoc codesign status, wrangler presence + Worker dev port, config file and
discovered agent data sources.
Diagnostics (offline services, missing apps, no wrangler) are warnings; a broken
node/deps setup makes it exit 1.
`.trim(),
  help: `
${bold('tokenisland help')} [command]

Show the global help or the detailed help for one command.
`.trim(),
};

function printHelp(command) {
  if (!command) {
    console.log(HELP);
    return;
  }
  const text = COMMAND_HELP[command];
  if (!text) {
    warn(`no detailed help for "${command}"`);
    console.log(HELP);
    return;
  }
  console.log(`${text}\n\n${dim(`Run "tokenisland ${command} --help" for this text.`)}`);
}

function maybeHelp(args, command) {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp(command);
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// HTTP helpers (Node 22 global fetch; every request is bounded)
// ---------------------------------------------------------------------------

async function fetchJson(url, { timeoutMs = 3000, ...init } = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { response, text, body };
}

function errorMessageFromBody(body, text, fallback) {
  if (body && body.error && typeof body.error.message === 'string') return body.error.message;
  if (body && typeof body.message === 'string') return body.message;
  const trimmed = (text || '').trim();
  return trimmed ? trimmed.slice(0, 300) : fallback;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdCollect(args) {
  if (maybeHelp(args, 'collect')) return;
  ensureTsx();
  ensureEntry(
    COLLECTOR_ENTRY,
    'Collector app',
    'Expected apps/collector/src/index.ts (the collector is implemented in task-1).',
  );
  const demo = args.includes('--demo');
  note(`collector ${demo ? '(demo · port 47119)' : '(real data)'} · home ${shortPath(stateHome())}`);
  const code = await runNodeEntry(COLLECTOR_ENTRY, ['collect', ...args], {
    TOKEN_ISLAND_HOME: stateHome(),
  });
  process.exitCode = code;
}

async function cmdSync(args) {
  if (maybeHelp(args, 'sync')) return;
  ensureTsx();
  ensureEntry(
    COLLECTOR_ENTRY,
    'Collector app',
    'Expected apps/collector/src/index.ts (the collector is implemented in task-1).',
  );
  const code = await runNodeEntry(COLLECTOR_ENTRY, ['sync', ...args], {
    TOKEN_ISLAND_HOME: stateHome(),
  });
  process.exitCode = code;
}

async function cmdStatus(args) {
  if (maybeHelp(args, 'status')) return;
  let port = args.includes('--demo') ? DEMO_COLLECTOR_PORT : configPort();
  const portIndex = args.indexOf('--port');
  if (portIndex !== -1) {
    const value = Number.parseInt(args[portIndex + 1] ?? '', 10);
    if (!Number.isFinite(value) || value <= 0) die('--port requires a positive integer');
    port = value;
  }
  const url = `http://127.0.0.1:${port}/api/health`;
  try {
    const { response, text, body } = await fetchJson(url, { timeoutMs: 1500 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const output = body ?? text;
    console.log(typeof output === 'string' ? output : JSON.stringify(output, null, 2));
  } catch (error) {
    console.log('offline');
    note(
      `could not reach ${url} (${error.message}) — start the collector with ` +
        `tokenisland collect --foreground${port === DEMO_COLLECTOR_PORT ? ' --demo' : ''}`,
    );
    process.exitCode = 1;
  }
}

function parseRegisterArgs(args) {
  const options = {
    cloud: '',
    username: '',
    displayName: '',
    adminToken: process.env.TOKEN_ISLAND_ADMIN_TOKEN ?? '',
    json: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const values = {
      '--cloud': 'cloud',
      '--url': 'cloud',
      '--username': 'username',
      '-u': 'username',
      '--display-name': 'displayName',
      '--admin-token': 'adminToken',
    };
    if (arg in values) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) die(`${arg} requires a value`);
      options[values[arg]] = value;
      i += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      return null;
    } else {
      die(`unknown option "${arg}" for register (see: tokenisland help register)`);
    }
  }
  return options;
}

async function cmdRegister(args) {
  const options = parseRegisterArgs(args);
  if (!options) {
    printHelp('register');
    return;
  }
  const cloud = (options.cloud || configCloudUrl()).replace(/\/+$/, '');
  if (!cloud) die('missing --cloud <url> (or set cloud.url in config.json first)');
  if (options.username && !/^[a-z0-9_-]{3,32}$/.test(options.username)) {
    die('invalid --username: use 3-32 lowercase letters, digits, "_" or "-"');
  }

  const body = {};
  if (options.username) body.username = options.username;
  if (options.displayName) body.displayName = options.displayName;

  let result;
  try {
    result = await fetchJson(`${cloud}/api/v1/register`, {
      timeoutMs: 8000,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.adminToken ? { authorization: `Bearer ${options.adminToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    die(
      `cannot reach the cloud at ${cloud}: ${error.message}\n` +
        `  Start one locally with: tokenisland cloud start`,
    );
  }

  const { response, body: data, text } = result;
  if (response.status !== 201 || !data || typeof data.apiKey !== 'string') {
    const detail = errorMessageFromBody(data, text, `HTTP ${response.status}`);
    let hint = '';
    if (response.status === 409) hint = '\n  That username is taken — retry with another --username.';
    if (response.status === 401) hint = '\n  The cloud requires an admin token: pass --admin-token <token>.';
    die(`registration failed (${response.status}): ${detail}${hint}`);
  }

  const username = typeof data.username === 'string' ? data.username : options.username;
  const configFile = mergeConfig((existing) => {
    const previousCloud =
      existing.cloud && typeof existing.cloud === 'object' && !Array.isArray(existing.cloud)
        ? existing.cloud
        : {};
    return {
      ...existing,
      cloud: {
        ...previousCloud,
        enabled: true,
        url: cloud,
        username,
        apiKey: data.apiKey,
        autoSync: previousCloud.autoSync !== false,
        intervalMinutes:
          Number.isFinite(Number(previousCloud.intervalMinutes)) && Number(previousCloud.intervalMinutes) > 0
            ? Number(previousCloud.intervalMinutes)
            : 15,
      },
    };
  });

  // Read back: a silent write failure here would be very confusing later.
  const written = readConfig({ lenient: true });
  if (!written.cloud || written.cloud.apiKey !== data.apiKey) {
    die(`wrote ${shortPath(configFile)} but could not read the API key back — check file permissions`);
  }

  const base = cloud.replace(/\/+$/, '');
  const badgeUrl = `${base}/u/${encodeURIComponent(String(username))}/badge.svg?metric=tokens&theme=dark`;
  const dashboardUrl = `${base}/u/${encodeURIComponent(String(username))}`;
  if (options.json) {
    console.log(JSON.stringify({ ...data, registered: true, configPath: configFile }, null, 2));
    return;
  }
  console.log(`${OK} registered ${bold(String(username))} at ${base}`);
  console.log(`  API key   ${yellow(data.apiKey)}  ${dim('(shown once — store it now)')}`);
  console.log(`  Config    ${shortPath(configFile)} ${dim('(mode 600, existing keys preserved)')}`);
  console.log(`  Badge     ${badgeUrl}`);
  console.log(`  Dashboard ${dashboardUrl}`);
  console.log(`\n${bold('Next steps')}`);
  console.log(`  1. tokenisland collect --foreground   ${dim('(restart it if already running)')}`);
  console.log(`  2. tokenisland sync                   ${dim('(upload daily aggregates)')}`);
  if (!options.json) note('cloud.enabled is now true; auto-sync runs every ~15 min.');
}

function localDeviceIdentity() {
  const home = stateHome();
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = join(home, 'device.json');
  const platform = `${process.platform}-${process.arch}`;
  const fallbackName = process.env.HOSTNAME || 'Computer';
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed && typeof parsed.deviceId === 'string' && parsed.deviceId.trim().length >= 3) {
        return {
          deviceId: parsed.deviceId.trim(),
          deviceName: typeof parsed.deviceName === 'string' && parsed.deviceName.trim() ? parsed.deviceName.trim() : fallbackName,
          platform,
        };
      }
    } catch {
      /* regenerate */
    }
  }
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const identity = { deviceId: `dev_${hex}`, deviceName: fallbackName, platform };
  writeFileSync(file, JSON.stringify(identity, null, 2) + '\n', { mode: 0o600 });
  return identity;
}

async function cmdLogin(args) {
  if (maybeHelp(args, 'login')) return;
  let cloudArg = '';
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--cloud' || arg === '--url') {
      cloudArg = args[i + 1] ?? '';
      if (!cloudArg) die(`${arg} requires a URL`);
      i += 1;
    } else {
      die(`unknown option "${arg}" for login (usage: tokenisland login [--cloud <url>])`);
    }
  }
  const cloud = (cloudArg || configCloudUrl()).replace(/\/+$/, '');
  const device = localDeviceIdentity();

  const startRes = await fetchJson(`${cloud}/api/v1/auth/github/start`, {
    timeoutMs: 8000,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(device),
  }).catch((err) => die(`cannot reach ${cloud}: ${err.message}`));

  if (startRes.response.status !== 200 || !startRes.body || typeof startRes.body.sessionId !== 'string') {
    const detail = errorMessageFromBody(startRes.body, startRes.text, `HTTP ${startRes.response.status}`);
    die(`GitHub login unavailable (${startRes.response.status}): ${detail}`);
  }

  const { sessionId, userCode, verificationUri, expiresIn = 900 } = startRes.body;
  let intervalSec = Math.max(2, Number(startRes.body.interval) || 5);

  console.log(`\n${bold('Sign in with GitHub')}`);
  console.log(`  1. Open:  ${cyan(verificationUri)}`);
  console.log(`  2. Code:  ${bold(yellow(userCode))}\n`);
  note('Waiting for GitHub authorization in your browser…');

  const deadline = Date.now() + Number(expiresIn) * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalSec * 1000);
    const pollRes = await fetchJson(`${cloud}/api/v1/auth/github/poll`, {
      timeoutMs: 10000,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (pollRes.response.status !== 200 || !pollRes.body) {
      const detail = errorMessageFromBody(pollRes.body, pollRes.text, `HTTP ${pollRes.response.status}`);
      die(`GitHub login failed: ${detail}`);
    }
    if (pollRes.body.status === 'pending') {
      if (typeof pollRes.body.interval === 'number' && pollRes.body.interval > 0) {
        intervalSec = pollRes.body.interval;
      }
      continue;
    }
    if (pollRes.body.status === 'complete' && typeof pollRes.body.apiKey === 'string') {
      const { username, apiKey, dashboardUrl } = pollRes.body;
      const cfgPath = mergeConfig((existing) => {
        const previousCloud =
          existing.cloud && typeof existing.cloud === 'object' && !Array.isArray(existing.cloud)
            ? existing.cloud
            : {};
        return {
          ...existing,
          cloud: {
            ...previousCloud,
            enabled: true,
            url: cloud,
            username,
            apiKey,
            autoSync: previousCloud.autoSync !== false,
            intervalMinutes: Number(previousCloud.intervalMinutes) > 0 ? Number(previousCloud.intervalMinutes) : 15,
          },
        };
      });
      console.log(`${OK} Signed in as ${bold('@' + username)} (${dim(device.deviceId)})`);
      console.log(`  Config    ${shortPath(cfgPath)} ${dim('(per-device key saved)')}`);
      if (dashboardUrl) console.log(`  Dashboard ${dashboardUrl}`);
      return;
    }
  }
  die('GitHub login timed out before authorization completed.');
}


// ---------------------------------------------------------------------------
// export — static SVGs for GitHub READMEs (github.com cannot load 127.0.0.1)
// ---------------------------------------------------------------------------

const EXPORT_BADGE_METRICS = ['tokens', 'cost', 'streak', 'messages', 'day', 'model', 'status'];
const EXPORT_CHART_TYPES = ['line', 'bar', 'heatmap', 'models'];

function toPosixPath(input) {
  return input.replaceAll('\\', '/');
}

function parseExportArgs(args) {
  const config = readConfig({ lenient: true });
  const options = {
    cloud: '',
    user:
      config.cloud && typeof config.cloud.username === 'string' ? String(config.cloud.username) : '',
    out: 'docs/badges',
    days: 30,
    theme: 'dark',
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = args[i + 1];
    if (arg === '--cloud' || arg === '--url') {
      if (!value) die(`${arg} requires a value`);
      options.cloud = value;
      i += 1;
    } else if (arg === '--user' || arg === '--username' || arg === '-u') {
      if (!value) die(`${arg} requires a value`);
      options.user = value;
      i += 1;
    } else if (arg === '--out') {
      if (!value) die('--out requires a directory');
      options.out = value;
      i += 1;
    } else if (arg === '--days') {
      const days = Number.parseInt(value ?? '', 10);
      if (!Number.isFinite(days) || days < 7 || days > 365) die('--days must be an integer between 7 and 365');
      options.days = days;
      i += 1;
    } else if (arg === '--theme') {
      if (!value || !['dark', 'light', 'auto'].includes(value)) die('--theme must be dark, light or auto');
      options.theme = value;
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      return null;
    } else {
      die(`unknown option "${arg}" for export (see: tokenisland help export)`);
    }
  }
  return options;
}

async function cmdExport(args) {
  const options = parseExportArgs(args);
  if (!options) {
    printHelp('export');
    return;
  }
  const cloud = (options.cloud || configCloudUrl()).replace(/\/+$/, '');
  if (!options.user) {
    die(
      'missing --user <name> (or set cloud.username in config.json first: tokenisland register ...)',
    );
  }
  if (!/^[a-z0-9_-]{3,32}$/.test(options.user)) {
    die('invalid --user: use 3-32 lowercase letters, digits, "_" or "-"');
  }

  const user = encodeURIComponent(options.user);
  const theme = encodeURIComponent(options.theme);
  const window = String(options.days);
  const targets = [];
  for (const metric of EXPORT_BADGE_METRICS) {
    targets.push({
      name: `${metric}.svg`,
      url: `${cloud}/u/${user}/badge.svg?metric=${metric}&theme=${theme}&days=${window}`,
    });
  }
  for (const type of EXPORT_CHART_TYPES) {
    targets.push({
      name: `chart-${type}.svg`,
      url: `${cloud}/u/${user}/chart.svg?type=${type}&days=${window}&theme=${theme}`,
    });
  }
  targets.push({ name: 'card.svg', url: `${cloud}/u/${user}/card.svg?theme=${theme}` });

  const outDir = resolve(process.cwd(), options.out);
  const fetched = [];
  const failures = [];
  await Promise.all(
    targets.map(async ({ name, url }) => {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const body = await response.text();
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${errorMessageFromBody(null, body, '').slice(0, 120)}`);
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('svg') || !body.includes('<svg')) {
          throw new Error(`not an SVG response (content-type: ${contentType || 'none'})`);
        }
        fetched.push({ name, body });
      } catch (error) {
        failures.push({ name, url, error: error.message });
      }
    }),
  );

  // Write only after at least one fetch succeeded, so a down cloud does not
  // leave an empty output directory behind.
  const written = new Set();
  if (fetched.length) {
    mkdirSync(outDir, { recursive: true });
    for (const { name, body } of fetched) {
      writeFileSync(join(outDir, name), body, { mode: 0o644 });
      written.add(name);
    }
  }

  console.log(`${OK} exported ${written.size}/${targets.length} SVG file(s) to ${shortPath(outDir)}`);
  for (const failure of failures) {
    console.error(`${BAD} ${failure.name}: ${failure.error}`);
  }
  if (failures.length) process.exitCode = 1;
  if (!written.size) return;

  const relativePath = (name) => toPosixPath(relative(ROOT, join(outDir, name)));
  const lines = [];
  for (const metric of EXPORT_BADGE_METRICS) {
    if (written.has(`${metric}.svg`)) lines.push(`![${metric}](${relativePath(`${metric}.svg`)})`);
  }
  for (const type of EXPORT_CHART_TYPES) {
    if (written.has(`chart-${type}.svg`)) {
      lines.push(`![${type} chart](${relativePath(`chart-${type}.svg`)})`);
    }
  }
  if (written.has('card.svg')) lines.push(`![profile card](${relativePath('card.svg')})`);

  console.log(`\n${bold('Markdown snippet (repo-relative paths — works on github.com)')}\n`);
  console.log('```markdown');
  console.log(lines.join('\n'));
  console.log('```');
  console.log(
    `\n${dim(
      'Commit the exported SVGs so GitHub can serve them; re-run this command after sync to refresh ' +
        'the numbers, or deploy the cloud publicly and use live URLs instead.',
    )}`,
  );
}

// ---------------------------------------------------------------------------
// Cloudflare Workers helpers (wrangler with sandbox-safe state dirs)
// ---------------------------------------------------------------------------

function wranglerEnv() {
  mkdirSync(WRANGLER_XDG_CONFIG, { recursive: true });
  mkdirSync(WRANGLER_XDG_CACHE, { recursive: true });
  return {
    XDG_CONFIG_HOME: WRANGLER_XDG_CONFIG,
    XDG_CACHE_HOME: WRANGLER_XDG_CACHE,
  };
}

/** Returns the wrangler version string, or null when it is not installed. */
function wranglerVersion() {
  const result = spawnSync('wrangler', ['--version'], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, ...wranglerEnv() },
  });
  if (result.error || result.status !== 0) return null;
  const match = /(\d+\.\d+\.\d+)/.exec(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  return match ? match[1] : 'unknown';
}

function ensureWrangler() {
  const version = wranglerVersion();
  if (!version) {
    die(
      `wrangler (Cloudflare Workers CLI) is not available on PATH.\n` +
        `  Install: npm install -g wrangler@4\n` +
        `  Docs:    apps/cloud/DEPLOY-CLOUDFLARE.md`,
    );
  }
  return version;
}

/** Run wrangler from apps/cloud with repo-local XDG dirs (no writes to $HOME). */
function wrangler(args, { stdio = 'inherit', timeoutMs = 180_000 } = {}) {
  return spawnSync('wrangler', args, {
    cwd: CLOUD_APP_DIR,
    env: { ...process.env, ...wranglerEnv() },
    encoding: 'utf8',
    stdio,
    timeout: timeoutMs,
  });
}

function ensureWorkerApp() {
  if (!existsSync(CLOUD_WORKER_ENTRY) || !existsSync(join(CLOUD_APP_DIR, 'wrangler.toml'))) {
    die(
      `the Cloudflare Worker app is missing.\n` +
        `  Expected: apps/cloud/src/worker.ts + apps/cloud/wrangler.toml\n` +
        `  Node runtime alternative: tokenisland cloud start`,
    );
  }
}

async function portReachable(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

function failureDetail(result) {
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const line = text.split('\n').filter((candidate) => candidate.trim().length > 0).slice(-1)[0] ?? '';
  return line.slice(0, 200);
}

// ---------------------------------------------------------------------------
// island DMG helpers
// ---------------------------------------------------------------------------

function findIslandDmg() {
  const version = installedVersion('package.json') ?? FALLBACK_VERSION;
  const exact = join(ISLAND_BUILD_DIR, `TokenIsland-${version}.dmg`);
  if (existsSync(exact)) return exact;
  try {
    const candidates = readdirSync(ISLAND_BUILD_DIR)
      .filter((name) => /^TokenIsland-.*\.dmg$/.test(name))
      .sort()
      .reverse();
    if (candidates.length > 0) return join(ISLAND_BUILD_DIR, candidates[0]);
  } catch {
    /* build dir missing */
  }
  return null;
}

function formatMb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function cmdIslandDmg() {
  const dmg = findIslandDmg();
  if (!dmg) {
    die(
      `no DMG found in ${shortPath(ISLAND_BUILD_DIR)}.\n` +
        `  Build it:   bash apps/island-macos/scripts/package-dmg.sh\n` +
        `  (or:        pnpm island:build, then package-dmg.sh)`,
    );
  }
  let size = '';
  try {
    size = ` (${formatMb(statSync(dmg).size)})`;
  } catch {
    /* ignore */
  }
  console.log(`${OK} Token Island DMG: ${shortPath(dmg)}${size}`);
  const verify = spawnSync('hdiutil', ['verify', dmg], {
    encoding: 'utf8',
    timeout: 120_000,
    stdio: 'pipe',
  });
  if (verify.status === 0) {
    console.log(`${OK} hdiutil verify: VALID`);
  } else {
    warn(`hdiutil verify failed${failureDetail(verify) ? `: ${failureDetail(verify)}` : ''}`);
  }
  console.log(`\n${bold('Install from the DMG')}`);
  console.log(`  1. open ${shortPath(dmg)}`);
  console.log('  2. drag Token Island.app into /Applications');
  console.log('  3. launch it from /Applications — the island appears at the top of the screen;');
  console.log('     the menu-bar pixel icon gives Show/Hide, Preferences…, About, Quit (no Dock icon)');
  console.log('\nThe app bundle is ad-hoc signed (no notarization): if macOS blocks the first launch,');
  console.log('right-click → Open, or build locally with `pnpm island:build`.');
  console.log(`\n${dim('CLI alternative (installs widget + collector LaunchAgents, no sudo):')} tokenisland install`);
  console.log(`${dim('Docs: docs/CONTRACT-V2.md §1.4 · app: apps/island-macos/')}`);
}

// ---------------------------------------------------------------------------
// cloud command
// ---------------------------------------------------------------------------

function parseNodeCloudArgs(args) {
  const options = {
    port: process.env.PORT || String(DEFAULT_CLOUD_PORT),
    db: process.env.TOKEN_ISLAND_CLOUD_DB || '',
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--port') {
      const value = Number.parseInt(args[i + 1] ?? '', 10);
      if (!Number.isFinite(value) || value <= 0) die('--port requires a positive integer');
      options.port = String(value);
      i += 1;
    } else if (arg === '--db') {
      const value = args[i + 1];
      if (!value) die('--db requires a file path');
      options.db = resolve(process.cwd(), value);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      return null;
    } else {
      die(`unknown option "${arg}" for cloud (see: tokenisland help cloud)`);
    }
  }
  return options;
}

function parseWorkerArgs(args, mode) {
  const options = {
    port: DEFAULT_WORKER_PORT,
    persist: WORKER_PERSIST_DIR,
    skipMigrate: false,
    remote: false,
    dryRun: false,
    outdir: WORKER_DIST_DIR,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--port' && mode === 'dev') {
      const value = Number.parseInt(args[i + 1] ?? '', 10);
      if (!Number.isFinite(value) || value <= 0) die('--port requires a positive integer');
      options.port = value;
      i += 1;
    } else if (arg === '--persist-to') {
      const value = args[i + 1];
      if (!value) die('--persist-to requires a directory');
      options.persist = resolve(process.cwd(), value);
      i += 1;
    } else if (arg === '--skip-migrate' && mode === 'dev') {
      options.skipMigrate = true;
    } else if (arg === '--remote' && mode === 'migrate') {
      options.remote = true;
    } else if (arg === '--dry-run' && mode === 'deploy') {
      options.dryRun = true;
    } else if (arg === '--outdir' && mode === 'deploy') {
      const value = args[i + 1];
      if (!value) die('--outdir requires a directory');
      options.outdir = resolve(process.cwd(), value);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      return null;
    } else {
      die(`unknown option "${arg}" for cloud ${mode} (see: tokenisland help cloud)`);
    }
  }
  return options;
}

function cloudMigrateArgs(options) {
  return [
    'd1',
    'migrations',
    'apply',
    'token-island-cloud',
    options.remote ? '--remote' : '--local',
    '--persist-to',
    options.persist,
  ];
}

async function cmdCloudMigrate(args) {
  const options = parseWorkerArgs(args, 'migrate');
  if (!options) {
    printHelp('cloud');
    return;
  }
  const version = ensureWrangler();
  ensureWorkerApp();
  const target = options.remote ? 'remote D1' : `local D1 (${shortPath(options.persist)})`;
  note(`wrangler ${version} · applying migrations to ${target}`);
  const result = wrangler(cloudMigrateArgs(options), { stdio: 'inherit', timeoutMs: 240_000 });
  if (result.status !== 0) {
    die(`D1 migration failed${failureDetail(result) ? `: ${failureDetail(result)}` : ''}`);
  }
  console.log(`${OK} D1 migrations applied (${options.remote ? 'remote' : 'local'})`);
}

async function cmdCloudDev(args) {
  const options = parseWorkerArgs(args, 'dev');
  if (!options) {
    printHelp('cloud');
    return;
  }
  const version = ensureWrangler();
  ensureWorkerApp();
  if (await portReachable(options.port)) {
    die(
      `port ${options.port} is already serving something — stop it or use --port <n>.\n` +
        `  (The real demo services on :47117/:47118 are never touched.)`,
    );
  }
  if (!options.skipMigrate) {
    note(`wrangler ${version} · applying local D1 migrations (${shortPath(options.persist)})`);
    const migrate = wrangler(cloudMigrateArgs(options), { stdio: 'inherit', timeoutMs: 240_000 });
    if (migrate.status !== 0) {
      die(
        `local D1 migration failed${failureDetail(migrate) ? `: ${failureDetail(migrate)}` : ''}\n` +
          `  Fix wrangler/D1, or re-run with --skip-migrate if the schema already exists.`,
      );
    }
  }
  const url = `http://127.0.0.1:${options.port}`;
  note(`Cloudflare Worker (wrangler dev) · ${bold(url)}`);
  console.log(
    `  seed demo data: ${yellow(
      `node --import tsx apps/cloud/scripts/seed-worker.ts --url ${url}`,
    )}`,
  );
  console.log(`  Local D1 state: ${shortPath(options.persist)} ${dim('(repo-local, sandbox-safe)')}`);
  console.log('  Cloudflare deploy: tokenisland cloud deploy --dry-run · real deploy: tokenisland cloud deploy');
  process.exitCode = await runBinary(
    'wrangler',
    ['dev', '--port', String(options.port), '--persist-to', options.persist],
    { cwd: CLOUD_APP_DIR, env: wranglerEnv() },
  );
}

async function cmdCloudDeploy(args) {
  const options = parseWorkerArgs(args, 'deploy');
  if (!options) {
    printHelp('cloud');
    return;
  }
  const version = ensureWrangler();
  ensureWorkerApp();
  note(`wrangler ${version} · ${options.dryRun ? 'bundling Worker (dry run)' : 'deploying Worker to Cloudflare'}`);
  if (options.dryRun) {
    const result = wrangler(['deploy', '--dry-run', '--outdir', options.outdir], {
      stdio: 'inherit',
      timeoutMs: 240_000,
    });
    if (result.status !== 0) die(`Worker bundle failed${failureDetail(result) ? `: ${failureDetail(result)}` : ''}`);
    console.log(`${OK} Worker bundle + bindings OK ${dim(shortPath(options.outdir))}`);
    return;
  }

  const whoami = wrangler(['whoami'], { stdio: 'pipe', timeoutMs: 20_000 });
  if (whoami.error || whoami.status !== 0) {
    die(
      `not logged in to Cloudflare.\n` +
        `  Run:  wrangler login\n` +
        `  or:   export CLOUDFLARE_API_TOKEN=<token with Workers Scripts:Edit + D1:Edit>\n` +
        `  Then: tokenisland cloud deploy\n` +
        `  Bundle check without auth: tokenisland cloud deploy --dry-run`,
    );
  }
  const result = wrangler(['deploy'], { stdio: 'inherit', timeoutMs: 300_000 });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return;
  }
  console.log(`${OK} Worker deployed — finish the production setup:`);
  console.log('  1. wrangler d1 migrations apply token-island-cloud --remote');
  console.log('  2. wrangler secret put TOKEN_ISLAND_ADMIN_TOKEN');
  console.log(
    '  3. node --import tsx apps/cloud/scripts/seed-worker.ts --url https://<worker-url>',
  );
  console.log('  4. tokenisland register --cloud https://<worker-url> --username <name>');
  console.log(`\n${dim('Docs: apps/cloud/DEPLOY-CLOUDFLARE.md')}`);
}

async function cmdCloud(args) {
  const subcommand = args[0];
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp('cloud');
    return;
  }

  if (subcommand === 'start' || subcommand === 'seed') {
    const options = parseNodeCloudArgs(args.slice(1));
    if (!options) {
      printHelp('cloud');
      return;
    }
    ensureTsx();
    if (subcommand === 'start') {
      ensureEntry(
        CLOUD_ENTRY,
        'Cloud app (Node + SQLite runtime)',
        'Expected apps/cloud/src/node.ts (V2 renamed index.ts → node.ts).',
      );
      const env = { PORT: String(options.port) };
      if (options.db) env.TOKEN_ISLAND_CLOUD_DB = options.db;
      note(
        `cloud (Node + SQLite) ${dim(`http://127.0.0.1:${options.port}/`)} · db ${
          options.db || dim('(default ./data/cloud.db)')
        }`,
      );
      process.exitCode = await runNodeEntry(CLOUD_ENTRY, [], env);
      return;
    }
    ensureEntry(
      CLOUD_SEED_ENTRY,
      'Cloud seed script',
      'Expected apps/cloud/src/seed.ts (Node + SQLite runtime).',
    );
    const env = {};
    if (options.db) env.TOKEN_ISLAND_CLOUD_DB = options.db;
    note(`cloud seed · db ${options.db || dim('(default ./data/cloud.db)')}`);
    process.exitCode = await runNodeEntry(CLOUD_SEED_ENTRY, [], env);
    return;
  }

  if (subcommand === 'migrate') {
    await cmdCloudMigrate(args.slice(1));
    return;
  }
  if (subcommand === 'dev') {
    await cmdCloudDev(args.slice(1));
    return;
  }
  if (subcommand === 'deploy') {
    await cmdCloudDeploy(args.slice(1));
    return;
  }

  die(`unknown cloud subcommand "${subcommand}" (expected start | seed | migrate | dev | deploy)`);
}

function uid() {
  try {
    return process.getuid ? process.getuid() : 0;
  } catch {
    return 0;
  }
}

async function cmdIsland(args) {
  if (maybeHelp(args, 'island')) return;
  if (args.includes('--dmg')) {
    cmdIslandDmg();
    return;
  }
  const snapshotMode = args.includes('--snapshot') || args.includes('--snapshot-all');
  const demoMode = args.includes('--demo');

  if (!existsSync(ISLAND_BIN)) {
    die(
      `the macOS widget is not built yet.\n` +
        `  Missing: ${shortPath(ISLAND_BIN)}\n` +
        `  Build it first: pnpm island:build    (or: bash apps/island-macos/scripts/build-app.sh)`,
    );
  }

  if (snapshotMode) {
    note(`rendering snapshot(s) with ${shortPath(ISLAND_BIN)}`);
    // cwd = repo root so repo-relative output paths behave as documented.
    const code = await runBinary(ISLAND_BIN, args, { cwd: ROOT });
    process.exitCode = code;
    return;
  }

  const launchArgs = demoMode ? ['--demo'] : [];

  // Bare launch: prefer the installed LaunchAgent so we restart exactly one
  // instance with the same login-item semantics; fall back to a detached spawn
  // when the widget has not been installed.
  if (existsSync(LAUNCH_AGENT_PLIST)) {
    const service = `gui/${uid()}/com.token-island.app`;
    const kickstart = spawnSync('launchctl', ['kickstart', '-k', service], {
      encoding: 'utf8',
      timeout: 5000,
    });
    if (kickstart.status === 0) {
      console.log(`${OK} Token Island restarted via LaunchAgent ${dim('(com.token-island.app)')}`);
      return;
    }
    spawnSync('launchctl', ['load', '-w', LAUNCH_AGENT_PLIST], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const retry = spawnSync('launchctl', ['kickstart', '-k', service], {
      encoding: 'utf8',
      timeout: 5000,
    });
    if (retry.status === 0) {
      console.log(`${OK} Token Island loaded via LaunchAgent ${dim('(com.token-island.app)')}`);
      return;
    }
    warn(
      `could not kickstart the LaunchAgent (${(kickstart.stderr || kickstart.error || 'unknown error').trim()}); ` +
        `falling back to a direct launch`,
    );
  }

  const child = spawn(ISLAND_BIN, launchArgs, { detached: true, stdio: 'ignore' });
  child.once('error', (error) => die(`failed to launch the widget: ${error.message}`));
  child.unref();
  console.log(`${OK} Token Island launched (pid ${child.pid}) from ${shortPath(ISLAND_BIN)}`);
  note('auto-start at login: tokenisland install · DMG install: tokenisland island --dmg');
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function collectorAgentPlistPath() {
  return join(homedir(), `Library/LaunchAgents/${COLLECTOR_AGENT_LABEL}.plist`);
}

/**
 * LaunchAgent for the collector daemon: starts at login and is restarted by
 * launchd if it exits (KeepAlive). Paths are absolute so launchd's minimal
 * environment does not matter; PATH is still provided for zstd/other tools.
 */
function collectorAgentPlist() {
  const args = [NODE, '--import', 'tsx', COLLECTOR_ENTRY, 'collect'];
  const env = [
    '    <key>PATH</key>',
    '    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>',
    '    <key>NODE_OPTIONS</key>',
    '    <string>--no-warnings</string>',
  ];
  // Only pin a custom state dir when the user explicitly chose one; production
  // default remains ~/.token-island.
  if (process.env.TOKEN_ISLAND_HOME) {
    env.push('    <key>TOKEN_ISLAND_HOME</key>', `    <string>${xmlEscape(process.env.TOKEN_ISLAND_HOME)}</string>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${COLLECTOR_AGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args.map((arg) => `        <string>${xmlEscape(arg)}</string>`).join('\n')}
    </array>
    <key>WorkingDirectory</key>
    <string>${xmlEscape(ROOT)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>LimitLoadToSessionType</key>
    <string>Aqua</string>
    <key>ProcessType</key>
    <string>Background</string>
    <key>ThrottleInterval</key>
    <integer>10</integer>
    <key>EnvironmentVariables</key>
    <dict>
${env.join('\n')}
    </dict>
    <key>StandardOutPath</key>
    <string>${xmlEscape(COLLECTOR_LOG_FILE)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(COLLECTOR_LOG_FILE)}</string>
</dict>
</plist>
`;
}

function launchctl(args) {
  return spawnSync('launchctl', args, { encoding: 'utf8', timeout: 5000 });
}

function unloadLaunchAgent(plistPath, label) {
  launchctl(['unload', '-w', plistPath]);
  launchctl(['bootout', `gui/${uid()}/${label}`]);
}

function loadLaunchAgent(plistPath) {
  const load = launchctl(['load', '-w', plistPath]);
  if (load.status === 0) return { ok: true, method: 'load' };
  const bootstrap = launchctl(['bootstrap', `gui/${uid()}`, plistPath]);
  if (bootstrap.status === 0) return { ok: true, method: 'bootstrap' };
  const error = (load.stderr || bootstrap.stderr || load.error || bootstrap.error || '').trim();
  return { ok: false, method: '', error: error.split('\n').filter(Boolean).slice(-1)[0] ?? '' };
}

function writeCollectorAgent(plistPath) {
  const content = collectorAgentPlist();
  mkdirSync(COLLECTOR_LOG_DIR, { recursive: true });
  mkdirSync(dirname(plistPath), { recursive: true });
  const temp = `${plistPath}.${process.pid}.tmp`;
  writeFileSync(temp, content, { mode: 0o644 });
  renameSync(temp, plistPath);
  try {
    chmodSync(plistPath, 0o644);
  } catch {
    /* best effort */
  }
  return content;
}

async function cmdInstall(args, mode) {
  if (maybeHelp(args, mode)) return;
  const dryRun = args.includes('--dry-run');
  const script = mode === 'install' ? ISLAND_INSTALL : ISLAND_UNINSTALL;
  const label = mode === 'install' ? 'install' : 'uninstall';
  if (!existsSync(script)) {
    die(
      `${label} script is missing: ${shortPath(script)}\n` +
        `  Make sure you are running from a full token-island repository checkout.`,
    );
  }
  const agentPlist = collectorAgentPlistPath();

  if (mode === 'uninstall') {
    note(`uninstalling Token Island (widget + collector LaunchAgent) ${dim('(no sudo needed)')}`);
    if (dryRun) {
      console.log(`${dim('--dry-run: nothing will be written or unloaded')}`);
      console.log(`  widget     bash ${shortPath(script)}`);
      console.log(`  collector  unload + remove ${shortPath(agentPlist)}`);
      return;
    }
    const widgetCode = await runBinary('bash', [script]);
    unloadLaunchAgent(agentPlist, COLLECTOR_AGENT_LABEL);
    let removed = false;
    if (existsSync(agentPlist)) {
      try {
        unlinkSync(agentPlist);
        removed = true;
      } catch (error) {
        warn(`could not remove ${shortPath(agentPlist)}: ${error.message}`);
      }
    }
    console.log(
      `${OK} collector LaunchAgent ${removed ? 'removed' : 'not installed'} ${dim(`(${shortPath(agentPlist)})`)}`,
    );
    console.log(dim('local data in ~/.token-island was kept (delete it manually to erase usage history)'));
    process.exitCode = widgetCode;
    return;
  }

  note(`installing Token Island (widget + bundled collector supervision) ${dim('(no sudo needed)')}`);
  const collectorOnly = args.includes('--collector-only');
  if (dryRun) {
    console.log(`${dim('--dry-run: nothing will be written or loaded')}`);
    if (!collectorOnly) {
      console.log(`  widget     bash ${shortPath(script)}`);
      console.log(`             → ~/Applications/TokenIsland.app + LaunchAgent ${WIDGET_AGENT_LABEL}`);
      console.log(`  collector  supervised by TokenIsland.app (Resources/collector.mjs)`);
    } else {
      const plist = collectorAgentPlist();
      console.log(`  collector  ${shortPath(agentPlist)} (RunAtLoad, KeepAlive)`);
      console.log(dim(plist.split('\n').map((line) => `  │ ${line}`).join('\n')));
    }
    return;
  }

  if (!collectorOnly) {
    unloadLaunchAgent(agentPlist, COLLECTOR_AGENT_LABEL);
    if (existsSync(agentPlist)) {
      try {
        unlinkSync(agentPlist);
      } catch {
        /* best effort */
      }
    }
    const widgetCode = await runBinary('bash', [script]);
    console.log(`${OK} Token Island installed ${dim(`(${WIDGET_AGENT_LABEL}, bundled collector supervised)`)}`);
    console.log(`  state  ${shortPath(stateHome())} ${dim('(TOKEN_ISLAND_HOME)')}`);
    process.exitCode = widgetCode;
    return;
  }

  writeCollectorAgent(agentPlist);
  unloadLaunchAgent(agentPlist, COLLECTOR_AGENT_LABEL);
  const loaded = loadLaunchAgent(agentPlist);
  if (loaded.ok) {
    console.log(`${OK} collector LaunchAgent loaded ${dim(`(${COLLECTOR_AGENT_LABEL}, ${loaded.method})`)}`);
  } else {
    warn(
      `collector LaunchAgent written to ${shortPath(agentPlist)} but launchctl could not load it` +
        (loaded.error ? ` (${loaded.error})` : '') +
        ' — it will start at next login',
    );
  }
  console.log(`  plist  ${shortPath(agentPlist)}`);
  console.log(`  log    ${shortPath(COLLECTOR_LOG_FILE)}`);
  console.log(`  state  ${shortPath(stateHome())} ${dim('(TOKEN_ISLAND_HOME)')}`);
  process.exitCode = loaded.ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

function installedVersion(relativePath) {
  try {
    return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

function sourceRoots(config) {
  const overrides =
    config.paths && typeof config.paths === 'object' && !Array.isArray(config.paths) ? config.paths : {};
  return Object.entries(DEFAULT_SOURCE_PATHS).map(([source, fallback]) => {
    let resolved = expandHome(typeof overrides[source] === 'string' ? overrides[source] : fallback);
    if (source === 'antigravity' && typeof overrides[source] !== 'string' && !existsSync(resolved)) {
      for (const alt of ['~/.gemini/antigravity-cli', '~/.gemini/antigravity-ide', '~/.config/antigravity']) {
        const candidate = expandHome(alt);
        if (existsSync(candidate)) {
          resolved = candidate;
          break;
        }
      }
    }
    return {
      source,
      path: resolved,
      defaultPath: fallback,
    };
  });
}

async function doctorCollector() {
  const port = configPort();
  const url = `http://127.0.0.1:${port}/api/health`;
  try {
    const { response, body } = await fetchJson(url, { timeoutMs: 1200 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const version = body && body.version ? ` v${body.version}` : '';
    const events = body && Number.isFinite(body.events) ? `, ${body.events} events` : '';
    const demo = body && body.demo ? ', demo' : '';
    return { ok: true, detail: `${url}${version}${events}${demo}` };
  } catch (error) {
    return { ok: false, detail: `offline (${url})`, hint: 'tokenisland collect --foreground' };
  }
}

async function doctorCloud() {
  const cloudUrl = configCloudUrl().replace(/\/+$/, '');
  const url = `${cloudUrl}/healthz`;
  try {
    const { response, body } = await fetchJson(url, { timeoutMs: 1200 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const users = body && Number.isFinite(body.users) ? `, ${body.users} users` : '';
    return { ok: true, detail: `${url}${users}` };
  } catch {
    return { ok: false, detail: `offline (${url})`, hint: 'tokenisland cloud start' };
  }
}

function doctorIsland() {
  if (!existsSync(ISLAND_BIN)) {
    return {
      ok: false,
      detail: 'not built',
      hint: 'pnpm island:build (then: tokenisland install)',
    };
  }
  let size = '';
  try {
    size = ` (${Math.round(statSync(ISLAND_BIN).size / 1024 / 1024)} MB)`;
  } catch {
    /* ignore */
  }
  return { ok: true, detail: `${shortPath(ISLAND_BIN)}${size}` };
}

function doctorWrangler() {
  const version = wranglerVersion();
  if (!version) {
    return {
      ok: false,
      detail: 'not installed',
      hint: 'npm install -g wrangler@4 (needed for Cloudflare deploy/dev)',
    };
  }
  return { ok: true, detail: `wrangler v${version}` };
}

async function doctorWorkerPort() {
  const port = DEFAULT_WORKER_PORT;
  const busy = await portReachable(port);
  return {
    label: 'worker port',
    ok: !busy,
    neutral: true,
    detail: busy
      ? `:${port} in use (wrangler dev already running?) — 'cloud dev --port <n>' to change`
      : `:${port} free (tokenisland cloud dev)`,
    hint: '',
  };
}

function doctorAppAssets() {
  if (!existsSync(ISLAND_BIN)) {
    return { ok: false, detail: 'app not built', hint: 'pnpm island:build' };
  }
  const resources = join(ISLAND_APP, 'Contents/Resources');
  // The native app only renders Silkscreen; VT323 is used by the HTML pages
  // (served from apps/cloud/public/fonts, not bundled into the .app).
  const fonts = [
    'Silkscreen-Regular.ttf',
    'Silkscreen-Bold.ttf',
    'OFL-ofl-silkscreen.txt',
    'OFL-ofl-vt323.txt',
  ];
  const missing = [];
  if (!existsSync(join(resources, 'AppIcon.icns'))) missing.push('AppIcon.icns');
  for (const font of fonts) {
    if (!existsSync(join(resources, 'fonts', font))) missing.push(`fonts/${font}`);
  }
  if (missing.length === 0) {
    return { ok: true, detail: 'AppIcon.icns + Silkscreen fonts/OFL licenses bundled' };
  }
  return {
    ok: false,
    detail: `missing ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`,
    hint: 'pnpm island:build',
  };
}

function doctorDmg() {
  const dmg = findIslandDmg();
  if (!dmg) {
    return {
      ok: false,
      detail: 'not packaged',
      hint: 'bash apps/island-macos/scripts/package-dmg.sh',
    };
  }
  let size = '';
  try {
    size = ` (${formatMb(statSync(dmg).size)})`;
  } catch {
    /* ignore */
  }
  return { ok: true, detail: `${shortPath(dmg)}${size}` };
}

function doctorCodesign() {
  if (!existsSync(ISLAND_APP)) {
    return { ok: false, detail: 'app not built', hint: 'pnpm island:build' };
  }
  const result = spawnSync('codesign', ['--verify', '--deep', '--strict', ISLAND_APP], {
    encoding: 'utf8',
    timeout: 15_000,
    stdio: 'pipe',
  });
  if (result.status === 0) {
    return { ok: true, detail: 'ad-hoc signature valid (codesign --verify --deep --strict)' };
  }
  return {
    ok: false,
    detail: failureDetail(result) || 'codesign verify failed',
    hint: 'pnpm island:build',
  };
}

async function cmdDoctor(args) {
  if (maybeHelp(args, 'doctor')) return;

  const config = readConfig({ lenient: true });
  const hardFailures = [];

  const nodeOk = nodeVersionOk();
  if (!nodeOk) hardFailures.push('node version');

  const tsxVersion = installedVersion('node_modules/tsx/package.json');
  const typescriptVersion = installedVersion('node_modules/typescript/package.json');
  const coreLinked = existsSync(join(ROOT, 'node_modules/@token-island/core'));
  const depsOk = Boolean(tsxVersion && typescriptVersion);
  if (!depsOk) hardFailures.push('dependencies');

  const rows = [];
  rows.push({
    label: 'node',
    ok: nodeOk,
    detail: `v${process.versions.node} (requires >= ${MIN_NODE.major}.${MIN_NODE.minor})`,
    hint: nodeOk ? '' : 'install Node.js 22.5+ (nvm/fnm/brew) and re-run',
  });
  rows.push({
    label: 'install',
    ok: depsOk && coreLinked,
    detail: depsOk
      ? `tsx ${tsxVersion}, typescript ${typescriptVersion}${coreLinked ? ', core linked' : ', @token-island/core missing'}`
      : 'dev dependencies missing',
    hint: depsOk ? (coreLinked ? '' : 'pnpm install') : 'run pnpm install in ' + shortPath(ROOT),
  });

  const collectorApp = existsSync(COLLECTOR_ENTRY);
  rows.push({
    label: 'collector app',
    ok: collectorApp,
    detail: collectorApp ? shortPath(COLLECTOR_ENTRY) : 'missing apps/collector/src/index.ts',
    hint: collectorApp ? '' : 'check out the full repository (apps/collector)',
  });
  const cloudApp =
    existsSync(CLOUD_ENTRY) && existsSync(CLOUD_WORKER_ENTRY) && existsSync(CLOUD_SEED_ENTRY);
  rows.push({
    label: 'cloud app',
    ok: cloudApp,
    detail: cloudApp
      ? `${shortPath(CLOUD_ENTRY)} + worker.ts (Cloudflare)`
      : 'missing apps/cloud/src/{node,worker,seed}.ts',
    hint: cloudApp ? '' : 'check out the full repository (apps/cloud)',
  });

  const [collector, cloud] = await Promise.all([doctorCollector(), doctorCloud()]);
  rows.push({ label: 'collector', ...collector });
  rows.push({ label: 'cloud', ...cloud });
  rows.push({ label: 'wrangler', ...doctorWrangler() });
  rows.push(await doctorWorkerPort());
  rows.push({ label: 'island', ...doctorIsland() });
  rows.push({ label: 'app assets', ...doctorAppAssets() });
  rows.push({ label: 'dmg', ...doctorDmg() });
  rows.push({ label: 'codesign', ...doctorCodesign() });

  const configFile = configPath();
  const configExists = existsSync(configFile);
  rows.push({
    label: 'config',
    ok: configExists,
    neutral: !configExists,
    detail: configExists ? shortPath(configFile) : `not created yet (using defaults) — ${shortPath(configFile)}`,
    hint: '',
  });

  // Data sources are informational: missing sources are fine (the tool works
  // for users who only use one agent), a present-but-unreadable path is a warning.
  const sources = sourceRoots(config);
  const sourceRows = sources.map(({ source, path, defaultPath }) => {
    let present = false;
    try {
      present = existsSync(path);
    } catch {
      present = false;
    }
    return {
      label: source,
      ok: present,
      neutral: !present,
      detail: present ? shortPath(path) : `not found (${defaultPath})`,
      hint: '',
    };
  });

  const width = Math.max(...[...rows, ...sourceRows].map((row) => row.label.length));
  const line = (row) => {
    const symbol = row.neutral ? INFO : row.ok ? OK : BAD;
    const detail = row.ok || row.neutral ? dim(row.detail) : row.detail;
    const hint = row.ok || !row.hint ? '' : `  ${yellow('→')} ${row.hint}`;
    console.log(`  ${symbol} ${row.label.padEnd(width)}  ${detail}${hint}`);
  };

  console.log(bold('\nToken Island doctor'));
  console.log(dim(`  repo   ${ROOT}`));
  console.log(dim(`  state  ${stateHome()}\n`));
  for (const row of rows) line(row);

  console.log(bold('\n  Agent data sources'));
  for (const row of sourceRows) line(row);

  const warnings = [...rows, ...sourceRows].filter((row) => !row.ok && !row.neutral).length;
  const okCount = [...rows, ...sourceRows].filter((row) => row.ok).length;
  console.log(
    `\n  ${okCount} ok · ${warnings} warning${warnings === 1 ? '' : 's'}` +
      (hardFailures.length ? ` · ${red(`${hardFailures.length} failure(s)`)}` : ''),
  );

  if (hardFailures.length) {
    console.log(`\n${BAD} fix the ${hardFailures.join(' + ')} issue(s) above before using tokenisland.`);
    process.exitCode = 1;
    return;
  }
  if (warnings) {
    note('warnings do not block the CLI; the hints above show how to fix them.');
  }
  if (!sources.some(({ path }) => existsSync(path))) {
    warn(
      'no agent data sources were found — run your agent(s) once, or set paths in ' +
        shortPath(configFile),
    );
  }
}

// ---------------------------------------------------------------------------
// version
// ---------------------------------------------------------------------------

function cmdVersion() {
  const version = installedVersion('package.json') ?? FALLBACK_VERSION;
  console.log(version);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const args = argv.slice(1);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp(args[0]);
    return;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    cmdVersion();
    return;
  }

  switch (command) {
    case 'collect':
      await cmdCollect(args);
      return;
    case 'sync':
      await cmdSync(args);
      return;
    case 'status':
      await cmdStatus(args);
      return;
    case 'login':
      await cmdLogin(args);
      return;
    case 'register':
      await cmdRegister(args);
      return;
    case 'export':
      await cmdExport(args);
      return;
    case 'cloud':
      await cmdCloud(args);
      return;
    case 'island':
      await cmdIsland(args);
      return;
    case 'install':
      await cmdInstall(args, 'install');
      return;
    case 'uninstall':
      await cmdInstall(args, 'uninstall');
      return;
    case 'doctor':
      await cmdDoctor(args);
      return;
    default:
      console.error(`${BAD} unknown command "${command}"\n`);
      printHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  die(error && error.message ? error.message : String(error));
});
