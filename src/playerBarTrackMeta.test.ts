import { describe, expect, it, vi } from 'vitest';
import {
  playbackArtStabilizeScope,
  resolveLockerEntryAlbumArt,
  resolveLockerEntryId,
  resolvePlayerBarArtwork,
  resolvePlayerBarDisplay,
  resolvePlayerBarHasTrack,
  resolvePlaybackCoverArt,
  stabilizePlaybackArtSrc,
} from './playerBarTrackMeta';
import { rememberKnownGoodAlbumArt, forgetKnownGoodAlbumArt, getKnownGoodAlbumArt } from './albumArtCache';

vi.mock('./lockerStorage', () => ({
  getLockerEntriesSnapshot: vi.fn(() => [
    {
      id: 'water-track',
      title: 'Water',
      artist: 'Kanye West',
      albumName: 'Jesus Is King',
      albumArtist: 'Kanye West',
    },
    {
      id: 'sibling-track',
      title: 'Selah',
      artist: 'Kanye West',
      albumName: 'Jesus Is King',
      albumArtist: 'Kanye West',
      albumArt: 'blob:album-cover',
    },
  ]),
  lockerAlbumGroupKey: (entry: { albumName?: string; albumArtist?: string }) =>
    `${entry.albumName ?? ''}::${entry.albumArtist ?? ''}`,
  isPersistentAlbumArt: (url?: string) => Boolean(url?.startsWith('https://')),
  resolveLockerEntryGroupArt: (
    entry: { id?: string; albumName?: string; albumArtist?: string; albumArt?: string },
    snap?: Array<{ id?: string; albumArt?: string; albumName?: string; albumArtist?: string }> | null,
  ) => {
    const key = `${entry.albumName ?? ''}::${entry.albumArtist ?? ''}`;
    const cached = getKnownGoodAlbumArt(key);
    if (cached) return cached;
    const pool = snap ?? [];
    const siblingArt = pool.find((row) => row.id !== entry.id && row.albumArt)?.albumArt;
    return siblingArt ?? entry.albumArt;
  },
}));

describe('resolvePlayerBarHasTrack', () => {
  it('treats envelope as active track even when state is Idle', () => {
    expect(
      resolvePlayerBarHasTrack(false, null, {
        title: '',
        artist: '',
        state: 'Idle',
        envelope: { envelopeId: 'e1', title: 'Song', artist: 'Artist' } as never,
      }),
    ).toBe(true);
  });

  it('requires remote track id when connect remote', () => {
    expect(
      resolvePlayerBarHasTrack(true, 'track-1', {
        title: '',
        artist: '',
        state: 'Idle',
        envelope: null,
      }),
    ).toBe(true);
    expect(
      resolvePlayerBarHasTrack(true, null, {
        title: '',
        artist: '',
        state: 'Idle',
        envelope: null,
      }),
    ).toBe(false);
  });
});

describe('resolvePlayerBarDisplay', () => {
  it('falls back to envelope title when audio title is empty', () => {
    expect(
      resolvePlayerBarDisplay(false, null, {
        title: '',
        artist: '',
        state: 'Resolving',
        envelope: {
          envelopeId: 'e1',
          title: 'Envelope Title',
          artist: 'Envelope Artist',
          album: 'Album',
        } as never,
      }),
    ).toEqual({
      title: 'Envelope Title',
      artist: 'Envelope Artist',
      album: 'Album',
    });
  });

  it('prefers envelope identity during active playback', () => {
    expect(
      resolvePlayerBarDisplay(false, null, {
        title: 'Stale Title',
        artist: 'Stale Artist',
        state: 'Playing',
        envelope: {
          envelopeId: 'e1',
          title: 'Envelope Title',
          artist: 'Envelope Artist',
        } as never,
      }),
    ).toEqual({
      title: 'Envelope Title',
      artist: 'Envelope Artist',
      album: undefined,
    });
  });
});

describe('resolvePlayerBarArtwork', () => {
  it('ignores parallel artwork when seed envelope differs', () => {
    expect(
      resolvePlayerBarArtwork(
        'https://example.com/stale-podcast.jpg',
        'podcast:feed:ep',
        'local-track-42',
        'https://example.com/locker.jpg',
      ),
    ).toBe('https://example.com/locker.jpg');
  });
});

describe('resolvePlayerBarArtwork', () => {
  it('ignores parallel artwork when seed envelope differs', () => {
    expect(
      resolvePlayerBarArtwork(
        'https://example.com/stale-podcast.jpg',
        'podcast:feed:ep',
        'local-track-42',
        'https://example.com/locker.jpg',
      ),
    ).toBe('https://example.com/locker.jpg');
  });
});

