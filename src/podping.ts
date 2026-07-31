/**
 * Podping — feed updates announced on the Hive chain instead of discovered by polling.
 *
 * The RSS model asks every feed, over and over, whether anything changed. For a few subscriptions
 * that is fine; across a directory it is millions of requests to learn that almost nothing has.
 * Podping inverts it: when a publisher releases an episode, their host writes the feed URL to a
 * public chain, and anyone watching that stream learns of it within seconds. One connection
 * replaces the polling entirely, and the announcement comes from the publisher rather than from
 * guessing.
 *
 * This module is the parsing half — turning chain operations into update events. It is kept
 * separate from any network client so the format handling can be tested without a chain, and so
 * air-gap mode has a single obvious place to stop: no watcher, no calls, nothing to parse.
 */

/** What kind of change the publisher is announcing. */
export type PodpingReason = 'update' | 'live' | 'liveEnd' | 'unknown';

/** What kind of feed it is. Podping carries this so consumers can ignore media they do not handle. */
export type PodpingMedium =
  | 'podcast'
  | 'music'
  | 'video'
  | 'film'
  | 'audiobook'
  | 'newsletter'
  | 'blog'
  | 'unknown';

export interface PodpingUpdate {
  /** Feed URL that changed. */
  iri: string;
  reason: PodpingReason;
  medium: PodpingMedium;
}

/** A Hive custom_json operation, in the shape a block stream hands them over. */
export interface HiveCustomJsonOperation {
  id?: string;
  json?: string | Record<string, unknown>;
}

/*
 * Podping has been through several payload shapes and old ones still appear in replayed history.
 * Accepting all of them costs a few lines; rejecting them silently would look exactly like a quiet
 * chain, which is the least debuggable failure this could have.
 */
const PODPING_IDS = new Set(['podping', 'pp_podcast_update', 'hive-hydra']);

function isPodpingId(id: string | undefined): boolean {
  const trimmed = id?.trim().toLowerCase() ?? '';
  if (!trimmed) return false;
  if (PODPING_IDS.has(trimmed)) return true;
  // Newer hosts namespace by medium and reason: pp_<medium>_<reason>.
  return trimmed.startsWith('pp_');
}

function normaliseReason(value: unknown, operationId?: string): PodpingReason {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'update' || raw === 'live' || raw === 'liveend') {
    return raw === 'liveend' ? 'liveEnd' : (raw as PodpingReason);
  }
  // pp_<medium>_<reason> carries it in the id when the payload omits it.
  const parts = operationId?.trim().toLowerCase().split('_') ?? [];
  const fromId = parts.length >= 3 ? parts[2] : '';
  if (fromId === 'update') return 'update';
  if (fromId === 'live') return 'live';
  if (fromId === 'liveend') return 'liveEnd';
  return 'unknown';
}

function normaliseMedium(value: unknown, operationId?: string): PodpingMedium {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const known: PodpingMedium[] = [
    'podcast',
    'music',
    'video',
    'film',
    'audiobook',
    'newsletter',
    'blog',
  ];
  if ((known as string[]).includes(raw)) return raw as PodpingMedium;
  const parts = operationId?.trim().toLowerCase().split('_') ?? [];
  const fromId = parts.length >= 2 ? parts[1]! : '';
  if ((known as string[]).includes(fromId)) return fromId as PodpingMedium;
  return 'unknown';
}

/** Only http(s) feeds. Anything else is not something this app can fetch. */
function usableIri(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

/**
 * Updates carried by one operation, or an empty list.
 *
 * Payloads have used `iris`, `urls` and a bare `url` across versions, so all three are read. A
 * malformed JSON string yields nothing rather than throwing: a single bad write from one publisher
 * must not stop a watcher consuming the rest of the block.
 */
export function parsePodpingOperation(operation: HiveCustomJsonOperation): PodpingUpdate[] {
  if (!operation || !isPodpingId(operation.id)) return [];

  let payload: Record<string, unknown> | null = null;
  const raw = operation.json;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      return [];
    }
  } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    payload = raw as Record<string, unknown>;
  }
  if (!payload) return [];

  const candidates: unknown[] = [];
  if (Array.isArray(payload.iris)) candidates.push(...payload.iris);
  if (Array.isArray(payload.urls)) candidates.push(...payload.urls);
  if (typeof payload.url === 'string') candidates.push(payload.url);

  const reason = normaliseReason(payload.reason, operation.id);
  const medium = normaliseMedium(payload.medium, operation.id);

  const seen = new Set<string>();
  const updates: PodpingUpdate[] = [];
  for (const candidate of candidates) {
    const iri = usableIri(candidate);
    if (!iri || seen.has(iri)) continue;
    seen.add(iri);
    updates.push({ iri, reason, medium });
  }
  return updates;
}

/**
 * Every update in a block, deduplicated across operations.
 *
 * A single block routinely carries the same feed twice — a host retrying, or two of its writers
 * announcing the same release — and refetching a feed twice for one event is exactly the waste
 * Podping exists to remove.
 */
export function podpingUpdatesFromBlock(
  operations: HiveCustomJsonOperation[] | null | undefined,
): PodpingUpdate[] {
  if (!Array.isArray(operations)) return [];
  const seen = new Set<string>();
  const updates: PodpingUpdate[] = [];
  for (const operation of operations) {
    for (const update of parsePodpingOperation(operation)) {
      const key = `${update.iri}|${update.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      updates.push(update);
    }
  }
  return updates;
}

/**
 * Narrow a block's updates to feeds this install actually follows.
 *
 * The firehose is the whole open ecosystem; almost none of it is any one listener's business.
 * Matching is on the URL a subscription already stores, so a feed nobody here follows costs one
 * set lookup and is dropped — the watcher never fetches anything on the strength of a stranger's
 * announcement.
 */
export function podpingUpdatesForSubscriptions(
  updates: PodpingUpdate[],
  subscribedFeedUrls: Iterable<string>,
): PodpingUpdate[] {
  const wanted = new Set<string>();
  for (const url of subscribedFeedUrls) {
    const trimmed = url?.trim();
    if (trimmed) wanted.add(trimmed.replace(/\/+$/, '').toLowerCase());
  }
  if (wanted.size === 0) return [];
  return updates.filter((update) =>
    wanted.has(update.iri.replace(/\/+$/, '').toLowerCase()),
  );
}
