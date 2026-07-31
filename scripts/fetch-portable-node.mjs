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

/**
 * Per-platform dist. This step used to bail on anything but Windows, so `resources/node/`
 * never existed on Linux or macOS while tauri.conf.json still declared it as a bundled
 * resource — the build then failed with `resource path 'resources/node' doesn't exist`.
 * That is R-007, and it made the Linux desktop build permanently red.
 */
function nodeDistFor(platform, arch) {
  if (platform === 'win32') return { dist: `node-v${NODE_VERSION}-win-x64`, ext: 'zip' };
  if (platform === 'darwin') {
    const a = arch === 'arm64' ? 'arm64' : 'x64';
    return { dist: `node-v${NODE_VERSION}-darwin-${a}`, ext: 'tar.gz' };
  }
  if (platform === 'linux') {
    const a = arch === 'arm64' ? 'arm64' : 'x64';
    return { dist: `node-v${NODE_VERSION}-linux-${a}`, ext: 'tar.xz' };
  }
  return null;
}

const NODE_DIST = `node-v${NODE_VERSION}-win-x64`;

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(res.body, createWriteStream(dest));
}

/** Unix: pull node out of the official tarball into resources/node/node. */
async function fetchUnixNode(target) {
  const outBin = join(outDir, 'node');
  if (existsSync(outBin) && !process.argv.includes('--force')) {
    console.log(`[fetch-portable-node] Already present: ${outBin}`);
    return;
  }
  const tmpDir = join(root, '.tmp-node-fetch');
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const archive = join(tmpDir, `${target.dist}.${target.ext}`);
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${target.dist}.${target.ext}`;
  console.log(`[fetch-portable-node] Downloading ${url}`);
  await download(url, archive);

  // tar handles both .tar.gz and .tar.xz on Linux and macOS.
  execFileSync('tar', ['-xf', archive, '-C', tmpDir], { stdio: 'inherit' });
  const extracted = join(tmpDir, target.dist, 'bin', 'node');
  if (!existsSync(extracted)) throw new Error(`node not found after extract: ${extracted}`);

  mkdirSync(outDir, { recursive: true });
  const { copyFileSync, chmodSync, statSync } = await import('node:fs');
  copyFileSync(extracted, outBin);
  chmodSync(outBin, 0o755);
  rmSync(tmpDir, { recursive: true, force: true });
  console.log(
    `[fetch-portable-node] Wrote ${outBin} (${Math.round(statSync(outBin).size / 1024 / 1024)} MB)`,
  );
}

async function main() {
  const target = nodeDistFor(process.platform, process.arch);
  if (!target) {
    // Still create the directory: tauri.conf.json declares it unconditionally, and a missing
    // path fails the bundle outright rather than degrading to system Node.
    mkdirSync(outDir, { recursive: true });
    console.log(`[fetch-portable-node] No dist for ${process.platform}/${process.arch}`);
    process.exit(0);
  }

  if (process.platform !== 'win32') {
    await fetchUnixNode(target);
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
  // The directory must exist even when the download fails: tauri.conf.json lists it as a
  // bundled resource, and an absent path aborts the whole build instead of degrading.
  try {
    mkdirSync(outDir, { recursive: true });
  } catch {
    /* best effort */
  }
  process.exit(0);
});
