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
  renameSync,
  statSync,
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
const TSX_FLAGS = ['--import', 'tsx'];

const COLLECTOR_ENTRY = join(ROOT, 'apps/collector/src/index.ts');
const CLOUD_ENTRY = join(ROOT, 'apps/cloud/src/index.ts');
const CLOUD_SEED_ENTRY = join(ROOT, 'apps/cloud/src/seed.ts');
const ISLAND_APP = join(ROOT, 'apps/island-macos/build/TokenIsland.app');
const ISLAND_BIN = join(ISLAND_APP, 'Contents/MacOS/TokenIsland');
const ISLAND_INSTALL = join(ROOT, 'apps/island-macos/scripts/install.sh');
const ISLAND_UNINSTALL = join(ROOT, 'apps/island-macos/scripts/uninstall.sh');
const LAUNCH_AGENT_PLIST = join(homedir(), 'Library/LaunchAgents/com.token-island.app.plist');

const DEFAULT_COLLECTOR_PORT = 47118;
const DEMO_COLLECTOR_PORT = 47119;
const DEFAULT_CLOUD_PORT = 47117;
const DEFAULT_CLOUD_URL = `http://127.0.0.1:${DEFAULT_CLOUD_PORT}`;
const MIN_NODE = { major: 22, minor: 5 };

