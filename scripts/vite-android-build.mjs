#!/usr/bin/env node
/** Vite production build with SANDBOX_BUILD_TARGET=android. Set SANDBOX_ANDROID_E2E=true to embed the E2E bridge. */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, SANDBOX_BUILD_TARGET: 'android' };
const shell = process.platform === 'win32';

const lint = spawnSync('npm', ['run', 'lint'], { cwd: root, stdio: 'inherit', shell, env });
if (lint.status !== 0) process.exit(lint.status ?? 1);

const build = spawnSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit', shell, env });
process.exit(build.status ?? 1);
