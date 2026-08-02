/**
 * A web page → a document you can have read to you.
 *
 * The shelf takes files and pasted text. Most of what people actually want read aloud is a page:
 * an article, a set of documentation, a long post. Copying it by hand means selecting text that
 * fights back, and importing it as a file means finding an export button that often is not there.
 *
 * This will not work on every page by itself. A site that renders its text in the browser rather
 * than sending it — which is most Google properties, including the Gemini share pages this was
 * asked for — returns an empty shell over the network. That case is detected rather than narrated,
 * because reading a page's cookie banner aloud would be worse than refusing it.
 *
 * Those pages need a browser to run them, which is what a reader service is. If one is configured
 * the shell case is retried through it; if not, the refusal is the same as it always was. See
 * readerService.ts.
 *
 * Everything here that can be tested without a DOM is separated out and tested. The extraction
 * itself needs DOMParser, which Node does not have.
 */

/** Elements that are never the article: navigation, chrome, and things that only exist to be clicked. */
const STRIP_SELECTORS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'button',
  'iframe',
  '[aria-hidden="true"]',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[hidden]',
].join(',');

/**
 * Where the actual article lives, in the order worth trying.
 *
 * <article> first because a page that bothers to mark it is telling the truth. Falling back to the
 * body last means a page with no semantics still yields something rather than nothing.
 */
const CONTENT_SELECTORS = ['article', 'main', '[role="main"]', '#content', '.post', '.article'];

export type WebPageFailure =
  | 'not-http'
  | 'fetch-failed'
  | 'not-html'
  /** The page sent no text and no reader service is set up to render it. */
  | 'needs-javascript'
  /** A reader service is set up, was asked, and could not read the page either. */
  | 'reader-service-failed'
  | 'too-little-text';

export interface WebPageResult {
  title?: string;
  text?: string;
  reason?: WebPageFailure;
}

/**
 * Below this, there is no article — only chrome.
 *
 * Set where it is because a page rendered by JavaScript typically yields a few dozen characters of
 * boilerplate, while even a short blog post clears a thousand.
 */
export const MIN_ARTICLE_CHARS = 600;

/** http and https only. A file: or javascript: URL here would be a way in, not a feature. */
export function isImportableUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Collapse the whitespace HTML leaves behind, without losing paragraph breaks.
 *
 * Paragraph breaks are the only structure that survives into narration — the chunker splits on
 * them — so flattening everything to single spaces would turn a book-length article into one
 * unbroken passage.
 */
export function cleanExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Did the server actually send the article, or just the shell around it?
 *
 * A JavaScript-rendered page is not a small page; it is a large HTML document containing almost no
 * text. That ratio is the signal, and it is more reliable than looking for framework markers,
 * which change with every release.
 */
export function looksLikeJavaScriptShell(html: string, extractedText: string): boolean {
  if (extractedText.length >= MIN_ARTICLE_CHARS) return false;
  // A genuinely small page is not a shell — a short note is allowed to be short.
  if (html.length < 4000) return false;
  return true;
}

/** Strip the chrome and take what is left. Needs a real DOM, so it is separated from the logic. */
export function extractFromDocument(doc: Document): { title: string; text: string } {
  for (const node of Array.from(doc.querySelectorAll(STRIP_SELECTORS))) {
    node.remove();
  }
  let root: Element | null = null;
  for (const selector of CONTENT_SELECTORS) {
    const found = doc.querySelector(selector);
    if (found && (found.textContent?.trim().length ?? 0) > MIN_ARTICLE_CHARS) {
      root = found;
      break;
    }
  }
  const container = root ?? doc.body;
  const title =
    doc.querySelector('h1')?.textContent?.trim() || doc.title?.trim() || '';
  return { title, text: cleanExtractedText(container?.textContent ?? '') };
}

/**
 * Fetch a page and pull its text out.
 *
 * Goes through fetchWithTimeout, which routes via native HTTP on device — the WebView blocks these
 * cross-origin requests — and enforces the air-gap setting centrally, so turning the app offline
 * turns this off with everything else.
 */
export async function importWebPage(rawUrl: string): Promise<WebPageResult> {
  const url = rawUrl.trim();
  if (!isImportableUrl(url)) return { reason: 'not-http' };

  let html: string;
  try {
    const { fetchWithTimeout } = await import('./fetchWithTimeout');
    const response = await fetchWithTimeout(url, { headers: { Accept: 'text/html' } }, 15_000);
    if (!response.ok) return { reason: 'fetch-failed' };
    const contentType = response.headers.get('content-type') ?? '';
    // A PDF or an image behind a URL is a different import, not a broken one.
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
      return { reason: 'not-html' };
    }
    html = await response.text();
  } catch {
    return { reason: 'fetch-failed' };
  }

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const { title, text } = extractFromDocument(doc);
    if (looksLikeJavaScriptShell(html, text)) return viaReaderService(url);
    if (text.length < MIN_ARTICLE_CHARS) return { reason: 'too-little-text' };
    return { title: title || url, text };
  } catch {
    return { reason: 'fetch-failed' };
  }
}

/**
 * Second attempt, through a reader service, for a page that sent no text.
 *
 * Only reached once the plain fetch has already come back a shell, so an ordinary page never
 * touches the service and never leaves the device by a second route. With nothing configured this
 * is the same 'needs-javascript' answer as before, so the default behaviour is unchanged.
 */
async function viaReaderService(url: string): Promise<WebPageResult> {
  const { fetchViaReaderService, isReaderServiceConfigured } = await import('./readerService');
  if (!isReaderServiceConfigured()) return { reason: 'needs-javascript' };

  const result = await fetchViaReaderService(url);
  if (!result.text) {
    // The service was asked and could not do it either. Saying so beats repeating the advice to
    // paste the page, which is what 'needs-javascript' tells the reader to go and do.
    return { reason: 'reader-service-failed' };
  }
  return { title: result.title || url, text: result.text };
}
