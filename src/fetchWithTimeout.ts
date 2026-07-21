import { airGapBlockedResponse, getNativeFetch, isFetchAllowed } from './airGapMode';

/** Default timeout for cover/metadata HTTP requests (matches tier34 client). */
export const DEFAULT_FETCH_TIMEOUT_MS = 12_000;

/** True when the response is JSON or iTunes-style JSONP (`text/javascript`). */
export function isJsonLikeContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.includes('json') || ct.includes('javascript');
}

/** `fetch` with an AbortController deadline; rejects on timeout or network error. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  if (!isFetchAllowed(input)) {
    return airGapBlockedResponse();
  }
  const ctrl = new AbortController();
  const timer = globalThis.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await getNativeFetch()(input, { ...init, signal: ctrl.signal });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

/** Resolve with `null` when `promise` exceeds `timeoutMs` or rejects. */
export async function raceTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
