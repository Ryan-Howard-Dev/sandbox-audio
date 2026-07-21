/**
 * Prompt → playlist curation — local taste + vibe scoring, optional Gemini rank.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import type { LockerEntry } from './lockerStorage';
import { scoreAiPromptMatch } from './playlistAiPrompt';
import {
  buildSmartTrackContexts,
  lockerEntryToEnvelope,
  type SmartTrackContext,
} from './smartPlaylistEngine';
import { scoreTrackForTaste } from './tasteProfile';
import { fetchWithTimeout } from './fetchWithTimeout';

export type CuratePromptSource = 'local' | 'gemini';

export type CuratePromptResult = {
  tracks: MediaEnvelope[];
  source: CuratePromptSource;
};

const MIN_SCORE = 0.25;
const VIBE_WEIGHT = 0.65;
const TASTE_WEIGHT = 0.35;

export function rankContextsForPrompt(
  contexts: SmartTrackContext[],
  prompt: string,
): Array<{ ctx: SmartTrackContext; score: number }> {
  const tasteRaw = contexts.map((ctx) => scoreTrackForTaste(lockerEntryToEnvelope(ctx.entry)));
  const maxTaste = Math.max(...tasteRaw, 0.01);

  return contexts
    .map((ctx, index) => {
      const vibe = scoreAiPromptMatch(ctx, prompt);
      const taste = Math.max(0, tasteRaw[index]!) / maxTaste;
      return { ctx, score: vibe * VIBE_WEIGHT + taste * TASTE_WEIGHT };
    })
    .filter((row) => row.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
}

export function curatePlaylistFromPromptLocal(
  prompt: string,
  lockerEntries: LockerEntry[],
  limit = 80,
): MediaEnvelope[] {
  const trimmed = prompt.trim();
  if (!trimmed || lockerEntries.length === 0) return [];

  const contexts = buildSmartTrackContexts(lockerEntries, []);
  const ranked = rankContextsForPrompt(contexts, trimmed).slice(0, limit);
  return ranked.map((row) => lockerEntryToEnvelope(row.ctx.entry));
}

async function curatePlaylistFromGemini(
  prompt: string,
  lockerEntries: LockerEntry[],
  limit: number,
): Promise<MediaEnvelope[] | null> {
  const tracks = lockerEntries.slice(0, 200).map((entry) => ({
    id: entry.id,
    title: entry.title,
    artist: entry.artist,
    album: entry.albumName ?? '',
    genre: entry.genre ?? '',
  }));
  if (tracks.length === 0) return null;

  const res = await fetchWithTimeout(
    '/api/playlist-curate',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.trim(), tracks, limit }),
    },
    18_000,
  );
  if (!res.ok) return null;

  const data = (await res.json()) as { rankedIds?: string[] };
  if (!Array.isArray(data.rankedIds) || data.rankedIds.length === 0) return null;

  const byId = new Map(lockerEntries.map((entry) => [entry.id, entry]));
  const ranked = data.rankedIds
    .map((id) => byId.get(id))
    .filter((entry): entry is LockerEntry => Boolean(entry?.url?.trim()))
    .map(lockerEntryToEnvelope);

  return ranked.length > 0 ? ranked : null;
}

/** Rank locker tracks for a natural-language prompt; tries Gemini when online. */
export async function curatePlaylistFromPrompt(
  prompt: string,
  lockerEntries: LockerEntry[],
  limit = 80,
): Promise<CuratePromptResult> {
  const local = curatePlaylistFromPromptLocal(prompt, lockerEntries, limit);
  try {
    const gemini = await curatePlaylistFromGemini(prompt, lockerEntries, limit);
    if (gemini?.length) {
      return { tracks: gemini, source: 'gemini' };
    }
  } catch {
    /* offline or no API key — local fallback */
  }
  return { tracks: local, source: 'local' };
}
