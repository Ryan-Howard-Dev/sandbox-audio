import { describe, expect, it } from 'vitest';
import { resolveDeviceScanMetadata } from './deviceImportMetadata';
import {
  extractEmbeddedPerformerFromText,
  inferArtistTitleFromAllCapsBlob,
  isLikelyFanEditTrackTitle,
} from './importTitleParse';
import {
  isBadMediaStoreAlbum,
  isBadMediaStoreArtist,
  isJunkImportArchiveLabel,
  isUsableArtistName,
} from './lockerStorage';
import type { DeviceMusicScanHit } from './lockerUploadFilter';

function hit(partial: Partial<DeviceMusicScanHit> & Pick<DeviceMusicScanHit, 'id' | 'contentUri'>): DeviceMusicScanHit {
  return {
    displayName: 'track.mp3',
    path: 'Music/YMusic/track.mp3',
    title: '',
    artist: '',
    album: '',
    folder: 'YMusic',
    mimeType: 'audio/mpeg',
    size: 4_000_000,
    durationMs: 180_000,
    ...partial,
  };
}

describe('device import metadata', () => {
  it('rejects YMusic and digital jockey artist tags', () => {
    expect(isBadMediaStoreArtist('digital jockey')).toBe(true);
    expect(isBadMediaStoreArtist('Ymusic')).toBe(true);
    expect(isBadMediaStoreArtist('JonJeffJon Edits')).toBe(true);
    expect(isUsableArtistName('digital jockey')).toBe(false);
    expect(isUsableArtistName('Kanye West')).toBe(true);
  });

  it('rejects YMusic archive folder album names', () => {
    expect(isBadMediaStoreAlbum('HOW? Kanye Archive')).toBe(true);
    expect(isBadMediaStoreAlbum('YMusic')).toBe(true);
    expect(isJunkImportArchiveLabel('HOW? Kanye Archive')).toBe(true);
  });

  it('parses Artist - Title from filename when MediaStore artist is junk', () => {
    const resolved = resolveDeviceScanMetadata(
      hit({
        id: '1',
        contentUri: 'content://1',
        displayName: 'Kanye West - Runaway.mp3',
        path: 'Music/YMusic/Kanye West - Runaway.mp3',
        title: 'KANYE WEST RUNAWAY',
        artist: 'digital jockey',
      }),
    );
    expect(resolved.artist).toBe('Kanye West');
    expect(resolved.title).toBe('Runaway');
    expect(resolved.albumName).toBeUndefined();
  });

  it('drops junk MediaStore album tags from YMusic imports', () => {
    const resolved = resolveDeviceScanMetadata(
      hit({
        id: '3',
        contentUri: 'content://3',
        displayName: 'ghost.mp3',
        path: 'Music/YMusic/ghost.mp3',
        title: 'KANYE WEST GHOST TOWN',
        artist: 'Ymusic',
        album: 'HOW? Kanye Archive',
      }),
    );
    expect(resolved.artist).toBe('Kanye West');
    expect(resolved.albumName).toBeUndefined();
  });

  it('splits ALL CAPS artist prefix from title blob', () => {
    expect(inferArtistTitleFromAllCapsBlob('KANYE WEST BITTERSWEET POETRY')).toEqual({
      artist: 'Kanye West',
      title: 'Bittersweet Poetry',
    });
  });

  it('uses ALL CAPS title when artist tag is Ymusic', () => {
    const resolved = resolveDeviceScanMetadata(
      hit({
        id: '2',
        contentUri: 'content://2',
        displayName: 'ghost.mp3',
        path: 'Music/YMusic/ghost.mp3',
        title: 'KANYE WEST GHOST TOWN BUT IT WILL MAKE YOU ASCEND',
        artist: 'Ymusic',
      }),
    );
    expect(resolved.artist).toBe('Kanye West');
    expect(resolved.title).toContain('Ghost Town');
  });

  it('flags long fan-edit meme titles', () => {
    expect(
      isLikelyFanEditTrackTitle('Kanye West Ghost Town But It Will Make You Ascend'),
    ).toBe(true);
    expect(extractEmbeddedPerformerFromText('Kanye West - Runaway')?.artist).toBe('Kanye West');
  });

  it('does not split short title prefixes into fake artists', () => {
    expect(extractEmbeddedPerformerFromText('Like That')?.artist).toBeUndefined();
    expect(extractEmbeddedPerformerFromText('Type Shit')?.artist).toBeUndefined();
    expect(extractEmbeddedPerformerFromText('Bad Blood')?.artist).toBeUndefined();
  });

  it('parses Title — Artist dash order correctly', () => {
    expect(extractEmbeddedPerformerFromText('Like That — Future')?.artist).toBe('Future');
    expect(extractEmbeddedPerformerFromText('Like That — Future')?.title).toBe('Like That');
    const resolved = resolveDeviceScanMetadata(
      hit({
        id: '4',
        contentUri: 'content://4',
        displayName: 'Like That — Future.mp3',
        path: 'Music/YMusic/Like That — Future.mp3',
        title: 'Like That',
        artist: 'Like',
      }),
    );
    expect(resolved.artist).toBe('Future');
    expect(resolved.title).toBe('Like That');
  });
});
