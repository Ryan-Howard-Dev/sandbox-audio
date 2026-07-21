#!/usr/bin/env node
/**
 * Copy per-ABI release APKs into release-android/ with versioned names + SHA256SUMS.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apkDir = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release');
const outDir = join(root, 'release-android');

if (!existsSync(apkDir)) {
  console.error(`[android-package] APK directory missing: ${apkDir}`);
  process.exit(1);
}

const apks = readdirSync(apkDir).filter((f) => f.endsWith('.apk'));
if (apks.length === 0) {
  console.error(`[android-package] No APK files in ${apkDir}`);
  process.exit(1);
}

const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const tagVersion =
  process.env.RELEASE_VERSION?.trim() ||
  process.env.GITHUB_REF_NAME?.replace(/^v/i, '') ||
  pkgVersion;

mkdirSync(outDir, { recursive: true });

const sums = [];
for (const apk of apks.sort()) {
  const abiMatch = apk.match(/^app-(.+?)-release(?:-unsigned)?\.apk$/);
  const abi = abiMatch?.[1] ?? apk.replace(/\.apk$/, '');
  const destName = `sandbox-music-${tagVersion}-${abi}.apk`;
  const srcPath = join(apkDir, apk);
  const destPath = join(outDir, destName);
  copyFileSync(srcPath, destPath);
  const hash = createHash('sha256').update(readFileSync(destPath)).digest('hex');
  sums.push(`${hash}  ${destName}`);
  const signed = !apk.includes('-unsigned');
  console.log(`[android-package] ${destName} (${signed ? 'signed' : 'unsigned'})`);
}

writeFileSync(join(outDir, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(`[android-package] ${apks.length} APK(s) → ${outDir}/`);
