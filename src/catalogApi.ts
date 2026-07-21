/**
 * Client routes for server-proxied music catalog search (no direct provider URLs).
 */

export type CatalogQueryValue = string | number | undefined;

export function catalogSearchUrl(params: Record<string, CatalogQueryValue>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') q.set(key, String(value));
  }
  return `/api/catalog/search?${q}`;
}

export function catalogLookupUrl(params: Record<string, CatalogQueryValue>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') q.set(key, String(value));
  }
  return `/api/catalog/lookup?${q}`;
}

export function catalogChartsUrl(
  limit = 25,
  filters?: { genre?: string; yearMin?: number; yearMax?: number },
): string {
  const q = new URLSearchParams();
  q.set('limit', String(limit));
  if (filters?.genre) q.set('genre', filters.genre);
  if (filters?.yearMin !== undefined) q.set('yearMin', String(filters.yearMin));
  if (filters?.yearMax !== undefined) q.set('yearMax', String(filters.yearMax));
  return `/api/catalog/charts?${q}`;
}
