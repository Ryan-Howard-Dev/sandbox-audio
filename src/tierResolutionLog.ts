/**
 * Debug tier resolution log — Settings → Signal Bench.
 */

export interface TierResolutionEntry {
  at: number;
  query: string;
  tier: number;
  provider: string;
  outcome: 'hit' | 'miss' | 'skip' | 'error';
  detail?: string;
}

const MAX_ENTRIES = 80;
const entries: TierResolutionEntry[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function logTierResolution(
  partial: Omit<TierResolutionEntry, 'at'> & { at?: number },
): void {
  entries.unshift({ ...partial, at: partial.at ?? Date.now() });
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  notify();
}

export function getTierResolutionLog(): TierResolutionEntry[] {
  return [...entries];
}

export function clearTierResolutionLog(): void {
  entries.length = 0;
  notify();
}

export function subscribeTierResolutionLog(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
