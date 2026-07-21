import crypto from 'node:crypto';

export function stableHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function qmHash(title: string, artist: string): string {
  const h = stableHash(`${title}::${artist}`).slice(0, 46);
  return `Qm${h}`;
}

/** Shannon entropy of byte buffer, normalized 0–1 */
export function spectralEntropyFromBuffer(buf: Buffer): number {
  if (buf.length === 0) return 0;
  const freq = new Map<number, number>();
  for (const b of buf) {
    freq.set(b, (freq.get(b) ?? 0) + 1);
  }
  let entropy = 0;
  const len = buf.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return Math.min(1, entropy / 8);
}

export function acousticFingerprint(
  title: string,
  artist: string,
  durationSeconds = 0,
): string {
  const norm = `${title}|${artist}|${Math.round(durationSeconds)}`
    .toLowerCase()
    .replace(/\s+/g, '');
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 20);
}

export function sonicDnaVector(
  title: string,
  artist: string,
  genre = '',
  durationSeconds = 0,
): number[] {
  const seed = stableHash(`${title}:${artist}:${genre}:${Math.round(durationSeconds)}`);
  const nums = [];
  for (let i = 0; i < 8; i++) {
    nums.push(parseInt(seed.slice(i * 4, i * 4 + 4), 16) / 0xffff);
  }
  if (durationSeconds > 0) {
    const tempoHint = Math.max(0, Math.min(1, ((durationSeconds % 120) + 40) / 200));
    nums[1] = (nums[1]! * 0.65 + tempoHint * 0.35);
  }
  return nums;
}

export async function fetchAudioSample(url: string, maxBytes = 65536): Promise<Buffer> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Range: `bytes=0-${maxBytes - 1}`, 'User-Agent': 'SandboxTier34/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab.slice(0, maxBytes));
  } finally {
    clearTimeout(t);
  }
}
