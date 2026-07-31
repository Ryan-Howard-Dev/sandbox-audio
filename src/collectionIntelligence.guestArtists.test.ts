import { describe, expect, it } from 'vitest';
import { buildCanonicalArtists } from './collectionIntelligence';
import type { LockerEntry } from './lockerStorage';

function track(over: Partial<LockerEntry>): LockerEntry {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Track',
    artist: 'Someone',
    addedAt: Date.now(),
    ...over,
  } as LockerEntry;
}

describe('locker artist rows — guest credits', () => {
  const entries: LockerEntry[] = [
    // Kanye album; Andre Troutman only ever appears as a feature here.
    track({
      title: 'ALL THE LOVE',
      artist: 'Kanye West & Andre Troutman',
      albumArtist: 'Kanye West',
      albumName: 'BULLY - DELUXE',
    }),
    track({
      title: 'WHITE LINES',
      artist: 'Kanye West & Andre Troutman',
      albumArtist: 'Kanye West',
      albumName: 'BULLY - DELUXE',
    }),
    // Denzel album; 454 only ever appears as a feature here.
    track({
      title: 'Sanjuro',
      artist: 'Denzel Curry & 454',
      albumArtist: 'Denzel Curry',
      albumName: 'Melt My Eyez See Your Future',
    }),
    // Danny Brown guests on a JPEGMAFIA record...
    track({
      title: 'Lean Beef Patty',
      artist: 'JPEGMAFIA & Danny Brown',
      albumArtist: 'JPEGMAFIA',
      albumName: 'SCARING THE HOES',
    }),
    // ...but also headlines his own album, so he stays a real library artist.
    track({
      title: 'Really Doe',
      artist: 'Danny Brown',
      albumArtist: 'Danny Brown',
      albumName: 'Atrocity Exhibition',
    }),
  ];

  const rows = buildCanonicalArtists(entries);
  const byName = (n: string) => rows.find((r) => r.name === n);
  // What the library artist list actually renders.
  const headlineNames = rows.filter((r) => !r.guestOnly).map((r) => r.name);

  it('keeps headline album artists in the library list', () => {
    expect(headlineNames).toContain('Kanye West');
    expect(headlineNames).toContain('Denzel Curry');
    expect(headlineNames).toContain('JPEGMAFIA');
  });

  it('flags feature-only collaborators as guestOnly so the list hides them', () => {
    expect(byName('Andre Troutman')?.guestOnly).toBe(true);
    expect(byName('454')?.guestOnly).toBe(true);
    expect(headlineNames).not.toContain('Andre Troutman');
    expect(headlineNames).not.toContain('454');
  });

  it('still keeps guests in the graph so appears-on links resolve', () => {
    expect(byName('Andre Troutman')).toBeDefined();
    expect(byName('454')?.trackCount).toBeGreaterThan(0);
  });

  it('keeps a guest who also headlines their own album', () => {
    expect(byName('Danny Brown')?.guestOnly).toBeFalsy();
    expect(headlineNames).toContain('Danny Brown');
  });
});
