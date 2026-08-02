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
import { unzipSync } from 'fflate';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  createWriteStream,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
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
 * ONNX Runtime, which sherpa's build script fetches prebuilt rather than compiling.
 *
 * Worth being clear about, because it qualifies the claim that this builds from source: sherpa
 * itself does, its heaviest dependency does not. Fetched here rather than by their script so the
 * version is pinned in one place with everything else, and so the build does not need wget,
 * which Windows has no copy of.
 *
 * Their script honours SHERPA_ONNXRUNTIME_LIB_DIR, so a runtime built from source can be
 * supplied instead when that matters — which it will, for an F-Droid listing.
 */
const ONNXRUNTIME_VERSION = '1.27.0';
const ONNXRUNTIME_URL =
  `https://github.com/csukuangfj/onnxruntime-libs/releases/download/v${ONNXRUNTIME_VERSION}/onnxruntime-android-${ONNXRUNTIME_VERSION}.zip`;

/**
 * A low, unhurried British voice, which is what long-form reading wants.
 *
 * From sherpa's release rather than Piper's: this archive carries tokens.txt and espeak-ng-data
 * alongside the model, and the engine needs all three.
 */
const VOICE_ID = 'vits-piper-en_GB-alan-medium';
const VOICE_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${VOICE_ID}.tar.bz2`;

/** The architectures an Android APK split can target here. */
const KNOWN_ABIS = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];

/**
 * Which architecture to build the engine for, one per run.
 *
 * One at a time because compiling this is the slowest thing in the build, and doing four in a row
 * is how a CI job runs out of its allotted time. F-Droid builds each ABI in its own container with
 * its own budget, and passes the target in through this variable; locally it defaults to arm64,
 * which is what a phone from the last several years actually is.
 *
 * Worth knowing what the default costs: the voice model lives in assets and therefore ships in
 * every APK, but the engine that reads it does not. An armeabi-v7a or x86 build made with this
 * default carries the voice and cannot speak it, and narration quietly falls back to the
 * platform's own voice. Building each ABI is what fixes that, not shipping fewer of them.
 */
const ABI = (() => {
  const requested = (process.env.SANDBOX_PIPER_ABI ?? '').trim();
  if (!requested) return 'arm64-v8a';
  if (!KNOWN_ABIS.includes(requested)) {
    console.error(`[piper] unknown ABI "${requested}" — expected one of ${KNOWN_ABIS.join(', ')}`);
    process.exit(1);
  }
  return requested;
})();

/**
 * Languages whose pronunciation data is kept.
 *
 * espeak-ng ships a dictionary for all 113 languages it can speak, and the voice uses exactly
 * one of them. The Russian dictionary alone is 8.3 MB in an English-only app. Pruning the rest
 * takes espeak-ng-data from 18 MB to under 2 MB.
 *
 * Adding a voice in another language means adding its code here. Everything else in the
 * directory — phondata, phontab, intonations, lang and voices — is structural and stays
 * whatever languages are kept.
 */
const KEEP_DICTS = ['en'];

const workDir = join(root, '.sherpa-build');
const jniLibsDir = join(root, 'android', 'app', 'src', 'main', 'jniLibs', ABI);
const assetsDir = join(root, 'android', 'app', 'src', 'main', 'assets', VOICE_ID);
/** Their Kotlin binding compiles as part of this app; the package path has to match. */
const kotlinDir = join(
  root, 'android', 'app', 'src', 'main', 'java', 'com', 'k2fsa', 'sherpa', 'onnx',
);

function run(cmd, args, cwd, env) {
  console.log(`[piper] ${cmd} ${args.join(' ')}`);
  /*
   * Windows needs a shell for git and npm, which are batch files rather than executables. But a
   * shell splits an absolute path on its spaces, and the only bash on a Windows machine lives in
   * `C:\Program Files\Git`. Quoting the command keeps both cases working.
   */
  const useShell = process.platform === 'win32';
  const command = useShell && cmd.includes(' ') ? `"${cmd}"` : cmd;
  const result = spawnSync(command, args, {
    cwd: cwd ?? root,
    stdio: 'inherit',
    shell: useShell,
    env: env ? { ...process.env, ...env } : process.env,
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

/**
 * A shell that can run sherpa's build script.
 *
 * The script is bash, and Windows has none on PATH. Git ships one and git is already required
 * to clone the source, so it is always present wherever this can run at all. Falls back to plain
 * sh everywhere else, which is Linux and macOS, including F-Droid's builders.
 */
function shellPath() {
  if (process.platform !== 'win32') return 'sh';
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git', 'bin', 'bash.exe'),
    join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git', 'usr', 'bin', 'bash.exe'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;
  console.error('[piper] no bash found. Install Git for Windows, or build under WSL.');
  process.exit(1);
}
/** A Windows path in the form bash understands: C:\\x becomes /c/x. */
function posixPath(p) {
  if (process.platform !== 'win32') return p;
  const withSlashes = p.split('\\').join('/');
  const drive = withSlashes.match(/^([A-Za-z]):/);
  return drive
    ? `/${drive[1].toLowerCase()}${withSlashes.slice(2)}`
    : withSlashes;
}

/**
 * Put ONNX Runtime where sherpa's script expects it, so it skips its own download.
 *
 * Extracted with fflate, already a dependency here, rather than shelling out to unzip, which
 * Windows does not have either.
 */
async function ensureOnnxRuntime() {
  const buildDir = join(workDir, `build-android-${ABI}`, ONNXRUNTIME_VERSION);
  const marker = join(buildDir, 'jni', ABI, 'libonnxruntime.so');
  if (existsSync(marker)) {
    console.log('[piper] onnxruntime already in place');
    return;
  }
  const archive = join(workDir, `onnxruntime-android-${ONNXRUNTIME_VERSION}.zip`);
  await download(ONNXRUNTIME_URL, archive);
  console.log('[piper] extracting onnxruntime');
  const files = unzipSync(new Uint8Array(readFileSync(archive)));
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith('/') || bytes.length === 0) continue;
    const dest = join(buildDir, name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
  }
  if (!existsSync(marker)) {
    console.error(`[piper] onnxruntime extracted but ${marker} is missing`);
    process.exit(1);
  }
  console.log('[piper] onnxruntime ready');
}
/**
 * A `make` that is really ninja.
 *
 * Their script ends with `make -j4` and `make install/strip`. Windows has no make, and CMake
 * generated Ninja files because the Visual Studio generator cannot cross-compile for Android.
 * Ninja takes the same arguments and CMake gives it the same install/strip target, so a two
 * line shim on PATH bridges the two without patching their script, which would have to be
 * re-patched at every version bump.
 */
function makeShimDir() {
  const binDir = join(workDir, 'shim-bin');
  mkdirSync(binDir, { recursive: true });
  const shim = join(binDir, 'make');
  if (!existsSync(shim)) {
    writeFileSync(shim, '#!/bin/sh\nexec ninja "$@"\n', { mode: 0o755 });
  }
  return binDir;
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

async function buildEngine() {
  const ndk = ndkPath();
  if (!ndk) {
    console.error('[piper] no NDK found. Set ANDROID_NDK_HOME, or install one via the SDK manager.');
    process.exit(1);
  }
  console.log(`[piper] using NDK at ${ndk}`);

  /*
   * Test for the checkout, not the directory. main() creates workDir to hold the downloaded
   * archive, so an existsSync on the directory is always true by the time this runs and the
   * clone silently never happened.
   */
  if (!existsSync(join(workDir, '.git'))) {
    // Shallow, single tag: the full history is about a gigabyte and none of it is needed here.
    run('git', ['clone', '--depth', '1', '--branch', SHERPA_TAG, SHERPA_REPO, workDir]);
  }

  /*
   * Their script reads ANDROID_NDK, not the ANDROID_NDK_HOME that F-Droid and Android Studio
   * set, and it tests the path with a shell [ -d ] so a Windows path with backslashes fails
   * even when the directory is plainly there. Both spellings are supplied, POSIX-formed.
   */
  await ensureOnnxRuntime();

  run(shellPath(), ['./build-android-arm64-v8a.sh'], workDir, {
    ANDROID_NDK: posixPath(ndk),
    ANDROID_NDK_HOME: posixPath(ndk),
    /*
     * CMake picks Visual Studio by default on Windows, which cannot cross-compile for Android
     * and fails while probing for MSBuild targets. Ninja is what the Android toolchain expects
     * and what every other platform would have chosen anyway; the SDK's own cmake package ships
     * a copy, so nothing extra needs installing.
     */
    CMAKE_GENERATOR: 'Ninja',
    // The shim first, so their `make` calls reach ninja.
    PATH: `${posixPath(makeShimDir())}:${process.env.PATH ?? ''}`,
  });

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
  pruneLanguageData();
  console.log('[piper] installed voice');
}

/**
 * Delete the pronunciation data for languages this build cannot speak.
 *
 * Only *_dict files are language data. Removing anything else here breaks synthesis for every
 * language including the one being kept, so the filter is deliberately narrow.
 */
function pruneLanguageData() {
  const dataDir = join(assetsDir, 'espeak-ng-data');
  if (!existsSync(dataDir)) return;
  let removed = 0;
  let freedBytes = 0;
  for (const file of readdirSync(dataDir)) {
    if (!file.endsWith('_dict')) continue;
    const language = file.slice(0, -'_dict'.length);
    if (KEEP_DICTS.includes(language)) continue;
    const path = join(dataDir, file);
    freedBytes += statSync(path).size;
    rmSync(path);
    removed += 1;
  }
  const freedMb = (freedBytes / 1024 / 1024).toFixed(1);
  console.log(`[piper] pruned ${removed} language dictionaries, freeing ${freedMb} MB`);
}
async function main() {
  if (haveEngine() && haveVoice()) {
    console.log('[piper] engine and voice already present — nothing to do');
    return;
  }
  mkdirSync(workDir, { recursive: true });
  if (!haveEngine()) await buildEngine();
  if (!haveVoice()) await fetchVoice();
  console.log('[piper] done');
}

main().catch((error) => {
  console.error('[piper]', error);
  process.exit(1);
});

export { SHERPA_TAG, VOICE_ID, copyFile, ndkPath };
