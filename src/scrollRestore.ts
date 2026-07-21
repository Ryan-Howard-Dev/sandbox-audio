const positions = new Map<string, number>();

let scrollContainer: HTMLElement | null = null;
let pendingRestoreKey: string | null = null;

export const SEARCH_RESULTS_SCROLL_KEY = 'search:results';

export function searchArtistScrollKey(artistId: string): string {
  return `search:artist:${artistId}`;
}

export const LOCKER_LIBRARY_SCROLL_KEY = 'locker:library';
export const LOCKER_SEARCH_SCROLL_KEY = 'locker:search';

export function lockerArtistScrollKey(artistName: string): string {
  return `locker:artist:${artistName}`;
}

export function registerShellScrollContainer(el: HTMLElement | null): void {
  scrollContainer = el;
}

export function saveShellScroll(key: string): void {
  if (!scrollContainer) return;
  positions.set(key, scrollContainer.scrollTop);
}

export function requestShellScrollRestore(key: string): void {
  pendingRestoreKey = key;
}

export function restoreShellScroll(key: string): boolean {
  if (!scrollContainer) return false;
  const y = positions.get(key);
  if (y == null) return false;
  scrollContainer.scrollTop = y;
  return true;
}

/** Apply any pending restore after navigation; retries once on the next frame for late layout. */
export function flushPendingShellScrollRestore(): void {
  if (!pendingRestoreKey || !scrollContainer) return;
  const key = pendingRestoreKey;
  const y = positions.get(key);
  if (y == null) {
    pendingRestoreKey = null;
    return;
  }
  const el = scrollContainer;
  const apply = () => {
    el.scrollTop = y;
  };
  apply();
  if (Math.abs(el.scrollTop - y) > 2) {
    requestAnimationFrame(apply);
  }
  pendingRestoreKey = null;
}
