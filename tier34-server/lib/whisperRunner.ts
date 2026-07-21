/**
 * Local Whisper transcription — openai-whisper CLI or python -m whisper (no third-party APIs).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type WhisperSegment = {
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type WhisperResult = {
  text: string;
  segments: WhisperSegment[];
  language?: string;
  model: string;
};

type WhisperInvocation = { cmd: string; prefixArgs: string[] };

let whisperChecked: boolean | null = null;
let whisperInvocation: WhisperInvocation | null = null;

function whisperInvocations(): WhisperInvocation[] {
  const envBin = process.env.WHISPER_BIN?.trim();
  if (envBin) {
    return [{ cmd: envBin, prefixArgs: [] }];
  }
  const model = whisperModel();
  return [
    { cmd: 'whisper', prefixArgs: [] },
    { cmd: 'python', prefixArgs: ['-m', 'whisper'] },
    { cmd: 'python3', prefixArgs: ['-m', 'whisper'] },
    { cmd: 'py', prefixArgs: ['-m', 'whisper'] },
  ].map((row) => ({ ...row, prefixArgs: [...row.prefixArgs] }));
}

export function whisperModel(): string {
  const raw = process.env.PODCAST_WHISPER_MODEL?.trim();
  return raw || 'base';
}

function runCommand(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`whisper timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export async function whisperAvailable(): Promise<boolean> {
  if (whisperChecked != null) return whisperChecked;
  for (const inv of whisperInvocations()) {
    try {
      const { code } = await runCommand(inv.cmd, [...inv.prefixArgs, '--help'], 8_000);
      if (code === 0) {
        whisperInvocation = inv;
        whisperChecked = true;
        return true;
      }
    } catch {
      /* try next */
    }
  }
  whisperChecked = false;
  return false;
}

export function parseWhisperJsonOutput(raw: string): WhisperResult | null {
  try {
    const parsed = JSON.parse(raw) as {
      text?: string;
      language?: string;
      segments?: Array<{ start?: number; end?: number; text?: string }>;
    };
    const segments: WhisperSegment[] = (parsed.segments ?? [])
      .map((seg) => ({
        startSeconds: typeof seg.start === 'number' ? seg.start : 0,
        endSeconds: typeof seg.end === 'number' ? seg.end : 0,
        text: String(seg.text ?? '').trim(),
      }))
      .filter((seg) => seg.text.length > 0);
    const text =
      String(parsed.text ?? '').trim() ||
      segments.map((s) => s.text).join(' ').trim();
    if (!text) return null;
    return {
      text,
      segments,
      language: parsed.language,
      model: whisperModel(),
    };
  } catch {
    return null;
  }
}

function findWhisperJsonFile(outputDir: string, baseName: string): string | null {
  const candidates = [
    path.join(outputDir, `${baseName}.json`),
    path.join(outputDir, `${baseName}.mp3.json`),
    path.join(outputDir, `${baseName}.m4a.json`),
    path.join(outputDir, `${baseName}.wav.json`),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return filePath;
  }
  const files = fs.readdirSync(outputDir).filter((f) => f.endsWith('.json'));
  return files[0] ? path.join(outputDir, files[0]) : null;
}

export async function transcribeAudioFile(audioPath: string): Promise<WhisperResult> {
  const ok = await whisperAvailable();
  if (!ok || !whisperInvocation) {
    throw new Error(
      'Whisper not installed. Install openai-whisper locally or set WHISPER_BIN — audio never leaves your Tier34 host.',
    );
  }

  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-whisper-'));
  const baseName = path.basename(audioPath, path.extname(audioPath));
  const model = whisperModel();
  const timeoutMs = whisperTimeoutMs();

  const args = [
    ...whisperInvocation.prefixArgs,
    audioPath,
    '--model',
    model,
    '--output_format',
    'json',
    '--output_dir',
    outputDir,
    '--verbose',
    'False',
  ];

  try {
    const { code, stderr } = await runCommand(whisperInvocation.cmd, args, timeoutMs);
    if (code !== 0) {
      throw new Error(stderr.trim() || `whisper exited ${code}`);
    }
    const jsonPath = findWhisperJsonFile(outputDir, baseName);
    if (!jsonPath) {
      throw new Error('whisper produced no JSON output');
    }
    const parsed = parseWhisperJsonOutput(fs.readFileSync(jsonPath, 'utf8'));
    if (!parsed) throw new Error('whisper JSON parse failed');
    return parsed;
  } finally {
    try {
      fs.rmSync(outputDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export function whisperTimeoutMs(): number {
  const raw = process.env.PODCAST_WHISPER_TIMEOUT_MS?.trim();
  const n = raw ? parseInt(raw, 10) : 3_600_000;
  return Number.isFinite(n) && n >= 60_000 ? n : 3_600_000;
}

export function whisperMaxEpisodeSeconds(): number {
  const raw = process.env.PODCAST_WHISPER_MAX_SECONDS?.trim();
  const n = raw ? parseInt(raw, 10) : 10_800;
  return Number.isFinite(n) && n > 0 ? n : 10_800;
}
