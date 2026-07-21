/**
 * Stem separation manifest — maps track ids to locker blob hashes per stem.
 */

import fs from 'node:fs';
import path from 'node:path';
import { LOCKER_STORAGE_ROOT } from './lockerPaths.js';

const MANIFEST_PATH = path.join(LOCKER_STORAGE_ROOT, 'stems-manifest.json');

export type StemKind = 'vocals' | 'drums' | 'bass' | 'other';

export type StemEntry = {
  trackId: string;
  sourceHash: string;
  stems: Partial<Record<StemKind, string>>;
  analyzedAt: number;
  title?: string;
  artist?: string;
};

export type StemsManifest = {
  updatedAt: number;
  entries: Record<string, StemEntry>;
};

const EMPTY: StemsManifest = { updatedAt: 0, entries: {} };

function ensureRoot(): void {
  fs.mkdirSync(LOCKER_STORAGE_ROOT, { recursive: true });
}

export function loadStemsManifest(): StemsManifest {
  ensureRoot();
  if (!fs.existsSync(MANIFEST_PATH)) return { ...EMPTY, entries: {} };
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StemsManifest;
    return {
      updatedAt: parsed.updatedAt ?? 0,
      entries: parsed.entries ?? {},
    };
  } catch {
    return { ...EMPTY, entries: {} };
  }
}

export function saveStemsManifest(manifest: StemsManifest): void {
  ensureRoot();
  manifest.updatedAt = Date.now();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

export function getStemEntry(trackId: string): StemEntry | null {
  const manifest = loadStemsManifest();
  return manifest.entries[trackId] ?? null;
}

export function upsertStemEntry(entry: StemEntry): StemEntry {
  const manifest = loadStemsManifest();
  manifest.entries[entry.trackId] = entry;
  saveStemsManifest(manifest);
  return entry;
}

export function stemUrlsForTrack(
  trackId: string,
  baseUrl: string,
): Partial<Record<StemKind, string>> | null {
  const entry = getStemEntry(trackId);
  if (!entry?.stems) return null;
  const root = baseUrl.replace(/\/$/, '');
  const out: Partial<Record<StemKind, string>> = {};
  for (const kind of ['vocals', 'drums', 'bass', 'other'] as StemKind[]) {
    const hash = entry.stems[kind];
    if (hash) out[kind] = `${root}/api/locker/blob/${hash}`;
  }
  return Object.keys(out).length > 0 ? out : null;
}
