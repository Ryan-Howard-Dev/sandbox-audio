import { describe, expect, it } from 'vitest';
import {
  collectableExtensions,
  fileExtension,
  folderForFile,
  isReadableToday,
  targetPathFor,
  LIBRARY_FOLDERS,
} from './libraryFolders';

describe('fileExtension', () => {
  it('reads the extension from a bare name or a full path', () => {
    expect(fileExtension('book.epub')).toBe('epub');
    expect(fileExtension('/sdcard/Download/Project Hail Mary - Andy Weir.epub')).toBe('epub');
    expect(fileExtension('C:\Users\RH\Calibre Library\a.AZW3')).toBe('azw3');
  });

  it('returns empty where there is no usable extension', () => {
    expect(fileExtension('README')).toBe('');
    expect(fileExtension('trailing.')).toBe('');
    expect(fileExtension('.hidden')).toBe('');
  });
});

describe('folderForFile', () => {
  it('files audio by kind, keeping audiobooks out of music', () => {
    expect(folderForFile('track.mp3')).toBe('music');
    expect(folderForFile('track.flac')).toBe('music');
    // m4b is audio but is a book by construction, and the native scan already separates it.
    expect(folderForFile('novel.m4b')).toBe('audiobooks');
    expect(folderForFile('novel.aax')).toBe('audiobooks');
  });

  it('files books by container, including ones nothing can read yet', () => {
    expect(folderForFile('a.epub')).toBe('books');
    expect(folderForFile('a.azw3')).toBe('books');
    expect(folderForFile('a.mobi')).toBe('books');
  });

  it('files documents', () => {
    expect(folderForFile('paper.pdf')).toBe('documents');
    expect(folderForFile('assessment.docx')).toBe('documents');
    expect(folderForFile('notes.md')).toBe('documents');
  });

  it('never guesses podcasts from a filename', () => {
    // Provenance, not extension: an episode is a fact about the feed that fetched it.
    expect(folderForFile('episode.mp3')).toBe('music');
    expect(LIBRARY_FOLDERS).toContain('podcasts');
  });

  it('returns null rather than defaulting, so no shelf lies about its contents', () => {
    expect(folderForFile('poster.jpg')).toBeNull();
    expect(folderForFile('comic.cbr')).toBeNull();
    expect(folderForFile('archive.zip')).toBeNull();
    expect(folderForFile('README')).toBeNull();
  });
});

describe('isReadableToday', () => {
  it('separates what is filed from what can actually be opened', () => {
    expect(isReadableToday('a.epub')).toBe(true);
    expect(isReadableToday('a.pdf')).toBe(true);
    expect(isReadableToday('a.docx')).toBe(true);
    // Filed on the Books shelf, but no reader exists yet — shown, not hidden.
    expect(isReadableToday('a.azw3')).toBe(false);
    expect(isReadableToday('a.mobi')).toBe(false);
  });

  it('is false for anything with no folder at all', () => {
    expect(isReadableToday('poster.jpg')).toBe(false);
  });
});

describe('targetPathFor', () => {
  it('puts each kind under its own folder', () => {
    expect(targetPathFor('track.mp3')).toBe('Sandbox/Music/track.mp3');
    expect(targetPathFor('novel.m4b')).toBe('Sandbox/Audiobooks/novel.m4b');
    expect(targetPathFor('book.epub')).toBe('Sandbox/Books/book.epub');
    expect(targetPathFor('paper.pdf')).toBe('Sandbox/Documents/paper.pdf');
  });

  it('strips any incoming directory so a source path cannot escape the root', () => {
    expect(targetPathFor('/sdcard/Download/book.epub')).toBe('Sandbox/Books/book.epub');
    expect(targetPathFor('../../etc/passwd.epub')).toBe('Sandbox/Books/passwd.epub');
  });

  it('returns null for files with no home', () => {
    expect(targetPathFor('poster.jpg')).toBeNull();
  });
});

describe('collectableExtensions', () => {
  it('covers every format the library files, with no duplicates', () => {
    const all = collectableExtensions();
    expect(all).toContain('epub');
    expect(all).toContain('m4b');
    expect(all).toContain('docx');
    expect(new Set(all).size).toBe(all.length);
  });
});
