/**
 * Generates Tauri desktop launcher icons from icon-desktop.svg (SANDBOX gradient + orange S).
 * Web favicon and Android launcher icons use public/icon.svg separately.
 * Requires @tauri-apps/cli (devDependency).
 */
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = path.join(root, 'public', 'icon-desktop.svg');

const result = spawnSync('npx', ['tauri', 'icon', svg], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) {
  console.error('Failed to generate Tauri icons. Run: npx tauri icon public/icon-desktop.svg');
  process.exit(result.status ?? 1);
}
