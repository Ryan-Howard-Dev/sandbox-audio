/** Gregorian calendar dates — avoids Buddhist-era years on Thai/Android locales. */
export function formatEpisodeDate(publishedAt?: number): string {
  if (!publishedAt || !Number.isFinite(publishedAt)) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      calendar: 'gregory',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).format(new Date(publishedAt));
  } catch {
    return new Date(publishedAt).toLocaleDateString('en-US', {
      calendar: 'gregory',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    } as Intl.DateTimeFormatOptions);
  }
}
