import { describe, expect, it } from 'vitest';
import {
  analyseLibraryHealth,
  describeGroup,
  duplicateKey,
  hasWeakMetadata,
  isAudioFile,
  normalizePath,
  type HealthItem,
  type ScannedFile,
} from './libraryHealth';
import type { PhysicalCopy } from './physicalCollection';

const item = (over: Partial<HealthItem> = {}): HealthItem => ({
  id: 'item-1',
  station: 'music',
  title: 'Paranoid Android',
  artist: 'Radiohead',
  album: 'OK Computer',
  artworkUrl: 'file:///art.jpg',
  ...over,
});

const file = (over: Partial<ScannedFile> = {}): ScannedFile => ({
  path: 'C:/library/track.flac',
  name: 'track.flac',
  isDir: false,
  size: 1000,
  extension: 'flac',
  ...over,
});

const copy = (over: Partial<PhysicalCopy> = {}): PhysicalCopy => ({
  id: 'copy-1',
  title: 'OK Computer',
  artist: 'Radiohead',
  format: 'cd',
  addedAt: 1,
  ...over,
});

function group(report: ReturnType<typeof analyseLibraryHealth>, kind: string) {
  return report.groups.find((g) => g.kind === kind);
}

describe('normalizePath', () => {
  it('treats the same file reached two ways as one file', () => {
    expect(normalizePath('C:\\Library\\Track.flac')).toBe(normalizePath('c:/library/track.flac'));
  });

  it('ignores a trailing separator', () => {
    expect(normalizePath('C:/library/')).toBe(normalizePath('C:/library'));
  });
});

describe('isAudioFile', () => {
  it('accepts the formats the library actually holds', () => {
    for (const ext of ['mp3', 'flac', 'm4b', 'opus']) {
      expect(isAudioFile(file({ extension: ext })), ext).toBe(true);
    }
  });

  it('rejects folders and artwork', () => {
    expect(isAudioFile(file({ isDir: true }))).toBe(false);
    expect(isAudioFile(file({ extension: 'jpg', name: 'cover.jpg' }))).toBe(false);
  });

  it('falls back to the name when the scan gave no extension', () => {
    expect(isAudioFile(file({ extension: null, name: 'song.FLAC' }))).toBe(true);
  });
});

describe('hasWeakMetadata', () => {
  it('accepts a properly tagged item', () => {
    expect(hasWeakMetadata(item())).toBe(false);
  });

  it('catches an empty field', () => {
    expect(hasWeakMetadata(item({ artist: '   ' }))).toBe(true);
    expect(hasWeakMetadata(item({ title: '' }))).toBe(true);
  });

  it('catches the stand-ins an importer invents', () => {
    // The whole point: these are non-empty, so a check that only asks "is it blank" passes them.
    expect(hasWeakMetadata(item({ title: 'Track 01' }))).toBe(true);
    expect(hasWeakMetadata(item({ title: 'untitled' }))).toBe(true);
    expect(hasWeakMetadata(item({ artist: 'Unknown Artist' }))).toBe(true);
    expect(hasWeakMetadata(item({ artist: 'Various Artists' }))).toBe(true);
  });

  it('does not mistake a real title that merely contains a placeholder word', () => {
    expect(hasWeakMetadata(item({ title: 'Unknown Pleasures' }))).toBe(false);
    expect(hasWeakMetadata(item({ title: 'Race Track Blues' }))).toBe(false);
  });
});

describe('duplicateKey', () => {
  it('matches through punctuation and casing', () => {
    expect(duplicateKey(item({ title: "Don't Panic" }))).toBe(
      duplicateKey(item({ title: 'dont panic' })),
    );
  });

  it('separates the same song on two different albums', () => {
    // A track on its own album and again on a compilation is two legitimate files.
    expect(duplicateKey(item({ album: 'OK Computer' }))).not.toBe(
      duplicateKey(item({ album: 'Greatest Hits' })),
    );
  });
});

