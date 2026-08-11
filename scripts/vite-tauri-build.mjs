#!/usr/bin/env node
/**
 * Vite production build with SANDBOX_BUILD_TARGET=tauri.
 *
 * The target exists so the config can tell a packaged desktop build from a web one. The service
 * worker is the reason: a desktop app already carries its assets, and caching them meant a rebuilt
 * app kept serving the previous version's bundle.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('npx', ['vite', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, SANDBOX_BUILD_TARGET: 'tauri' },
});
process.exit(result.status ?? 1);
