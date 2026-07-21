/** RSS/Atom feed fetch for podcast subscriptions (CORS bypass). */

export function podcastFeedUrlAllowed(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host === '127.0.0.1' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function fetchPodcastFeedXml(feedUrl: string): Promise<{ status: number; body: string; contentType: string }> {
  const upstream = await fetch(feedUrl, {
    headers: {
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      'User-Agent': 'SandboxTier34/1.0 (podcast-feed)',
    },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await upstream.text();
  const contentType = upstream.headers.get('content-type') ?? 'application/xml';
  return { status: upstream.status, body, contentType };
}
