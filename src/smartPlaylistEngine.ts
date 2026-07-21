/**
 * Smart playlist engine — rule evaluation against locker vault + play history.
 *
 * Smart playlists are dynamically generated; `StoredPlaylist.tracks` is a read-only
 * cache refreshed on locker / play-history / playlist-rule changes. Manual track edits
 * are not supported (pinning exceptions may be added later via `extensions.pinnedIds`).
 */

import {
  buildAlbumCollections,
  resolvePreferredEdition,
  type AlbumCollection,
} from './collectionIntelligence';
import type { LockerEntry } from './lockerStorage';
import { resolveLockerEntryGroupArt } from './lockerStorage';
import type { MediaEnvelope } from './sandboxLayer1';
import type { StoredPlayHit } from './playHistory';
import { getSmartPlaylistRating } from './tasteProfile';
import { matchesAiPrompt, scoreAiPromptMatch } from './playlistAiPrompt';
import { scoreTrackForTaste } from './tasteProfile';

// ---------------------------------------------------------------------------
// Extensible rule schema (v1)
// ---------------------------------------------------------------------------

export type SmartRuleField =
  | 'genre'
  | 'artist'
  | 'album'
  | 'year'
  | 'playCount'
  | 'lastPlayed'
  | 'dateAdded'
  | 'rating';

export type SmartRuleOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'before'
  | 'after'
  | 'withinDays'
  | 'notWithinDays';

export type SmartRule = {
  id: string;
  field: SmartRuleField;
  operator: SmartRuleOperator;
  value: string | number;
  /** Future: releaseGroupId, collectionTag, aiEmbedding, etc. */
  meta?: Record<string, unknown>;
};

export type SmartPlaylistSortField = SmartRuleField | 'title';

export type SmartConditionLogic = 'and' | 'or';

export type SmartPlaylistAlgorithm = 'unfinished-albums';

export type SmartPlaylistRules = {
  schemaVersion: 1;
  /** Rule conditions — combined with conditionLogic (default AND). */
  conditions: SmartRule[];
  /** How to combine conditions; default `and`. */
  conditionLogic?: SmartConditionLogic;
  sortBy?: SmartPlaylistSortField;
  sortDirection?: 'asc' | 'desc';
  limit?: number;
  /** Collection-intelligence algorithms and future extensions. */
  extensions?: {
    algorithm?: SmartPlaylistAlgorithm;
    pinnedIds?: string[];
    releaseGroupId?: string;
    collectionTag?: string;
    aiPrompt?: string;
    [key: string]: unknown;
  };
};

export type BuiltInSmartPlaylistId =
  | 'recently-added'
  | 'most-played'
  | 'never-played'
  | 'recently-played'
  | 'forgotten-tracks'
  | 'unfinished-albums'
  | 'favorites'
  | 'liked-tracks'
  | 'by-genre'
  | 'by-artist'
  | 'by-year';

/** Auto-managed built-ins — created locally, not synced cross-device. */
export const CORE_BUILTIN_SMART_PLAYLIST_IDS: BuiltInSmartPlaylistId[] = [
  'recently-added',
  'recently-played',
  'most-played',
  'never-played',
  'forgotten-tracks',
  'unfinished-albums',
];

export function isCoreBuiltInSmartPlaylist(id?: BuiltInSmartPlaylistId): boolean {
  return Boolean(id && CORE_BUILTIN_SMART_PLAYLIST_IDS.includes(id));
}

export function coreBuiltInPlaylistId(builtInId: BuiltInSmartPlaylistId): string {
  return `builtin-${builtInId}`;
}

export type BuiltInSmartPlaylistPreset = {
  id: BuiltInSmartPlaylistId;
  name: string;
  description: string;
  rules: SmartPlaylistRules;
  /** Built-ins that need a user-supplied value (genre / artist / year). */
  requiresParam?: 'genre' | 'artist' | 'year';
  paramLabel?: string;
  paramPlaceholder?: string;
};

