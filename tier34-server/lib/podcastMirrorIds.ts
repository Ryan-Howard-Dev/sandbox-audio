/** Feed / episode id helpers — must match client `subscriptionFeedUrlId` / `episodeIdFromGuid`. */

export function subscriptionFeedUrlId(feedUrl: string): string {
  const normalized = feedUrl.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }
  return `feed-${Math.abs(hash).toString(36)}`;
}

export function episodeIdFromGuid(feedId: string, guid: string, audioUrl: string): string {
  const base = guid.trim() || audioUrl.trim();
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = (hash * 31 + base.charCodeAt(i)) | 0;
  }
  return `${feedId}:ep-${Math.abs(hash).toString(36)}`;
}