describe('analyseLibraryHealth', () => {
  it('reports nothing for a clean library', () => {
    const report = analyseLibraryHealth({
      items: [item({ path: 'C:/library/a.flac' })],
      files: [file({ path: 'C:/library/a.flac' })],
      copies: [],
    });
    expect(report.totalFindings).toBe(0);
    expect(report.groups).toEqual([]);
  });

  it('finds a row whose file is gone', () => {
    const report = analyseLibraryHealth({
      items: [item({ path: 'C:/library/missing.flac' })],
      files: [],
    });
    expect(group(report, 'missingFile')?.count).toBe(1);
    expect(group(report, 'missingFile')?.severity).toBe('problem');
  });

  it('matches a file through separator and case differences before calling it missing', () => {
    const report = analyseLibraryHealth({
      items: [item({ path: 'C:\\Library\\A.flac' })],
      files: [file({ path: 'c:/library/a.flac' })],
    });
    expect(group(report, 'missingFile')).toBeUndefined();
  });

  it('never reports a missing file when no scan was supplied', () => {
    // Without a scan every local row would look missing, which is worse than saying nothing.
    const report = analyseLibraryHealth({ items: [item({ path: 'C:/library/a.flac' })] });
    expect(group(report, 'missingFile')).toBeUndefined();
    expect(report.scanMissing).toBe(true);
  });

  it('does not report a missing file for something that only streams', () => {
    const report = analyseLibraryHealth({ items: [item({ path: undefined })], files: [] });
    expect(group(report, 'missingFile')).toBeUndefined();
  });

  it('finds audio on disk that no station knows about', () => {
    const report = analyseLibraryHealth({
      items: [],
      files: [file({ path: 'C:/library/orphan.flac', name: 'orphan.flac' })],
    });
    expect(group(report, 'untrackedFile')?.count).toBe(1);
  });

  it('does not call a file untracked when an item claims it', () => {
    const report = analyseLibraryHealth({
      items: [item({ path: 'C:/library/track.flac' })],
      files: [file({ path: 'C:/library/track.flac' })],
    });
    expect(group(report, 'untrackedFile')).toBeUndefined();
  });

  it('groups duplicates into one finding rather than one per copy', () => {
    const report = analyseLibraryHealth({
      items: [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })],
      files: [],
    });
    const dupes = group(report, 'duplicate');
    expect(dupes?.count).toBe(1);
    expect(dupes?.examples[0].refs).toEqual(['a', 'b', 'c']);
    expect(dupes?.examples[0].detail).toBe('3 copies');
  });

  it('does not collect every blank row into one enormous duplicate group', () => {
    const report = analyseLibraryHealth({
      items: [
        item({ id: 'a', title: '', artist: '', album: '' }),
        item({ id: 'b', title: '', artist: '', album: '' }),
      ],
      files: [],
    });
    expect(group(report, 'duplicate')).toBeUndefined();
  });

  it('finds a record owned on the shelf with nothing in the library matching it', () => {
    const report = analyseLibraryHealth({
      items: [item({ album: 'Kid A' })],
      files: [],
      copies: [copy({ title: 'OK Computer' })],
    });
    expect(group(report, 'ownedNotRipped')?.count).toBe(1);
  });

  it('does not flag a record that is in the library', () => {
    const report = analyseLibraryHealth({
      items: [item({ album: 'OK Computer', artist: 'Radiohead' })],
      files: [],
      copies: [copy()],
    });
    expect(group(report, 'ownedNotRipped')).toBeUndefined();
  });

  it('counts every station separately so the worst one is obvious', () => {
    const report = analyseLibraryHealth({
      items: [
        item({ id: 'm', station: 'music', artworkUrl: undefined }),
        item({ id: 'p', station: 'podcast', artworkUrl: undefined, album: 'Feed' }),
        item({ id: 'b', station: 'audiobook', artworkUrl: undefined, album: 'Series' }),
      ],
      files: [],
    });
    expect(report.byStation.music).toBe(1);
    expect(report.byStation.podcast).toBe(1);
    expect(report.byStation.audiobook).toBe(1);
    expect(report.byStation.document).toBe(0);
  });

  it('counts exactly while capping what it hands back', () => {
    // A library with thousands of untagged files must report the true number and not thousands of
    // rows; the count is the fact worth knowing.
    const items = Array.from({ length: 500 }, (_, i) =>
      item({ id: `i${i}`, title: `Title ${i}`, artworkUrl: undefined }),
    );
    const report = analyseLibraryHealth({ items, files: [] }, { sampleSize: 5 });
    const artwork = group(report, 'missingArtwork');
    expect(artwork?.count).toBe(500);
    expect(artwork?.examples).toHaveLength(5);
  });

  it('orders groups so what is broken comes before what is merely untidy', () => {
    const report = analyseLibraryHealth({
      items: [
        item({ id: 'a', path: 'C:/library/gone.flac', artworkUrl: undefined }),
        item({ id: 'b', artworkUrl: undefined }),
        item({ id: 'c', artworkUrl: undefined }),
      ],
      files: [],
    });
    expect(report.groups[0].kind).toBe('missingFile');
    expect(report.groups[0].severity).toBe('problem');
    expect(report.groups.at(-1)?.severity).toBe('note');
  });
});

describe('describeGroup', () => {
  it('gets singular and plural right', () => {
    expect(
      describeGroup({ kind: 'missingFile', severity: 'problem', count: 1, examples: [] }),
    ).toBe('1 item whose file is gone');
    expect(
      describeGroup({ kind: 'untrackedFile', severity: 'note', count: 4, examples: [] }),
    ).toBe('4 audio files the library has never seen');
  });
});
