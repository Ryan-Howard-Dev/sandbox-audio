/**
 * Regression fixtures for mixtape / unofficial album catalog identification.
 * Run: npx tsx scripts/test-mixtape-identify.ts
 */

import {
  artistLineContainsLeakWatermark,
  inferArtistFromAlbumFolder,
  isLeakWatermarkArtistName,
  isUsableArtistName,
  lockerAlbumArtistNeedsIdentification,
  resolveAlbumSearchArtist,
  resolveLockerTrackArtistLine,
  stripLeakWatermarkFromArtistLine,
} from './lockerStorage';
import { buildTrackArtistPatchesFromCatalog } from './metadataRepair';
import {
  albumTitlesFuzzyMatch,
  lookupKnownMixtapeArtist,
  normalizeAlbumTitleForMatch,
} from './searchCatalog';

/** Kanye West fan mixtape — locker folder vs cover-art title. */
export const LOUIS_VUITTON_DON_FIXTURE = {
  albumName: 'LOUIS VUITTON DON',
  coverArtTitle: 'KAN THE LOUIS VUITTON DON',
  trackArtists: ['Kanye West', 'Kanye West', 'Kanye West feat. Jay-Z'],
  expectedArtist: 'Kanye West',
  expectedCoreTitle: 'louis vuitton don',
};

export function verifyLouisVuittonDonTitleMatching(): boolean {
  return (
    albumTitlesFuzzyMatch(
      LOUIS_VUITTON_DON_FIXTURE.albumName,
      LOUIS_VUITTON_DON_FIXTURE.coverArtTitle,
    ) &&
    albumTitlesFuzzyMatch('Louis Vuitton Don', LOUIS_VUITTON_DON_FIXTURE.albumName) &&
    normalizeAlbumTitleForMatch(LOUIS_VUITTON_DON_FIXTURE.coverArtTitle) ===
      LOUIS_VUITTON_DON_FIXTURE.expectedCoreTitle
  );
}

export function runMixtapeIdentifyFixtures(): { passed: number; failed: number } {
  const checks: Array<{ name: string; ok: boolean }> = [
    {
      name: 'Louis Vuitton Don folder vs cover title',
      ok: albumTitlesFuzzyMatch('LOUIS VUITTON DON', 'KAN THE LOUIS VUITTON DON'),
    },
    {
      name: 'Louis Vuitton Don normalized core title',
      ok:
        normalizeAlbumTitleForMatch('KAN THE LOUIS VUITTON DON') === 'louis vuitton don',
    },
    {
      name: 'Mixtape marker stripped',
      ok: albumTitlesFuzzyMatch('Louis Vuitton Don Mixtape', 'LOUIS VUITTON DON'),
    },
    {
      name: 'Kon the cover-art prefix stripped',
      ok: albumTitlesFuzzyMatch('LOUIS VUITTON DON', 'KON THE LOUIS VUITTON DON'),
    },
    {
      name: 'Bare year rejected as artist name',
      ok: !isUsableArtistName('2000') && !isUsableArtistName('2004'),
    },
    {
      name: 'Leak watermark CANSE rejected as artist',
      ok:
        isLeakWatermarkArtistName('CANSE') &&
        isLeakWatermarkArtistName('Canse') &&
        !isUsableArtistName('CANSE') &&
        !isUsableArtistName('Canse'),
    },
    {
      name: 'Leak watermark phrase rejected (BURN MY SHADOW)',
      ok: isLeakWatermarkArtistName('BURN MY SHADOW') && !isUsableArtistName('BURN MY SHADOW'),
    },
    {
      name: 'Real artist names still usable (Dr. Dre, Kanye West, ESDEEKID)',
      ok:
        isUsableArtistName('Dr. Dre') &&
        isUsableArtistName('Kanye West') &&
        isUsableArtistName('NAS') &&
        isUsableArtistName('ESDEEKID') &&
        !isLeakWatermarkArtistName('ESDEEKID'),
    },
    {
      name: 'inferArtistFromAlbumFolder never returns CANSE',
      ok:
        inferArtistFromAlbumFolder('The Chronic', 'CANSE') === 'Local Upload' &&
        !isUsableArtistName(inferArtistFromAlbumFolder('The Chronic', 'CANSE')),
    },
    {
      name: 'resolveAlbumSearchArtist skips CANSE leak tags',
      ok: !isUsableArtistName(
        resolveAlbumSearchArtist('The Chronic', 'CANSE', [
          { albumArtist: 'CANSE', artist: 'CANSE' },
          { albumArtist: 'CANSE', artist: 'CANSE' },
        ]),
      ),
    },
    {
      name: 'lockerAlbumArtistNeedsIdentification for all-CANSE Chronic',
      ok: lockerAlbumArtistNeedsIdentification([
        { albumArtist: 'CANSE', artist: 'CANSE' },
        { albumArtist: 'CANSE', artist: 'CANSE' },
      ]),
    },
    {
      name: 'Composite CANSE artist line rejected as usable',
      ok:
        !isUsableArtistName('CANSE, WARREN G, SNOOP DOGG') &&
        artistLineContainsLeakWatermark('CANSE, WARREN G, SNOOP DOGG'),
    },
    {
      name: 'stripLeakWatermarkFromArtistLine removes CANSE prefix',
      ok:
        stripLeakWatermarkFromArtistLine('CANSE, Warren G, Snoop Dogg') ===
        'Warren G, Snoop Dogg',
    },
    {
      name: 'resolveLockerTrackArtistLine uses banner artist over CANSE tags',
      ok:
        resolveLockerTrackArtistLine(
          { title: "Nuthin' but a 'G' Thang", artist: 'CANSE, Warren G, Snoop Dogg' },
          'Dr. Dre',
        ) === 'Dr. Dre, Warren G, Snoop Dogg',
    },
    {
      name: 'buildTrackArtistPatchesFromCatalog replaces CANSE-tagged artist',
      ok: (() => {
        const patches = buildTrackArtistPatchesFromCatalog(
          [
            {
              id: 't1',
              title: "Nuthin' but a 'G' Thang",
              artist: 'CANSE, Warren G, Snoop Dogg',
            } as import('./lockerStorage').LockerEntry,
          ],
          [
            {
              title: "Nuthin' but a 'G' Thang",
              artist: 'Dr. Dre, Snoop Dogg',
            } as import('./searchCatalog').CatalogTrack,
          ],
        );
        return (
          patches.length === 1 &&
          patches[0]!.artist === 'Dr. Dre, Snoop Dogg' &&
          !patches[0]!.artist.includes('CANSE')
        );
      })(),
    },
    {
      name: 'Known mixtape lookup — Louis Vuitton Don → Kanye West',
      ok: lookupKnownMixtapeArtist('LOUIS VUITTON DON')?.artist === 'Kanye West',
    },
    {
      name: 'verifyLouisVuittonDonTitleMatching',
      ok: verifyLouisVuittonDonTitleMatching(),
    },
  ];

  let passed = 0;
  let failed = 0;
  for (const check of checks) {
    if (check.ok) {
      passed += 1;
      console.log(`  ✓ ${check.name}`);
    } else {
      failed += 1;
      console.error(`  ✗ ${check.name}`);
    }
  }
  return { passed, failed };
}
