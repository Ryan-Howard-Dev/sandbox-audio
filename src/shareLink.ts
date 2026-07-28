/**
 * Paste any link and the app works out what you meant.
 *
 * The input model most music apps get wrong: they expect you to search their catalogue in their
 * words. But a link is how people actually pass music around — a friend sends a Tidal album, a
 * forum post links a Bandcamp record, a podcast lives at an RSS URL. All of those name a *work*,
 * and naming a work is separable from fetching it from that service.
 *
 * So this reads the link and nothing more: which service, what kind of thing, which id, and any
 * title the URL happens to spell out. What the app then does with that intent is its own business
 * — searching its own sources for the same album is a different act from pulling bytes out of
 * someone's service, and only the first one happens here.
 *
 * Nothing in this module fetches anything.
 */

export type ShareLinkService =
  | 'tidal'
  | 'spotify'
  | 'apple'
  | 'deezer'
  | 'qobuz'
  | 'youtube'
  | 'bandcamp'
  | 'soundcloud'
  | 'archive'
  | 'rss'
  | 'unknown';

export type ShareLinkKind = 'album' | 'playlist' | 'track' | 'artist' | 'podcast' | 'unknown';

export interface ShareLink {
  service: ShareLinkService;
  kind: ShareLinkKind;
  /** Service-side identifier, when the URL carries one. */
  id?: string;
  /** Words the URL spells out — often the artist and album, and enough to search on. */
  terms?: string;
  /** The URL as given, so a caller can fall back to fetching it directly when it is a feed. */
  url: string;
}

/** URL slugs are hyphenated and often carry the artist and title; recover them as search terms. */
function termsFromSlug(slug: string | undefined): string | undefined {
  const raw = slug?.trim() ?? '';
  if (!raw) return undefined;
  const words = decodeURIComponent(raw)
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[_+]/g, '-')
    .split('-')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^\d+$/.test(part));
  if (words.length === 0) return undefined;
  return words.join(' ');
}

function kindFromWord(word: string | undefined): ShareLinkKind {
  switch ((word ?? '').toLowerCase()) {
    case 'album':
    case 'albums':
      return 'album';
    case 'playlist':
    case 'playlists':
      return 'playlist';
    case 'track':
    case 'tracks':
    case 'song':
      return 'track';
    case 'artist':
    case 'artists':
    case 'browse':
      return 'artist';
    default:
      return 'unknown';
  }
}

/**
 * Structured intent from a pasted link, or null when it is not a URL at all.
 *
 * A bare search phrase is not a failure of this function — the caller should treat a null as
 * "the user typed words, search for those" rather than as an error.
 */
