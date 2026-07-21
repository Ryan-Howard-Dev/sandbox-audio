const fs = require('fs');
const p = 'C:/Users/RH/Downloads/sovereign-music-console/src/downloadLockerPrecheck.test.ts';
let s = fs.readFileSync(p, 'utf8');
if (!s.includes('Heal Signal')) {
  s = s.replace(
    `vi.mock('./lockerStorage', () => ({
  findPlayableLockerEntryForTrack: vi.fn(async (title: string) =>
    title === 'Already Here' ? { id: 'e1' } : null,
  ),
  getLockerEntries: vi.fn(async () => []),
  tracksForAlbumGroup: vi.fn(() => []),
}));`,
    `vi.mock('./lockerStorage', () => ({
  findPlayableLockerEntryForTrack: vi.fn(async (title: string) =>
    title === 'Already Here' ? { id: 'e1' } : null,
  ),
  findLockerEntryForTrackIncludingHollow: vi.fn(async (title: string) =>
    title === 'Heal Only' ? { id: 'heal-1' } : null,
  ),
  lockerEntryHasHealSignals: vi.fn(async (id: string) => id === 'heal-1'),
  getLockerEntries: vi.fn(async () => []),
  tracksForAlbumGroup: vi.fn(() => []),
}));`,
  );
  s += `

  it('skips hollow locker rows with heal signals', async () => {
    const withHeal: CatalogTrack[] = [
      { kind: 'track', id: 'h', title: 'Heal Only', artist: 'Artist', album: 'Album' },
      { kind: 'track', id: '2', title: 'Need This', artist: 'Artist', album: 'Album' },
    ];
    const result = await filterTracksNeedingDownload(withHeal, 'Album');
    expect(result.skipped).toBe(1);
    expect(result.needing).toHaveLength(1);
    expect(result.needing[0]?.title).toBe('Need This');
  });
`;
  fs.writeFileSync(p, s);
  console.log('test patched');
}
