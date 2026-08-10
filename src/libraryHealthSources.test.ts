import { describe, expect, it } from 'vitest';
import {
  attributeFilesToStations,
  documentItems,
  filePathFromUrl,
  lockerItems,
  podcastItems,
  type OfflineEpisodeLike,
} from './libraryHealthSources';
import type { LockerEntry } from './lockerStorage';
import type { FileEntry, LibraryRoot } from './libraryFs';

const entry = (over: Partial<LockerEntry> = {}): LockerEntry =>
  ({
    id: 'locker-1',
    title: 'Paranoid Android',
    artist: 'Radiohead',
    genre: 'Rock',
    durationSeconds: 383,
    url: 'file:///C:/library/track.flac',
    addedAt: 1,
    albumName: 'OK Computer',
    albumArt: 'data:image/png;base64,x',
    ...over,
  }) as LockerEntry;

const root = (over: Partial<LibraryRoot> = {}): LibraryRoot => ({
  id: 'root-1',
  path: 'C:/library/music',
  kind: 'music',
  addedAt: 1,
  ...over,
});

const fileEntry = (over: Partial<FileEntry> = {}): FileEntry => ({
  path: 'C:/library/music/track.flac',
  name: 'track.flac',
  isDir: false,
  size: 10,
  modified: 0,
  extension: 'flac',
  ...over,
});

describe('filePathFromUrl', () => {
  it('unwraps a Windows file url, dropping the slash before the drive letter', () => {
    expect(filePathFromUrl('file:///C:/library/track.flac')).toBe('C:/library/track.flac');
  });

  it('unwraps a posix file url', () => {
    expect(filePathFromUrl('file:///home/rh/track.flac')).toBe('/home/rh/track.flac');
  });

  it('decodes escaped characters, because real folders have spaces in them', () => {
    expect(filePathFromUrl('file:///C:/My%20Music/a%20b.flac')).toBe('C:/My Music/a b.flac');
  });

  it('accepts a bare Windows path', () => {
    expect(filePathFromUrl('C:\\library\\track.flac')).toBe('C:\\library\\track.flac');
  });

  it('returns nothing for anything that is not a file on this machine', () => {
    // These cannot go missing from disk, so they must never be reported as a missing file.
    expect(filePathFromUrl('https://example.com/a.mp3')).toBeUndefined();
    expect(filePathFromUrl('blob:http://localhost/abc')).toBeUndefined();
    expect(filePathFromUrl('/api/locker/blob/abc123')).toBe('/api/locker/blob/abc123');
    expect(filePathFromUrl('')).toBeUndefined();
    expect(filePathFromUrl(undefined)).toBeUndefined();
  });
});

describe('lockerItems', () => {
  it('carries the fields the analysis reads', () => {
    const [item] = lockerItems([entry()]);
    expect(item).toMatchObject({
      id: 'locker-1',
      station: 'music',
      title: 'Paranoid Android',
      artist: 'Radiohead',
      album: 'OK Computer',
      path: 'C:/library/track.flac',
    });
  });

  it('leaves path unset for a streamed row', () => {
    const [item] = lockerItems([entry({ url: 'https://example.com/a.mp3' })]);
    expect(item.path).toBeUndefined();
  });
});

describe('podcastItems', () => {
  const row = (over: Partial<OfflineEpisodeLike> = {}): OfflineEpisodeLike => ({
    feedId: 'feed-1',
    feedTitle: 'A Show',
    feedArtworkUrl: 'https://art/show.jpg',
    episode: {
      id: 'ep-1',
      title: 'Episode One',
      durationSeconds: 100,
      audioUrl: 'https://audio/ep1.mp3',
    },
    ...over,
  });

  it('names the show as the artist', () => {
    const [item] = podcastItems([row()]);
    expect(item.artist).toBe('A Show');
    expect(item.station).toBe('podcast');
  });

  it('inherits the show artwork, because an episode without its own is not missing art', () => {
    const [item] = podcastItems([row()]);
    expect(item.artworkUrl).toBe('https://art/show.jpg');
  });

  it('prefers the episode artwork when it has its own', () => {
    const [item] = podcastItems([
      row({
        episode: {
          id: 'ep-1',
          title: 'Episode One',
          artworkUrl: 'https://art/ep.jpg',
          audioUrl: 'https://audio/ep1.mp3',
        },
      }),
    ]);
    expect(item.artworkUrl).toBe('https://art/ep.jpg');
  });

  it('reports genuinely absent artwork', () => {
    const [item] = podcastItems([row({ feedArtworkUrl: undefined })]);
    expect(item.artworkUrl).toBeUndefined();
  });
});

describe('documentItems', () => {
  it('maps a book onto the document station', () => {
    const [item] = documentItems([
      { id: 'doc-1', name: 'Dune', author: 'Frank Herbert', coverUrl: 'data:image/png;base64,x' },
    ]);
    expect(item).toMatchObject({ station: 'document', title: 'Dune', artist: 'Frank Herbert' });
  });
});

describe('attributeFilesToStations', () => {
  it('tags a file with the station of the folder it sits in', () => {
    const [tagged] = attributeFilesToStations(
      [fileEntry({ path: 'C:/library/books/dune.m4b' })],
      [root(), root({ id: 'root-2', path: 'C:/library/books', kind: 'audiobook' })],
    );
    expect(tagged.station).toBe('audiobook');
  });

  it('matches through separator and case differences', () => {
    const [tagged] = attributeFilesToStations(
      [fileEntry({ path: 'c:\\library\\music\\a.flac' })],
      [root()],
    );
    expect(tagged.station).toBe('music');
  });

  it('leaves a file under no root unattributed rather than guessing', () => {
    const [tagged] = attributeFilesToStations(
      [fileEntry({ path: 'D:/elsewhere/a.flac' })],
      [root()],
    );
    expect(tagged.station).toBeUndefined();
  });

  it('does not treat a sibling folder with a shared prefix as being inside the root', () => {
    const [tagged] = attributeFilesToStations(
      [fileEntry({ path: 'C:/library/music-backup/a.flac' })],
      [root()],
    );
    expect(tagged.station).toBeUndefined();
  });
});
