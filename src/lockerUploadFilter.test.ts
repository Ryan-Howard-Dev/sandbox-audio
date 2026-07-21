import { describe, expect, it } from 'vitest';
import {
  isAudiobookBlockedFile,
  isDefaultMusicSelection,
  isLikelyAudiobookLibraryHit,
  isLikelyAudiobookOrNonMusic,
  isMusicUpload,
  partitionMusicScanHits,
  partitionMusicUploads,
  MUSIC_UPLOAD_ACCEPT,
} from './lockerUploadFilter';

function file(
  name: string,
  opts?: { type?: string; size?: number; webkitRelativePath?: string },
): File {
  const blob = new Blob([], { type: opts?.type ?? '' });
  const f = new File([blob], name, { type: opts?.type ?? '' });
  Object.defineProperty(f, 'size', { value: opts?.size ?? 1024 });
  if (opts?.webkitRelativePath) {
    Object.defineProperty(f, 'webkitRelativePath', { value: opts.webkitRelativePath });
  }
  return f;
}

function scanHit(
  overrides: Partial<import('./lockerUploadFilter').DeviceMusicScanHit> &
    Pick<import('./lockerUploadFilter').DeviceMusicScanHit, 'displayName' | 'path'>,
): import('./lockerUploadFilter').DeviceMusicScanHit {
  return {
    id: '1',
    contentUri: 'content://media/1',
    title: '',
    artist: '',
    album: '',
    folder: '',
    size: 5 * 1024 * 1024,
    durationMs: 180000,
    mimeType: 'audio/mpeg',
    ...overrides,
  };
}

