#!/usr/bin/env node
/**
 * Build-time locker fixture for Android playback E2E (not committed).
 * 12s sine mono low-bitrate AAC/m4a with fixed metadata for seed-locker-fixture.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'e2e-fixtures');
const outFile = join(outDir, 'locker-tone.m4a');
function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  return result.status ?? 1;
}

function hasFfmpeg() {
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return probe.status === 0;
}

if (!hasFfmpeg()) {
  console.error(
    '[generate-android-e2e-fixture] ffmpeg not found — install ffmpeg before SANDBOX_ANDROID_E2E builds',
  );
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const args = [
  '-y',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=12',
  '-ac',
  '1',
  '-ar',
  '22050',
  '-c:a',
  'aac',
  '-b:a',
  '32k',
  '-metadata',
  'artist=Sandbox E2E',
  '-metadata',
  'title=Locker Tone',
  '-metadata',
  'album=Sandbox E2E Fixtures',
  outFile,
];

const status = run('ffmpeg', args);
if (status !== 0) {
  console.error('[generate-android-e2e-fixture] ffmpeg failed');
  process.exit(status);
}

if (!existsSync(outFile)) {
  console.error(`[generate-android-e2e-fixture] expected output missing: ${outFile}`);
  process.exit(1);
}

console.log(`[generate-android-e2e-fixture] wrote ${outFile}`);
