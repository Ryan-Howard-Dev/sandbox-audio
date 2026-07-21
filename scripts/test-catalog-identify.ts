/**
 * Live catalog identification checks (iTunes + MusicBrainz).
 * Run: npx tsx scripts/test-catalog-identify.ts
 */

const prefStore = new Map<string, string>();
const storageShim: Storage = {
  get length() {
    return prefStore.size;
  },
  clear: () => prefStore.clear(),
  getItem: (key: string) => prefStore.get(key) ?? null,
  key: (index: number) => [...prefStore.keys()][index] ?? null,
  removeItem: (key: string) => {
    prefStore.delete(key);
  },
  setItem: (key: string, value: string) => {
    prefStore.set(key, value);
  },
};
(globalThis as typeof globalThis & { localStorage: Storage; sessionStorage: Storage }).localStorage =
  storageShim;
(globalThis as typeof globalThis & { localStorage: Storage; sessionStorage: Storage }).sessionStorage =
  storageShim;

const { runMixtapeIdentifyFixtures } = await import('../src/catalogIdentifyMixtape.fixture');
const {
  identifyAlbumByTrackFingerprint,
  identifyCatalogAlbumByTitle,
  scoreTracklistFingerprint,
} = await import('../src/searchCatalog');

/** Full 1992 tracklist — leak uploads often tag every file as CANSE. */
export const THE_CHRONIC_TRACKS = [
  { title: 'The Chronic (Intro)' },
  { title: "Fuck wit Dre Day (And Everybody's Celebratin')" },
  { title: 'Let Me Ride' },
  { title: 'The Day the Niggaz Took Over' },
  { title: "Nuthin' but a 'G' Thang" },
  { title: 'Deeez Nuuuts' },
  { title: "Lil' Ghetto Boy" },
  { title: 'A Nigga Wit Gunz' },
  { title: 'Rat-Tat-Tat-Tat' },
  { title: 'The $20 Sack Pyramid' },
  { title: 'Lyrical Gangbang' },
  { title: 'High Powered' },
  { title: "The Doctor's Office" },
  { title: 'Stranded on Death Row' },
  { title: 'The Roach (The Chronic Outro)' },
  { title: "Bitches Ain't Shit" },
];

async function assertMatch(
  label: string,
  title: string,
  opts: {
    artistHint?: string;
    trackCount?: number;
    trackTitles?: string[];
    releaseYear?: string;
    expectedArtist: RegExp;
  },
): Promise<boolean> {
  const match = await identifyCatalogAlbumByTitle(title, {
    artistHint: opts.artistHint,
    trackCount: opts.trackCount,
    trackTitles: opts.trackTitles,
    releaseYear: opts.releaseYear,
  });
  const artist = match?.album.artist ?? '';
  const ok = opts.expectedArtist.test(artist);
  if (ok) {
    console.log(`  ✓ ${label} → ${artist}`);
  } else {
    console.error(`  ✗ ${label} → ${artist || '(no match)'}`);
  }
  return ok;
}

console.log('Unit fixtures:');
const unit = runMixtapeIdentifyFixtures();
console.log(`\n${unit.passed} passed, ${unit.failed} failed\n`);

console.log('Tracklist fingerprint (The Chronic fixture):');
const chronicFp = await identifyAlbumByTrackFingerprint('The Chronic', THE_CHRONIC_TRACKS, '1992');
const chronicFpOk = chronicFp?.album.artist && /Dr\.?\s*Dre/i.test(chronicFp.album.artist);
if (chronicFpOk) {
  console.log(`  ✓ fingerprint → ${chronicFp!.album.artist} (confidence ${chronicFp!.confidence})`);
} else {
  console.error(`  ✗ fingerprint → ${chronicFp?.album.artist ?? '(no match)'}`);
}

const fpScore = scoreTracklistFingerprint(
  THE_CHRONIC_TRACKS.map((t) => t.title),
  [
    'The Chronic (Intro)',
    "Fuck Wit Dre Day (And Everybody's Celebratin')",
    'Let Me Ride',
    "Nuthin' but a 'G' Thang",
    'Bitches Ain\'t Shit',
  ],
);
console.log(
  `  partial overlap score: ${fpScore.score} (${fpScore.matched}/${THE_CHRONIC_TRACKS.length}, ratio ${fpScore.ratio.toFixed(2)})`,
);

console.log('\nLive catalog identification:');
const liveChecks = await Promise.all([
  assertMatch('The Chronic (CANSE + fingerprint)', 'The Chronic', {
    artistHint: 'CANSE',
    trackCount: 16,
    trackTitles: THE_CHRONIC_TRACKS.map((t) => t.title),
    releaseYear: '1992',
    expectedArtist: /Dr\.?\s*Dre/i,
  }),
  assertMatch('The Chronic (CANSE leak tags)', 'The Chronic', {
    artistHint: 'CANSE',
    trackCount: 16,
    expectedArtist: /Dr\.?\s*Dre/i,
  }),
  assertMatch('The Chronic (no hint)', 'The Chronic', {
    trackCount: 16,
    expectedArtist: /Dr\.?\s*Dre/i,
  }),
  assertMatch('MBDTF (CANSE leak tags)', 'My Beautiful Dark Twisted Fantasy', {
    artistHint: 'CANSE',
    trackCount: 13,
    expectedArtist: /Kanye West/i,
  }),
]);

const liveFailed = liveChecks.filter((ok) => !ok).length;
const fpFailed = chronicFpOk ? 0 : 1;
const failed = unit.failed + liveFailed + fpFailed;
console.log(`\nTotal: ${unit.passed + liveChecks.length + 1 - failed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
