#!/usr/bin/env node
/**
 * Bundles `@token-island/collector` + `@token-island/core` into a single
 * zero-dependency ESM file (`apps/island-macos/Resources/collector.mjs`)
 * so `TokenIsland.app` can launch and supervise the local collector server
 * even on standalone DMG installs with no repository checkout.
 */

import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootReq = createRequire(pathToFileURL(resolve(root, 'package.json')));
const tsxReq = createRequire(rootReq.resolve('tsx'));
const esbuild = tsxReq('esbuild');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = typeof pkg.version === 'string' ? pkg.version : '0.4.0';

const outIndex = process.argv.indexOf('--outfile');
const outfile =
  outIndex !== -1 && process.argv[outIndex + 1]
    ? resolve(process.cwd(), process.argv[outIndex + 1])
    : resolve(root, 'apps/island-macos/Resources/collector.mjs');

mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [resolve(root, 'apps/collector/src/index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  define: {
    __TOKEN_ISLAND_BUNDLED_VERSION__: JSON.stringify(version),
  },
});

chmodSync(outfile, 0o755);
console.log(`bundled collector v${version} -> ${outfile}`);
