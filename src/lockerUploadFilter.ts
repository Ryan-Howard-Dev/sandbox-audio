/**
 * Music locker upload filtering — keeps audiobooks/podcasts out of the music library.
 * Audiobook *station* uses isLikelyAudiobookLibraryHit / filterAudiobookScanHits —
 * never routes those files into the music locker vault.
 */

/** File-picker accept list — explicit music formats only (no audio/* or .m4b). */
export const MUSIC_UPLOAD_ACCEPT =
  'audio/mpeg,audio/flac,audio/ogg,audio/wav,audio/x-m4a,.flac,.mp3,.ogg,.wav,.m4a,.opus,.webm,.aac';

const MUSIC_EXT_RE = /\.(mp3|flac|ogg|wav|m4a|opus|webm|aac)$/i;
const AUDIOBOOK_EXT_RE = /\.(m4b|aa|aax)$/i;

const AUDIOBOOK_MIME_RE =
  /^(audio\/x-m4b|audio\/m4b|application\/audiobook|audio\/x-audible|audio\/audible)$/i;

/** Filename / path / title hints common on audiobook rips and folders. */
const AUDIOBOOK_NAME_RE =
  /audiobook|audio[\s._-]?book|unabridged|abridged|\bpart\s+\d+\s+of\s+\d+|\bch(?:apter)?\s*\d{2,}\b|\bnarrated\s+by\b/i;

const AUDIOBOOK_FOLDER_RE = /audiobooks?|audio[\s._-]?books?/i;

/** Download / torrent / reader apps that usually hold audiobooks, not music. */
const AUDIOBOOK_APP_FOLDER_RE = /torrdroid|pocketbook/i;

/** Non-music device folders — voice memos, documents, generic recordings. */
const NON_MUSIC_FOLDER_RE =
  /(?:^|\/)(?:documents|voice\s*recording|recordings|android\/data\/[^/]+\/files\/voice)(?:\/|$)/i;

/** Likely music library folders on Android. */
const MUSIC_LIBRARY_FOLDER_RE = /(?:^|\/)music(?:\/|$)/i;
const YMUSIC_FOLDER_RE = /ymusic/i;

/** One huge file in a folder upload is usually an audiobook, not a single-track album. */
const SINGLE_FILE_AUDIOBOOK_BYTES = 80 * 1024 * 1024;

/** Device scan: treat very long single files as audiobooks / podcasts. */
const SCAN_LONG_DURATION_MS = 45 * 60 * 1000;

/** Default auto-select: only short tracks typical of songs. */
export const DEFAULT_MUSIC_MAX_DURATION_MS = 15 * 60 * 1000;

/** Long files sitting in Download/ are usually podcasts or audiobook downloads. */
const DOWNLOAD_LONG_DURATION_MS = 20 * 60 * 1000;
const DOWNLOAD_FOLDER_RE = /(?:^|\/)download(?:\/|$)/i;

export type AudiobookRejectReason =
  | 'extension'
  | 'mime'
  | 'filename'
  | 'folderPath'
  | 'singleLongFile'
  | 'longDuration'
  | 'nonMusicFolder'
  | 'downloadPodcast';

export type AudiobookBlockResult = {
  blocked: boolean;
  reason?: AudiobookRejectReason;
};

export type ScanHitTextFields = {
  displayName: string;
  path: string;
  title?: string;
  artist?: string;
  album?: string;
  folder?: string;
};

function filePathHint(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel || file.name;
}

function scanHitTextBlob(hit: ScanHitTextFields): string {
  return [hit.path, hit.displayName, hit.title, hit.artist, hit.album, hit.folder]
    .filter(Boolean)
    .join(' ');
}

function normalizedPath(hit: ScanHitTextFields): string {
  return (hit.path || hit.displayName).replace(/\\/g, '/');
}

export function isMusicAudioExtension(filename: string): boolean {
  return MUSIC_EXT_RE.test(filename) && !AUDIOBOOK_EXT_RE.test(filename);
}

export function isAudiobookBlockedFile(
  file: File,
  ctx?: { audioFileCount?: number },
): AudiobookBlockResult {
  const name = file.name;
  const path = filePathHint(file);

  if (AUDIOBOOK_EXT_RE.test(name)) {
    return { blocked: true, reason: 'extension' };
  }

  const mime = file.type?.trim() ?? '';
  if (mime && AUDIOBOOK_MIME_RE.test(mime)) {
    return { blocked: true, reason: 'mime' };
  }

  if (AUDIOBOOK_FOLDER_RE.test(path) || AUDIOBOOK_APP_FOLDER_RE.test(path)) {
    return { blocked: true, reason: 'folderPath' };
  }

  if (NON_MUSIC_FOLDER_RE.test(path)) {
    return { blocked: true, reason: 'nonMusicFolder' };
  }

  if (AUDIOBOOK_NAME_RE.test(path)) {
    return { blocked: true, reason: 'filename' };
  }

  const audioCount = ctx?.audioFileCount;
  if (
    audioCount === 1 &&
    isMusicAudioExtension(name) &&
    file.size >= SINGLE_FILE_AUDIOBOOK_BYTES
  ) {
    return { blocked: true, reason: 'singleLongFile' };
  }

  return { blocked: false };
}

