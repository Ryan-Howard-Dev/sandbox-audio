import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const keystoreProps = join(androidDir, 'keystore.properties');
const isWin = process.platform === 'win32';
const gradlew = isWin ? 'gradlew.bat' : './gradlew';

if (!existsSync(keystoreProps)) {
  console.error(
    '[build:android:release] Missing android/keystore.properties\n' +
      '  Copy android/keystore.properties.example → android/keystore.properties\n' +
      '  Generate a keystore with keytool (see example file comments).',
  );
  process.exit(1);
}

const result = spawnSync(gradlew, ['assembleRelease'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWin,
});

process.exit(result.status ?? 1);