/** Minimum play count to qualify as a favorite (no dedicated favorite flag yet). */
export const FAVORITES_PLAY_COUNT_THRESHOLD = 5;

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Built-in presets
// ---------------------------------------------------------------------------

export const BUILT_IN_SMART_PLAYLISTS: BuiltInSmartPlaylistPreset[] = [
  {
    id: 'recently-added',
    name: 'Recently Added',
    description: 'Newest locker uploads first',
    rules: {
      schemaVersion: 1,
      conditions: [],
      sortBy: 'dateAdded',
      sortDirection: 'desc',
      limit: 100,
    },
  },
  {
    id: 'most-played',
    name: 'Most Played',
    description: 'Tracks ranked by total play count',
    rules: {
      schemaVersion: 1,
      conditions: [{ id: 'mp-min', field: 'playCount', operator: 'gte', value: 1 }],
      sortBy: 'playCount',
      sortDirection: 'desc',
      limit: 100,
    },
  },
  {
    id: 'never-played',
    name: 'Never Played',
    description: 'Locker tracks with zero plays',
    rules: {
      schemaVersion: 1,
      conditions: [{ id: 'np-zero', field: 'playCount', operator: 'eq', value: 0 }],
      sortBy: 'dateAdded',
      sortDirection: 'desc',
    },
  },
  {
    id: 'recently-played',
    name: 'Recently Played',
    description: 'Sorted by last played timestamp',
    rules: {
      schemaVersion: 1,
      conditions: [{ id: 'rp-has', field: 'playCount', operator: 'gte', value: 1 }],
      sortBy: 'lastPlayed',
      sortDirection: 'desc',
      limit: 100,
    },
  },
  {
    id: 'forgotten-tracks',
    name: 'Forgotten Tracks',
    description: 'Played before but not in the last 90 days',
    rules: {
      schemaVersion: 1,
      conditions: [
        { id: 'ft-min', field: 'playCount', operator: 'gte', value: 1 },
        { id: 'ft-stale', field: 'lastPlayed', operator: 'notWithinDays', value: 90 },
      ],
      sortBy: 'lastPlayed',
      sortDirection: 'asc',
      limit: 100,
    },
  },
  {
    id: 'unfinished-albums',
    name: 'Unfinished Albums',
    description: 'Unplayed tracks from albums you started but have not finished',
    rules: {
      schemaVersion: 1,
      conditions: [],
      sortBy: 'album',
      sortDirection: 'asc',
      extensions: { algorithm: 'unfinished-albums' },
    },
  },
  {
    id: 'favorites',
    name: 'Favorites',
    description: `Tracks with ${FAVORITES_PLAY_COUNT_THRESHOLD}+ plays or thumbs-up`,
    rules: {
      schemaVersion: 1,
      conditionLogic: 'or',
      conditions: [
        {
          id: 'fav-threshold',
          field: 'playCount',
          operator: 'gte',
          value: FAVORITES_PLAY_COUNT_THRESHOLD,
        },
        {
          id: 'fav-liked',
          field: 'rating',
          operator: 'gte',
          value: 5,
        },
      ],
      sortBy: 'playCount',
      sortDirection: 'desc',
      limit: 100,
    },
  },
  {
    id: 'liked-tracks',
    name: 'Liked Tracks',
    description: 'Tracks you explicitly thumbs-upped',
    rules: {
      schemaVersion: 1,
      conditions: [{ id: 'lt-rating', field: 'rating', operator: 'gte', value: 5 }],
      sortBy: 'rating',
      sortDirection: 'desc',
      limit: 100,
    },
  },
  {
    id: 'by-genre',
    name: 'By Genre',
    description: 'Filter locker tracks by genre tag',
    requiresParam: 'genre',
    paramLabel: 'Genre',
    paramPlaceholder: 'e.g. Rock, Jazz, Electronic…',
    rules: {
      schemaVersion: 1,
      conditions: [{ id: 'bg-genre', field: 'genre', operator: 'contains', value: '' }],
      sortBy: 'title',
      sortDirection: 'asc',
    },
  },
  {
    id: 'by-artist',
    name: 'By Artist',
    description: 'Filter locker tracks by artist name',
    requiresParam: 'artist',
    paramLabel: 'Artist',
    paramPlaceholder: 'e.g. Artist name…',
    rules: {
      schemaVersion: 1,
      conditions: [{ id: 'ba-artist', field: 'artist', operator: 'contains', value: '' }],
      sortBy: 'title',
      sortDirection: 'asc',
    },
  },
  {
    id: 'by-year',
    name: 'By Year',
    description: 'Filter locker tracks by release year',
    requiresParam: 'year',
    paramLabel: 'Year',
    paramPlaceholder: 'e.g. 1999',
    rules: {
      schemaVersion: 1,
      conditions: [{ id: 'by-year', field: 'year', operator: 'eq', value: '' }],
      sortBy: 'title',
      sortDirection: 'asc',
    },
  },
];