export function parseShareLink(input: string): ShareLink | null {
  const raw = input?.trim() ?? '';
  if (!raw) return null;

  // Tidal's own share format is a URI rather than a URL: tidal://album/12345
  const uriMatch = /^(tidal|spotify|qobuz):\/*([a-z]+)[:/]([\w-]+)/i.exec(raw);
  if (uriMatch) {
    return {
      service: uriMatch[1]!.toLowerCase() as ShareLinkService,
      kind: kindFromWord(uriMatch[2]),
      id: uriMatch[3],
      url: raw,
    };
  }

  /*
   * Reject a foreign scheme before prefixing rather than after. "https://" + "file:///etc/passwd"
   * parses cleanly as a host called "file", so a protocol check on the *result* passes something
   * that was never a web link.
   */
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (schemeMatch && !/^https?$/i.test(schemeMatch[1]!)) return null;

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/^https?:$/i.test(parsed.protocol)) return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const segments = parsed.pathname.split('/').filter((part) => part.length > 0);
  const base: ShareLink = { service: 'unknown', kind: 'unknown', url: raw };

  if (host.endsWith('tidal.com')) {
    // /browse/album/12345 and /album/12345 both occur.
    const idx = segments.findIndex((s) => kindFromWord(s) !== 'unknown' && s !== 'browse');
    return {
      ...base,
      service: 'tidal',
      kind: idx >= 0 ? kindFromWord(segments[idx]) : 'unknown',
      id: idx >= 0 ? segments[idx + 1] : undefined,
    };
  }

  if (host.endsWith('spotify.com')) {
    const idx = segments.findIndex((s) => kindFromWord(s) !== 'unknown');
    return {
      ...base,
      service: 'spotify',
      kind: idx >= 0 ? kindFromWord(segments[idx]) : 'unknown',
      id: idx >= 0 ? segments[idx + 1] : undefined,
    };
  }

  if (host.endsWith('music.apple.com') || host.endsWith('itunes.apple.com')) {
    // /gb/album/some-record/12345 — the slug is a gift, it names the record in plain words.
    const idx = segments.findIndex((s) => kindFromWord(s) !== 'unknown');
    const isTrack = parsed.searchParams.has('i');
    return {
      ...base,
      service: 'apple',
      kind: isTrack ? 'track' : idx >= 0 ? kindFromWord(segments[idx]) : 'unknown',
      id: parsed.searchParams.get('i') ?? (idx >= 0 ? segments[idx + 2] : undefined),
      terms: termsFromSlug(idx >= 0 ? segments[idx + 1] : undefined),
    };
  }

  if (host.endsWith('deezer.com')) {
    const idx = segments.findIndex((s) => kindFromWord(s) !== 'unknown');
    return {
      ...base,
      service: 'deezer',
      kind: idx >= 0 ? kindFromWord(segments[idx]) : 'unknown',
      id: idx >= 0 ? segments[idx + 1] : undefined,
    };
  }

  if (host.endsWith('qobuz.com')) {
    const idx = segments.findIndex((s) => kindFromWord(s) !== 'unknown');
    return {
      ...base,
      service: 'qobuz',
      kind: idx >= 0 ? kindFromWord(segments[idx]) : 'unknown',
      id: segments[segments.length - 1],
      terms: termsFromSlug(idx >= 0 ? segments[idx + 1] : undefined),
    };
  }

  if (host.endsWith('youtube.com') || host === 'youtu.be' || host.endsWith('music.youtube.com')) {
    const list = parsed.searchParams.get('list');
    const video = parsed.searchParams.get('v') ?? (host === 'youtu.be' ? segments[0] : undefined);
    return {
      ...base,
      service: 'youtube',
      kind: list ? 'playlist' : video ? 'track' : 'unknown',
      id: list ?? video ?? undefined,
    };
  }

  if (host.endsWith('bandcamp.com')) {
    // Bandcamp puts the artist in the subdomain and the record in the slug.
    const artist = host.replace('.bandcamp.com', '');
    const kind = segments[0] === 'album' ? 'album' : segments[0] === 'track' ? 'track' : 'artist';
    const title = termsFromSlug(segments[1]);
    return {
      ...base,
      service: 'bandcamp',
      kind,
      terms: [termsFromSlug(artist), title].filter(Boolean).join(' ') || undefined,
    };
  }

  if (host.endsWith('soundcloud.com')) {
    return {
      ...base,
      service: 'soundcloud',
      kind: segments[1] === 'sets' ? 'playlist' : segments[1] ? 'track' : 'artist',
      terms: [termsFromSlug(segments[0]), termsFromSlug(segments[segments.length - 1])]
        .filter(Boolean)
        .join(' ') || undefined,
    };
  }

  if (host.endsWith('archive.org')) {
    const idx = segments.findIndex((s) => s === 'details' || s === 'download');
    return {
      ...base,
      service: 'archive',
      kind: 'album',
      id: idx >= 0 ? segments[idx + 1] : undefined,
      terms: termsFromSlug(idx >= 0 ? segments[idx + 1] : undefined),
    };
  }

  // Anything ending in a feed path is treated as a podcast feed the app can fetch directly.
  if (/\.(xml|rss)$/i.test(parsed.pathname) || /\/(feed|rss)\/?$/i.test(parsed.pathname)) {
    return { ...base, service: 'rss', kind: 'podcast' };
  }

  return base;
}

/**
 * Words to search this app's own sources with.
 *
 * The point of the whole module: a link from a service becomes a search for the same work here.
 * Slug-derived terms are preferred because they name the record in words, and an opaque id is
 * useless to any source other than the one that issued it.
 */
export function shareLinkSearchTerms(link: ShareLink | null): string {
  if (!link) return '';
  if (link.terms?.trim()) return link.terms.trim();
  return '';
}
