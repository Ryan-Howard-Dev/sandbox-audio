import { spawn } from 'node:child_process';

const playlistUrl = process.argv[2] || 'https://tidal.com/browse/playlist/acf5354c-0b3d-472a-b94a-56a125b6cb1a';
const server = spawn('npx', ['tsx', 'server.ts'], {
  cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'),
  env: { ...process.env, PORT: '3099' },
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});

let ready = false;
const timer = setTimeout(() => {
  if (!ready) {
    server.kill();
    console.error('Server startup timeout');
    process.exit(1);
  }
}, 30000);

server.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  if (text.includes('Local:')) ready = true;
});

await new Promise((resolve) => {
  const interval = setInterval(() => {
    if (ready) {
      clearInterval(interval);
      resolve(undefined);
    }
  }, 200);
});

const res = await fetch(
  `http://localhost:3099/api/playlist-metadata?url=${encodeURIComponent(playlistUrl)}`,
);
const data = await res.json();
console.log(JSON.stringify(data, null, 2));

clearTimeout(timer);
server.kill();
