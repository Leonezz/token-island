import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type LoadedConfig } from '../src/config.js';
import type { DiscoveredFile, SourceContext } from '../src/sources/types.js';

export const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

export function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

export function tempDir(prefix = 'ti-collector-test-'): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function cleanupDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function discoveredFile(filePath: string): DiscoveredFile {
  const stat = statSync(filePath);
  return { path: filePath, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) };
}

export function makeContext(timezone = 'UTC'): SourceContext {
  return { timezone, prices: [], now: Date.now() };
}

export interface TestHome {
  home: string;
  configPath: string;
  claudeDir: string;
  codexDir: string;
  opencodeDir: string;
  dshDir: string;
}

/** Creates a temp state dir with a config.json pointing all sources inside it. */
export function createTestHome(overrides: Record<string, unknown> = {}): TestHome {
  const home = tempDir();
  const claudeDir = path.join(home, 'claude');
  const codexDir = path.join(home, 'codex');
  const opencodeDir = path.join(home, 'opencode');
  const dshDir = path.join(home, 'dsh');
  const config = {
    timezone: 'UTC',
    backfillDays: 30,
    scanIntervalMs: 1_000,
    liveWindowMs: 600_000,
    paths: {
      claude: claudeDir,
      codex: codexDir,
      opencode: opencodeDir,
      dsh: dshDir,
    },
    ...overrides,
  };
  const configPath = path.join(home, 'config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { home, configPath, claudeDir, codexDir, opencodeDir, dshDir };
}

export function loadTestHomeConfig(home: string): LoadedConfig {
  return loadConfig({ env: { TOKEN_ISLAND_HOME: home }, homeDir: home });
}

/** Writes a Claude-style session file under `<claudeDir>/projects/<project>/<session>.jsonl`. */
export function writeClaudeSession(
  claudeDir: string,
  project: string,
  sessionFile: string,
  lines: string[],
): string {
  const dir = path.join(claudeDir, 'projects', project);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, sessionFile);
  writeFileSync(filePath, lines.join('\n') + '\n');
  return filePath;
}

export function assistantLine(messageId: string, inputTokens = 10, outputTokens = 5): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-11-20T10:00:05.000Z',
    sessionId: 'session-incremental-1',
    cwd: '/Users/fixture/projects/incremental-app',
    isSidechain: false,
    message: {
      id: messageId,
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
}
