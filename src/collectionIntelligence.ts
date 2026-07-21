/**
 * Collection Intelligence — release-group consolidation, edition management,
 * hash duplicate detection, and collection statistics.
 *
 * Extensible for mastering preference, lossless rules, source ranking, auto-dedup.
 */

import {
  formatAlbumDisplayName,
  isArtistTitleMashupName,
  isBadMediaStoreAlbum,
  isBadMediaStoreArtist,
  isKnownPlaylistStubArtistName,
  isLikelyUploaderHandleArtist,
  isMislabeledPlaylistStubArtist,
  isTitleFragmentArtistName,
  isTruncatedArtistName,
  isUsableArtistName,
  lockerAlbumArtistConsensus,
  lockerAlbumGroupArtist,
  lockerAlbumGroupKey,
  lockerAlbumDisplayArtist,
  normalizeLockerKeyPart,
  albumPrimaryArtist,
  parseLockerArtistBilling,
  collectLockerGuestArtists,
  lockerCollectionPrimaryArtistMatches,
  lockerEntryMatchesArtistFilter,
  type LockerEntry,
} from './lockerStorage';
import { featuredArtistsFromTrackTitle } from './displaySanitize';
import {
  groupTracksByEnvelope,
  releaseGroupIdFromEntry,
  type EnvelopeMetaRow,
} from './groupTracksByEnvelope';
import { sortLockerTracks } from './lockerTrackOrder';
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import { extractEmbeddedPerformerFromText } from './importTitleParse';
import type { MediaGraphStats, Tier34SearchHit } from './tier34/client';
import type { CatalogAlbum, CatalogTrack } from './searchCatalog';

export type EditionKind =
  | 'original'
  | 'remaster'
  | 'deluxe'
  | 'anniversary'
  | 'expanded'
  | 'other';

/** Input for edition detection — title heuristics plus optional MusicBrainz metadata. */
export type ReleaseEditionInput = {
  title: string;
  displayName?: string;
  disambiguation?: string;
  releaseYear?: string;
  tags?: string[];
  relationships?: string[];
  creditsJson?: string;
};

export type ReleaseGroupBucket = {
  releaseGroupId: string | null;
  key: string;
  editions: AlbumEdition[];
};

export type CanonicalAlbum = {
  id: string;
  releaseGroupId: string | null;
  title: string;
  displayName: string;
  artist: string;
  editions: AlbumEdition[];
  editionCount: number;
  preferredEditionKey: string;
};

export type CanonicalArtist = {
  id: string;
  musicbrainzArtistId: string | null;
  name: string;
  displayName: string;
  trackCount: number;
  albumCount: number;
  collectionKeys: string[];
};

export type MediaGraph = {
  albums: CanonicalAlbum[];
  artists: CanonicalArtist[];
  collections: AlbumCollection[];
  stats: CollectionStats;
};

/** Future rules: mastering preference, lossless bias, source ranking, auto-dedup. */
export type CollectionIntelligenceRules = {
  preferLossless?: boolean;
  sourceRank?: string[];
  masteringPreference?: 'earliest' | 'latest' | 'loudest';
  autoDedup?: boolean;
};

export type AlbumEdition = {
  /** Legacy album group key: albumName::artist */
  key: string;
  name: string;
  displayName: string;
  label: string;
  kind: EditionKind;
  year?: string;
  source?: string;
  trackCount: number;
  duplicateTrackCopies: number;
  tracks: LockerEntry[];
  releaseGroupId: string | null;
};

export type AlbumCollection = {
  /** rg:{mbid} or legacy album key when no release group */
  key: string;
  releaseGroupId: string | null;
  title: string;
  displayName: string;
  artist: string;
  editions: AlbumEdition[];
  editionCount: number;
  duplicateAlbumCount: number;
  totalTracks: number;
  preferredEditionKey: string;
};

export type CollectionStats = {
  releaseGroupCount: number;
  editionCount: number;
  albumCollectionCount: number;
  legacyAlbumCount: number;
  duplicateTrackGroups: number;
  duplicateTrackCopies: number;
  duplicateAlbumGroups: number;
  hashDuplicateGroups: number;
  storageSavedBytes: number;
  storageSavedLabel: string;
};

export type PreferredEditionPrefs = Record<string, string>;

export const PREFERRED_EDITION_PREFS_KEY = 'sandbox_collection_preferred_editions';

const HASH_FROM_URL_RE = /\/api\/locker\/blob\/([a-f0-9]{64})/i;

/** @deprecated use PREFERRED_EDITION_PREFS_KEY */
export const PREFERRED_EDITION_KEY = PREFERRED_EDITION_PREFS_KEY;

