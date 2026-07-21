#!/usr/bin/env node
/**
 * Enforce CI PWA precache size budgets after `vite build`.
 * Workbox writes JS object literals (not JSON) in dist/sw.js — stat dist files instead.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const swPath = join(dist, 'sw.js');

if (!existsSync(swPath)) {
  console.error('[pwa-precache] dist/sw.js not found — run npm run build:client first');
  process.exit(1);
}

const sw = readFileSync(swPath, 'utf8');
const match = sw.match(/precacheAndRoute\(\[(.*?)\],\{\}\)/s);
if (!match) {
  console.error('[pwa-precache] sw.js missing precacheAndRoute manifest');
  process.exit(1);
}

const urls = [...match[1].matchAll(/url:"([^"]+)"/g)].map((entry) => entry[1]);
if (urls.length === 0) {
  console.error('[pwa-precache] No precache URLs found in sw.js');
  process.exit(1);
}

let total = 0;
let max = 0;
const missing = [];

for (const url of urls) {
  const file = join(dist, url);
  if (!existsSync(file)) {
    missing.push(url);
    continue;
  }
  const size = statSync(file).size;
  total += size;
  max = Math.max(max, size);
}

if (missing.length > 0) {
  console.error(`[pwa-precache] Missing ${missing.length} precache file(s): ${missing.slice(0, 5).join(', ')}`);
  process.exit(1);
}

console.log(
  'PWA precache:',
  urls.length,
  'entries',
  (total / 1024 / 1024).toFixed(2),
  'MiB, max',
  (max / 1024).toFixed(0),
  'KiB',
);

const maxTotal = 3.5 * 1024 * 1024;
const maxChunk = 2.8 * 1024 * 1024;

if (total > maxTotal) {
  console.error('[pwa-precache] PWA precache exceeds 3.5 MiB budget');
  process.exit(1);
}

if (max > maxChunk) {
  console.error('[pwa-precache] Single precache chunk exceeds 2.8 MiB');
  process.exit(1);
}
