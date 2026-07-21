export const MAX_IMPORTED_PLAYLIST_TRACKS = 500;
export const PLAYLIST_IMPORT_PAGE_LIMIT = 100;

export interface PlaylistImportTrackStub {
  title: string;
  artist?: string;
  duration?: number;
}

export interface PlaylistImportMetadata {
  title?: string;
  creator?: string;
  coverUrl?: string;
  trackStubs?: PlaylistImportTrackStub[];
  trackCount?: number;
  validated: boolean;
  tracksUnavailable?: boolean;
  blocked?: boolean;
  blockedReason?: string;
}

export const PLAYLIST_FETCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/json',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
};

export const PLAYLIST_METADATA_TIMEOUT_MS = 12_000;

export function parseDurationLabel(label: string | undefined): number | undefined {
  if (!label?.trim()) return undefined;
  const parts = label.trim().split(':').map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}

export function stripHtmlText(raw: string): string {
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
