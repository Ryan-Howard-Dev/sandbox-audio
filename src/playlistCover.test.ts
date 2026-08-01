import { describe, expect, it } from 'vitest';
import { playlistCoverForDisplay, playlistCoverUrl } from './playlistStorage';
import type { StoredPlaylist } from './playlistStorage';

function playlist(over: Partial<StoredPlaylist> = {}): StoredPlaylist {
  return {
    id: 'p1',
    name: 'Test',
    tracks: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as StoredPlaylist;
}

describe('playlistCoverForDisplay', () => {
  it('uses the stored cover when there is one, without asking the resolver', () => {
    let asked = 0;
    const out = playlistCoverForDisplay(
      playlist({ coverUrl: 'https://example.test/cover.jpg' }),
      () => {
        asked += 1;
        return 'blob:should-not-be-used';
      },
    );
    expect(out).toBe('https://example.test/cover.jpg');
    expect(asked).toBe(0);
  });

  it('falls back to a durable track cover, as before', () => {
    const out = playlistCoverForDisplay(
      playlist({ tracks: [{ artworkUrl: 'https://example.test/track.jpg' }] as never }),
    );
    expect(out).toBe('https://example.test/track.jpg');
  });

  /*
   * The bug this exists for: every track is a locker blob, so the durable scan finds nothing and
   * the playlist drew a bare gradient despite having art on every single track.
   */
  it('resolves locker art when every track is a blob', () => {
    const pl = playlist({
      tracks: [{ artworkUrl: 'blob:one', id: 't1' }, { artworkUrl: 'blob:two', id: 't2' }] as never,
    });
    expect(playlistCoverUrl(pl)).toBeUndefined();
    expect(playlistCoverForDisplay(pl, (t) => (t.id === 't1' ? 'blob:live-one' : undefined))).toBe(
      'blob:live-one',
    );
  });

  it('walks past tracks the resolver cannot answer for', () => {
    const pl = playlist({
      tracks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never,
    });
    expect(playlistCoverForDisplay(pl, (t) => (t.id === 'c' ? 'blob:third' : undefined))).toBe(
      'blob:third',
    );
  });

  it('returns nothing rather than an empty string when nothing resolves', () => {
    expect(playlistCoverForDisplay(playlist(), () => '   ')).toBeUndefined();
    expect(playlistCoverForDisplay(playlist())).toBeUndefined();
  });
});
