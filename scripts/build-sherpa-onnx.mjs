#!/usr/bin/env node
/**
 * Build the neural speech engine from source, and fetch the voice it speaks with.
 *
 * The platform speech engine sounds like a machine reading a phone number. Piper sounds like a
 * person and runs on the phone, but it is a native library and a 63 MB voice file, neither of
 * which belongs in git.
 *
 * F-Droid builds from source and rejects prebuilt binaries, so downloading sherpa-onnx's release
 * AAR would forfeit an F-Droid listing. This clones it at a pinned tag and compiles it with the
 * NDK instead, which keeps that door open and keeps the repository free of a hundred megabytes of
 * binaries nobody can review.
 *
 * Everything is pinned. An unpinned clone would mean two builds of the same tag producing
 * different APKs, which is the opposite of what a reproducible build is for.
 *
 * Run before a Gradle build:  node scripts/build-sherpa-onnx.mjs
 * Skips its own work when the outputs are already present, so it is cheap to leave in a chain.
 */
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Pinned. Moving this is a deliberate act with a changelog entry, not a build-time surprise. */
const SHERPA_REPO = 'https://github.com/k2-fsa/sherpa-onnx.git';
const SHERPA_TAG = 'v1.13.4';

/*
 * A low, unhurried British voice, which is what long-form reading wants. Piper voices are
 * published under permissive terms; en_GB-alan is MIT, same as the runtime.
 */
const VOICE_ID = 'en_GB-alan-medium';
const VOICE_BASE =
  'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium';

/*
 * arm64 only, on purpose. Every Android phone shipped in the last several years is arm64, and
 * building four ABIs quadruples both the build time and the APK for architectures nobody reading a
 * book is holding.
 */
const ABI = 'arm64-v8a';

const workDir = join(root, '.sherpa-build');
const jniLibsDir = join(root, 'android', 'app', 'src', 'main', 'jniLibs', ABI);
const assetsDir = join(root, 'android', 'app', 'src', 'main', 'assets', 'piper');

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
  const candidates = [
    process.env.ANDROID_NDK_HOME,
    process.env.ANDROID_NDK,
    process.env.NDK_HOME,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  const sdk = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
  if (sdk) {
    const ndkRoot = join(sdk, 'ndk');
    if (existsSync(ndkRoot)) {
      // Highest installed version, so a machine with several does not need configuring.
      const versions = readdirSync(ndkRoot).sort();
      if (versions.length > 0) return join(ndkRoot, versions[versions.length - 1]);
    }
  }
  return null;
}

async function main() {
  const soName = 'libsherpa-onnx-jni.so';
  const builtSo = join(jniLibsDir, soName);
  const voiceModel = join(assetsDir, `${VOICE_ID}.onnx`);

  if (existsSync(builtSo) && existsSync(voiceModel)) {
    console.log('[piper] engine and voice already present — nothing to do');
    return;
  }

  if (!existsSync(builtSo)) {
    const ndk = ndkPath();
    if (!ndk) {
      console.error(
        '[piper] no NDK found. Set ANDROID_NDK_HOME, or install one via the SDK manager.',
      );
      process.exit(1);
    }
    console.log(`[piper] using NDK at ${ndk}`);

    if (!existsSync(workDir)) {
      // Shallow, single tag: the full history is ~1 GB and none of it is needed to compile.
      run('git', [
        'clone',
        '--depth',
        '1',
        '--branch',
        SHERPA_TAG,
        SHERPA_REPO,
        workDir,
      ]);
    }

    const script =
      process.platform === 'win32'
        ? join(workDir, 'build-android-arm64-v8a.sh')
        : './build-android-arm64-v8a.sh';
    run(process.platform === 'win32' ? 'bash' : 'sh', [script], workDir);

    const outDir = join(workDir, `build-android-${ABI}`, 'install', 'lib');
    if (!existsSync(outDir)) {
      console.error(`[piper] build produced nothing at ${outDir}`);
      process.exit(1);
    }
    mkdirSync(jniLibsDir, { recursive: true });
    for (const file of readdirSync(outDir)) {
      if (file.endsWith('.so')) {
        await copyFile(join(outDir, file), join(jniLibsDir, file));
        console.log(`[piper] installed ${file}`);
      }
    }
  }

  // The voice is data rather than code, so it is fetched rather than built. Pinned by path.
  await download(`${VOICE_BASE}/${VOICE_ID}.onnx`, voiceModel);
  await download(`${VOICE_BASE}/${VOICE_ID}.onnx.json`, `${voiceModel}.json`);

  console.log('[piper] done');
}

main().catch((error) => {
  console.error('[piper]', error);
  process.exit(1);
});

export { SHERPA_TAG, VOICE_ID, ndkPath, rmSync };
