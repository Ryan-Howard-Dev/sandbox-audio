/**
 * Global MusicBrainz request scheduler — serializes MB API calls (~1 req/s)
 * to avoid 503 throttling and network bursts from parallel features.
 */

const MIN_GAP_MS = 1100;

let chain: Promise<void> = Promise.resolve();
let lastDoneAt = 0;

function waitForSlot(): Promise<void> {
  const now = Date.now();
  const delay = Math.max(0, MIN_GAP_MS - (now - lastDoneAt));
  if (delay <= 0) return Promise.resolve();
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

/** Queue a MusicBrainz fetch; returns the same result as `fn`. */
export function scheduleMusicBrainz<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    await waitForSlot();
    try {
      return await fn();
    } finally {
      lastDoneAt = Date.now();
    }
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
