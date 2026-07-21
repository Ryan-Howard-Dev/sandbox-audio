#!/usr/bin/env node
/**
 * Decode GitHub Actions secrets into android/keystore.properties + release.keystore.
 * Required env: ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[android-ci-keystore] Missing required env: ${name}`);
    console.error('  See docs/android-release.md for GitHub Actions secret setup.');
    process.exit(1);
  }
  return value;
}

const b64 = requireEnv('ANDROID_KEYSTORE_BASE64');
const storePassword = requireEnv('ANDROID_KEYSTORE_PASSWORD');
const keyAlias = requireEnv('ANDROID_KEY_ALIAS');
const keyPassword = requireEnv('ANDROID_KEY_PASSWORD');

let keystoreBytes;
try {
  keystoreBytes = Buffer.from(b64, 'base64');
} catch {
  console.error('[android-ci-keystore] ANDROID_KEYSTORE_BASE64 is not valid base64');
  process.exit(1);
}
if (keystoreBytes.length < 256) {
  console.error('[android-ci-keystore] Decoded keystore is too small — check ANDROID_KEYSTORE_BASE64');
  process.exit(1);
}

writeFileSync(join(androidDir, 'release.keystore'), keystoreBytes);
writeFileSync(
  join(androidDir, 'keystore.properties'),
  [
    'storeFile=release.keystore',
    `storePassword=${storePassword}`,
    `keyAlias=${keyAlias}`,
    `keyPassword=${keyPassword}`,
    '',
  ].join('\n'),
);

console.log('[android-ci-keystore] Wrote android/keystore.properties and release.keystore');
