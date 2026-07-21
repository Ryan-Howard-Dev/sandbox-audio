import type { MediaEnvelope } from './sandboxLayer1';
import type { DeviceMusicScanHit } from './lockerUploadFilter';
import {
  isBadAudiobookAuthor,
  isBadAudiobookTitle,
} from './audiobookMetadata';

export const AUDIOBOOK_ENVELOPE_PREFIX = 'audiobook:';

export function isAudiobookEnvelopeId(envelopeId: string | null | undefined): boolean {
  return (envelopeId?.trim() ?? '').startsWith(AUDIOBOOK_ENVELOPE_PREFIX);
}

export type AudiobookEnvelopeOptions = {
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
};

/** Play MediaStore audiobook rows via Exo content:// — never copies into music locker. */
export function audiobookHitToEnvelope(
  hit: DeviceMusicScanHit,
  options?: AudiobookEnvelopeOptions,
): MediaEnvelope {
  const rawTitle = hit.title?.trim() || hit.displayName || 'Audiobook';
  const rawArtist = hit.artist?.trim() || hit.folder || 'Audiobook';
  const title =
    options?.title?.trim() ||
    (isBadAudiobookTitle(rawTitle) ? hit.displayName || 'Audiobook' : rawTitle);
  const artist =
    options?.artist?.trim() ||
    (isBadAudiobookAuthor(rawArtist) ? 'Unknown author' : rawArtist);
  const durationSeconds =
    hit.durationMs > 0 ? Math.max(1, Math.round(hit.durationMs / 1000)) : 0;
  return {
    envelopeId: `${AUDIOBOOK_ENVELOPE_PREFIX}${hit.id}`,
    title,
    artist,
    album: options?.album?.trim() || hit.album?.trim() || undefined,
    url: hit.contentUri.trim(),
    durationSeconds,
    provider: 'https',
    transport: 'element-src',
    sourceId: `audiobook-media-${hit.id}`,
    artworkUrl: options?.artworkUrl?.trim() || undefined,
  };
}
