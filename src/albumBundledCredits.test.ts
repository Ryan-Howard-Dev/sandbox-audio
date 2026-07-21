import { describe, expect, it } from 'vitest';
import {
  lookupBundledTrackArtistLine,
  lookupBundledTrackFeatures,
} from './albumBundledCredits';
import { resolveLockerTrackArtistLine } from './lockerStorage';
import { collectLockerAlbumArtistCredits } from './searchCatalog';

describe('albumBundledCredits — Donda', () => {
  const albumName = 'Donda';
  const albumArtist = 'Kanye West';

  it('resolves featured artists for sparse-billing tracks', () => {
    expect(lookupBundledTrackFeatures(albumName, albumArtist, 'Jail')).toBe('Jay-Z');
    expect(lookupBundledTrackFeatures(albumName, albumArtist, 'Hurricane')).toBe(
      'Lil Baby, The Weeknd',
    );
    expect(lookupBundledTrackArtistLine(albumName, albumArtist, 'Praise God')).toBe(
      'Kanye West, Baby Keem, Travis Scott',
    );
  });

  it('resolveLockerTrackArtistLine uses bundled credits when tag is primary-only', () => {
    const line = resolveLockerTrackArtistLine(
      {
        title: 'Jail',
        artist: 'Kanye West',
        albumArtist: 'Kanye West',
        albumName: 'Donda',
      },
      'Kanye West',
      'Donda',
    );
    expect(line).toBe('Kanye West, Jay-Z');
  });

  it('collectLockerAlbumArtistCredits aggregates Donda guests for album chips', () => {
    const credits = collectLockerAlbumArtistCredits(
      albumArtist,
      [
        { title: 'Jail', artist: 'Kanye West', albumName: 'Donda' },
        { title: 'Hurricane', artist: 'Kanye West', albumName: 'Donda' },
        { title: 'Off The Grid', artist: 'Kanye West', albumName: 'Donda' },
      ],
      (track) => resolveLockerTrackArtistLine(track, albumArtist, albumName),
    );
    expect(credits).toContain('Kanye West');
    expect(credits).toContain('Jay-Z');
    expect(credits).toContain('Lil Baby');
    expect(credits).toContain('The Weeknd');
    expect(credits).toContain('Playboi Carti');
  });
});
