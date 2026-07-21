/**
 * Audiobook acquire provider id — torrent/magnet search plugins (Settings → Add-ons).
 * Wired from Audiobooks station → Acquire tab; not part of free catalog discovery.
 */

export const AUDIOBOOK_ACQUIRE_PROVIDER_ID = 'acquire' as const;

export type AudiobookAcquireProviderId = typeof AUDIOBOOK_ACQUIRE_PROVIDER_ID;
