export const SEARCH_SORT_KEY = 'sandbox_search_sort_order';

export type SearchSortOrder = 'newest' | 'oldest';

export function loadSearchSortOrder(): SearchSortOrder {
  return localStorage.getItem(SEARCH_SORT_KEY) === 'oldest' ? 'oldest' : 'newest';
}

export function saveSearchSortOrder(order: SearchSortOrder): void {
  localStorage.setItem(SEARCH_SORT_KEY, order);
  window.dispatchEvent(new Event('sandbox-settings-change'));
}

export function parseReleaseYear(value?: string): number {
  if (!value) return 0;
  const y = parseInt(value.slice(0, 4), 10);
  return Number.isFinite(y) ? y : 0;
}

export function sortByReleaseYear<T extends { releaseYear?: string; title?: string }>(
  items: T[],
  order?: SearchSortOrder,
): T[] {
  const dir = order ?? loadSearchSortOrder();
  return [...items].sort((a, b) => {
    const ya = parseReleaseYear(a.releaseYear);
    const yb = parseReleaseYear(b.releaseYear);
    if (ya !== yb) return dir === 'oldest' ? ya - yb : yb - ya;
    const ta = a.title ?? '';
    const tb = b.title ?? '';
    return ta.localeCompare(tb, undefined, { numeric: true });
  });
}
