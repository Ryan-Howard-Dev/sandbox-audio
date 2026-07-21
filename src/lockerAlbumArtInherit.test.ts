import { describe, expect, it, beforeEach } from 'vitest';
import { forgetKnownGoodAlbumArt } from './albumArtCache';
import {
  inheritLockerAlbumArt,
  lockerAlbumGroupKey,
  resolveLockerEntryGroupArt,
  type LockerEntry,
} from './lockerStorage';

function track(
  id: string,
  title: string,
  albumName: string,
  albumArtist: string,
  albumArt?: string,
): LockerEntry {
  return {
    id,
    title,
    artist: albumArtist,
    genre: 'Local',
    durationSeconds: 180,
    url: `blob:${id}`,
    addedAt: 1,
    albumName,
    albumArtist,
    albumArt,
  };
}

describe('inheritLockerAlbumArt', () => {
  beforeEach(() => {
    forgetKnownGoodAlbumArt('american dream::21 savage');
    forgetKnownGoodAlbumArt('jesus is king::kanye west');
  });

  it('fills missing per-row art from album siblings', () => {
    const entries = [
      track('nee-nah', 'Nee Nah', 'American Dream', '21 Savage'),
      track(
        'sibling',
        'Sister',
        'American Dream',
        '21 Savage',
        'https://is1-ssl.mzstatic.com/image/thumb/american-dream.jpg',
      ),
    ];
    const inherited = inheritLockerAlbumArt(entries);
    expect(inherited[0]?.albumArt).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/american-dream.jpg',
    );
    expect(inherited[1]?.albumArt).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/american-dream.jpg',
    );
  });

  it('upgrades stale blob rows to durable sibling art', () => {
    const entries = [
      track('water', 'Water', 'Jesus Is King', 'Kanye West', 'blob:dead-water'),
      track('selah', 'Selah', 'Jesus Is King', 'Kanye West', 'https://example.com/jik.jpg'),
    ];
    const inherited = inheritLockerAlbumArt(entries);
    expect(inherited[0]?.albumArt).toBe('https://example.com/jik.jpg');
  });

  it('resolveLockerEntryGroupArt uses the full sibling pool', () => {
    const entries = [
      track('a', 'A', 'Album', 'Artist'),
      track('b', 'B', 'Album', 'Artist', 'blob:cover'),
    ];
    const art = resolveLockerEntryGroupArt(entries[0]!, entries);
    expect(art).toBe('blob:cover');
    expect(lockerAlbumGroupKey(entries[0]!)).toBe('album::artist');
  });
});
