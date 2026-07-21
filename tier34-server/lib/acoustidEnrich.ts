/**
 * Merge tag reads + AcoustID lookup for acquire enrichment and dedup.
 */

import type { AcoustidLookupResult, AcoustidRecordingMatch } from './acoustid.js';
import { identifyAudioBuffer } from './acoustid.js';
import {
  findManifestEntryByContentHash,
  findManifestEntryByRecordingId,
  type LockerSyncManifestEntry,
} from './lockerStorage.js';
import { readAudioTagsFromBuffer, type ParsedAudioTags } from './readAudioTags.js';

export type TrackEnrichHints = {
  title: string;
  artist: string;
  albumName?: string;
  albumArtist?: string;
  releaseYear?: string;
  durationSeconds?: number;
};

export type AcquiredTrackEnrichment = {
  title: string;
  artist: string;
  albumName?: string;
  releaseYear?: string;
  durationSeconds: number;
  acoustidId?: string;
  acoustidFingerprint?: string;
  musicbrainzRecordingId?: string;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
  matchScore: number;
  matchSource: 'tags' | 'acoustid' | 'input';
};

export type AcquireDedupResult =
  | { kind: 'new' }
  | {
      kind: 'duplicate-hash' | 'duplicate-recording';
      existing: LockerSyncManifestEntry;
    };

const AUTO_TITLE_SCORE = 0.85;

function pickString(...values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    const trimmed = v?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function tagsToEnrichment(tags: ParsedAudioTags, hints: TrackEnrichHints): AcquiredTrackEnrichment | null {
  if (!tags.musicbrainzRecordingId) return null;
  return {
    title: pickString(tags.title, hints.title) ?? hints.title,
    artist: pickString(tags.artist, hints.artist) ?? hints.artist,
    albumName: pickString(tags.album, hints.albumName),
    releaseYear: pickString(tags.releaseYear, hints.releaseYear),
    durationSeconds: tags.durationSeconds ?? hints.durationSeconds ?? 0,
    musicbrainzRecordingId: tags.musicbrainzRecordingId,
    musicbrainzReleaseId: tags.musicbrainzReleaseId,
    musicbrainzReleaseGroupId: tags.musicbrainzReleaseGroupId,
    acoustidId: tags.acoustidId,
    acoustidFingerprint: tags.acoustidFingerprint,
    matchScore: 1,
    matchSource: 'tags',
  };
}

function acoustidToEnrichment(
  match: AcoustidRecordingMatch,
  lookup: AcoustidLookupResult,
  hints: TrackEnrichHints,
): AcquiredTrackEnrichment {
  const useAcoustidMeta = match.score >= AUTO_TITLE_SCORE;
  return {
    title: useAcoustidMeta && match.title ? match.title : hints.title,
    artist: useAcoustidMeta && match.artist ? match.artist : hints.artist,
    albumName: hints.albumName,
    releaseYear: pickString(match.releaseYear, hints.releaseYear),
    durationSeconds: Math.round(lookup.duration || hints.durationSeconds || 0),
    acoustidId: match.acoustidId || undefined,
    acoustidFingerprint: lookup.fingerprint || undefined,
    musicbrainzRecordingId: match.musicbrainzRecordingId,
    musicbrainzReleaseId: match.musicbrainzReleaseId,
    musicbrainzReleaseGroupId: match.musicbrainzReleaseGroupId,
    matchScore: match.score,
    matchSource: 'acoustid',
  };
}

function inputFallback(hints: TrackEnrichHints): AcquiredTrackEnrichment {
  return {
    title: hints.title,
    artist: hints.artist,
    albumName: hints.albumName,
    releaseYear: hints.releaseYear,
    durationSeconds: hints.durationSeconds ?? 0,
    matchScore: 0,
    matchSource: 'input',
  };
}

/** Read embedded tags, then AcoustID when tags lack a MusicBrainz recording id. */
export async function enrichAcquiredTrack(
  audioBuf: Buffer,
  hints: TrackEnrichHints,
): Promise<AcquiredTrackEnrichment> {
  const tags = await readAudioTagsFromBuffer(audioBuf);
  const fromTags = tagsToEnrichment(tags, hints);
  if (fromTags) return fromTags;

  const lookup = await identifyAudioBuffer(audioBuf, hints.durationSeconds ?? tags.durationSeconds ?? 0);
  if (lookup.match) {
    return acoustidToEnrichment(lookup.match, lookup, hints);
  }

  if (tags.title || tags.artist) {
    return {
      title: pickString(tags.title, hints.title) ?? hints.title,
      artist: pickString(tags.artist, hints.artist) ?? hints.artist,
      albumName: pickString(tags.album, hints.albumName),
      releaseYear: pickString(tags.releaseYear, hints.releaseYear),
      durationSeconds: tags.durationSeconds ?? hints.durationSeconds ?? 0,
      musicbrainzRecordingId: tags.musicbrainzRecordingId,
      musicbrainzReleaseId: tags.musicbrainzReleaseId,
      musicbrainzReleaseGroupId: tags.musicbrainzReleaseGroupId,
      acoustidId: tags.acoustidId,
        acoustidFingerprint: tags.acoustidFingerprint ?? (lookup.fingerprint || undefined),
      matchScore: 0.4,
      matchSource: 'tags',
    };
  }

  const fallback = inputFallback(hints);
  if (lookup.fingerprint) {
    fallback.acoustidFingerprint = lookup.fingerprint;
    fallback.durationSeconds = Math.round(lookup.duration || fallback.durationSeconds);
  }
  return fallback;
}

/** Skip re-ingest when SHA-256 or MusicBrainz recording already exists in the locker manifest. */
export function checkAcquireDedup(
  contentHash: string,
  musicbrainzRecordingId?: string,
): AcquireDedupResult {
  const byHash = findManifestEntryByContentHash(contentHash);
  if (byHash) {
    return { kind: 'duplicate-hash', existing: byHash };
  }

  const recordingId = musicbrainzRecordingId?.trim();
  if (recordingId) {
    const byRecording = findManifestEntryByRecordingId(recordingId);
    if (byRecording && byRecording.contentHash !== contentHash) {
      return { kind: 'duplicate-recording', existing: byRecording };
    }
  }

  return { kind: 'new' };
}
