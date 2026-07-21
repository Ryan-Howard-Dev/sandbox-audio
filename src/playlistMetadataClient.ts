import type { ImportPlatformId } from './importPlatforms';
import type { PlaylistImportMetadata } from './playlistImportTypes';
import { fetchAppleMusicPlaylistMetadataClient } from './playlistMetadataApple';
import {
  fetchAmazonMusicPlaylistMetadataClient,
  fetchBandcampPlaylistMetadataClient,
  fetchPandoraPlaylistMetadataClient,
} from './playlistMetadataFallback';
import { fetchDeezerPlaylistMetadataClient } from './playlistMetadataDeezer';
import { fetchSoundCloudPlaylistMetadataClient } from './playlistMetadataSoundCloud';
import { fetchSpotifyPlaylistMetadataClient } from './playlistMetadataSpotify';
import { fetchTidalPlaylistMetadataClient } from './playlistMetadataTidal';
import { fetchYoutubeMusicPlaylistMetadataClient } from './playlistMetadataYoutube';

/** On-device playlist metadata fetch when Sandbox Server is unavailable. */
export async function fetchClientPlaylistMetadata(
  platformId: ImportPlatformId,
  pageUrl: string,
): Promise<PlaylistImportMetadata> {
  switch (platformId) {
    case 'tidal':
      return fetchTidalPlaylistMetadataClient(pageUrl);
    case 'spotify':
      return fetchSpotifyPlaylistMetadataClient(pageUrl);
    case 'deezer':
      return fetchDeezerPlaylistMetadataClient(pageUrl);
    case 'youtube-music':
      return fetchYoutubeMusicPlaylistMetadataClient(pageUrl);
    case 'soundcloud':
      return fetchSoundCloudPlaylistMetadataClient(pageUrl);
    case 'catalog-playlist':
    case 'apple-music':
      return fetchAppleMusicPlaylistMetadataClient(pageUrl);
    case 'bandcamp':
      return fetchBandcampPlaylistMetadataClient(pageUrl);
    case 'amazon-music':
      return fetchAmazonMusicPlaylistMetadataClient(pageUrl);
    case 'pandora':
      return fetchPandoraPlaylistMetadataClient(pageUrl);
    default:
      return { validated: false };
  }
}

export function mapClientMetadataToExternal(
  metadata: PlaylistImportMetadata,
): {
  validated: boolean;
  title?: string;
  trackCount?: number;
  trackStubs?: PlaylistImportMetadata['trackStubs'];
  tracksUnavailable?: boolean;
  blocked?: boolean;
  blockedReason?: string;
  coverUrl?: string;
  creator?: string;
} {
  return {
    validated: metadata.validated,
    title: metadata.title,
    trackCount: metadata.trackCount ?? metadata.trackStubs?.length,
    trackStubs: metadata.trackStubs,
    tracksUnavailable: metadata.tracksUnavailable,
    blocked: metadata.blocked,
    blockedReason: metadata.blockedReason,
    coverUrl: metadata.coverUrl,
    creator: metadata.creator,
  };
}

/** Server `/api/playlist-metadata` JSON shape. */
export function toPlaylistMetadataResponse(metadata: PlaylistImportMetadata): {
  title?: string;
  trackCount?: number;
  tracks?: PlaylistImportMetadata['trackStubs'];
  validated: boolean;
  tracksUnavailable?: boolean;
  blocked?: boolean;
  blockedReason?: string;
  coverUrl?: string;
  creator?: string;
} {
  const trackCount =
    metadata.trackCount ?? (metadata.trackStubs?.length ? metadata.trackStubs.length : undefined);
  return {
    validated: metadata.validated,
    title: metadata.title,
    creator: metadata.creator,
    coverUrl: metadata.coverUrl,
    tracks: metadata.trackStubs,
    trackCount,
    tracksUnavailable: metadata.tracksUnavailable,
    blocked: metadata.blocked,
    blockedReason: metadata.blockedReason,
  };
}
