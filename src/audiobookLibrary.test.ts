import { describe, expect, it } from 'vitest';
import { groupAudiobookHits, resolveAudiobookAuthor, resolveAudiobookTitle } from './audiobookLibrary';
import { isBadAudiobookAuthor, isBadAudiobookTitle } from './audiobookMetadata';
import type { DeviceMusicScanHit } from './lockerUploadFilter';

function hit(partial: Partial<DeviceMusicScanHit> & Pick<DeviceMusicScanHit, 'id'>): DeviceMusicScanHit {
  return {
    contentUri: `content://media/${partial.id}`,
    title: '',
    artist: '',
    album: '',
    displayName: 'book.m4b',
    folder: 'Audiobooks',
    path: 'Audiobooks/book.m4b',
    size: 1,
    durationMs: 60_000,
    mimeType: 'audio/mp4',
    ...partial,
  };
}

describe('audiobook metadata hygiene', () => {
  it('flags placeholder titles and authors', () => {
    expect(isBadAudiobookTitle('-')).toBe(true);
    expect(isBadAudiobookTitle('Unknown')).toBe(true);
    expect(isBadAudiobookAuthor('author name')).toBe(true);
    expect(isBadAudiobookAuthor('Neil Gaiman')).toBe(false);
  });

  it('prefers album / folder over junk MediaStore title', () => {
    const row = hit({
      id: '1',
      title: '-',
      artist: 'author name',
      album: 'Neverwhere',
      folder: 'Gaiman',
      displayName: '01-chapter.mp3',
    });
    expect(resolveAudiobookTitle(row)).toBe('Neverwhere');
    expect(resolveAudiobookAuthor(row)).toBe('Unknown author');
  });

  it('groups chapter files into one book', () => {
    const books = groupAudiobookHits([
      hit({
        id: '1',
        album: 'Dune',
        artist: 'Frank Herbert',
        title: 'Chapter 01',
        displayName: '01.mp3',
      }),
      hit({
        id: '2',
        album: 'Dune',
        artist: 'Frank Herbert',
        title: 'Chapter 02',
        displayName: '02.mp3',
      }),
    ]);
    expect(books).toHaveLength(1);
    expect(books[0]!.title).toBe('Dune');
    expect(books[0]!.tracks).toHaveLength(2);
  });
});
