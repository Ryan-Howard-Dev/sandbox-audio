/**
 * The Podcasting 2.0 namespace.
 *
 * Everything here already exists in feeds the app fetches; it is simply thrown away today. The
 * tags fall into two groups, and they are read for different reasons.
 *
 * The first is `podcast:locked`, which is the publisher saying whether their feed may be imported
 * or mirrored elsewhere. It is the one tag in the namespace that constrains what this app is
 * allowed to do, and it is the reason this module exists at the ingestion boundary rather than in
 * the player — a feed marked locked must be refused before anything is copied, not filtered out of
 * a view afterwards.
 *
 * The second is everything the listener gains: transcripts, chapters, soundbites, the people
 * involved, where a recording happened, and how to support it. Chapters and transcripts in
 * particular are exactly what the audiobook and podcast players already want and currently have to
 * do without.
 *
 * Parsing only. Nothing here fetches a transcript or a chapter file; it reports where they are.
 */

export interface PodcastPerson {
  name: string;
  /** host, guest, producer… as the feed states it. Free text by specification. */
  role?: string;
  group?: string;
  img?: string;
  href?: string;
}

export interface PodcastTranscriptRef {
  url: string;
  /** application/json, text/vtt, application/x-subrip… */
  type: string;
  language?: string;
  /** "captions" marks a transcript intended for accessibility rather than search. */
  rel?: string;
}

export interface PodcastSoundbite {
  startTime: number;
  duration: number;
  title?: string;
}

export interface PodcastFunding {
  url: string;
  label?: string;
}

export interface PodcastChannelTags {
  /**
   * Publisher's answer to "may this feed be imported or mirrored elsewhere".
   *
   * Absent means unstated, which is not consent — see feedAllowsImport.
   */
  locked?: boolean;
  /** Contact for a claim, when the publisher supplies one alongside the lock. */
  lockOwner?: string;
  guid?: string;
  medium?: string;
  persons: PodcastPerson[];
  funding: PodcastFunding[];
  /** Feeds the publisher themselves recommend — an endorsement graph, not an algorithm. */
  podroll: string[];
  location?: string;
}

export interface PodcastItemTags {
  transcripts: PodcastTranscriptRef[];
  /** External chapter file (JSON), which the spec prefers over ID3 chapters. */
  chaptersUrl?: string;
  chaptersType?: string;
  soundbites: PodcastSoundbite[];
  persons: PodcastPerson[];
  season?: number;
  episode?: number;
  location?: string;
  /** URI of the post where discussion of this episode lives. */
  socialInteractUrl?: string;
}

const PODCAST_NS = 'https://podcastindex.org/namespace/1.0';

function parseXml(xml: string): Document | null {
  if (typeof DOMParser === 'undefined') return null;
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    return doc.querySelector('parsererror') ? null : doc;
  } catch {
    return null;
  }
}

/**
 * Elements in the podcast namespace, by local name.
 *
 * Matched on local name rather than the `podcast:` prefix. The prefix is chosen by whoever wrote
 * the feed and is not guaranteed — a publisher may bind the namespace to any prefix they like, and
 * matching the literal string would silently miss those feeds.
 */
function podcastElements(scope: Element | Document, localName: string): Element[] {
  const byNs = Array.from(scope.getElementsByTagNameNS?.(PODCAST_NS, localName) ?? []);
  if (byNs.length > 0) return byNs;
  // Fall back to prefix matching for parsers that do not expose namespace lookups.
  return Array.from(scope.getElementsByTagName(`podcast:${localName}`));
}

function text(element: Element | undefined): string {
  return element?.textContent?.trim() ?? '';
}

function attr(element: Element, name: string): string | undefined {
  const value = element.getAttribute(name)?.trim();
  return value ? value : undefined;
}

