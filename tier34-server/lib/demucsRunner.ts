/**
 * Run Demucs stem separation — HTTP service, docker image, or local CLI.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
export type DemucsStemPaths = {
  vocals: string;
  drums: string;
  bass: string;
  other: string;
};

export class DemucsNotAvailableError extends Error {
  constructor(message = 'Demucs is not installed. Start the stems profile: docker compose --profile stems up') {
    super(message);
    this.name = 'DemucsNotAvailableError';
  }
}

function findStemOutputs(outputDir: string, modelDir: string): DemucsStemPaths | null {
  const modelRoot = path.join(outputDir, modelDir);
  if (!fs.existsSync(modelRoot)) {
    const children = fs.readdirSync(outputDir, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const child of children) {
      const candidate = findStemOutputs(outputDir, child.name);
      if (candidate) return candidate;
    }
    return null;
  }
  const trackDirs = fs.readdirSync(modelRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  const trackDir = trackDirs[0]?.name;
  if (!trackDir) return null;
  const base = path.join(modelRoot, trackDir);
  const pick = (name: string) => {
    const wav = path.join(base, `${name}.wav`);
    const mp3 = path.join(base, `${name}.mp3`);
    if (fs.existsSync(wav)) return wav;
    if (fs.existsSync(mp3)) return mp3;
    return null;
  };
  const vocals = pick('vocals');
  const drums = pick('drums');
  const bass = pick('bass');
  const other = pick('other');
  if (!vocals || !drums || !bass || !other) return null;
  return { vocals, drums, bass, other };
}

async function separateViaHttp(serviceUrl: string, inputPath: string, outputDir: string): Promise<DemucsStemPaths> {
  const res = await fetch(`${serviceUrl.replace(/\/$/, '')}/separate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputPath, outputDir }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Demucs service failed (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`);
  }
  const data = (await res.json()) as Partial<DemucsStemPaths>;
  if (!data.vocals || !data.drums || !data.bass || !data.other) {
    throw new Error('Demucs service returned incomplete stem paths');
  }
  return data as DemucsStemPaths;
}

function runCommand(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${cmd} exited ${code}`));
    });
  });
}

async function separateViaDocker(image: string, inputPath: string, outputDir: string): Promise<DemucsStemPaths> {
  const storageRoot = path.dirname(path.dirname(inputPath));
  const inRel = path.relative(storageRoot, inputPath).replace(/\\/g, '/');
  const outRel = path.relative(storageRoot, outputDir).replace(/\\/g, '/');
  const mount = process.platform === 'win32' ? storageRoot.replace(/\\/g, '/') : storageRoot;
  await runCommand('docker', [
    'run',
    '--rm',
    '-v',
    `${mount}:/data`,
    image,
    'python',
    '-m',
    'demucs',
    '-n',
    'htdemucs',
    '--out',
    `/data/${outRel}`,
    `/data/${inRel}`,
  ]);
  const stems = findStemOutputs(outputDir, 'htdemucs');
  if (!stems) throw new Error('Demucs docker run produced no stem files');
  return stems;
}

async function separateViaCli(inputPath: string, outputDir: string): Promise<DemucsStemPaths> {
  const cmd = process.env.DEMUCS_CMD?.trim() || 'python -m demucs';
  const parts = cmd.split(/\s+/);
  const bin = parts[0]!;
  const prefix = parts.slice(1);
  fs.mkdirSync(outputDir, { recursive: true });
  await runCommand(bin, [...prefix, '-n', 'htdemucs', '--out', outputDir, inputPath]);
  const stems = findStemOutputs(outputDir, 'htdemucs');
  if (!stems) throw new Error('Demucs CLI produced no stem files');
  return stems;
}

/** Probe whether any demucs backend is reachable (cached per process). */
let demucsProbe: Promise<boolean> | null = null;

export async function demucsAvailable(): Promise<boolean> {
  if (!demucsProbe) {
    demucsProbe = (async () => {
      const serviceUrl = process.env.DEMUCS_SERVICE_URL?.trim();
      if (serviceUrl) {
        try {
          const res = await fetch(`${serviceUrl.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3000) });
          return res.ok;
        } catch {
          return false;
        }
      }
      if (process.env.DEMUCS_DOCKER_IMAGE?.trim()) return true;
      if (process.env.DEMUCS_CMD?.trim()) return true;
      try {
        await runCommand('python', ['-m', 'demucs', '--help']);
        return true;
      } catch {
        return false;
      }
    })();
  }
  return demucsProbe;
}

export async function runDemucsSeparation(inputPath: string, outputDir: string): Promise<DemucsStemPaths> {
  if (!fs.existsSync(inputPath)) throw new Error(`Input audio not found: ${inputPath}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const serviceUrl = process.env.DEMUCS_SERVICE_URL?.trim();
  if (serviceUrl) {
    return separateViaHttp(serviceUrl, inputPath, outputDir);
  }

  const dockerImage = process.env.DEMUCS_DOCKER_IMAGE?.trim();
  if (dockerImage) {
    return separateViaDocker(dockerImage, inputPath, outputDir);
  }

  try {
    return await separateViaCli(inputPath, outputDir);
  } catch (err) {
    if (err instanceof DemucsNotAvailableError) throw err;
    throw new DemucsNotAvailableError(
      err instanceof Error ? err.message : 'Demucs separation failed — install demucs or start docker compose --profile stems up',
    );
  }
}
