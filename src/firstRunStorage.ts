/**
 * First-run flags (onboarding, server setup) always use localStorage so they survive
 * app restarts and force-stop even when Data Persistence routes other prefs to sessionStorage.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';

export function firstRunGetItem(key: string): string | null {
  try {
    const fromLocal = localStorage.getItem(key);
    if (fromLocal !== null) return fromLocal;
    const fromSession = sessionStorage.getItem(key);
    if (fromSession !== null) {
      try {
        localStorage.setItem(key, fromSession);
        sessionStorage.removeItem(key);
      } catch {
        /* quota */
      }
      return fromSession;
    }
  } catch {
    /* private mode */
  }
  return prefsGetItem(key);
}

export function firstRunSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    return;
  } catch {
    /* fall through */
  }
  prefsSetItem(key, value);
}

export function firstRunRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