export function contentHashFromEntry(entry: LockerEntry): string | null {
  const url = entry.url?.trim() ?? '';
  const match = url.match(HASH_FROM_URL_RE);
  if (match?.[1]) return match[1].toLowerCase();
  return null;
}

type CreditsEditionHints = {
  disambiguation?: string;
  tags?: string[];
  relationships?: string[];
  releaseTitle?: string;
  musicbrainzArtistId?: string;
};

function parseCreditsEditionHints(creditsJson?: string): CreditsEditionHints {
  if (!creditsJson?.trim()) return {};
  try {
    const parsed = JSON.parse(creditsJson) as CreditsEditionHints & {
      edition?: string;
      editionType?: string;
    };
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.map((t) => String(t))
      : parsed.edition || parsed.editionType
        ? [String(parsed.edition ?? parsed.editionType)]
        : undefined;
    return {
      disambiguation: parsed.disambiguation?.trim(),
      tags,
      relationships: Array.isArray(parsed.relationships)
        ? parsed.relationships.map((r) => String(r))
        : undefined,
      releaseTitle: parsed.releaseTitle?.trim(),
      musicbrainzArtistId: parsed.musicbrainzArtistId?.trim(),
    };
  } catch {
    return {};
  }
}

function editionHaystack(input: ReleaseEditionInput): string {
  const hints = parseCreditsEditionHints(input.creditsJson);
  return [
    input.title,
    input.displayName,
    input.disambiguation,
    hints.disambiguation,
    hints.releaseTitle,
    ...(input.tags ?? []),
    ...(hints.tags ?? []),
    ...(input.relationships ?? []),
    ...(hints.relationships ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Detect edition type from release title, disambiguation, and MusicBrainz hints. */
export function detectEditionType(input: ReleaseEditionInput): EditionKind {
  const hay = editionHaystack(input);

  if (
    /\b(anniversary|anniv\.?)\b/.test(hay) ||
    /\b\d{1,3}(?:th|nd|rd|st)\s+anniversary\b/.test(hay)
  ) {
    return 'anniversary';
  }
  if (/\b(deluxe|expanded edition|complete edition|special edition|super deluxe)\b/.test(hay)) {
    return 'deluxe';
  }
  if (/\b(remaster|remastered|digital remaster|hi[- ]?res|24[- ]?bit|50th|40th|30th|20th)\b/.test(hay)) {
    return 'remaster';
  }
  if (/\b(original|standard edition|first press)\b/.test(hay)) {
    return 'original';
  }
  if (/\b(bonus|extra tracks|expanded)\b/.test(hay)) {
    return 'expanded';
  }
  if (/\bexplicit\b/.test(hay)) return 'original';
  return 'other';
}

/** @deprecated use detectEditionType */
export function inferEditionKind(albumName: string): EditionKind {
  return detectEditionType({ title: albumName });
}

export function editionLabelForKind(kind: EditionKind, displayName: string): string {
  if (kind === 'other') return displayName;
  const labels: Record<Exclude<EditionKind, 'other'>, string> = {
    original: 'Original',
    remaster: 'Remaster',
    deluxe: 'Deluxe',
    anniversary: 'Anniversary',
    expanded: 'Expanded',
  };
  return labels[kind as Exclude<EditionKind, 'other'>];
}

export function normalizeIdentityKey(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function buildCanonicalAlbumId(
  releaseGroupId: string | null,
  albumTitle: string,
  artist: string,
): string {
  const rg = releaseGroupId?.trim();
  if (rg) return `rg:${rg}`;
  return `album:${normalizeIdentityKey(artist)}::${normalizeIdentityKey(albumTitle)}`;
}

export function buildCanonicalArtistId(
  musicbrainzArtistId: string | null,
  name: string,
): string {
  const mb = musicbrainzArtistId?.trim();
  if (mb) return `mb:${mb}`;
  return `artist:${normalizeIdentityKey(name)}`;
}

export function artistIdFromEntry(entry: LockerEntry): string | null {
  const hints = parseCreditsEditionHints(entry.creditsJson);
  return hints.musicbrainzArtistId ?? null;
}

export function releaseEditionInputFromTracks(
  albumName: string,
  tracks: LockerEntry[],
): ReleaseEditionInput {
  const sample =
    tracks.find((t) => t.creditsJson?.trim()) ??
    tracks.find((t) => t.albumArtist?.trim()) ??
    tracks[0];
  const hints = parseCreditsEditionHints(sample?.creditsJson);
  return {
    title: albumName,
    displayName: formatAlbumDisplayName(albumName),
    releaseYear: tracks.find((t) => t.releaseYear)?.releaseYear ?? sample?.releaseYear,
    disambiguation: hints.disambiguation,
    tags: hints.tags,
    relationships: hints.relationships,
    creditsJson: sample?.creditsJson,
  };
}

export function resolveCanonicalArtistForTrack(entry: LockerEntry): {
  name: string;
  musicbrainzArtistId: string | null;
} {
  const albumArtist = entry.albumArtist?.trim();
  const fromTrack = albumPrimaryArtist((entry.artist ?? '').trim());
  const albumArtistUsable =
    albumArtist &&
    isUsableArtistName(albumArtist) &&
    !/^local upload$/i.test(albumArtist) &&
    !isBadMediaStoreArtist(albumArtist) &&
    !isBadMediaStoreAlbum(albumArtist) &&
    !isMislabeledPlaylistStubArtist(albumArtist, entry);
  const fromTrackUsable =
    fromTrack &&
    !/^local upload$/i.test(fromTrack) &&
    isUsableArtistName(fromTrack) &&
    !isMislabeledPlaylistStubArtist(fromTrack, entry);

  if (albumArtistUsable) {
    return {
      name: albumPrimaryArtist(albumArtist),
      musicbrainzArtistId: artistIdFromEntry(entry),
    };
  }

  if (fromTrackUsable) {
    return { name: fromTrack, musicbrainzArtistId: artistIdFromEntry(entry) };
  }

  const parsed = extractEmbeddedPerformerFromText(entry.title ?? '')?.artist;
  if (
    parsed &&
    isUsableArtistName(parsed) &&
    !isMislabeledPlaylistStubArtist(parsed, entry) &&
    !isTitleFragmentArtistName(parsed, entry)
  ) {
    return { name: albumPrimaryArtist(parsed), musicbrainzArtistId: artistIdFromEntry(entry) };
  }

  const raw = entry.artist?.trim() || 'Local Upload';
  if (
    isMislabeledPlaylistStubArtist(raw, entry) ||
    isTitleFragmentArtistName(raw, entry)
  ) {
    return { name: 'Local Upload', musicbrainzArtistId: artistIdFromEntry(entry) };
  }
  return { name: albumPrimaryArtist(raw), musicbrainzArtistId: artistIdFromEntry(entry) };
}

function parseReleaseYear(year?: string): number {
  if (!year?.trim()) return 9999;
  const y = parseInt(year.trim().slice(0, 4), 10);
  return Number.isFinite(y) ? y : 9999;
}

function inferSourceFromEntry(entry: LockerEntry): string | undefined {
  const hash = contentHashFromEntry(entry);
  if (hash) return 'tier34';
  if (entry.url?.startsWith('blob:')) return 'local';
  if (entry.url?.startsWith('http')) return 'import';
  return 'local';
}

function resolveReleaseGroupIdForEdition(
  edition: AlbumEdition,
  metaByEnvelopeId?: Map<string, EnvelopeMetaRow>,
): string | null {
  for (const track of edition.tracks) {
    const meta = metaByEnvelopeId?.get(track.id);
    const rg =
      meta?.musicbrainzReleaseGroupId?.trim() || releaseGroupIdFromEntry(track);
    if (rg) return rg;
  }
  return edition.releaseGroupId;
}

function finalizeAlbumEdition(edition: AlbumEdition): void {
  edition.tracks = sortLockerTracks(edition.tracks);
  const withAlbumArtist = edition.tracks.find((t) => t.albumArtist?.trim());
  const primary = withAlbumArtist ?? edition.tracks[0];
  if (!primary) return;

  edition.year = edition.tracks.find((t) => t.releaseYear)?.releaseYear ?? edition.year;
  const groups = groupTracksByEnvelope(edition.tracks);
  edition.trackCount = groups.length;
  edition.duplicateTrackCopies = groups.reduce(
    (sum, g) => sum + Math.max(0, g.entries.length - 1),
    0,
  );
  edition.source = inferSourceFromEntry(primary);
  edition.releaseGroupId = releaseGroupIdFromEntry(primary);

  const kind = detectEditionType(releaseEditionInputFromTracks(edition.name, edition.tracks));
  edition.kind = kind;
  edition.label = editionLabelForKind(kind, edition.displayName);
}

function buildLegacyAlbumGroups(
  entries: LockerEntry[],
  metaByEnvelopeId?: Map<string, EnvelopeMetaRow>,
): Map<string, AlbumEdition> {
  const byAlbumKey = new Map<string, LockerEntry[]>();
  for (const e of entries) {
    const key = lockerAlbumGroupKey(e);
    if (!key) continue;
    const list = byAlbumKey.get(key);
    if (list) list.push(e);
    else byAlbumKey.set(key, [e]);
  }

  const map = new Map<string, AlbumEdition>();
  for (const tracks of byAlbumKey.values()) {
    const name = tracks[0]!.albumName!.trim();
    const artist = lockerAlbumDisplayArtist(tracks[0]!, tracks);
    const key = lockerAlbumGroupKey(tracks[0]!)!;
    const displayName = formatAlbumDisplayName(name);
    map.set(key, {
      key,
      name,
      displayName,
      label: displayName,
      kind: 'other',
      year: tracks.find((t) => t.releaseYear)?.releaseYear,
      source: inferSourceFromEntry(tracks[0]!),
      trackCount: 0,
      duplicateTrackCopies: 0,
      tracks: [...tracks],
      releaseGroupId: releaseGroupIdFromEntry(tracks[0]!),
    });
  }

  for (const edition of map.values()) {
    finalizeAlbumEdition(edition);
    const rg = resolveReleaseGroupIdForEdition(edition, metaByEnvelopeId);
    if (rg) edition.releaseGroupId = rg;
  }

  return map;
}

/**
 * Group legacy album editions by MusicBrainz release group when known.
 * Standalone editions (no release group) remain as single-edition buckets.
 */
export function groupReleasesByReleaseGroup(
  tracks: LockerEntry[],
  metaByEnvelopeId?: Map<string, EnvelopeMetaRow>,
): ReleaseGroupBucket[] {
  const legacy = buildLegacyAlbumGroups(tracks, metaByEnvelopeId);
  const byReleaseGroup = new Map<string, AlbumEdition[]>();
  const buckets: ReleaseGroupBucket[] = [];

  for (const edition of legacy.values()) {
    const rgId = resolveReleaseGroupIdForEdition(edition, metaByEnvelopeId);
    if (rgId) {
      const list = byReleaseGroup.get(rgId);
      if (list) list.push(edition);
      else byReleaseGroup.set(rgId, [edition]);
    } else {
      buckets.push({
        releaseGroupId: null,
        key: edition.key,
        editions: [edition],
      });
    }
  }

  for (const [rgId, editions] of byReleaseGroup) {
    editions.sort((a, b) => parseReleaseYear(a.year) - parseReleaseYear(b.year));
    buckets.push({
      releaseGroupId: rgId,
      key: `rg:${rgId}`,
      editions,
    });
  }

  return buckets.sort((a, b) => {
    const aName = a.editions[0]?.displayName ?? '';
    const bName = b.editions[0]?.displayName ?? '';
    return aName.localeCompare(bName);
  });
}

function defaultPreferredEditionKey(editions: AlbumEdition[]): string {
  if (editions.length === 0) return '';
  const ranked = [...editions].sort((a, b) => {
    const kindRank = (k: EditionKind) =>
      k === 'original'
        ? 0
        : k === 'remaster'
          ? 1
          : k === 'anniversary'
            ? 2
            : k === 'deluxe'
              ? 3
              : 4;
    const kr = kindRank(a.kind) - kindRank(b.kind);
    if (kr !== 0) return kr;
    const yr = parseReleaseYear(a.year) - parseReleaseYear(b.year);
    if (yr !== 0) return yr;
    return b.trackCount - a.trackCount;
  });
  return ranked[0]?.key ?? editions[0].key;
}

export function loadPreferredEditionPrefs(): PreferredEditionPrefs {
  try {
    const raw = prefsGetItem(PREFERRED_EDITION_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PreferredEditionPrefs;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function savePreferredEditionPref(
  collectionKey: string,
  editionKey: string,
): PreferredEditionPrefs {
  const prefs = loadPreferredEditionPrefs();
  prefs[collectionKey] = editionKey;
  prefsSetItem(PREFERRED_EDITION_PREFS_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent('sandbox-collection-prefs-change'));
  return prefs;
}

export function resolvePreferredEdition(
  collection: AlbumCollection,
  prefs?: PreferredEditionPrefs,
): AlbumEdition {
  const store = prefs ?? loadPreferredEditionPrefs();
  const wanted = store[collection.key];
  const match = collection.editions.find((e) => e.key === wanted);
  if (match) return match;
  const fallback = collection.editions.find((e) => e.key === collection.preferredEditionKey);
  return fallback ?? collection.editions[0];
}

/**
 * Consolidate locker albums by MusicBrainz release group when known.
 * Each collection exposes one or more editions (Original, Remaster, Deluxe, …).
 */
export function buildAlbumCollections(
  entries: LockerEntry[],
  metaByEnvelopeId?: Map<string, EnvelopeMetaRow>,
  prefs?: PreferredEditionPrefs,
): AlbumCollection[] {
  const buckets = groupReleasesByReleaseGroup(entries, metaByEnvelopeId);
  const prefStore = prefs ?? loadPreferredEditionPrefs();
  const collections: AlbumCollection[] = [];

  for (const bucket of buckets) {
    const editions = bucket.editions;
    const preferred = defaultPreferredEditionKey(editions);
    const primary = editions.find((e) => e.key === preferred) ?? editions[0];
    const artist = lockerAlbumDisplayArtist(
      primary.tracks[0] ?? { artist: 'Local Upload' },
      primary.tracks,
    );
    const collectionKey = bucket.releaseGroupId
      ? `rg:${bucket.releaseGroupId}`
      : buildCanonicalAlbumId(null, primary.name, artist);
    const resolvedKey = prefStore[collectionKey] ?? preferred;

    collections.push({
      key: collectionKey,
      releaseGroupId: bucket.releaseGroupId,
      title: primary.name,
      displayName: primary.displayName,
      artist,
      editions,
      editionCount: editions.length,
      duplicateAlbumCount: Math.max(0, editions.length - 1),
      totalTracks: editions.reduce((s, e) => s + e.trackCount, 0),
      preferredEditionKey: resolvedKey,
    });
  }

  return collections.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function buildCanonicalAlbums(
  collections: AlbumCollection[],
): CanonicalAlbum[] {
  return collections.map((collection) => ({
    id: buildCanonicalAlbumId(
      collection.releaseGroupId,
      collection.title,
      collection.artist,
    ),
    releaseGroupId: collection.releaseGroupId,
    title: collection.title,
    displayName: collection.displayName,
    artist: collection.artist,
    editions: collection.editions,
    editionCount: collection.editionCount,
    preferredEditionKey: collection.preferredEditionKey,
  }));
}

export function buildCanonicalArtists(entries: LockerEntry[]): CanonicalArtist[] {
  type ArtistRow = {
    musicbrainzArtistId: string | null;
    name: string;
    trackCount: number;
    collectionKeys: Set<string>;
  };

  const titleKeyCounts = new Map<string, number>();
  const artistKeyCounts = new Map<string, number>();
  const vaultArtistKeys = new Set<string>();
  for (const entry of entries) {
    const titleKey = normalizeLockerKeyPart(entry.title ?? '');
    if (titleKey) titleKeyCounts.set(titleKey, (titleKeyCounts.get(titleKey) ?? 0) + 1);
    const artistKey = normalizeLockerKeyPart(entry.artist ?? '');
    if (artistKey) {
      artistKeyCounts.set(artistKey, (artistKeyCounts.get(artistKey) ?? 0) + 1);
      vaultArtistKeys.add(artistKey);
    }
    const albumArtistKey = normalizeLockerKeyPart(entry.albumArtist ?? '');
    if (albumArtistKey) vaultArtistKeys.add(albumArtistKey);
  }

  const looksLikeTitleNotArtist = (name: string): boolean => {
    const key = normalizeLockerKeyPart(name);
    if (!key) return true;
    if (isTitleFragmentArtistName(name)) return true;
    if (isTruncatedArtistName(name, vaultArtistKeys)) return true;
    if (isLikelyUploaderHandleArtist(name)) return true;
    if (isArtistTitleMashupName(name)) return true;
    const asTitle = titleKeyCounts.get(key) ?? 0;
    const asArtist = artistKeyCounts.get(key) ?? 0;
    // Appears as often (or more) as a track title than as an artist field
    if (asTitle > 0 && asTitle >= asArtist) return true;
    // Single-track "artist" that is also a title somewhere else in the vault
    if (asArtist <= 1 && asTitle >= 1) return true;
    return false;
  };

  const byId = new Map<string, ArtistRow>();
  const collections = buildAlbumCollections(entries);

  const upsertArtist = (
    rawName: string,
    musicbrainzArtistId: string | null,
    trackDelta: number,
    collectionKey?: string,
    context?: LockerEntry,
  ) => {
    const name = albumPrimaryArtist(rawName);
    if (!name || /^local upload$/i.test(name)) return;
    if (/^unknown artist$/i.test(name)) return;
    if (isKnownPlaylistStubArtistName(name)) return;
    if (context && isMislabeledPlaylistStubArtist(name, context)) return;
    if (context && isTitleFragmentArtistName(name, context)) return;
    if (looksLikeTitleNotArtist(name)) return;
    // Uploader handle that only appears once with junk tags
    if (
      isLikelyUploaderHandleArtist(name) &&
      (artistKeyCounts.get(normalizeLockerKeyPart(name)) ?? 0) <= 1
    ) {
      return;
    }
    const id = buildCanonicalArtistId(musicbrainzArtistId, name);
    const row = byId.get(id);
    if (row) {
      row.trackCount += trackDelta;
      if (collectionKey) row.collectionKeys.add(collectionKey);
      if (!row.musicbrainzArtistId && musicbrainzArtistId) {
        row.musicbrainzArtistId = musicbrainzArtistId;
      }
    } else {
      byId.set(id, {
        musicbrainzArtistId,
        name,
        trackCount: trackDelta,
        collectionKeys: collectionKey ? new Set([collectionKey]) : new Set(),
      });
    }
  };

  for (const entry of entries) {
    const { name, musicbrainzArtistId } = resolveCanonicalArtistForTrack(entry);
    upsertArtist(name, musicbrainzArtistId, 1, undefined, entry);

    const feat = featuredArtistsFromTrackTitle(entry.title ?? '');
    if (feat) {
      for (const guest of parseLockerArtistBilling(feat)) {
        upsertArtist(guest, null, 1, undefined, entry);
      }
    }

    const trackPrimary = albumPrimaryArtist(entry.artist ?? '');
    for (const billed of parseLockerArtistBilling(entry.artist ?? '')) {
      if (normalizeLockerKeyPart(billed) !== normalizeLockerKeyPart(trackPrimary)) {
        upsertArtist(billed, null, 1, undefined, entry);
      }
    }
  }

  for (const collection of collections) {
    const sample = collection.editions[0]?.tracks[0];
    if (sample && isMislabeledPlaylistStubArtist(collection.artist, sample)) continue;
    upsertArtist(collection.artist, null, 0, collection.key, sample);

    const allTracks = collection.editions.flatMap((edition) => edition.tracks);
    const guests = collectLockerGuestArtists(collection.artist, allTracks);
    for (const guest of guests) {
      upsertArtist(guest, null, 0, collection.key, sample);
    }
  }

  const merged = new Map<string, ArtistRow>();
  for (const row of byId.values()) {
    const mergeKey = normalizeIdentityKey(row.name);
    const existing = merged.get(mergeKey);
    if (!existing) {
      merged.set(mergeKey, {
        ...row,
        collectionKeys: new Set(row.collectionKeys),
      });
      continue;
    }
    existing.trackCount += row.trackCount;
    for (const key of row.collectionKeys) existing.collectionKeys.add(key);
    if (!existing.musicbrainzArtistId && row.musicbrainzArtistId) {
      existing.musicbrainzArtistId = row.musicbrainzArtistId;
    }
  }

  return [...merged.values()]
    .map((row) => ({
      id: buildCanonicalArtistId(row.musicbrainzArtistId, row.name),
      musicbrainzArtistId: row.musicbrainzArtistId,
      name: row.name,
      displayName: row.name,
      trackCount: row.trackCount,
      albumCount: row.collectionKeys.size,
      collectionKeys: [...row.collectionKeys],
    }))
    .filter(
      (a) =>
        a.trackCount > 0 &&
        !isKnownPlaylistStubArtistName(a.name) &&
        !isTitleFragmentArtistName(a.name) &&
        !isTruncatedArtistName(a.name, vaultArtistKeys) &&
        !isLikelyUploaderHandleArtist(a.name) &&
        !isArtistTitleMashupName(a.name) &&
        !looksLikeTitleNotArtist(a.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type ArtistCollectionRole = 'primary' | 'guest';

/** Whether an artist is the primary biller or a guest on a locker collection. */
export function lockerCollectionRoleForArtist(
  collection: Pick<AlbumCollection, 'artist' | 'editions'>,
  filter: string,
): ArtistCollectionRole | null {
  if (lockerCollectionPrimaryArtistMatches(collection.artist, filter)) return 'primary';
  const tracks = collection.editions.flatMap((edition) => edition.tracks);
  if (tracks.some((track) => lockerEntryMatchesArtistFilter(track, filter))) return 'guest';
  return null;
}

/** Build the locker media graph — canonical albums/artists plus collection stats. */
export function buildMediaGraph(
  entries: LockerEntry[],
  metaByEnvelopeId?: Map<string, EnvelopeMetaRow>,
  prefs?: PreferredEditionPrefs,
  graphStats?: MediaGraphStats | null,
): MediaGraph {
  const collections = buildAlbumCollections(entries, metaByEnvelopeId, prefs);
  return {
    albums: buildCanonicalAlbums(collections),
    artists: buildCanonicalArtists(entries),
    collections,
    stats: computeCollectionStats(entries, collections, graphStats),
  };
}

/** Map a collection + edition to the legacy AlbumGroup shape used by locker actions. */
export function editionToAlbumGroup(
  collection: AlbumCollection,
  edition: AlbumEdition,
): {
  key: string;
  name: string;
  displayName: string;
  artist: string;
  tracks: LockerEntry[];
  collectionKey: string;
  releaseGroupId: string | null;
  editionKind: EditionKind;
} {
  const artist = lockerAlbumDisplayArtist(
    edition.tracks[0] ?? { artist: collection.artist },
    edition.tracks,
  );
  return {
    key: edition.key,
    name: edition.name,
    displayName: edition.displayName,
    artist,
    tracks: edition.tracks,
    collectionKey: collection.key,
    releaseGroupId: collection.releaseGroupId,
    editionKind: edition.kind,
  };
}

export type CollectionAlbumGroup = ReturnType<typeof editionToAlbumGroup>;

export function computeCollectionStats(
  entries: LockerEntry[],
  collections: AlbumCollection[],
  graphStats?: MediaGraphStats | null,
): CollectionStats {
  const groups = groupTracksByEnvelope(entries);
  const duplicateTrackGroups = groups.filter((g) => g.entries.length > 1).length;
  const duplicateTrackCopies = groups.reduce(
    (sum, g) => sum + Math.max(0, g.entries.length - 1),
    0,
  );

  const hashBuckets = new Map<string, number>();
  for (const entry of entries) {
    const hash = contentHashFromEntry(entry);
    if (!hash) continue;
    hashBuckets.set(hash, (hashBuckets.get(hash) ?? 0) + 1);
  }
  const hashDuplicateGroups = [...hashBuckets.values()].filter((n) => n > 1).length;

  const releaseGroupCount = collections.filter((c) => c.releaseGroupId).length;
  const editionCount = collections.reduce((s, c) => s + c.editionCount, 0);
  const duplicateAlbumGroups = collections.filter((c) => c.editionCount > 1).length;

  let storageSavedBytes = 0;
  if (graphStats?.duplicateHashes?.length && graphStats.hashes > 0 && graphStats.dedupedBytes > 0) {
    const avgBytes = graphStats.dedupedBytes / graphStats.hashes;
    storageSavedBytes = graphStats.duplicateHashes.reduce(
      (sum, row) => sum + Math.max(0, row.refCount - 1) * avgBytes,
      0,
    );
  } else if (hashDuplicateGroups > 0) {
    storageSavedBytes = [...hashBuckets.entries()].reduce((sum, [, count]) => {
      if (count <= 1) return sum;
      return sum + (count - 1) * 4 * 1024 * 1024;
    }, 0);
  }

  return {
    releaseGroupCount,
    editionCount,
    albumCollectionCount: collections.length,
    legacyAlbumCount: collections.reduce((s, c) => s + c.editionCount, 0),
    duplicateTrackGroups,
    duplicateTrackCopies,
    duplicateAlbumGroups,
    hashDuplicateGroups,
    storageSavedBytes: Math.round(storageSavedBytes),
    storageSavedLabel: formatStorageSaved(storageSavedBytes),
  };
}

export function formatStorageSaved(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export type GroupedSearchCollection = {
  collectionKey: string;
  releaseGroupId: string | null;
  title: string;
  artist: string;
  editionCount: number;
  tracks: CatalogTrack[];
  albums: CatalogAlbum[];
};

/** Group Meilisearch / catalog locker hits by release group → collection → editions. */
export function groupLockerSearchHits(
  hits: Array<
    Pick<Tier34SearchHit, 'envelopeId' | 'title' | 'artist' | 'album' | 'year' | 'hash' | 'source'> & {
      musicbrainzReleaseGroupId?: string;
      musicbrainzReleaseId?: string;
    }
  >,
  toTrack: (hit: (typeof hits)[number]) => CatalogTrack,
): GroupedSearchCollection[] {
  const byCollection = new Map<string, GroupedSearchCollection>();

  for (const hit of hits) {
    const rg = hit.musicbrainzReleaseGroupId?.trim();
    const album = hit.album?.trim() || 'Unknown Album';
    const artist = hit.artist?.trim() || 'Unknown Artist';
    const collectionKey = rg ? `rg:${rg}` : `album:${artist.toLowerCase()}::${album.toLowerCase()}`;
    const track = toTrack(hit);

    let group = byCollection.get(collectionKey);
    if (!group) {
      group = {
        collectionKey,
        releaseGroupId: rg ?? null,
        title: album,
        artist,
        editionCount: 0,
        tracks: [],
        albums: [],
      };
      byCollection.set(collectionKey, group);
    }
    group.tracks.push(track);

    const editionKey = `${album}::${artist}`;
    if (!group.albums.some((a) => a.id === `local-album-${editionKey}`)) {
      group.albums.push({
        kind: 'album',
        id: `local-album-${editionKey}`,
        title: album,
        artist,
        releaseYear: hit.year,
        trackCount: 1,
        editionCount: 1,
        releaseGroupId: rg,
        isCollectionEdition: Boolean(rg),
      });
    } else {
      const existing = group.albums.find((a) => a.id === `local-album-${editionKey}`);
      if (existing) existing.trackCount = (existing.trackCount ?? 0) + 1;
    }
  }

  for (const group of byCollection.values()) {
    group.editionCount = group.albums.length;
    for (const album of group.albums) {
      album.editionCount = group.editionCount;
    }
  }

  return [...byCollection.values()];
}

// ---------------------------------------------------------------------------
// Locker tab classification (Albums · Singles · Videos)
// ---------------------------------------------------------------------------

const LOCKER_VIDEO_EXT_RE = /\.(mp4|webm|mkv|mov|avi|m4v)(\?|$)/i;

export type LockerTabId = 'artists' | 'albums' | 'singles' | 'videos' | 'playlists';

export function isLockerVideoEntry(entry: LockerEntry): boolean {
  const url = entry.url?.trim() ?? '';
  if (LOCKER_VIDEO_EXT_RE.test(url)) return true;
  const genre = entry.genre?.toLowerCase() ?? '';
  return genre.includes('video') || genre.includes('music video');
}

/** Locker track with no album group — excluded from buildAlbumCollections. */
export function isOrphanLockerTrack(entry: LockerEntry): boolean {
  return lockerAlbumGroupKey(entry) === null;
}

function buildOrphanSingleCollection(entry: LockerEntry): AlbumCollection {
  const artist = lockerAlbumGroupArtist(entry);
  const title = entry.title?.trim() || 'Unknown Track';
  const editionKey = `orphan:${entry.id}`;
  const edition: AlbumEdition = {
    key: editionKey,
    name: title,
    displayName: formatAlbumDisplayName(title),
    label: formatAlbumDisplayName(title),
    kind: 'other',
    year: entry.releaseYear,
    source: inferSourceFromEntry(entry),
    trackCount: 1,
    duplicateTrackCopies: 0,
    tracks: [entry],
    releaseGroupId: releaseGroupIdFromEntry(entry),
  };
  finalizeAlbumEdition(edition);

  return {
    key: editionKey,
    releaseGroupId: edition.releaseGroupId,
    title,
    displayName: edition.displayName,
    artist,
    editions: [edition],
    editionCount: 1,
    duplicateAlbumCount: 0,
    totalTracks: 1,
    preferredEditionKey: editionKey,
  };
}

/** Pseudo-collections for standalone downloads (no album metadata). */
export function buildOrphanSingleCollections(
  entries: LockerEntry[],
  videoIds?: Set<string>,
): AlbumCollection[] {
  const singles: AlbumCollection[] = [];
  for (const entry of entries) {
    if (!isOrphanLockerTrack(entry)) continue;
    if (videoIds?.has(entry.id)) continue;
    singles.push(buildOrphanSingleCollection(entry));
  }
  return singles.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function isLockerSingleCollection(collection: AlbumCollection): boolean {
  if (collection.key.startsWith('orphan:')) return true;
  if (collection.totalTracks <= 1) return true;
  const title = collection.displayName.toLowerCase();
  if (title.includes('- single') || title.endsWith(' single')) return true;
  if (title.includes(' - ep') || title.endsWith(' ep')) return true;
  const maxTracks = Math.max(...collection.editions.map((e) => e.trackCount), 0);
  return maxTracks <= 1;
}

export function collectionHasVideoTracks(
  collection: AlbumCollection,
  videoIds: Set<string>,
): boolean {
  return collection.editions.some((edition) =>
    edition.tracks.some((track) => videoIds.has(track.id)),
  );
}

export function filterCollectionsForLockerTab(
  collections: AlbumCollection[],
  tab: LockerTabId,
  entries: LockerEntry[],
): AlbumCollection[] {
  const videoIds = new Set(entries.filter(isLockerVideoEntry).map((e) => e.id));

  if (tab === 'videos') {
    return collections
      .filter((c) => collectionHasVideoTracks(c, videoIds))
      .filter((c) => c.editions.some((ed) => ed.tracks.length > 0));
  }

  const nonVideo = collections
    .filter((c) => !c.editions.every((ed) => ed.tracks.every((t) => videoIds.has(t.id))))
    .filter((c) => c.editions.some((ed) => ed.tracks.length > 0));

  if (tab === 'artists') {
    return nonVideo;
  }

  if (tab === 'singles') {
    const fromAlbumGroups = nonVideo.filter(isLockerSingleCollection);
    const orphanSingles = buildOrphanSingleCollections(entries, videoIds);
    return [...fromAlbumGroups, ...orphanSingles].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }

  return nonVideo.filter((c) => !isLockerSingleCollection(c));
}
