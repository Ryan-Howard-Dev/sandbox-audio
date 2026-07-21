/**
 * Envelope snapshots for liked tracks/episodes — catalog, podcast, and locker.
 * Keyed by stable envelopeId (same as taste profile explicitFeedback).
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

const STORAGE_KEY = 'sandbox_liked_envelopes_v1';

export type LikedEnvelopeEntry = {
  envelope: MediaEnvelope;
  likedAt: number;
};

type LikedEnvelopeStore = Record<string, LikedEnvelopeEntry>;

function readStore(): LikedEnvelopeStore {
  const raw = prefsGetItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as LikedEnvelopeStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: LikedEnvelopeStore): void {
  prefsSetItem(STORAGE_KEY, JSON.stringify(store));
}

export function saveLikedEnvelope(envelope: MediaEnvelope): void {
  const id = envelope.envelopeId?.trim();
  if (!id) return;
  const store = readStore();
  store[id] = {
    envelope: { ...envelope, envelopeId: id },
    likedAt: Date.now(),
  };
  writeStore(store);
}

export function touchLikedEnvelope(envelopeId: string): void {
  const id = envelopeId?.trim();
  if (!id) return;
  const store = readStore();
  const entry = store[id];
  if (!entry) return;
  store[id] = { ...entry, likedAt: Date.now() };
  writeStore(store);
}

export function removeLikedEnvelope(envelopeId: string): void {
  const id = envelopeId?.trim();
  if (!id) return;
  const store = readStore();
  if (!store[id]) return;
  delete store[id];
  writeStore(store);
}

export function getLikedEnvelope(envelopeId: string): MediaEnvelope | null {
  const id = envelopeId?.trim();
  if (!id) return null;
  return readStore()[id]?.envelope ?? null;
}

export function getAllLikedEnvelopeEntries(): LikedEnvelopeEntry[] {
  return Object.values(readStore());
}

/** Test helper — clears liked envelope snapshots. */
export function clearLikedEnvelopesForTests(): void {
  writeStore({});
}