function numberAttr(element: Element, name: string): number | undefined {
  const raw = attr(element, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** `<podcast:season>3</podcast:season>` — the number is the element's text, not an attribute. */
function numericTagValue(element: Element | undefined): number | undefined {
  if (!element) return undefined;
  const value = Number(text(element));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function parsePersons(scope: Element | Document): PodcastPerson[] {
  return podcastElements(scope, 'person')
    .map((element) => ({
      name: text(element),
      role: attr(element, 'role'),
      group: attr(element, 'group'),
      img: attr(element, 'img'),
      href: attr(element, 'href'),
    }))
    .filter((person) => person.name.length > 0);
}

/** Channel-level tags, including the lock. */
export function parsePodcastChannelTags(xml: string): PodcastChannelTags {
  const empty: PodcastChannelTags = { persons: [], funding: [], podroll: [] };
  const doc = parseXml(xml);
  if (!doc) return empty;
  const channel = doc.querySelector('channel') ?? doc.documentElement;
  if (!channel) return empty;

  const lockedElement = podcastElements(channel, 'locked')[0];
  const lockedText = text(lockedElement).toLowerCase();

  const podroll = podcastElements(channel, 'podroll').flatMap((element) =>
    Array.from(element.getElementsByTagName('*'))
      .map((remoteItem) => attr(remoteItem, 'feedUrl') ?? attr(remoteItem, 'feedGuid'))
      .filter((value): value is string => Boolean(value)),
  );

  return {
    locked: lockedElement ? lockedText === 'yes' || lockedText === 'true' || lockedText === '1' : undefined,
    lockOwner: lockedElement ? attr(lockedElement, 'owner') : undefined,
    guid: text(podcastElements(channel, 'guid')[0]) || undefined,
    medium: text(podcastElements(channel, 'medium')[0]) || undefined,
    persons: parsePersons(channel),
    funding: podcastElements(channel, 'funding')
      .map((element) => ({ url: attr(element, 'url') ?? '', label: text(element) || undefined }))
      .filter((entry) => entry.url.length > 0),
    podroll,
    location: text(podcastElements(channel, 'location')[0]) || undefined,
  };
}

/**
 * Whether this feed may be imported or mirrored into the app's own index.
 *
 * `locked` is a directive, not a preference. Absent is treated as permitted because the vast
 * majority of feeds predate the tag and saying nothing has always meant an open feed — but an
 * explicit yes is refused outright. This is checked before anything is copied rather than when
 * something is displayed: the point is not to hide a mirrored feed, it is not to make one.
 */
export function feedAllowsImport(tags: PodcastChannelTags): boolean {
  return tags.locked !== true;
}

/** Per-episode tags from a single `<item>` element's XML. */
export function parsePodcastItemTags(xml: string): PodcastItemTags {
  const empty: PodcastItemTags = { transcripts: [], soundbites: [], persons: [] };
  const doc = parseXml(xml);
  if (!doc) return empty;
  const item = doc.querySelector('item') ?? doc.documentElement;
  if (!item) return empty;

  const chapters = podcastElements(item, 'chapters')[0];
  const social = podcastElements(item, 'socialInteract')[0];

  return {
    transcripts: podcastElements(item, 'transcript')
      .map((element) => ({
        url: attr(element, 'url') ?? '',
        type: attr(element, 'type') ?? '',
        language: attr(element, 'language'),
        rel: attr(element, 'rel'),
      }))
      .filter((entry) => entry.url.length > 0),
    chaptersUrl: chapters ? attr(chapters, 'url') : undefined,
    chaptersType: chapters ? attr(chapters, 'type') : undefined,
    soundbites: podcastElements(item, 'soundbite')
      .map((element) => ({
        startTime: numberAttr(element, 'startTime') ?? -1,
        duration: numberAttr(element, 'duration') ?? -1,
        title: text(element) || undefined,
      }))
      // A soundbite without a real start and length cannot be played or drawn on a timeline.
      .filter((entry) => entry.startTime >= 0 && entry.duration > 0),
    persons: parsePersons(item),
    season: numericTagValue(podcastElements(item, 'season')[0]),
    episode: numericTagValue(podcastElements(item, 'episode')[0]),
    location: text(podcastElements(item, 'location')[0]) || undefined,
    socialInteractUrl: social ? attr(social, 'uri') ?? attr(social, 'url') : undefined,
  };
}

/**
 * Pick the transcript worth fetching.
 *
 * JSON first because it carries speaker labels and word timings, which is what makes a transcript
 * searchable rather than merely readable; VTT next; anything else last. A captions-only transcript
 * is deprioritised — it exists for accessibility during playback and is often a stripped subset.
 */
export function preferredTranscript(
  transcripts: PodcastTranscriptRef[],
): PodcastTranscriptRef | null {
  if (transcripts.length === 0) return null;
  const score = (entry: PodcastTranscriptRef): number => {
    const type = entry.type.toLowerCase();
    let value = 0;
    if (type.includes('json')) value = 3;
    else if (type.includes('vtt')) value = 2;
    else if (type.includes('srt') || type.includes('subrip')) value = 1;
    if (entry.rel?.toLowerCase() === 'captions') value -= 1;
    return value;
  };
  return [...transcripts].sort((a, b) => score(b) - score(a))[0]!;
}
