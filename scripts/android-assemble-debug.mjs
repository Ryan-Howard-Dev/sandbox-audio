import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const isWin = process.platform === 'win32';
const gradlew = isWin ? '.\\gradlew.bat' : './gradlew';

const result = spawnSync(gradlew, ['assembleDebug'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: isWin,
});

/*
 * Report a failed *spawn* rather than exiting silently. With stdio:'inherit' a spawn error
 * prints nothing at all, so `gradlew` missing its executable bit surfaced as exit 1 in ~170ms
 * with an empty log — which is how every CI emulator job failed without saying why.
 */
if (result.error) {
  console.error(`[android-assemble-debug] could not run ${gradlew}: ${result.error.message}`);
  if (result.error.code === 'EACCES') {
    console.error(
      '[android-assemble-debug] android/gradlew is not executable. ' +
        'Fix permanently with: git update-index --chmod=+x android/gradlew',
    );
  }
  process.exit(1);
}

process.exit(result.status ?? 1);
