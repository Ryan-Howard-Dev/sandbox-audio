#!/usr/bin/env node
/**
 * Mirrors F-Droid fdroiddata prebuild steps (metadata/fdroid/metadata.yml).
 * Run from repo root before a local Gradle release build or fdroid build verification.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('[fdroid:prebuild] npm ci');
run('npm', ['ci']);

console.log('[fdroid:prebuild] npm run build:client');
run('npm', ['run', 'build:client']);

console.log('[fdroid:prebuild] npx cap sync android');
run('npx', ['cap', 'sync', 'android']);

console.log('[fdroid:prebuild] done — run Gradle from android/ (assembleRelease) or fdroid build from fdroiddata');
