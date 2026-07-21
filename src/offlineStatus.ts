/**
 * Unified offline / connectivity signals for user-visible messaging.
 */

import { useEffect, useState } from 'react';
import { isAirGapEnabled, subscribeAirGap } from './airGapMode';
import { tier34HealthStatus } from './tier34/client';
import { t } from './i18n';
import type { AppLanguage } from './languageSettings';

export type OfflineStatusSnapshot = {
  browserOnline: boolean;
  airGap: boolean;
  tier34Ok: boolean | null;
  meilisearchOk: boolean | null;
};

export const OFFLINE_STATUS_POLL_MS = 30_000;

export function readBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

export async function pollOfflineStatus(): Promise<OfflineStatusSnapshot> {
  const browserOnline = readBrowserOnline();
  const airGap = isAirGapEnabled();

  if (airGap) {
    return { browserOnline, airGap, tier34Ok: null, meilisearchOk: null };
  }

  try {
    const health = await tier34HealthStatus();
    return {
      browserOnline,
      airGap,
      tier34Ok: health.ok,
      meilisearchOk: health.ok ? Boolean(health.meilisearch) : null,
    };
  } catch {
    return { browserOnline, airGap, tier34Ok: false, meilisearchOk: null };
  }
}

/** Short label for fixed badges (shell chrome). */
export function offlineBadgeLabel(
  status: OfflineStatusSnapshot,
  lang?: AppLanguage,
): string | null {
  if (status.airGap) return t('offline.badge.airGap', lang);
  if (!status.browserOnline) return t('offline.badge.noInternet', lang);
  if (status.tier34Ok === false) return t('offline.badge.tier34Offline', lang);
  return null;
}

const MOBILE_SEARCH_PLACEHOLDER = 'What do you want to play?';
const MOBILE_SEARCH_LOCKER_PLACEHOLDER = 'Search locker';
const MOBILE_SHELL_HEADER_PLACEHOLDER = 'Search music…';

/** Search bar placeholder tuned to what still works. */
export function searchBarPlaceholder(
  status: OfflineStatusSnapshot,
  lang?: AppLanguage,
  compact = false,
  mobileShellHeader = false,
): string {
  if (mobileShellHeader) {
    if (status.airGap) return MOBILE_SEARCH_LOCKER_PLACEHOLDER;
    if (!status.browserOnline) return MOBILE_SEARCH_LOCKER_PLACEHOLDER;
    return MOBILE_SHELL_HEADER_PLACEHOLDER;
  }
  if (status.airGap) {
    return compact
      ? MOBILE_SEARCH_LOCKER_PLACEHOLDER
      : t('shell.searchPlaceholder.airGap', lang);
  }
  if (!status.browserOnline) {
    return compact
      ? MOBILE_SEARCH_LOCKER_PLACEHOLDER
      : t('shell.searchPlaceholder.offline', lang);
  }
  return compact
    ? MOBILE_SEARCH_PLACEHOLDER
    : t('shell.searchPlaceholder.default', lang);
}

/** Serious connectivity limits — show when search is focused or open. */
export function searchConnectivityHint(
  status: OfflineStatusSnapshot,
  lang?: AppLanguage,
): string | null {
  if (status.airGap) return t('offline.searchHint.airGap', lang);
  if (!status.browserOnline) return t('offline.searchHint.noInternet', lang);
  if (status.tier34Ok === false) return t('offline.searchHint.tier34Offline', lang);
  return null;
}

/** Meilisearch-only degradation — subtle chip in search dropdown, not a home hero banner. */
export function searchMeilisearchDegradedHint(
  status: OfflineStatusSnapshot,
  lang?: AppLanguage,
): string | null {
  if (status.airGap || !status.browserOnline || status.tier34Ok === false) return null;
  if (status.meilisearchOk === false) {
    return t('offline.meilisearchDegraded', lang);
  }
  return null;
}

/** Combined hint for search results empty states and aria descriptions. */
export function searchOfflineHint(
  status: OfflineStatusSnapshot,
  lang?: AppLanguage,
): string | null {
  return (
    searchConnectivityHint(status, lang) ?? searchMeilisearchDegradedHint(status, lang)
  );
}

export function feedOfflineMessage(status: OfflineStatusSnapshot, lang?: AppLanguage): string {
  if (status.airGap) return t('offline.feed.airGap', lang);
  if (!status.browserOnline) return t('offline.feed.noInternet', lang);
  return t('offline.feed.offline', lang);
}

export function connectOfflineHint(
  status: OfflineStatusSnapshot,
  lang?: AppLanguage,
): string | null {
  if (!status.airGap && status.tier34Ok === false) {
    return t('offline.connect', lang);
  }
  return null;
}

export function acquireOfflineHint(
  status: OfflineStatusSnapshot,
  lang?: AppLanguage,
): string | null {
  if (status.airGap) return t('offline.acquire.airGap', lang);
  if (status.tier34Ok === false) return t('offline.acquire.tier34Offline', lang);
  if (!status.browserOnline) return t('offline.acquire.noInternet', lang);
  return null;
}

/** Poll connectivity while a view is mounted. */
export function useOfflineStatus(pollMs = OFFLINE_STATUS_POLL_MS): OfflineStatusSnapshot {
  const [status, setStatus] = useState<OfflineStatusSnapshot>(() => ({
    browserOnline: readBrowserOnline(),
    airGap: isAirGapEnabled(),
    tier34Ok: null,
    meilisearchOk: null,
  }));

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      void pollOfflineStatus().then((next) => {
        if (!cancelled) setStatus(next);
      });
    };

    refresh();
    const pollId = window.setInterval(refresh, pollMs);
    const onOnline = () => refresh();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);
    const unsubAirGap = subscribeAirGap(() => refresh());

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
      unsubAirGap();
    };
  }, [pollMs]);

  return status;
}