export function getBuiltInPreset(id: BuiltInSmartPlaylistId): BuiltInSmartPlaylistPreset | undefined {
  return BUILT_IN_SMART_PLAYLISTS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Track context + envelope mapping
// ---------------------------------------------------------------------------

export type SmartTrackContext = {
  envelopeId: string;
  lockerId: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: string;
  dateAdded: number;
  playCount: number;
  lastPlayedAt: number;
  /** Reserved for future star-rating support; defaults to 0. */
  rating: number;
  entry: LockerEntry;
};

export function lockerEntryToEnvelope(entry: LockerEntry): MediaEnvelope {
  return {
    envelopeId: `local-${entry.id}`,
    title: entry.title,
    artist: entry.artist,
    album: entry.albumName,
    url: entry.url,
    durationSeconds: entry.durationSeconds || 210,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: entry.id,
    artworkUrl: resolveLockerEntryGroupArt(entry),
    releaseYear: entry.releaseYear,
  };
}

export function buildSmartTrackContexts(
  lockerEntries: LockerEntry[],
  playHistory: StoredPlayHit[],
): SmartTrackContext[] {
  const historyById = new Map(playHistory.map((h) => [h.envelopeId, h]));
  return lockerEntries
    .filter((e) => e.url?.trim())
    .map((entry) => {
      const envelopeId = `local-${entry.id}`;
      const hit = historyById.get(envelopeId);
      return {
        envelopeId,
        lockerId: entry.id,
        title: entry.title,
        artist: entry.artist,
        album: entry.albumName ?? '',
        genre: entry.genre ?? '',
        year: entry.releaseYear ?? '',
        dateAdded: entry.addedAt ?? 0,
        playCount: hit?.playCount ?? 0,
        lastPlayedAt: hit?.lastPlayedAt ?? 0,
        rating: getSmartPlaylistRating(envelopeId),
        entry,
      };
    });
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function parseRuleNumber(value: string | number): number {
  if (typeof value === 'number') return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getFieldValue(ctx: SmartTrackContext, field: SmartRuleField): string | number {
  switch (field) {
    case 'genre':
      return ctx.genre;
    case 'artist':
      return ctx.artist;
    case 'album':
      return ctx.album;
    case 'year':
      return ctx.year;
    case 'playCount':
      return ctx.playCount;
    case 'lastPlayed':
      return ctx.lastPlayedAt;
    case 'dateAdded':
      return ctx.dateAdded;
    case 'rating':
      return ctx.rating;
    default:
      return '';
  }
}

function evaluateRule(ctx: SmartTrackContext, rule: SmartRule, now = Date.now()): boolean {
  const raw = getFieldValue(ctx, rule.field);
  const strVal = String(rule.value ?? '').trim();
  const numVal = parseRuleNumber(rule.value);
  const rawStr = String(raw);
  const rawNum = typeof raw === 'number' ? raw : parseRuleNumber(raw);

  switch (rule.operator) {
    case 'eq':
      if (rule.field === 'year' || rule.field === 'playCount' || rule.field === 'rating') {
        return rawNum === numVal;
      }
      return norm(rawStr) === norm(strVal);
    case 'neq':
      if (rule.field === 'year' || rule.field === 'playCount' || rule.field === 'rating') {
        return rawNum !== numVal;
      }
      return norm(rawStr) !== norm(strVal);
    case 'contains':
      return norm(rawStr).includes(norm(strVal));
    case 'gt':
      return rawNum > numVal;
    case 'gte':
      return rawNum >= numVal;
    case 'lt':
      return rawNum < numVal;
    case 'lte':
      return rawNum <= numVal;
    case 'before':
      return rawNum > 0 && rawNum < numVal;
    case 'after':
      return rawNum > numVal;
    case 'withinDays': {
      if (rawNum <= 0) return false;
      const windowMs = numVal * MS_PER_DAY;
      return now - rawNum <= windowMs;
    }
    case 'notWithinDays': {
      if (rawNum <= 0) return true;
      const windowMs = numVal * MS_PER_DAY;
      return now - rawNum > windowMs;
    }
    default:
      return true;
  }
}

function compareContexts(
  a: SmartTrackContext,
  b: SmartTrackContext,
  sortBy: SmartPlaylistSortField,
  direction: 'asc' | 'desc',
): number {
  const mul = direction === 'asc' ? 1 : -1;
  let cmp = 0;
  switch (sortBy) {
    case 'title':
      cmp = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      break;
    case 'artist':
      cmp = a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' });
      break;
    case 'album':
      cmp = a.album.localeCompare(b.album, undefined, { sensitivity: 'base' });
      break;
    case 'genre':
      cmp = a.genre.localeCompare(b.genre, undefined, { sensitivity: 'base' });
      break;
    case 'year':
      cmp = a.year.localeCompare(b.year, undefined, { sensitivity: 'base' });
      break;
    case 'playCount':
      cmp = a.playCount - b.playCount || a.lastPlayedAt - b.lastPlayedAt;
      break;
    case 'lastPlayed':
      cmp = a.lastPlayedAt - b.lastPlayedAt;
      break;
    case 'dateAdded':
      cmp = a.dateAdded - b.dateAdded;
      break;
    case 'rating':
      cmp = a.rating - b.rating;
      break;
    default:
      cmp = 0;
  }
  return cmp * mul;
}

/**
 * Unplayed tracks from albums where at least one track was played (release-group aware).
 */
export function evaluateUnfinishedAlbumTracks(
  lockerEntries: LockerEntry[],
  playHistory: StoredPlayHit[],
  collections?: AlbumCollection[],
): string[] {
  const historyById = new Map(playHistory.map((h) => [h.envelopeId, h]));
  const albumCollections = collections ?? buildAlbumCollections(lockerEntries);
  const envelopeIds: string[] = [];
  const seen = new Set<string>();

  for (const collection of albumCollections) {
    const edition = resolvePreferredEdition(collection);
    const tracks = edition.tracks.filter((e) => e.url?.trim());
    if (tracks.length < 2) continue;

    const playedCount = tracks.filter((t) => {
      const hit = historyById.get(`local-${t.id}`);
      return (hit?.playCount ?? 0) > 0;
    }).length;

    if (playedCount === 0 || playedCount >= tracks.length) continue;

    for (const track of tracks) {
      const envelopeId = `local-${track.id}`;
      const hit = historyById.get(envelopeId);
      if ((hit?.playCount ?? 0) > 0) continue;
      if (seen.has(envelopeId)) continue;
      seen.add(envelopeId);
      envelopeIds.push(envelopeId);
    }
  }

  return envelopeIds;
}

function matchesRuleConditions(
  ctx: SmartTrackContext,
  rules: SmartPlaylistRules,
  now: number,
): boolean {
  if (!rules.conditions.length) return true;
  const logic = rules.conditionLogic ?? 'and';
  if (logic === 'or') {
    return rules.conditions.some((rule) => evaluateRule(ctx, rule, now));
  }
  return rules.conditions.every((rule) => evaluateRule(ctx, rule, now));
}

/**
 * Evaluate smart playlist rules against locker entries + play history.
 * Returns envelope IDs in display order.
 */
export function evaluateSmartPlaylist(
  rules: SmartPlaylistRules,
  lockerEntries: LockerEntry[],
  playHistory: StoredPlayHit[],
  now = Date.now(),
): string[] {
  if (rules.extensions?.algorithm === 'unfinished-albums') {
    const ids = evaluateUnfinishedAlbumTracks(lockerEntries, playHistory);
    const sortBy = rules.sortBy ?? 'album';
    const sortDirection = rules.sortDirection ?? 'asc';
    const contexts = buildSmartTrackContexts(lockerEntries, playHistory);
    const byId = new Map(contexts.map((c) => [c.envelopeId, c]));
    let matched = ids
      .map((id) => byId.get(id))
      .filter((c): c is SmartTrackContext => Boolean(c));
    matched = [...matched].sort((a, b) => compareContexts(a, b, sortBy, sortDirection));
    if (rules.limit != null && rules.limit > 0) {
      matched = matched.slice(0, rules.limit);
    }
    return matched.map((c) => c.envelopeId);
  }

  const contexts = buildSmartTrackContexts(lockerEntries, playHistory);
  const pinned = new Set(rules.extensions?.pinnedIds ?? []);

  const aiPrompt = rules.extensions?.aiPrompt?.trim();

  let matched = contexts.filter((ctx) => {
    if (pinned.has(ctx.envelopeId)) return true;
    const passesRules =
      !rules.conditions.length || matchesRuleConditions(ctx, rules, now);
    if (!passesRules) return false;
    if (aiPrompt) return matchesAiPrompt(ctx, aiPrompt);
    return true;
  });

  if (aiPrompt) {
    matched = [...matched].sort((a, b) => {
      const vibeA = scoreAiPromptMatch(a, aiPrompt);
      const vibeB = scoreAiPromptMatch(b, aiPrompt);
      const tasteA = scoreTrackForTaste(lockerEntryToEnvelope(a.entry));
      const tasteB = scoreTrackForTaste(lockerEntryToEnvelope(b.entry));
      const scoreA = vibeA * 0.65 + Math.max(0, tasteA) * 0.35;
      const scoreB = vibeB * 0.65 + Math.max(0, tasteB) * 0.35;
      return scoreB - scoreA;
    });
  } else {
    const sortBy = rules.sortBy ?? 'dateAdded';
    const sortDirection = rules.sortDirection ?? 'desc';
    matched = [...matched].sort((a, b) => compareContexts(a, b, sortBy, sortDirection));
  }

  if (rules.limit != null && rules.limit > 0) {
    matched = matched.slice(0, rules.limit);
  }

  return matched.map((ctx) => ctx.envelopeId);
}

export function resolveEnvelopeIdsToTracks(
  envelopeIds: string[],
  lockerEntries: LockerEntry[],
): MediaEnvelope[] {
  const byLockerId = new Map(lockerEntries.map((e) => [e.id, e]));
  const tracks: MediaEnvelope[] = [];
  const seen = new Set<string>();
  for (const id of envelopeIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const lockerId = id.startsWith('local-') ? id.slice(6) : id;
    const entry = byLockerId.get(lockerId);
    if (entry?.url) tracks.push(lockerEntryToEnvelope(entry));
  }
  return tracks;
}

export function evaluateSmartPlaylistTracks(
  rules: SmartPlaylistRules,
  lockerEntries: LockerEntry[],
  playHistory: StoredPlayHit[],
): MediaEnvelope[] {
  const ids = evaluateSmartPlaylist(rules, lockerEntries, playHistory);
  return resolveEnvelopeIdsToTracks(ids, lockerEntries);
}

/** Apply built-in param (genre / artist / year) into rule conditions. */
export function applyBuiltInParam(
  rules: SmartPlaylistRules,
  builtInId: BuiltInSmartPlaylistId,
  param: string,
): SmartPlaylistRules {
  const trimmed = param.trim();
  if (!trimmed) return rules;
  const conditions = rules.conditions.map((rule) => {
    if (builtInId === 'by-genre' && rule.field === 'genre') {
      return { ...rule, value: trimmed };
    }
    if (builtInId === 'by-artist' && rule.field === 'artist') {
      return { ...rule, value: trimmed };
    }
    if (builtInId === 'by-year' && rule.field === 'year') {
      return { ...rule, value: trimmed };
    }
    return rule;
  });
  return { ...rules, conditions };
}

export function describeSmartPlaylistRules(
  rules: SmartPlaylistRules,
  builtInId?: BuiltInSmartPlaylistId,
  builtInParam?: string,
): string {
  if (builtInId) {
    const preset = getBuiltInPreset(builtInId);
    if (preset) {
      const paramSuffix = builtInParam?.trim() ? ` · ${builtInParam.trim()}` : '';
      return `${preset.name}${paramSuffix}`;
    }
  }
  if (rules.extensions?.algorithm === 'unfinished-albums') {
    return 'Unfinished albums · unplayed tracks from partial albums';
  }
  if (!rules.conditions.length) {
    return 'All locker tracks';
  }
  const logic = rules.conditionLogic === 'or' ? ' OR ' : ' · ';
  const parts = rules.conditions.map((r) => {
    const op =
      r.operator === 'contains'
        ? 'contains'
        : r.operator === 'withinDays'
          ? `within ${r.value}d`
          : r.operator === 'notWithinDays'
            ? `not within ${r.value}d`
            : `${r.operator} ${r.value}`;
    return `${r.field} ${op}`;
  });
  return parts.join(logic);
}

export const SMART_RULE_FIELDS: { field: SmartRuleField; label: string; type: 'text' | 'number' | 'date' }[] = [
  { field: 'genre', label: 'Genre', type: 'text' },
  { field: 'artist', label: 'Artist', type: 'text' },
  { field: 'album', label: 'Album', type: 'text' },
  { field: 'year', label: 'Year', type: 'text' },
  { field: 'playCount', label: 'Play count', type: 'number' },
  { field: 'lastPlayed', label: 'Last played', type: 'date' },
  { field: 'dateAdded', label: 'Date added', type: 'date' },
  { field: 'rating', label: 'Rating', type: 'number' },
];

export const TEXT_OPERATORS: SmartRuleOperator[] = ['eq', 'neq', 'contains'];
export const NUMBER_OPERATORS: SmartRuleOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'];
export const DATE_OPERATORS: SmartRuleOperator[] = [
  'before',
  'after',
  'withinDays',
  'notWithinDays',
];

export function operatorsForField(field: SmartRuleField): SmartRuleOperator[] {
  const meta = SMART_RULE_FIELDS.find((f) => f.field === field);
  if (!meta) return TEXT_OPERATORS;
  if (meta.type === 'number') return NUMBER_OPERATORS;
  if (meta.type === 'date') {
    if (field === 'lastPlayed') return ['withinDays', 'notWithinDays', 'before', 'after'];
    return DATE_OPERATORS;
  }
  return TEXT_OPERATORS;
}

export function newSmartRule(field: SmartRuleField = 'artist'): SmartRule {
  const ops = operatorsForField(field);
  return {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    field,
    operator: ops[0] ?? 'contains',
    value: field === 'playCount' ? 1 : '',
  };
}

export function defaultCustomSmartRules(): SmartPlaylistRules {
  return {
    schemaVersion: 1,
    conditions: [newSmartRule('artist')],
    sortBy: 'title',
    sortDirection: 'asc',
  };
}
