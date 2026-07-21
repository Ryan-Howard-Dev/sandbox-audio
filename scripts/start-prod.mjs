import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = path.join(root, 'dist', 'server.cjs');

spawn(process.execPath, [server], {
  stdio: 'inherit',
  env: {...process.env, NODE_ENV: 'production'},
});
