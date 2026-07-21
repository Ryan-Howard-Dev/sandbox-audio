#!/usr/bin/env node
/**
 * Run `tauri build` with CARGO_TARGET_DIR pinned to src-tauri/target.
 * Cursor sandbox (and other env overrides) may redirect cargo output to a
 * temp cache; an absolute project path keeps bundles under src-tauri/target/release/.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cargoTargetDir = join(root, 'src-tauri', 'target');
const releaseDir = join(cargoTargetDir, 'release');
const isWin = process.platform === 'win32';
const tauriBin = join(root, 'node_modules', '.bin', isWin ? 'tauri.cmd' : 'tauri');
const cargoBin = join(process.env.USERPROFILE ?? '', '.cargo', 'bin');

function readMainBinaryName() {
  const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  return conf.mainBinaryName ?? conf.productName ?? null;
}

function verifyWindowsDesktopArtifacts(mainBinaryName) {
  if (!isWin || !mainBinaryName) return true;

  const brandedExe = join(releaseDir, `${mainBinaryName}.exe`);
  const legacyExe = join(releaseDir, 'sovereign-music-console.exe');
  const nsisDir = join(releaseDir, 'bundle', 'nsis');
  const nsisSetup = existsSync(nsisDir)
    ? readdirSync(nsisDir).find((name) => name.endsWith('-setup.exe'))
    : null;
  const nsisSetupPath = nsisSetup ? join(nsisDir, nsisSetup) : null;
  const nsisScript = join(releaseDir, 'nsis', 'x64', 'installer.nsi');

  let ok = true;
  if (!existsSync(brandedExe)) {
    console.error(`[tauri:build] Missing release binary: ${brandedExe}`);
    ok = false;
  } else {
    console.log(`[tauri:build] Release binary OK: ${brandedExe}`);
  }

  if (existsSync(legacyExe)) {
    console.warn(`[tauri:build] Legacy cargo binary still present: ${legacyExe}`);
  }

  if (nsisSetupPath && existsSync(nsisSetupPath)) {
    console.log(`[tauri:build] NSIS setup OK: ${nsisSetupPath}`);
    if (existsSync(nsisScript)) {
      const scriptMtime = statSync(nsisScript).mtimeMs;
      const setupMtime = statSync(nsisSetupPath).mtimeMs;
      if (setupMtime < scriptMtime) {
        console.error(
          `[tauri:build] NSIS setup is older than installer.nsi — run npm run build:desktop to rebundle.`,
        );
        ok = false;
      }
    }
  }

  return ok;
}

console.log(`[tauri:build] CARGO_TARGET_DIR=${cargoTargetDir}`);

const pathSep = isWin ? ';' : ':';
const pathWithCargo =
  isWin && cargoBin && !process.env.PATH?.toLowerCase().includes('.cargo\\bin')
    ? `${cargoBin}${pathSep}${process.env.PATH ?? ''}`
    : process.env.PATH;

const result = spawnSync(tauriBin, ['build'], {
  cwd: root,
  stdio: 'inherit',
  shell: isWin,
  env: {
    ...process.env,
    PATH: pathWithCargo,
    CARGO_TARGET_DIR: cargoTargetDir,
  },
});

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

const mainBinaryName = readMainBinaryName();
if (!verifyWindowsDesktopArtifacts(mainBinaryName)) {
  process.exit(1);
}

process.exit(0);