describe('resolvePlaybackCoverArt', () => {
  it('prefers locker vault art over stale parallel seed for local-vault', () => {
    const envelope = {
      envelopeId: 'local-track-99',
      provider: 'local-vault',
      sourceId: 'track-99',
      artworkUrl: '/cover-proxy?url=https%3A%2F%2Fstale.example%2Fart.jpg',
    } as never;
    const art = resolvePlaybackCoverArt(
      '/cover-proxy?url=https%3A%2F%2Fstale.example%2Fart.jpg',
      envelope,
      'https://is1-ssl.mzstatic.com/image/thumb/black-ops.jpg',
    );
    expect(art).toBe('https://is1-ssl.mzstatic.com/image/thumb/black-ops.jpg');
  });

  it('prefers parallel artwork for catalog playback', () => {
    const envelope = {
      envelopeId: 'search-track-1',
      provider: 'https',
      artworkUrl: 'https://example.com/envelope.jpg',
    } as never;
    const art = resolvePlaybackCoverArt(
      'https://example.com/parallel.jpg',
      envelope,
    );
    expect(art).toBe('https://example.com/parallel.jpg');
  });

  it('keeps stable blob art for the same envelope during vault churn', () => {
    const envelope = {
      envelopeId: 'local-track-42',
      provider: 'local-vault',
      sourceId: 'track-42',
      artworkUrl: 'blob:first',
    } as never;
    const first = resolvePlaybackCoverArt('blob:first', envelope, 'blob:first');
    const second = resolvePlaybackCoverArt('blob:second', envelope, 'blob:second');
    expect(first).toBe('blob:first');
    expect(second).toBe('blob:first');
  });
});

describe('resolveLockerEntryAlbumArt', () => {
  it('backfills from album siblings when the playing track has no cover', () => {
    const envelope = {
      envelopeId: 'local-water-track',
      provider: 'local-vault',
      sourceId: 'water-track',
    } as never;
    expect(resolveLockerEntryAlbumArt(envelope)).toBe('blob:album-cover');
  });

  it('resolves entry id from envelopeId when sourceId uses local- prefix', () => {
    const envelope = {
      envelopeId: 'local-water-track',
      provider: 'local-vault',
      sourceId: 'local-water-track',
    } as never;
    expect(resolveLockerEntryId(envelope)).toBe('water-track');
    expect(resolveLockerEntryAlbumArt(envelope)).toBe('blob:album-cover');
  });

  it('prefers session-known-good art over stale vault blob URLs', () => {
    const key = 'Jesus Is King::Kanye West';
    rememberKnownGoodAlbumArt(key, 'blob:cached-good');
    const envelope = {
      envelopeId: 'local-water-track',
      provider: 'local-vault',
      sourceId: 'water-track',
    } as never;
    expect(resolveLockerEntryAlbumArt(envelope)).toBe('blob:cached-good');
    forgetKnownGoodAlbumArt(key);
  });
});

describe('playbackArtStabilizeScope', () => {
  it('uses locker album group scope for local-vault playback', () => {
    const envelope = {
      envelopeId: 'local-water-track',
      provider: 'local-vault',
      sourceId: 'water-track',
      album: 'Jesus Is King',
      artist: 'Kanye West',
    } as never;
    expect(playbackArtStabilizeScope(envelope)).toBe(
      'locker-album:Jesus Is King::Kanye West',
    );
  });
});

describe('stabilizePlaybackArtSrc', () => {
  it('ignores locker blob URL churn for the same scope', () => {
    expect(stabilizePlaybackArtSrc('blob:a', 'blob:b', 'local-track-1')).toBe('blob:a');
  });

  it('accepts persistent URL upgrades', () => {
    expect(
      stabilizePlaybackArtSrc(
        'blob:a',
        'https://example.com/cover.jpg',
        'local-track-1',
      ),
    ).toBe('https://example.com/cover.jpg');
  });

  it('keeps prior art when next is briefly empty within the same scope', () => {
    expect(stabilizePlaybackArtSrc('blob:a', '', 'local-track-1')).toBe('blob:a');
    expect(stabilizePlaybackArtSrc('https://example.com/cover.jpg', undefined, 'album:1')).toBe(
      'https://example.com/cover.jpg',
    );
  });

  it('clears art when next is empty and there is no scope', () => {
    expect(stabilizePlaybackArtSrc('blob:a', '', undefined)).toBe('');
  });
});
