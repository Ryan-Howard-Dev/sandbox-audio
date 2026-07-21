/**
 * Read ID3/Vorbis tags from FLAC/MP3 (and other formats music-metadata supports).
 * Picard/MusicBrainz tags are preferred when present.
 */

import fs from 'node:fs/promises';
import { parseBuffer } from 'music-metadata';

export type ParsedAudioTags = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  trackNumber?: number;
  discNumber?: number;
  releaseYear?: string;
  durationSeconds?: number;
  acoustidId?: string;
  acoustidFingerprint?: string;
  musicbrainzRecordingId?: string;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
  musicbrainzArtistId?: string;
  genre?: string;
};

function firstString(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = v?.trim();
  return trimmed || undefined;
}

function mbId(raw: string | string[] | undefined): string | undefined {
  const v = firstString(raw);
  if (!v) return undefined;
  return v.replace(/^https?:\/\/musicbrainz\.org\//i, '').trim() || undefined;
}

function parsedTagsFromMetadata(
  meta: Awaited<ReturnType<typeof parseBuffer>>,
): ParsedAudioTags {
  const common = meta.common;
  const format = meta.format;

  const year =
    common.year != null
      ? String(common.year)
      : common.date?.trim().slice(0, 4);

  const artistFromList = Array.isArray(common.artists)
    ? firstString(common.artists.filter((a): a is string => typeof a === 'string'))
    : undefined;

  return {
    title: firstString(common.title),
    artist: firstString(common.artist) ?? artistFromList,
    album: firstString(common.album),
    albumArtist: firstString(common.albumartist),
    trackNumber: common.track?.no ?? undefined,
    discNumber: common.disk?.no ?? undefined,
    releaseYear: year,
    durationSeconds:
      format.duration != null && Number.isFinite(format.duration)
        ? Math.round(format.duration)
        : undefined,
    acoustidId: firstString(common.acoustid_id),
    acoustidFingerprint: firstString(common.acoustid_fingerprint),
    musicbrainzRecordingId: mbId(common.musicbrainz_recordingid),
    musicbrainzReleaseId: mbId(common.musicbrainz_albumid),
    musicbrainzReleaseGroupId: mbId(common.musicbrainz_releasegroupid),
    musicbrainzArtistId: mbId(common.musicbrainz_artistid),
    genre: firstString(common.genre),
  };
}

export async function readAudioTagsFromBuffer(
  buf: Buffer,
  fileHint = 'audio.bin',
): Promise<ParsedAudioTags> {
  try {
    const meta = await parseBuffer(new Uint8Array(buf), fileHint, { duration: true });
    return parsedTagsFromMetadata(meta);
  } catch {
    return {};
  }
}

export async function readAudioTags(filePath: string): Promise<ParsedAudioTags> {
  try {
    const buf = await fs.readFile(filePath);
    const meta = await parseBuffer(new Uint8Array(buf), filePath, { duration: true });
    return parsedTagsFromMetadata(meta);
  } catch {
    return {};
  }
}
