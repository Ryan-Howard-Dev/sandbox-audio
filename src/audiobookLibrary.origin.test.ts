import { describe, expect, it } from 'vitest';
import {
  audiobookOrigin,
  audiobookOriginForPath,
  type AudiobookBook,
} from './audiobookLibrary';

function book(paths: string[]): AudiobookBook {
  return {
    key: 'k',
    title: 'T',
    author: 'A',
    durationSeconds: 0,
    tracks: paths.map((path, i) => ({
      id: String(i),
      contentUri: '',
      title: 'c',
      artist: '',
      album: '',
      displayName: '',
      folder: '',
      path,
      size: 0,
      durationMs: 0,
      mimeType: 'audio/mpeg',
      chapterLabel: `Chapter ${i + 1}`,
    })),
  };
}

describe('audiobookOriginForPath', () => {
  it('treats app-managed folders as downloaded', () => {
    expect(audiobookOriginForPath('/storage/emulated/0/Sandbox/Books/x.m4b')).toBe('downloaded');
    expect(
      audiobookOriginForPath('/Android/data/rd.sheepskin.sandboxmusic/files/books/x.m4b'),
    ).toBe('downloaded');
    expect(audiobookOriginForPath('/storage/emulated/0/Audiobooks/downloads/x.mp3')).toBe(
      'downloaded',
    );
  });

  it('treats the user’s own device files as uploaded', () => {
    expect(audiobookOriginForPath('/storage/emulated/0/Music/MyBook/ch1.mp3')).toBe('uploaded');
    expect(audiobookOriginForPath('/storage/1234-5678/Books/ch1.m4b')).toBe('uploaded');
    expect(audiobookOriginForPath('')).toBe('uploaded');
  });
});

describe('audiobookOrigin', () => {
  it('is downloaded when any chapter lives in an app folder', () => {
    expect(
      audiobookOrigin(book(['/storage/emulated/0/Music/a.mp3', '/storage/emulated/0/Sandbox/b.mp3'])),
    ).toBe('downloaded');
  });

  it('is uploaded when every chapter is a user file', () => {
    expect(audiobookOrigin(book(['/storage/emulated/0/Music/a.mp3']))).toBe('uploaded');
  });
});
