/**
 * Camelot wheel — harmonic mixing keys (1A–12A minor, 1B–12B major).
 * Used for DJ-style transitions once sonic analysis provides a musical key.
 */

export type KeyMode = 'major' | 'minor';

export interface ParsedMusicalKey {
  root: number;
  mode: KeyMode;
  label: string;
}

const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Root index 0=C … 11=B → Camelot code for major/minor. */
const CAMELOT_BY_ROOT: Record<KeyMode, readonly string[]> = {
  major: ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'],
  minor: ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'],
};

const FLAT_ALIASES: Record<string, string> = {
  DB: 'C#',
  EB: 'D#',
  GB: 'F#',
  AB: 'G#',
  BB: 'A#',
  CB: 'B',
  FB: 'E',
};

function normalizeRootToken(raw: string): number | null {
  let token = raw.trim().toUpperCase().replace(/♯/g, '#').replace(/♭/g, 'B');
  if (token.length === 2 && token.endsWith('B') && token !== 'AB' && token !== 'BB' && token !== 'DB' && token !== 'EB' && token !== 'GB') {
    token = FLAT_ALIASES[token] ?? token;
  }
  if (token in FLAT_ALIASES) token = FLAT_ALIASES[token]!;
  const idx = ROOT_NAMES.indexOf(token as (typeof ROOT_NAMES)[number]);
  return idx >= 0 ? idx : null;
}

const CAMELOT_RE = /^(\d{1,2})([AB])$/i;

/** Parse "Am", "A minor", "8A", "F# Major", etc. */
export function parseMusicalKey(input: string | undefined | null): ParsedMusicalKey | null {
  const raw = input?.trim();
  if (!raw) return null;

  const camelotMatch = CAMELOT_RE.exec(raw);
  if (camelotMatch) {
    const num = parseInt(camelotMatch[1]!, 10);
    const letter = camelotMatch[2]!.toUpperCase();
    if (num >= 1 && num <= 12) {
      const mode: KeyMode = letter === 'A' ? 'minor' : 'major';
      const root = CAMELOT_BY_ROOT[mode].indexOf(`${num}${letter}`);
      if (root >= 0) {
        return { root, mode, label: formatMusicalKey(root, mode) };
      }
    }
  }

  const cleaned = raw.replace(/\s+/g, ' ').trim();

  let mode: KeyMode = 'major';
  let rootPart = cleaned;

  if (/\b(minor|min)\b/i.test(cleaned) || (/m$/i.test(cleaned) && cleaned.length > 1 && !/^\d/.test(cleaned))) {
    mode = 'minor';
    rootPart = cleaned.replace(/\s*(minor|min)\s*/i, ' ').replace(/m$/i, '').trim();
  } else if (/\b(major|maj)\b/i.test(cleaned)) {
    mode = 'major';
    rootPart = cleaned.replace(/\s*(major|maj)\s*/i, ' ').trim();
  } else if (/m$/i.test(cleaned) && cleaned.length > 1) {
    mode = 'minor';
    rootPart = cleaned.slice(0, -1).trim();
  }

  const root = normalizeRootToken(rootPart);
  if (root == null) return null;
  return { root, mode, label: formatMusicalKey(root, mode) };
}

export function formatMusicalKey(root: number, mode: KeyMode): string {
  const name = ROOT_NAMES[((root % 12) + 12) % 12]!;
  return mode === 'minor' ? `${name}m` : name;
}

export function toCamelot(key: ParsedMusicalKey | string | null | undefined): string | null {
  if (!key) return null;
  const parsed = typeof key === 'string' ? parseMusicalKey(key) : key;
  if (!parsed) return null;
  return CAMELOT_BY_ROOT[parsed.mode][parsed.root] ?? null;
}

export function parseCamelot(code: string | undefined | null): { number: number; mode: KeyMode } | null {
  const match = CAMELOT_RE.exec(code?.trim() ?? '');
  if (!match) return null;
  const number = parseInt(match[1]!, 10);
  if (number < 1 || number > 12) return null;
  return { number, mode: match[2]!.toUpperCase() === 'A' ? 'minor' : 'major' };
}

/** 0 = perfect harmonic match, 1 = maximally clashing. */
export function camelotTransitionCost(from: string | null | undefined, to: string | null | undefined): number {
  const a = parseCamelot(from);
  const b = parseCamelot(to);
  if (!a || !b) return 0.35;
  if (from === to) return 0;

  const numDelta = Math.min(Math.abs(a.number - b.number), 12 - Math.abs(a.number - b.number));
  const sameLetter = a.mode === b.mode;

  if (numDelta === 0 && !sameLetter) return 0.12;
  if (numDelta === 0) return 0;
  if (numDelta === 1 && sameLetter) return 0.18;
  if (numDelta === 1 && !sameLetter) return 0.22;
  if (numDelta === 2) return 0.45;
  return 0.85;
}

/** 0–1 similarity from Camelot codes. */
export function camelotSimilarity(from: string | null | undefined, to: string | null | undefined): number {
  return 1 - camelotTransitionCost(from, to);
}

/** Derive a stable pseudo-key from tier34 vector slot (until real key detection). */
export function camelotFromTier34Slot(value: number): string {
  const idx = Math.max(0, Math.min(23, Math.floor(value * 24)));
  const number = (idx % 12) + 1;
  const letter = idx >= 12 ? 'B' : 'A';
  return `${number}${letter}`;
}
