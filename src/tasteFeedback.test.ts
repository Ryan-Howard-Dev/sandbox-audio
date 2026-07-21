import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';
import {
  clearLikedEnvelopesForTests,
  getAllLikedEnvelopeEntries,
  getLikedEnvelope,
  removeLikedEnvelope,
  saveLikedEnvelope,
} from './likedEnvelopes';
import {
  LIKED_PLAYLIST_ID,
  LIKED_PLAYLIST_NAME,
  isSystemLikedPlaylist,
} from './likedPlaylist';
import {
  getTrackTasteFeedback,
  recordTasteFeedback,
  TASTE_FEEDBACK_CHANGE_EVENT,
} from './tasteFeedback';
import { getTasteProfile, setExplicitFeedbackMap } from './tasteProfile';
import { loadPlaylists, savePlaylists } from './playlistStorage';

const PLAYLISTS_KEY = 'sandbox_layer4_playlists';
const TASTE_KEY = 'sandbox_taste_profile_v1';

function envelope(id: string, title = 'Track'): MediaEnvelope {
  return {
    envelopeId: id,
    sourceId: id,
    title,
    artist: 'Artist',
    album: 'Album',
    url: `https://example.com/${id}.mp3`,
    provider: 'unknown',
    transport: 'element-src',
    durationSeconds: 200,
  };
}

function stubWindow(): void {
  const listeners = new Map<string, Set<EventListener>>();
  vi.stubGlobal('window', {
    dispatchEvent(event: Event) {
      listeners.get(event.type)?.forEach((fn) => fn(event));
      return true;
    },
    addEventListener(type: string, fn: EventListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
  });
}

function clearStorage(): void {
  localStorage.removeItem(PLAYLISTS_KEY);
  localStorage.removeItem(TASTE_KEY);
  clearLikedEnvelopesForTests();
}

describe('tasteFeedback storage', () => {
  beforeEach(() => {
    stubWindow();
    clearStorage();
    setExplicitFeedbackMap({});
  });

  it('persists like keyed by envelopeId', () => {
    recordTasteFeedback({
      envelopeId: 'track-1',
      envelope: envelope('track-1'),
      kind: 'like',
    });
    expect(getTrackTasteFeedback('track-1')).toBe('like');
    expect(getTasteProfile().explicitFeedback['track-1']).toBe('like');
  });

  it('persists dislike keyed by envelopeId', () => {
    recordTasteFeedback({
      envelopeId: 'track-2',
      envelope: envelope('track-2'),
      kind: 'dislike',
    });
    expect(getTrackTasteFeedback('track-2')).toBe('dislike');
  });

  it('clears rating on second tap (toggle)', () => {
    recordTasteFeedback({
      envelopeId: 'track-3',
      envelope: envelope('track-3'),
      kind: 'like',
    });
    recordTasteFeedback({
      envelopeId: 'track-3',
      kind: 'clear',
    });
    expect(getTrackTasteFeedback('track-3')).toBeNull();
    expect(getTasteProfile().explicitFeedback['track-3']).toBeUndefined();
  });

  it('dispatches change event on record', () => {
    let fired = 0;
    const handler = () => {
      fired += 1;
    };
    window.addEventListener(TASTE_FEEDBACK_CHANGE_EVENT, handler);
    recordTasteFeedback({
      envelopeId: 'track-4',
      envelope: envelope('track-4'),
      kind: 'like',
    });
    window.removeEventListener(TASTE_FEEDBACK_CHANGE_EVENT, handler);
    expect(fired).toBe(1);
  });
});

describe('liked playlist sync', () => {
  beforeEach(() => {
    stubWindow();
    clearStorage();
    setExplicitFeedbackMap({});
  });

  it('creates system Liked playlist on first like', () => {
    const env = envelope('podcast-ep-1', 'Episode 1');
    recordTasteFeedback({ envelopeId: env.envelopeId, envelope: env, kind: 'like' });

    const playlists = loadPlaylists();
    const liked = playlists.find((pl) => pl.id === LIKED_PLAYLIST_ID);
    expect(liked).toBeDefined();
    expect(liked?.name).toBe(LIKED_PLAYLIST_NAME);
    expect(liked?.tracks).toHaveLength(1);
    expect(liked?.tracks[0]?.envelopeId).toBe('podcast-ep-1');
    expect(isSystemLikedPlaylist(liked!)).toBe(true);
  });

  it('removes track from Liked playlist on clear', () => {
    const env = envelope('track-a');
    recordTasteFeedback({ envelopeId: env.envelopeId, envelope: env, kind: 'like' });
    recordTasteFeedback({ envelopeId: env.envelopeId, kind: 'clear' });

    const liked = loadPlaylists().find((pl) => pl.id === LIKED_PLAYLIST_ID);
    expect(liked?.tracks ?? []).toHaveLength(0);
    expect(getLikedEnvelope(env.envelopeId)).toBeNull();
  });

  it('stores envelope snapshot for catalog tracks', () => {
    const env = envelope('catalog-99', 'Remote Song');
    saveLikedEnvelope(env);
    const stored = getLikedEnvelope('catalog-99');
    expect(stored?.title).toBe('Remote Song');
    expect(getAllLikedEnvelopeEntries()).toHaveLength(1);
    removeLikedEnvelope('catalog-99');
    expect(getLikedEnvelope('catalog-99')).toBeNull();
  });

  it('recordTasteFeedback syncs liked playlist tracks', () => {
    savePlaylists([]);
    const a = envelope('a');
    const b = envelope('b');
    recordTasteFeedback({ envelopeId: a.envelopeId, envelope: a, kind: 'like' });
    recordTasteFeedback({ envelopeId: b.envelopeId, envelope: b, kind: 'like' });

    const liked = loadPlaylists().find((pl) => pl.id === LIKED_PLAYLIST_ID);
    expect(liked?.tracks.map((t) => t.envelopeId).sort()).toEqual(['a', 'b']);
  });

  it('re-liking an already-liked track keeps like feedback', () => {
    const env = envelope('track-rel');
    recordTasteFeedback({ envelopeId: env.envelopeId, envelope: env, kind: 'like' });
    recordTasteFeedback({ envelopeId: env.envelopeId, envelope: env, kind: 'like' });
    expect(getTrackTasteFeedback(env.envelopeId)).toBe('like');
    const liked = loadPlaylists().find((p) => p.id === LIKED_PLAYLIST_ID);
    expect(liked?.tracks.some((t) => t.envelopeId === env.envelopeId)).toBe(true);
  });
});
