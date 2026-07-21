#!/usr/bin/env node
/**
 * Download portable Node.js LTS (win-x64) for bundled Sandbox Server sidecar.
 * Writes src-tauri/resources/node/node.exe (~30MB) — included in NSIS/MSI resources.
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src-tauri', 'resources', 'node');
const outExe = join(outDir, 'node.exe');

/** Pin LTS — update when bumping desktop runtime. */
const NODE_VERSION = '22.16.0';
const NODE_DIST = `node-v${NODE_VERSION}-win-x64`;

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('[fetch-portable-node] Skipping — Windows-only bundle step');
    process.exit(0);
  }

  if (existsSync(outExe) && !process.argv.includes('--force')) {
    console.log(`[fetch-portable-node] Already present: ${outExe}`);
    process.exit(0);
  }

  mkdirSync(outDir, { recursive: true });
  const tmpDir = join(root, '.tmp-node-fetch');
  const archive = join(tmpDir, `${NODE_DIST}.zip`);
  mkdirSync(tmpDir, { recursive: true });

  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.zip`;
  console.log(`[fetch-portable-node] Downloading ${url}`);
  await download(url, archive);

  console.log('[fetch-portable-node] Extracting node.exe…');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // Use PowerShell Expand-Archive on Windows (tar in Node may lack zip on older builds).
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${tmpDir.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'inherit' },
  );

  const extractedExe = join(tmpDir, NODE_DIST, 'node.exe');
  if (!existsSync(extractedExe)) {
    throw new Error(`node.exe not found after extract: ${extractedExe}`);
  }

  const data = readFileSync(extractedExe);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outExe, data);

  rmSync(tmpDir, { recursive: true, force: true });
  console.log(`[fetch-portable-node] Wrote ${outExe} (${Math.round(data.length / 1024 / 1024)} MB)`);
}

main().catch((err) => {
  console.warn(`[fetch-portable-node] ${err instanceof Error ? err.message : err}`);
  console.warn('[fetch-portable-node] Desktop install will fall back to system Node on PATH.');
  process.exit(0);
});