describe('lockerUploadFilter', () => {
  it('excludes m4b and audible extensions from music uploads', () => {
    expect(isAudiobookBlockedFile(file('story.m4b')).blocked).toBe(true);
    expect(isAudiobookBlockedFile(file('book.aa')).blocked).toBe(true);
    expect(isAudiobookBlockedFile(file('book.aax')).blocked).toBe(true);
    expect(isMusicUpload(file('track.flac'))).toBe(true);
    expect(isMusicUpload(file('track.m4b'))).toBe(false);
  });

  it('blocks audiobook mime types', () => {
    expect(isAudiobookBlockedFile(file('x.bin', { type: 'audio/x-m4b' })).blocked).toBe(true);
    expect(isAudiobookBlockedFile(file('x.bin', { type: 'application/audiobook' })).blocked).toBe(
      true,
    );
  });

  it('blocks filename and folder path hints', () => {
    expect(isAudiobookBlockedFile(file('My Audiobook.flac')).blocked).toBe(true);
    expect(
      isAudiobookBlockedFile(
        file('01.flac', { webkitRelativePath: 'Audiobooks/Author/01.flac' }),
      ).blocked,
    ).toBe(true);
    expect(isMusicUpload(file('01 - Intro.flac'))).toBe(true);
  });

  it('blocks a single very large file in a folder upload', () => {
    const huge = file('novel.m4a', { size: 90 * 1024 * 1024 });
    expect(isAudiobookBlockedFile(huge, { audioFileCount: 1 }).blocked).toBe(true);
    const albumTrack = file('01.flac', { size: 90 * 1024 * 1024 });
    expect(isAudiobookBlockedFile(albumTrack, { audioFileCount: 12 }).blocked).toBe(false);
  });

  it('partitions mixed selections', () => {
    const { music, audiobooks } = partitionMusicUploads([
      file('01.flac'),
      file('book.m4b'),
      file('02.mp3'),
    ]);
    expect(music).toHaveLength(2);
    expect(audiobooks).toHaveLength(1);
    expect(audiobooks[0].name).toBe('book.m4b');
  });

  it('accept list omits generic audio/* and m4b', () => {
    expect(MUSIC_UPLOAD_ACCEPT).not.toMatch(/audio\/\*/);
    expect(MUSIC_UPLOAD_ACCEPT).not.toMatch(/m4b/i);
  });

  it('filters George Orwell audiobook and TorrDroid downloads from music bucket', () => {
    const { music, other } = partitionMusicScanHits([
      scanHit({
        id: 'kanye',
        displayName: '01 Runaway.mp3',
        path: 'Music/YMusic/01 Runaway.mp3',
        folder: 'YMusic',
        title: 'Runaway',
        artist: 'Kanye West',
        durationMs: 9 * 60 * 1000,
      }),
      scanHit({
        id: 'orwell',
        displayName: '1984.m4a',
        path: 'Download/TorrDroid/George Orwell - Audiobook 1984.m4a',
        folder: 'TorrDroid',
        title: 'George Orwell - Audiobook: 1984',
        durationMs: 8 * 60 * 60 * 1000,
        size: 120 * 1024 * 1024,
      }),
      scanHit({
        id: 'voice',
        displayName: 'memo.m4a',
        path: 'Voice recording/memo.m4a',
        folder: 'Voice recording',
        durationMs: 60 * 1000,
      }),
      scanHit({
        id: 'doc',
        displayName: 'notes.m4a',
        path: 'Documents/AI/notes.m4a',
        folder: 'AI',
        durationMs: 120 * 1000,
      }),
    ]);

    expect(music).toHaveLength(1);
    expect(music[0].id).toBe('kanye');
    expect(other).toHaveLength(3);
    expect(other.map((h) => h.id).sort()).toEqual(['doc', 'orwell', 'voice']);
  });

  it('blocks long duration and audiobook title patterns at scan time', () => {
    expect(
      isLikelyAudiobookOrNonMusic(
        scanHit({
          displayName: 'silk-roads.m4a',
          path: 'Download/silk-roads.m4a',
          title: 'The Silk Roads — Unabridged',
          durationMs: 50 * 60 * 1000,
        }),
      ).blocked,
    ).toBe(true);

    expect(
      isLikelyAudiobookOrNonMusic(
        scanHit({
          displayName: 'suzuki.m4a',
          path: 'Download/suzuki.m4a',
          title: 'D.T. Suzuki — Narrated by John Smith',
          durationMs: 30 * 60 * 1000,
        }),
      ).blocked,
    ).toBe(true);
  });

  it('default selection only picks short tracks in Music/ or YMusic', () => {
    const kanye = scanHit({
      displayName: 'track.mp3',
      path: 'Music/YMusic/track.mp3',
      folder: 'YMusic',
      durationMs: 4 * 60 * 1000,
    });
    const longMusicFolder = scanHit({
      displayName: 'jam.mp3',
      path: 'Music/jam.mp3',
      durationMs: 25 * 60 * 1000,
    });
    const downloadTrack = scanHit({
      displayName: 'rip.mp3',
      path: 'Download/rip.mp3',
      durationMs: 3 * 60 * 1000,
    });

    expect(isDefaultMusicSelection(kanye)).toBe(true);
    expect(isDefaultMusicSelection(longMusicFolder)).toBe(false);
    expect(isDefaultMusicSelection(downloadTrack)).toBe(false);
  });

  it('partitions device scan hits with same audiobook rules', () => {
    const { music, other } = partitionMusicScanHits([
      {
        id: '1',
        contentUri: 'content://media/1',
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        displayName: '01.flac',
        folder: 'Music',
        path: 'Music/01.flac',
        size: 1024,
        durationMs: 180000,
        mimeType: 'audio/flac',
      },
      {
        id: '2',
        contentUri: 'content://media/2',
        title: 'Book',
        artist: 'Narrator',
        album: 'Audiobook',
        displayName: 'story.m4b',
        folder: 'Audiobooks',
        path: 'Audiobooks/story.m4b',
        size: 1024,
        durationMs: 3600000,
        mimeType: 'audio/x-m4b',
      },
    ]);
    expect(music).toHaveLength(1);
    expect(other).toHaveLength(1);
  });

  it('positively matches audiobook library hits without music-folder voice memos', () => {
    expect(
      isLikelyAudiobookLibraryHit(
        scanHit({
          displayName: 'chapter01.m4b',
          path: 'Audiobooks/Book/chapter01.m4b',
          folder: 'Audiobooks',
          durationMs: 3600000,
        }),
      ),
    ).toBe(true);
    expect(
      isLikelyAudiobookLibraryHit(
        scanHit({
          displayName: 'memo.m4a',
          path: 'Documents/Voice Recording/memo.m4a',
          folder: 'Voice Recording',
          durationMs: 60000,
        }),
      ),
    ).toBe(false);
  });
});