export function isRawAudioUpload(file: File): boolean {
  return file.type.startsWith('audio/') || MUSIC_EXT_RE.test(file.name) || AUDIOBOOK_EXT_RE.test(file.name);
}

export function isMusicUpload(file: File, ctx?: { audioFileCount?: number }): boolean {
  if (!isRawAudioUpload(file)) return false;
  return !isAudiobookBlockedFile(file, ctx).blocked;
}

export function partitionMusicUploads(files: File[]): {
  music: File[];
  audiobooks: File[];
} {
  const rawAudio = files.filter(isRawAudioUpload);
  const music: File[] = [];
  const audiobooks: File[] = [];

  for (const file of rawAudio) {
    const block = isAudiobookBlockedFile(file, { audioFileCount: rawAudio.length });
    if (block.blocked) audiobooks.push(file);
    else music.push(file);
  }

  return { music, audiobooks };
}

/** Device scan row — same audiobook heuristics as File uploads. */
export type DeviceMusicScanHit = {
  id: string;
  contentUri: string;
  title: string;
  artist: string;
  album: string;
  displayName: string;
  folder: string;
  path: string;
  size: number;
  durationMs: number;
  mimeType: string;
};

/**
 * Aggressive scan-time filter — audiobooks, voice memos, documents, podcast downloads.
 * Used when listing device scan results (not only on import).
 */
export function isLikelyAudiobookOrNonMusic(
  hit: Pick<DeviceMusicScanHit, 'displayName' | 'path' | 'size' | 'mimeType' | 'durationMs'> &
    Partial<Pick<DeviceMusicScanHit, 'title' | 'artist' | 'album' | 'folder'>>,
  ctx?: { audioFileCount?: number },
): AudiobookBlockResult {
  const name = hit.displayName;
  const path = normalizedPath(hit);
  const text = scanHitTextBlob(hit);

  if (AUDIOBOOK_EXT_RE.test(name)) {
    return { blocked: true, reason: 'extension' };
  }

  const mime = hit.mimeType?.trim() ?? '';
  if (mime && AUDIOBOOK_MIME_RE.test(mime)) {
    return { blocked: true, reason: 'mime' };
  }

  if (NON_MUSIC_FOLDER_RE.test(path)) {
    return { blocked: true, reason: 'nonMusicFolder' };
  }

  if (AUDIOBOOK_FOLDER_RE.test(path) || AUDIOBOOK_APP_FOLDER_RE.test(path)) {
    return { blocked: true, reason: 'folderPath' };
  }

  if (AUDIOBOOK_NAME_RE.test(text)) {
    return { blocked: true, reason: 'filename' };
  }

  if (hit.durationMs >= SCAN_LONG_DURATION_MS) {
    return { blocked: true, reason: 'longDuration' };
  }

  if (
    DOWNLOAD_FOLDER_RE.test(path) &&
    hit.durationMs >= DOWNLOAD_LONG_DURATION_MS &&
    !MUSIC_LIBRARY_FOLDER_RE.test(path)
  ) {
    return { blocked: true, reason: 'downloadPodcast' };
  }

  const audioCount = ctx?.audioFileCount;
  if (
    audioCount === 1 &&
    isMusicAudioExtension(name) &&
    hit.size >= SINGLE_FILE_AUDIOBOOK_BYTES
  ) {
    return { blocked: true, reason: 'singleLongFile' };
  }

  if (
    isMusicAudioExtension(name) &&
    hit.size >= SINGLE_FILE_AUDIOBOOK_BYTES &&
    hit.durationMs >= DOWNLOAD_LONG_DURATION_MS
  ) {
    return { blocked: true, reason: 'singleLongFile' };
  }

  return { blocked: false };
}

/** @deprecated Use isLikelyAudiobookOrNonMusic — kept for import guard parity. */
export function isAudiobookBlockedScanHit(
  hit: Pick<DeviceMusicScanHit, 'displayName' | 'path' | 'size' | 'mimeType' | 'durationMs'> &
    Partial<Pick<DeviceMusicScanHit, 'title' | 'artist' | 'album' | 'folder'>>,
  ctx?: { audioFileCount?: number },
): AudiobookBlockResult {
  return isLikelyAudiobookOrNonMusic(hit, ctx);
}

