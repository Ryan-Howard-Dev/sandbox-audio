#!/usr/bin/env node
/**
 * Cross-platform wrapper for beets-watch-sync (Windows-friendly npm script entry).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shScript = path.join(root, 'scripts', 'beets-watch-sync.sh');

const bash = process.platform === 'win32' ? 'bash' : 'sh';
const result = spawnSync(bash, [shScript], {
  stdio: 'inherit',
  env: process.env,
  cwd: root,
});

process.exit(result.status ?? 1);
