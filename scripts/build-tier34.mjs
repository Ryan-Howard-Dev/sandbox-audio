#!/usr/bin/env node
/**
 * Bundle tier34-server for packaged desktop — spawned via `node tier34-server.cjs`.
 */

import esbuild from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'dist', 'tier34-server.mjs');

await esbuild.build({
  entryPoints: [join(root, 'tier34-server', 'index.ts')],
  outfile,
  platform: 'node',
  format: 'esm',
  bundle: true,
  sourcemap: true,
  logLevel: 'info',
  external: ['bufferutil', 'utf-8-validate', 'fsevents'],
});

console.log(`[build:tier34] Wrote ${outfile}`);
