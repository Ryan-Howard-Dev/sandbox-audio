/**
 * A reader service you run yourself, for pages that build themselves in the browser.
 *
 * importWebPage fetches a page and reads what the server sent back. That works on an article and
 * fails on anything assembled in the browser — Gemini deep research links, Google Docs, most
 * single-page apps — because what arrives over the network is a shell with no words in it. There
 * is no fixing that from inside the app: running the page's own JavaScript needs a browser engine,
 * and the WebView will not lend us one for a cross-origin page.
 *
 * jina-ai/reader is that browser engine, as a service. It is Apache-2.0 and ships as a Docker
 * image, so the instance this talks to is one you run — on this machine, or on the household
 * server. See docker/reader/ for the compose file.
 *
 * Off until a URL is set, and it never picks one for you. There is a public instance at
 * r.jina.ai, and defaulting to it would mean everything you asked to have read aloud quietly went
 * through somebody else's server. An empty setting means pages are fetched exactly the way they
 * were before, which is the behaviour someone who never opens this setting should get.
 *
 * The service answers in markdown, which is already what documentToNarration expects: it strips
 * the markup and turns "## Findings" into a chapter. Nothing here needs to understand markdown.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';

const READER_SERVICE_URL_KEY = 'sandbox_reader_service_url';

/**
 * Rendering a page is slower than fetching one, because the service has to run the page's scripts
 * and wait for it to settle. Fifteen seconds is generous for a fetch and clearly too short here.
 */
const READER_TIMEOUT_MS = 45_000;

export type ReaderFailure = 'not-configured' | 'bad-url' | 'fetch-failed' | 'empty';

export interface ReaderServiceResult {
  title?: string;
  text?: string;
  reason?: ReaderFailure;
}

/**
 * Trim a base URL to the form request building expects: no trailing slash, http or https only.
 *
 * Returns null for anything else. A base of "localhost:3000" is the likeliest thing to be typed
 * and the likeliest to be wrong — with no scheme it is a relative path, and the request would go
 * to the app's own origin.
 */
export function normaliseReaderBase(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function loadReaderServiceUrl(): string {
  return normaliseReaderBase(prefsGetItem(READER_SERVICE_URL_KEY) ?? '') ?? '';
}

/** Saving an empty value turns the service off, which is the only way back to the default. */
export function saveReaderServiceUrl(raw: string): void {
  prefsSetItem(READER_SERVICE_URL_KEY, normaliseReaderBase(raw) ?? '');
}

export function isReaderServiceConfigured(): boolean {
  return loadReaderServiceUrl() !== '';
}

/**
 * Build the request URL the service expects: the target appended whole to the base.
 *
 * The target is deliberately not percent-encoded. Reader's route takes the rest of the path as a
 * URL and parses it itself, so an encoded one arrives as a single opaque segment it cannot read.
 * Only the fragment is dropped, because a fragment never reaches a server and would otherwise
 * truncate the request URL at the "#".
 */
export function readerRequestUrl(base: string, target: string): string {
  return `${base.replace(/\/+$/, '')}/${target.trim().split('#')[0]}`;
}

/**
 * Pull title and text out of whatever the service answered with.
 *
 * Reader returns JSON when asked, but a self-hosted instance behind a proxy, or an older build,
 * may answer with the markdown directly. Both are accepted: the shape is checked rather than
 * assumed, so a misconfigured instance degrades to plain text instead of importing nothing.
 */
export function parseReaderPayload(payload: unknown): { title: string; text: string } | null {
  if (typeof payload === 'string') {
    const text = payload.trim();
    return text ? { title: '', text } : null;
  }
  const data = (payload as { data?: unknown })?.data;
  if (!data || typeof data !== 'object') return null;
  const record = data as { title?: unknown; content?: unknown; text?: unknown };
  const content = typeof record.content === 'string' ? record.content : record.text;
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) return null;
  return { title: typeof record.title === 'string' ? record.title.trim() : '', text };
}

/**
 * Fetch a page through the configured reader service.
 *
 * Goes through fetchWithTimeout for the same reasons importWebPage does: on device the WebView
 * blocks these cross-origin requests and they have to be made natively, and the air-gap setting is
 * enforced there, so turning the app offline turns this off with everything else.
 */
export async function fetchViaReaderService(
  targetUrl: string,
  base: string = loadReaderServiceUrl(),
): Promise<ReaderServiceResult> {
  const service = normaliseReaderBase(base);
  if (!service) return { reason: 'not-configured' };
  const target = (targetUrl ?? '').trim();
  if (!target) return { reason: 'bad-url' };

  try {
    const { fetchWithTimeout } = await import('./fetchWithTimeout');
    const response = await fetchWithTimeout(
      readerRequestUrl(service, target),
      { headers: { Accept: 'application/json' } },
      READER_TIMEOUT_MS,
    );
    if (!response.ok) return { reason: 'fetch-failed' };

    const body = await response.text();
    let payload: unknown = body;
    try {
      payload = JSON.parse(body);
    } catch {
      // Not JSON, so it is the markdown itself. parseReaderPayload handles the string case.
    }
    const parsed = parseReaderPayload(payload);
    if (!parsed) return { reason: 'empty' };
    return { title: parsed.title || undefined, text: parsed.text };
  } catch {
    return { reason: 'fetch-failed' };
  }
}
