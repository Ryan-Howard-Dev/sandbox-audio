#!/usr/bin/env node
/**
 * Build the neural speech engine from source, and fetch the voice it speaks with.
 *
 * The platform speech engine sounds like a machine reading a phone number. Piper sounds like a
 * person and runs on the phone, but it is a native library, a Kotlin binding and a 60 MB voice,
 * none of which belongs in git.
 *
 * F-Droid builds from source and rejects prebuilt binaries, so downloading sherpa-onnx's release
 * AAR would forfeit a listing. This clones it at a pinned tag and compiles it with the NDK
 * instead, which keeps that door open and keeps a hundred megabytes of unreviewable binaries out
 * of the repository.
 *
 * Everything is pinned. An unpinned clone would mean two builds of the same tag producing
 * different APKs, which is the opposite of what a reproducible build is for.
 *
 * The voice comes from sherpa-onnx's own packaging rather than from Piper directly. Piper ships
 * only the model and its config; sherpa additionally needs tokens.txt and the espeak-ng phoneme
 * data, and its archives carry all three. Fetching the raw Piper files produces a model that
 * loads and then cannot pronounce anything.
 *
 * Run before a Gradle build:  npm run build:piper
 * Skips its own work when the outputs are present, so it is cheap to leave in a chain.
 */
import { spawnSync } from 'node:child_process';
import { createWriteStream, cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Pinned. Moving these is a deliberate act with a changelog entry, not a build-time surprise. */
const SHERPA_REPO = 'https://github.com/k2-fsa/sherpa-onnx.git';
const SHERPA_TAG = 'v1.13.4';

/**
 * A low, unhurried British voice, which is what long-form reading wants.
 *
 * From sherpa's release rather than Piper's: this archive carries tokens.txt and espeak-ng-data
 * alongside the model, and the engine needs all three.
 */
const VOICE_ID = 'vits-piper-en_GB-alan-medium';
const VOICE_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${VOICE_ID}.tar.bz2`;

/*
 * arm64 only, on purpose. Every Android phone shipped in years is arm64, and building four ABIs
 * quadruples the build time and the APK for architectures nobody reading a book is holding.
 */
const ABI = 'arm64-v8a';

const workDir = join(root, '.sherpa-build');
const jniLibsDir = join(root, 'android', 'app', 'src', 'main', 'jniLibs', ABI);
const assetsDir = join(root, 'android', 'app', 'src', 'main', 'assets', VOICE_ID);
/** Their Kotlin binding compiles as part of this app; the package path has to match. */
const kotlinDir = join(
  root, 'android', 'app', 'src', 'main', 'java', 'com', 'k2fsa', 'sherpa', 'onnx',
);

function run(cmd, args, cwd) {
  console.log(`[piper] ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, {
    cwd: cwd ?? root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if ((result.status ?? 1) !== 0) {
    console.error(`[piper] failed: ${cmd} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

async function download(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`[piper] already have ${dest}`);
    return;
  }
  console.log(`[piper] fetching ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    console.error(`[piper] download failed (${response.status}) ${url}`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}

function ndkPath() {
  // F-Droid sets ANDROID_NDK_HOME; local machines usually set ANDROID_NDK or have it under the SDK.
  const explicit = [process.env.ANDROID_NDK_HOME, process.env.ANDROID_NDK, process.env.NDK_HOME]
    .filter(Boolean)
    .find((candidate) => existsSync(candidate));
  if (explicit) return explicit;
  const sdk = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
  if (!sdk) return null;
  const ndkRoot = join(sdk, 'ndk');
  if (!existsSync(ndkRoot)) return null;
  // Highest installed version, so a machine with several needs no configuring.
  const versions = readdirSync(ndkRoot).sort();
  return versions.length > 0 ? join(ndkRoot, versions[versions.length - 1]) : null;
}

function haveEngine() {
  return existsSync(join(jniLibsDir, 'libsherpa-onnx-jni.so'));
}

function haveVoice() {
  return (
    existsSync(join(assetsDir, `${VOICE_ID.replace('vits-piper-', '')}.onnx`)) ||
    existsSync(join(assetsDir, 'tokens.txt'))
  );
}

function buildEngine() {
  const ndk = ndkPath();
  if (!ndk) {
    console.error('[piper] no NDK found. Set ANDROID_NDK_HOME, or install one via the SDK manager.');
    process.exit(1);
  }
  console.log(`[piper] using NDK at ${ndk}`);

  if (!existsSync(workDir)) {
    // Shallow, single tag: the full history is about a gigabyte and none of it is needed here.
    run('git', ['clone', '--depth', '1', '--branch', SHERPA_TAG, SHERPA_REPO, workDir]);
  }

  run('sh', ['./build-android-arm64-v8a.sh'], workDir);

  const outDir = join(workDir, `build-android-${ABI}`, 'install', 'lib');
  if (!existsSync(outDir)) {
    console.error(`[piper] build produced nothing at ${outDir}`);
    process.exit(1);
  }
  mkdirSync(jniLibsDir, { recursive: true });
  for (const file of readdirSync(outDir)) {
    if (file.endsWith('.so')) {
      cpSync(join(outDir, file), join(jniLibsDir, file));
      console.log(`[piper] installed ${file}`);
    }
  }

  /*
   * Their Kotlin binding, compiled as part of this app rather than pulled in as a library.
   * It is a thin wrapper over the JNI, and building it here keeps the whole engine traceable to
   * one pinned commit.
   */
  const kotlinSrc = join(workDir, 'sherpa-onnx', 'kotlin-api');
  if (!existsSync(kotlinSrc)) {
    console.error(`[piper] kotlin binding missing at ${kotlinSrc}`);
    process.exit(1);
  }
  mkdirSync(kotlinDir, { recursive: true });
  cpSync(kotlinSrc, kotlinDir, { recursive: true });
  console.log('[piper] installed kotlin binding');
}

async function fetchVoice() {
  const archive = join(workDir, `${VOICE_ID}.tar.bz2`);
  await download(VOICE_URL, archive);
  mkdirSync(dirname(assetsDir), { recursive: true });
  // tar is present on Linux, macOS and Windows 10 or later, so no archive dependency is needed.
  run('tar', ['-xjf', archive, '-C', dirname(assetsDir)]);
  if (!haveVoice()) {
    console.error(`[piper] archive extracted but ${assetsDir} has no voice in it`);
    process.exit(1);
  }
  console.log('[piper] installed voice');
}

async function main() {
  if (haveEngine() && haveVoice()) {
    console.log('[piper] engine and voice already present — nothing to do');
    return;
  }
  mkdirSync(workDir, { recursive: true });
  if (!haveEngine()) buildEngine();
  if (!haveVoice()) await fetchVoice();
  console.log('[piper] done');
}

main().catch((error) => {
  console.error('[piper]', error);
  process.exit(1);
});

export { SHERPA_TAG, VOICE_ID, copyFile, ndkPath };
