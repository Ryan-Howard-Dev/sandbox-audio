/**
 * Parse performer + title from YMusic filenames and long import title blobs.
 */

import {
  formatDisplayTrackTitle,
  isBadMediaStoreArtist,
  isTitleFragmentArtistName,
  isUsableArtistName,
} from './lockerStorage';

function scoreDashArtistSide(artist: string, title: string, combined?: string): number {
  if (!artist.trim() || !title.trim()) return -1;
  if (isBadMediaStoreArtist(artist)) return -1;
  const context = { title: combined ?? `${title} ${artist}`, artist };
  if (isTitleFragmentArtistName(artist, context)) return -1;
  if (!isUsableArtistName(artist)) return -1;

  let score = 0;
  const artistWords = artist.split(/\s+/).filter(Boolean);
  const titleWords = title.split(/\s+/).filter(Boolean);
  if (artistWords.length === 1 && titleWords.length >= 2) score += 5;
  if (artistWords.length >= 2 && titleWords.length === 1) score += 5;
  if (artistWords.length >= 2) score += 1;
  return score;
}

function parseArtistTitleFromFilename(name: string): { artist?: string; title: string } {
  const base = name.replace(/\.[^/.]+$/, '');
  const withoutNumber = base.replace(/^\s*\d+\s*[-._)]?\s*/, '').trim() || base.trim();
  const dash = withoutNumber.split(/\s+[-–—]\s+/);
  if (dash.length >= 2 && dash[0]!.trim() && dash[1]!.trim()) {
    const left = dash[0]!.trim();
    const right = dash.slice(1).join(' - ').trim();
    const combined = withoutNumber;
    const forward = { artist: left, title: right };
    const reverse = { artist: right, title: left };
    const forwardScore = scoreDashArtistSide(forward.artist, forward.title, combined);
    const reverseScore = scoreDashArtistSide(reverse.artist, reverse.title, combined);
    if (reverseScore > forwardScore) return reverse;
    if (forwardScore >= 0) return forward;
    if (reverseScore >= 0) return reverse;
    return { title: withoutNumber };
  }
  return { title: withoutNumber };
}

/** Split ALL-CAPS blobs like "KANYE WEST BITTERSWEET POETRY" into artist + title. */
export function inferArtistTitleFromAllCapsBlob(text: string): { artist?: string; title: string } | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed !== trimmed.toUpperCase()) return null;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 3) return null;

  for (const artistWordCount of [2, 1, 3]) {
    if (words.length <= artistWordCount) continue;
    const artistPart = words.slice(0, artistWordCount).join(' ');
    const titlePart = words.slice(artistWordCount).join(' ');
    if (titlePart.length < 3) continue;
    const artist = formatDisplayTrackTitle(artistPart);
    const title = formatDisplayTrackTitle(titlePart);
    if (artist.length >= 3 && title.length >= 3) {
      return { artist, title };
    }
  }
  return null;
}

/** Fan mashups / YMusic meme titles — skip low-confidence catalog art + album matching. */
export function isLikelyFanEditTrackTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (t.length > 72) return true;
  if ((t.match(/\s+/g) ?? []).length >= 12) return true;
  if (
    /\b(but\s+it\s+will|makes?\s+you\s+ascend|extended|slowed|sped\s+up|mashup|fan\s+edit|reupload)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** Pull performer + song title from YMusic filenames and long title blobs. */
export function extractEmbeddedPerformerFromText(
  text: string,
): { artist?: string; title: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const caps = inferArtistTitleFromAllCapsBlob(trimmed);
  if (caps?.artist && !isBadMediaStoreArtist(caps.artist)) return caps;

  const fromFile = parseArtistTitleFromFilename(trimmed);
  if (fromFile.artist && !isBadMediaStoreArtist(fromFile.artist)) {
    return {
      artist: formatDisplayTrackTitle(fromFile.artist),
      title: formatDisplayTrackTitle(fromFile.title),
    };
  }

  const leading = trimmed.match(/^([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,2})\s+(.+)$/);
  if (leading) {
    const candidate = leading[1].trim();
    const rest = leading[2].trim();
    if (
      isUsableArtistName(candidate) &&
      !isBadMediaStoreArtist(candidate) &&
      !isTitleFragmentArtistName(candidate, { title: trimmed, artist: candidate }) &&
      rest.length >= 3 &&
      rest.split(/\s+/).length >= 2
    ) {
      return {
        artist: formatDisplayTrackTitle(candidate),
        title: formatDisplayTrackTitle(rest),
      };
    }
  }

  const embedded = trimmed.match(/\b(kanye\s+west)\b/i);
  if (embedded) {
    const artist = formatDisplayTrackTitle(embedded[1]);
    const titlePart = trimmed
      .replace(new RegExp(embedded[0], 'i'), ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (titlePart.length >= 3) {
      return { artist, title: formatDisplayTrackTitle(titlePart) };
    }
  }

  return null;
}

export function resolveImportArtistAndTitle(sources: {
  pathName: string;
  mediaTitle: string;
  mediaArtist: string;
}): { artist: string; title: string } {
  const { pathName, mediaTitle, mediaArtist } = sources;
  let title = mediaTitle.trim() || pathName.replace(/\.[^/.]+$/, '');
  let artist = mediaArtist.trim();

  const fromPath = parseArtistTitleFromFilename(pathName);
  const fromTitle = extractEmbeddedPerformerFromText(title);
  const fromMediaTitle = extractEmbeddedPerformerFromText(mediaTitle.trim());
  const fromPathEmbed = extractEmbeddedPerformerFromText(pathName.replace(/\.[^/.]+$/, ''));

  const embedded =
    fromTitle ??
    fromMediaTitle ??
    fromPathEmbed ??
    (fromPath.artist ? { artist: fromPath.artist, title: fromPath.title } : null);

  if (embedded?.artist && !isBadMediaStoreArtist(embedded.artist)) {
    artist = embedded.artist;
    title = embedded.title;
  } else if (isBadMediaStoreArtist(artist) && fromPath.artist && !isBadMediaStoreArtist(fromPath.artist)) {
    artist = fromPath.artist;
    title = fromPath.title;
  }

  if (!artist || isBadMediaStoreArtist(artist)) {
    artist = 'Local Upload';
  }

  return {
    artist,
    title: formatDisplayTrackTitle(title),
  };
}
