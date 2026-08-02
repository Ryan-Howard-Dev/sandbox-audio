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
/*
 * Which distribution to package. gplay is the signed build published directly; foss is the
 * one F-Droid compiles, without Google Cast. Both produce per-ABI APKs, in directories and
 * under filenames that carry the flavour name.
 */
const flavour = process.argv.includes('--flavour')
  ? process.argv[process.argv.indexOf('--flavour') + 1]
  : 'gplay';
if (flavour !== 'gplay' && flavour !== 'foss') {
  console.error(`[android-package] unknown flavour: ${flavour}`);
  process.exit(1);
}

const apkDir = join(root, 'android', 'app', 'build', 'outputs', 'apk', flavour, 'release');
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

/*
 * GITHUB_REF_NAME is only a version on tag builds. On pull_request events it is
 * "<PR-number>/merge", and that slash turned the output filename into a nested path whose
 * parent does not exist — the job died with ENOENT copying to
 * "release-android/sandbox-music-1/merge-arm64-v8a.apk". Accept the ref only when it actually
 * looks like a version, and sanitise whatever we end up with so a filename can never contain
 * a path separator.
 */
const refName = process.env.GITHUB_REF_NAME?.replace(/^v/i, '').trim();
const refIsVersion = Boolean(refName && /^\d+(\.\d+)*([-+][\w.]+)?$/.test(refName));
const rawVersion = process.env.RELEASE_VERSION?.trim() || (refIsVersion ? refName : pkgVersion);
const tagVersion = rawVersion.replace(/[^\w.+-]/g, '-');

mkdirSync(outDir, { recursive: true });

const sums = [];
for (const apk of apks.sort()) {
  const abiMatch = apk.match(new RegExp(`^app-${flavour}-(.+?)-release(?:-unsigned)?\.apk$`));
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
