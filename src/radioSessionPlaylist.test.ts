import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';
import {
  TRACK_RADIO_PLAYLIST_ID,
  TRACK_RADIO_PLAYLIST_NAME,
  upsertTrackRadioPlaylist,
} from './radioSessionPlaylist';
import { loadPlaylists, savePlaylists } from './playlistStorage';

const PLAYLISTS_KEY = 'sandbox_layer4_playlists';

function env(id: string, title: string): MediaEnvelope {
  return {
    envelopeId: id,
    sourceId: id,
    title,
    artist: 'Artist',
    album: 'Album',
    url: `https://example.com/${id}.mp3`,
    provider: 'unknown',
    transport: 'element-src',
    durationSeconds: 180,
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

describe('radioSessionPlaylist', () => {
  beforeEach(() => {
    stubWindow();
    localStorage.removeItem(PLAYLISTS_KEY);
    savePlaylists([]);
  });

  it('creates Track radio playlist from a multi-track queue', () => {
    const tracks = [env('a', 'Seed'), env('b', 'Next'), env('c', 'After')];
    const pl = upsertTrackRadioPlaylist(tracks, { title: 'Seed', artist: 'Artist' });
    expect(pl).not.toBeNull();
    expect(pl?.id).toBe(TRACK_RADIO_PLAYLIST_ID);
    expect(pl?.name).toBe(TRACK_RADIO_PLAYLIST_NAME);
    expect(pl?.tracks).toHaveLength(3);
    expect(loadPlaylists().some((p) => p.id === TRACK_RADIO_PLAYLIST_ID)).toBe(true);
  });

  it('does not create playlist for a lone track', () => {
    expect(upsertTrackRadioPlaylist([env('a', 'Only')], { title: 'Only', artist: 'A' })).toBeNull();
  });

  it('updates existing Track radio playlist in place', () => {
    upsertTrackRadioPlaylist([env('a', 'A'), env('b', 'B')], { title: 'A', artist: 'X' });
    upsertTrackRadioPlaylist(
      [env('a', 'A'), env('c', 'C'), env('d', 'D')],
      { title: 'A', artist: 'X' },
    );
    const all = loadPlaylists().filter((p) => p.id === TRACK_RADIO_PLAYLIST_ID);
    expect(all).toHaveLength(1);
    expect(all[0]?.tracks.map((t) => t.envelopeId)).toEqual(['a', 'c', 'd']);
  });
});