const DEFAULT_SOURCE_PATHS = {
  claude: '~/.claude/projects',
  codex: '~/.codex/sessions',
  opencode: '~/.local/share/opencode/opencode.db',
  dsh: '~/.dsh/sessions',
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
function runBinary(binary, args, { cwd = process.cwd() } = {}) {
  return new Promise((done) => {
    const child = spawn(binary, args, { cwd, stdio: 'inherit' });
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
  ${cyan('register')}    Register this machine with a Token Island cloud and store its API key
  ${cyan('export')}      Download your badge/chart/card SVGs for a static GitHub README
  ${cyan('cloud')}       Cloud service: ${dim('start')} (HTTP server) or ${dim('seed')} (demo data)
  ${cyan('island')}      Launch the macOS Dynamic Island widget, or render PNG snapshots
  ${cyan('install')}     Install the widget + login LaunchAgent (no sudo)
  ${cyan('uninstall')}   Remove the widget + LaunchAgent
  ${cyan('doctor')}      Diagnose the local installation (node, deps, services, data sources)
  ${cyan('help')}        Show this help (or ${dim('tokenisland help <command>')})

${bold('Examples')}
  tokenisland doctor
  tokenisland collect --foreground
  tokenisland collect --demo                  ${dim('# demo data on :47119, no user files touched')}
  tokenisland cloud start                     ${dim('# cloud on :47117, another terminal')}
  tokenisland cloud seed                      ${dim('# demo/alice users + example URLs')}
  tokenisland register --cloud http://127.0.0.1:47117 --username myname
  tokenisland export --user myname                 ${dim('# static SVGs in docs/badges/')}
  tokenisland island --snapshot docs/images/island-expanded.png --state expanded --scale 2
  tokenisland island --snapshot-all docs/images --scale 2

${bold('Environment')}
  TOKEN_ISLAND_HOME   state dir (default ~/.token-island; config.json, data.db)
  TOKEN_ISLAND_PORT   collector port override (default 47118; demo uses 47119)

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
${bold('tokenisland cloud')} <start|seed> [options]

  ${bold('start')} [--port N] [--db <path>]   run the cloud HTTP server (default port 47117)
  ${bold('seed')}  [--db <path>]              seed the demo + alice accounts (idempotent),
                                              print their API keys and example badge URLs

Container-friendly env: PORT, TOKEN_ISLAND_CLOUD_DB
(default ./data/cloud.db), TOKEN_ISLAND_ADMIN_TOKEN, TOKEN_ISLAND_ALLOW_REGISTER.
Deploy notes: apps/cloud/DEPLOY.md.
`.trim(),
  island: `
${bold('tokenisland island')} [--snapshot <out.png> [--state collapsed|expanded|offline]
                    [--fixture <summary.json>] [--scale 1|2] [--background wallpaper|transparent]]
                    | [--snapshot-all <dir> [--scale 2]] | [--demo]

With no arguments: launch the built macOS widget. When an installed LaunchAgent is
present it is kick-started (so the widget restarts cleanly); otherwise the bundled
binary is spawned detached. ${dim('tokenisland install')} installs the login item.

Snapshot mode renders PNGs with ImageRenderer and exits — no screen recording
permission needed. Files must live inside the workspace; pass an absolute or
repo-relative output path.

  --demo   launch the widget against bundled fixtures/summary.example.json
`.trim(),
  install: `
${bold('tokenisland install')}

Build prerequisite: ${dim('pnpm island:build')} (or bash apps/island-macos/scripts/build-app.sh).
Copies TokenIsland.app to ~/Applications, writes the LaunchAgent
com.token-island.app.plist (RunAtLoad) and loads it. No sudo required.
`.trim(),
  uninstall: `
${bold('tokenisland uninstall')}

Unloads/removes the LaunchAgent and deletes ~/Applications/TokenIsland.app.
Local data in ~/.token-island is kept on purpose.
`.trim(),
  doctor: `
${bold('tokenisland doctor')}

Prints a compact ✓/✗ table: node version, installed dependencies, collector/cloud
reachability, built island app, config file and discovered agent data sources.
Diagnostics (offline services, missing apps) are warnings; a broken node/deps setup
makes it exit 1.
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

function parseCloudArgs(args) {
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

async function cmdCloud(args) {
  const subcommand = args[0];
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    printHelp('cloud');
    return;
  }
  const options = parseCloudArgs(args.slice(1));
  if (!options) {
    printHelp('cloud');
    return;
  }
  ensureTsx();

  if (subcommand === 'start') {
    ensureEntry(CLOUD_ENTRY, 'Cloud app', 'Expected apps/cloud/src/index.ts (implemented in task-2).');
    const env = { PORT: String(options.port) };
    if (options.db) env.TOKEN_ISLAND_CLOUD_DB = options.db;
    note(`cloud ${dim(`http://127.0.0.1:${options.port}/`)} · db ${options.db || dim('(default ./data/cloud.db)')}`);
    process.exitCode = await runNodeEntry(CLOUD_ENTRY, [], env);
    return;
  }

  if (subcommand === 'seed') {
    ensureEntry(CLOUD_SEED_ENTRY, 'Cloud seed script', 'Expected apps/cloud/src/seed.ts (implemented in task-2).');
    const env = {};
    if (options.db) env.TOKEN_ISLAND_CLOUD_DB = options.db;
    note(`cloud seed · db ${options.db || dim('(default ./data/cloud.db)')}`);
    process.exitCode = await runNodeEntry(CLOUD_SEED_ENTRY, [], env);
    return;
  }

  die(`unknown cloud subcommand "${subcommand}" (expected start | seed)`);
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
  note('for auto-start at login: tokenisland install');
}

async function cmdInstall(args, mode) {
  if (maybeHelp(args, mode)) return;
  const script = mode === 'install' ? ISLAND_INSTALL : ISLAND_UNINSTALL;
  const label = mode === 'install' ? 'install' : 'uninstall';
  if (!existsSync(script)) {
    die(
      `${label} script is missing: ${shortPath(script)}\n` +
        `  Make sure you are running from a full token-island repository checkout.`,
    );
  }
  note(`${label === 'install' ? 'installing' : 'uninstalling'} the macOS widget ${dim('(no sudo needed)')}`);
  process.exitCode = await runBinary('bash', [script]);
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
  return Object.entries(DEFAULT_SOURCE_PATHS).map(([source, fallback]) => ({
    source,
    path: expandHome(typeof overrides[source] === 'string' ? overrides[source] : fallback),
    defaultPath: fallback,
  }));
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
  const cloudApp = existsSync(CLOUD_ENTRY) && existsSync(CLOUD_SEED_ENTRY);
  rows.push({
    label: 'cloud app',
    ok: cloudApp,
    detail: cloudApp ? shortPath(CLOUD_ENTRY) : 'missing apps/cloud/src/{index,seed}.ts',
    hint: cloudApp ? '' : 'check out the full repository (apps/cloud)',
  });

  const [collector, cloud] = await Promise.all([doctorCollector(), doctorCloud()]);
  rows.push({ label: 'collector', ...collector });
  rows.push({ label: 'cloud', ...cloud });
  rows.push({ label: 'island', ...doctorIsland() });

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
  const version = installedVersion('package.json') ?? '0.1.0';
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