export function isMusicScanHit(
  hit: Pick<DeviceMusicScanHit, 'displayName' | 'path' | 'size' | 'mimeType' | 'durationMs'> &
    Partial<Pick<DeviceMusicScanHit, 'title' | 'artist' | 'album' | 'folder'>>,
  ctx?: { audioFileCount?: number },
): boolean {
  if (!isMusicAudioExtension(hit.displayName)) return false;
  return !isLikelyAudiobookOrNonMusic(hit, ctx).blocked;
}

/** Auto-select on scan: clear music in Music/ or YMusic with song-like duration. */
export function isDefaultMusicSelection(
  hit: Pick<DeviceMusicScanHit, 'displayName' | 'path' | 'size' | 'mimeType' | 'durationMs' | 'folder'> &
    Partial<Pick<DeviceMusicScanHit, 'title' | 'artist' | 'album'>>,
): boolean {
  if (!isMusicScanHit(hit)) return false;

  const path = normalizedPath(hit);
  const inMusicLib = MUSIC_LIBRARY_FOLDER_RE.test(path) || YMUSIC_FOLDER_RE.test(path);
  const durationOk =
    hit.durationMs <= 0 || hit.durationMs <= DEFAULT_MUSIC_MAX_DURATION_MS;

  return inMusicLib && durationOk;
}

export function partitionMusicScanHits(hits: DeviceMusicScanHit[]): {
  music: DeviceMusicScanHit[];
  other: DeviceMusicScanHit[];
} {
  const music: DeviceMusicScanHit[] = [];
  const other: DeviceMusicScanHit[] = [];

  for (const hit of hits) {
    const block = isLikelyAudiobookOrNonMusic(hit, { audioFileCount: hits.length });
    if (block.blocked) {
      other.push(hit);
    } else if (isMusicScanHit(hit, { audioFileCount: hits.length })) {
      music.push(hit);
    } else {
      other.push(hit);
    }
  }

  return { music, other };
}

/**
 * Positive audiobook library match — Books/Audiobooks folders, .m4b/.aa/.aax,
 * audiobook mime/name hints, or long files in book folders.
 * Voice-memo / Documents paths stay out (never pull music locker into Audiobooks).
 */
export function isLikelyAudiobookLibraryHit(
  hit: Pick<DeviceMusicScanHit, 'displayName' | 'path' | 'size' | 'mimeType' | 'durationMs'> &
    Partial<Pick<DeviceMusicScanHit, 'title' | 'artist' | 'album' | 'folder'>>,
): boolean {
  const name = hit.displayName;
  const path = normalizedPath(hit);
  const text = scanHitTextBlob(hit);

  if (NON_MUSIC_FOLDER_RE.test(path)) return false;

  if (AUDIOBOOK_EXT_RE.test(name)) return true;

  const mime = hit.mimeType?.trim() ?? '';
  if (mime && AUDIOBOOK_MIME_RE.test(mime)) return true;

  if (AUDIOBOOK_FOLDER_RE.test(path) || AUDIOBOOK_APP_FOLDER_RE.test(path)) return true;
  if (/(?:^|\/)books?(?:\/|$)/i.test(path)) return true;

  if (AUDIOBOOK_NAME_RE.test(text) && hit.durationMs >= DOWNLOAD_LONG_DURATION_MS) return true;

  if (
    hit.durationMs >= SCAN_LONG_DURATION_MS &&
    (AUDIOBOOK_FOLDER_RE.test(path) || /(?:^|\/)books?(?:\/|$)/i.test(path))
  ) {
    return true;
  }

  return false;
}

/** Keep only audiobook-shaped rows — never mixes music-locker imports. */
export function filterAudiobookScanHits(hits: DeviceMusicScanHit[]): DeviceMusicScanHit[] {
  return hits.filter((hit) => isLikelyAudiobookLibraryHit(hit));
}

export function audiobookRejectToastKey(reason: AudiobookRejectReason | undefined): string {
  switch (reason) {
    case 'extension':
      return 'locker.uploadAudiobookBlockedM4b';
    case 'mime':
      return 'locker.uploadAudiobookBlockedMime';
    case 'folderPath':
      return 'locker.uploadAudiobookBlockedFolder';
    case 'singleLongFile':
    case 'longDuration':
      return 'locker.uploadAudiobookBlockedLongFile';
    case 'nonMusicFolder':
      return 'locker.uploadNonMusicBlockedFolder';
    case 'downloadPodcast':
      return 'locker.uploadDownloadPodcastBlocked';
    case 'filename':
    default:
      return 'locker.uploadAudiobookBlocked';
  }
}
