const fs = require('fs');
const root = 'C:/Users/RH/Downloads/sovereign-music-console/src';

// Fix tests
const precheckTest = `${root}/downloadLockerPrecheck.test.ts`;
let t = fs.readFileSync(precheckTest, 'utf8');
t = t.replace(
  'findLockerEntryForTrackIncludingHollow: vi.fn(async (title: string) =>',
  'findLockerEntryForTrackIncludingHollow: vi.fn((title: string) =>',
);
t = t.replace(/\}\);\r?\n\r?\n\r?\n  it\('skips hollow/, `  it('skips hollow`);
if (!t.includes("it('skips hollow locker rows")) {
  throw new Error('heal test placement');
}
fs.writeFileSync(precheckTest, t);

const resumeTest = `${root}/downloadQueue.resume.test.ts`;
let r = fs.readFileSync(resumeTest, 'utf8');
r = r.replace(
  `vi.mock('./lockerStorage', () => ({
  findPlayableLockerEntryForTrack: vi.fn(async () => null),
}));`,
  `vi.mock('./lockerStorage', () => ({
  findPlayableLockerEntryForTrack: vi.fn(async () => null),
  findLockerEntryForTrackIncludingHollow: vi.fn(() => null),
  lockerEntryHasHealSignals: vi.fn(async () => false),
}));`,
);
fs.writeFileSync(resumeTest, r);

// Fix playLockerTrack hollow fallback
const layer3 = `${root}/sandboxLayer3.tsx`;
let s = fs.readFileSync(layer3, 'utf8');
const old = `      playLockerTrack: async (artistName, trackTitle, albumTitle) => {
        setHomeAwaitingUserResume(false);
        const entry = await findPlayableLockerEntryForTrack(
          trackTitle,
          artistName,
          albumTitle,
          getLockerEntriesSnapshot(),
        );
        const seed = {
          envelopeId: entry ? \`local-\${entry.id}\` : '',
          title: trackTitle,
          artist: artistName,
          album: albumTitle ?? entry?.albumName,
          durationSeconds: entry?.durationSeconds ?? 0,
          provider: 'local-vault' as const,
          transport: 'element-src' as const,
          sourceId: entry?.id ?? '',
          url: entry?.url ?? '',
        };`;
const neu = `      playLockerTrack: async (artistName, trackTitle, albumTitle) => {
        setHomeAwaitingUserResume(false);
        const snapshot = getLockerEntriesSnapshot();
        let entry = await findPlayableLockerEntryForTrack(
          trackTitle,
          artistName,
          albumTitle,
          snapshot,
        );
        if (!entry) {
          entry =
            findLockerEntryForTrackIncludingHollow(
              trackTitle,
              artistName,
              albumTitle,
              snapshot,
            ) ?? null;
        }
        const seed = {
          envelopeId: entry ? \`local-\${entry.id}\` : '',
          title: trackTitle,
          artist: artistName,
          album: albumTitle ?? entry?.albumName,
          durationSeconds: entry?.durationSeconds ?? 0,
          provider: 'local-vault' as const,
          transport: 'element-src' as const,
          sourceId: entry?.id ?? '',
          url: entry?.url ?? '',
        };`;
if (!s.includes(old)) throw new Error('playLockerTrack block not found');
if (!s.includes('findLockerEntryForTrackIncludingHollow')) {
  s = s.replace(
    'findPlayableLockerEntryForTrack,',
    'findPlayableLockerEntryForTrack,\n  findLockerEntryForTrackIncludingHollow,',
  );
}
s = s.replace(old, neu);
fs.writeFileSync(layer3, s);
console.log('tests and playLockerTrack patched');
