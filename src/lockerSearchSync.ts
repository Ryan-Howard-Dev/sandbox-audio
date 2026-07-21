/**
 * Debounced Meilisearch reindex trigger — fire-and-forget after locker mutations.
 */

import { tier34ReindexSearch } from './tier34/client';

let reindexTimer: ReturnType<typeof setTimeout> | null = null;

/** Schedule a server-side search index refresh (debounced ~1.5s). */
export function scheduleLockerSearchReindex(): void {
  if (reindexTimer) clearTimeout(reindexTimer);
  reindexTimer = setTimeout(() => {
    reindexTimer = null;
    void tier34ReindexSearch().catch(() => undefined);
  }, 1500);
}
