#!/usr/bin/env node
/**
 * Build-time platform guard — uses filesystem / env, not runtime __TAURI__.
 *
 * Usage:
 *   node scripts/check-platform.mjs [web|android|tauri]
 *   SANDBOX_BUILD_TARGET=android node scripts/check-platform.mjs
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = (process.env.SANDBOX_BUILD_TARGET || process.argv[2] || 'web').trim().toLowerCase();

const PROJECT_CHECKS = {
  web: {
    label: 'Web / PWA',
    paths: ['package.json', 'vite.config.ts'],
  },
  android: {
    label: 'Capacitor Android',
    paths: ['android/app/build.gradle', 'capacitor.config.ts'],
  },
  tauri: {
    label: 'Tauri Desktop',
    paths: ['src-tauri/tauri.conf.json', 'src-tauri/Cargo.toml'],
  },
};

function fail(message) {
  console.error(`[check:platform] ${message}`);
  process.exit(1);
}

const spec = PROJECT_CHECKS[target];
if (!spec) {
  fail(`Unknown target "${target}" — expected web, android, or tauri`);
}

const missing = spec.paths.filter((rel) => !existsSync(join(root, rel)));
if (missing.length > 0) {
  fail(
    `${spec.label} build requires missing paths: ${missing.join(', ')}`,
  );
}

console.log(
  `[check:platform] SANDBOX_BUILD_TARGET=${target} (${spec.label}) — project layout OK`,
);
