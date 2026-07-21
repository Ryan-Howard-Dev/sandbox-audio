import { describe, expect, it } from 'vitest';
import {
  buildCanonicalArtists,
  resolveCanonicalArtistForTrack,
} from './collectionIntelligence';
import {
  isLeakWatermarkArtistName,
  isKnownPlaylistStubArtistName,
  isMislabeledPlaylistStubArtist,
  isTitleFragmentArtistName,
  isUsableArtistName,
  resolveKnownStubArtistReassignment,
  lockerAlbumArtistConsensus,
  lockerAlbumGroupArtist,
  lockerTrackArtistConsensus,
  normalizeLockerAlbumArtistKey,
  lockerEntryMatchesArtistFilter,
  collectLockerGuestArtists,
  formatLockerAlbumFeaturingLine,
  tracksForAlbumGroup,
  type LockerEntry,
} from './lockerStorage';

describe('locker artist naming', () => {
  it('treats ESDEEKID as a real artist, not a leak watermark', () => {
    expect(isLeakWatermarkArtistName('ESDEEKID')).toBe(false);
    expect(isUsableArtistName('ESDEEKID')).toBe(true);
    expect(isUsableArtistName('Esdeekid')).toBe(true);
  });

  it('still rejects CANSE leak watermark', () => {
    expect(isLeakWatermarkArtistName('CANSE')).toBe(true);
    expect(isUsableArtistName('CANSE')).toBe(false);
  });

  it('groups album under album artist when TPE2 disagrees with featured track tags', () => {
    const tracks: Pick<LockerEntry, 'albumArtist' | 'artist'>[] = [
      { albumArtist: 'ESDEEKID', artist: 'Denzel Curry & Armani White' },
      { albumArtist: 'ESDEEKID', artist: 'ESDEEKID' },
      { albumArtist: 'ESDEEKID', artist: 'ESDEEKID' },
    ];
    expect(lockerAlbumArtistConsensus(tracks)).toBe('ESDEEKID');
    expect(lockerAlbumGroupArtist(tracks[0]!, tracks)).toBe('ESDEEKID');
  });

  it('resolves canonical library artist from album artist tag', () => {
    const entry = {
      albumArtist: 'ESDEEKID',
      artist: 'Denzel Curry & Armani White',
      title: 'WISHLIST',
    } as LockerEntry;
    expect(resolveCanonicalArtistForTrack(entry).name).toBe('ESDEEKID');
  });

  it('groups featured singles under the primary artist (comma billing)', () => {
    const entry = {
      artist: 'Denzel Curry, 2 Chainz',
      title: 'COLLECT',
    } as LockerEntry;
    expect(resolveCanonicalArtistForTrack(entry).name).toBe('Denzel Curry');
  });

  it('matches collab album delete keys across billing variants', () => {
    expect(normalizeLockerAlbumArtistKey('Future & Metro Boomin')).toBe(
      normalizeLockerAlbumArtistKey('Future, Metro Boomin'),
    );
    const entries = [
      {
        id: '1',
        albumName: "WE DON'T TRUST YOU",
        albumArtist: 'Future & Metro Boomin',
        artist: 'Future',
      },
      {
        id: '2',
        albumName: "WE DON'T TRUST YOU",
        albumArtist: 'Future',
        artist: 'Future',
      },
    ] as LockerEntry[];
    const removed = tracksForAlbumGroup(entries, "WE DON'T TRUST YOU", 'Future');
    expect(removed).toHaveLength(2);
  });

  it('detects playlist stub album/title used as artist', () => {
    const dondaStub = {
      title: 'Mr Miyagi',
      artist: 'Donda',
      albumName: 'Donda',
      albumArtist: 'Donda',
    } as LockerEntry;
    expect(isMislabeledPlaylistStubArtist('Donda', dondaStub)).toBe(true);
    expect(resolveCanonicalArtistForTrack(dondaStub).name).not.toBe('Donda');

    const ultraStub = {
      title: 'Shxt',
      artist: 'Ultra',
      albumName: 'Ultra',
    } as LockerEntry;
    expect(isMislabeledPlaylistStubArtist('Ultra', ultraStub)).toBe(true);
    expect(lockerAlbumGroupArtist(ultraStub)).toBe('Local Upload');

    const coleStub = {
      title: 'Cole Pimp',
      artist: 'Cole',
    } as LockerEntry;
    expect(isMislabeledPlaylistStubArtist('Cole', coleStub)).toBe(true);
  });

  it('does not list stub album names as library artists', () => {
    const entries = [
      {
        id: '1',
        title: 'Shxt',
        artist: 'Ultra',
        albumName: 'Ultra',
        albumArtist: 'Ultra',
      },
      {
        id: '2',
        title: 'Redrum',
        artist: '21 Savage',
        albumName: 'Her Loss',
        albumArtist: '21 Savage',
      },
      {
        id: '3',
        title: 'Him',
        artist: 'Denzel Curry',
        albumName: 'Melt My Eyez See Your Future',
        albumArtist: 'Denzel Curry',
      },
      {
        id: '4',
        title: 'Beauty And The Beast',
        artist: 'Beauty And The',
        albumName: 'Beauty And The',
        albumArtist: 'Beauty And The',
      },
    ] as LockerEntry[];

    const artists = buildCanonicalArtists(entries).map((a) => a.name);
    expect(artists).not.toContain('Ultra');
    expect(artists).not.toContain('Donda');
    expect(artists).not.toContain('Beauty And The');
    expect(artists).toContain('21 Savage');
    expect(artists).toContain('Denzel Curry');
  });

  it('maps known stub tags to real artists', () => {
    expect(
      resolveKnownStubArtistReassignment({
        title: 'Black Flag',
        artist: 'Black Flag',
      })?.artist,
    ).toBe('Denzel Curry');
    expect(
      resolveKnownStubArtistReassignment({ title: 'COYOTE', artist: 'COYOTE' })?.artist,
    ).toBe('Ab-Soul');
    expect(
      resolveKnownStubArtistReassignment({ title: 'Mr Miyagi', artist: 'Donda' })?.artist,
    ).toBe('Kanye West');
    expect(
      resolveKnownStubArtistReassignment({ title: 'Shell', artist: 'Shell' })?.artist,
    ).toBe('Kenny Mason');
    expect(isKnownPlaylistStubArtistName('Cole')).toBe(true);
    expect(isKnownPlaylistStubArtistName('Denzel Curry')).toBe(false);
  });

  it('ignores mislabeled stub artists in track consensus', () => {
    const tracks = [
      { artist: 'Ultra', title: 'Shxt', albumName: 'Ultra', albumArtist: 'Ultra' },
      { artist: 'Denzel Curry', title: 'Him', albumName: 'Melt My Eyez See Your Future', albumArtist: 'Denzel Curry' },
      { artist: 'Cole', title: 'Cole Pimp', albumName: 'Cole Pimp', albumArtist: 'Cole' },
    ] as LockerEntry[];
    expect(lockerTrackArtistConsensus(tracks)).toBeNull();

    const denzelHeavy = [
      { artist: 'Denzel Curry', title: 'Him', albumName: 'Melt My Eyez See Your Future', albumArtist: 'Denzel Curry' },
      { artist: 'Denzel Curry', title: 'Walkin', albumName: 'Melt My Eyez See Your Future', albumArtist: 'Denzel Curry' },
      { artist: 'Ultra', title: 'Shxt', albumName: 'Ultra', albumArtist: 'Ultra' },
    ] as LockerEntry[];
    expect(lockerTrackArtistConsensus(denzelHeavy)).toBe('Denzel Curry');
  });

  it('rejects title-fragment fake artists from playlist stub imports', () => {
    const fragments = [
      { artist: 'Like', title: 'Like That' },
      { artist: 'Looove', title: 'Looove' },
      { artist: 'Type', title: 'Type Shit' },
      { artist: 'Bad', title: 'Bad Blood' },
      { artist: 'At The', title: 'At The River' },
      { artist: 'Dream Come', title: 'Dream Come True' },
      { artist: 'Dance', title: 'Dance Monkey' },
      { artist: 'All', title: 'All Falls Down' },
    ] as LockerEntry[];

    for (const entry of fragments) {
      expect(isTitleFragmentArtistName(entry.artist, entry)).toBe(true);
      expect(isUsableArtistName(entry.artist)).toBe(false);
      expect(resolveCanonicalArtistForTrack(entry).name).not.toBe(entry.artist);
    }
  });

  it('does not list title fragments as library artists', () => {
    const entries = [
      { id: '1', title: 'Like That', artist: 'Like', albumName: 'Like That', albumArtist: 'Like' },
      { id: '2', title: 'Looove', artist: 'Looove', albumName: 'Looove', albumArtist: 'Looove' },
      { id: '3', title: 'Type Shit', artist: 'Type', albumName: 'Type Shit', albumArtist: 'Type' },
      { id: '4', title: 'Redrum', artist: '21 Savage', albumName: 'Her Loss', albumArtist: '21 Savage' },
      { id: '5', title: 'Him', artist: 'Denzel Curry', albumName: 'Melt My Eyez See Your Future', albumArtist: 'Denzel Curry' },
      { id: '6', title: 'Runaway', artist: 'Kanye West', albumName: 'My Beautiful Dark Twisted Fantasy', albumArtist: 'Kanye West' },
    ] as LockerEntry[];

    const artists = buildCanonicalArtists(entries).map((a) => a.name);
    expect(artists).not.toContain('Like');
    expect(artists).not.toContain('Looove');
    expect(artists).not.toContain('Type');
    expect(artists).toContain('21 Savage');
    expect(artists).toContain('Denzel Curry');
    expect(artists).toContain('Kanye West');
  });

  it('excludes ruthless title-fragment and mashup fake artists from the list', () => {
    const entries = [
      { id: '1', title: 'Show Of Hands', artist: 'Show', albumName: 'Show', albumArtist: 'Show' },
      { id: '2', title: 'Show Of Hands', artist: 'Show Of', albumName: 'Show Of', albumArtist: 'Show Of' },
      { id: '3', title: 'Type Shit', artist: 'Type', albumName: 'Type Shit', albumArtist: 'Type' },
      { id: '4', title: 'Til Further Notice', artist: 'Til Further Notice', albumName: 'Til Further Notice', albumArtist: 'Til Further Notice' },
      { id: '5', title: 'Either On Or Off', artist: 'Either On Or', albumName: 'Either On Or', albumArtist: 'Either On Or' },
      { id: '6', title: 'Bittersweet Poetry', artist: 'Kanye West Bittersweet', albumName: 'Bittersweet', albumArtist: 'Kanye West Bittersweet' },
      { id: '7', title: 'Surround Sound', artist: 'Surround', albumName: 'Surround', albumArtist: 'Surround' },
      { id: '8', title: 'Scaring The Hoes', artist: 'Scaring The', albumName: 'Scaring The', albumArtist: 'Scaring The' },
      { id: '9', title: 'Preacher Man', artist: 'Preacher', albumName: 'Preacher', albumArtist: 'Preacher' },
      { id: '10', title: 'Leak Track', artist: 'DinoA1', albumName: 'Uploads', albumArtist: 'DIN0A1' },
      { id: '11', title: 'Taylor Swi', artist: 'Taylor Swi', albumName: 'Taylor Swi', albumArtist: 'Taylor Swi' },
      { id: '12', title: 'Walkin', artist: 'Denzel Curry', albumName: 'Melt My Eyez See Your Future', albumArtist: 'Denzel Curry' },
      { id: '13', title: 'Runaway', artist: 'Kanye West', albumName: 'MBDTF', albumArtist: 'Kanye West' },
      { id: '14', title: 'Bad Blood', artist: 'Bad', albumName: 'Bad', albumArtist: 'Bad' },
      { id: '15', title: 'Dance Monkey', artist: 'Dance', albumName: 'Dance', albumArtist: 'Dance' },
      { id: '16', title: 'All Falls Down', artist: 'All', albumName: 'All', albumArtist: 'All' },
      { id: '17', title: 'At The River', artist: 'At The', albumName: 'At The', albumArtist: 'At The' },
      { id: '18', title: 'Dream Come True', artist: 'Dream Come', albumName: 'Dream Come', albumArtist: 'Dream Come' },
      { id: '19', title: 'Fuk Sumn', artist: 'Fuk', albumName: 'Fuk', albumArtist: 'Fuk' },
      { id: '20', title: 'Bloody Waters', artist: 'Bloody', albumName: 'Bloody', albumArtist: 'Bloody' },
      { id: '21', title: 'California', artist: 'California', albumName: 'California', albumArtist: 'California' },
    ] as LockerEntry[];

    const artists = buildCanonicalArtists(entries).map((a) => a.name);
    for (const junk of [
      'Show',
      'Show Of',
      'Type',
      'Til Further Notice',
      'Either On Or',
      'Kanye West Bittersweet',
      'Surround',
      'Scaring The',
      'Preacher',
      'DinoA1',
      'DIN0A1',
      'Taylor Swi',
      'Bad',
      'Dance',
      'All',
      'At The',
      'Dream Come',
      'Fuk',
      'Bloody',
      'California',
    ]) {
      expect(artists).not.toContain(junk);
    }
    expect(artists).toContain('Denzel Curry');
    expect(artists).toContain('Kanye West');
  });

  it('does not invent ABBA or Taylor Swift from title-fragment stubs', () => {
    expect(
      resolveKnownStubArtistReassignment({ title: 'Dream Come True', artist: 'Dream Come' }),
    ).toBeNull();
    expect(resolveKnownStubArtistReassignment({ title: 'Choices', artist: 'Bad' })).toBeNull();
    expect(resolveKnownStubArtistReassignment({ title: 'California', artist: 'California' })).toBeNull();
    expect(
      resolveKnownStubArtistReassignment({ title: 'Bad Blood', artist: 'Bad' })?.artist,
    ).toBe('Taylor Swift');
  });

  it('never treats first-word-of-title as a usable artist write target', () => {
    expect(isUsableArtistName('Show')).toBe(false);
    expect(isUsableArtistName('Type')).toBe(false);
    expect(isUsableArtistName('Til Further Notice')).toBe(false);
    expect(isUsableArtistName('Either On Or')).toBe(false);
    expect(isUsableArtistName('Kanye West Bittersweet')).toBe(false);
    expect(isUsableArtistName('Denzel Curry')).toBe(true);
    expect(isUsableArtistName('Kanye West')).toBe(true);
  });

  it('maps title-fragment stubs to real performers', () => {
    expect(resolveKnownStubArtistReassignment({ title: 'Like That', artist: 'Like' })?.artist).toBe(
      'Future',
    );
    expect(resolveKnownStubArtistReassignment({ title: 'Looove', artist: 'Looove' })?.artist).toBe(
      'Travis Scott',
    );
    expect(resolveKnownStubArtistReassignment({ title: 'Type Shit', artist: 'Type' })?.artist).toBe(
      'Future',
    );
    expect(resolveKnownStubArtistReassignment({ title: 'Redrum', artist: 'Redrum' })?.artist).toBe(
      '21 Savage',
    );
    expect(
      resolveKnownStubArtistReassignment({ title: 'Starburst', artist: 'Niko Sitaras' })?.artist,
    ).toBe('Danny Brown');
    expect(resolveKnownStubArtistReassignment({ title: 'Now', artist: 'Tones and I' })).toBeNull();
    expect(isKnownPlaylistStubArtistName('Like')).toBe(true);
    expect(isKnownPlaylistStubArtistName('Travis Scott')).toBe(false);
  });

  it('maps N95 to Kendrick Lamar by default', () => {
    expect(resolveKnownStubArtistReassignment({ title: 'N95', artist: 'N95' })?.artist).toBe(
      'Kendrick Lamar',
    );
    expect(resolveKnownStubArtistReassignment({ title: 'N95', artist: '' })?.artist).toBe(
      'Kendrick Lamar',
    );
  });

  it('maps N95 to Jeff Jons only with remix or cover signals', () => {
    expect(
      resolveKnownStubArtistReassignment({ title: 'N95', artist: 'Jeff Jons' })?.artist,
    ).toBe('Jeff Jons');
    expect(
      resolveKnownStubArtistReassignment({
        title: 'N95',
        artist: 'N95',
        albumName: 'Jeff Jons Remix',
      })?.artist,
    ).toBe('Jeff Jons');
  });

  it('maps N95 to Kanye only with explicit Kanye cover signals', () => {
    expect(
      resolveKnownStubArtistReassignment({
        title: 'N95',
        artist: 'Kanye West',
      })?.artist,
    ).toBe('Kanye West');
    expect(resolveKnownStubArtistReassignment({ title: 'N95', artist: 'N95' })?.artist).not.toBe(
      'Kanye West',
    );
  });

  it('links guest artists to albums they appear on', () => {
    const guestTrack = {
      id: 'g1',
      title: 'Money Trees (feat. Jay Rock)',
      artist: 'Kendrick Lamar',
      albumArtist: 'Kendrick Lamar',
      albumName: 'good kid, m.A.A.d city',
      genre: '',
      durationSeconds: 240,
      url: '',
      addedAt: 1,
    } as LockerEntry;

    expect(lockerEntryMatchesArtistFilter(guestTrack, 'Jay Rock')).toBe(true);
    expect(collectLockerGuestArtists('Kendrick Lamar', [guestTrack])).toContain('Jay Rock');
    expect(formatLockerAlbumFeaturingLine('Kendrick Lamar', ['Jay Rock'])).toBe(
      'Kendrick Lamar feat. Jay Rock',
    );

    const artists = buildCanonicalArtists([guestTrack]);
    const jay = artists.find((a) => a.name === 'Jay Rock');
    expect(jay?.trackCount).toBeGreaterThan(0);
    expect(jay?.albumCount).toBeGreaterThan(0);
  });
});
