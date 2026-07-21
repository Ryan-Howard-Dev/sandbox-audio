/**
 * Car Mode — driving-safe playback shell state, prefs, and voice action hooks.
 *
 * ## Media Session (wired today)
 * Playback transport is exposed via `registerMediaSession` in `keyboardShortcuts.ts`
 * and `initAndroidBackgroundMedia` in `backgroundMedia.ts`. Headset / steering-wheel
 * media keys and the Android notification shade route to the same handlers.
 *
 * ## Android Auto (foundation)
 * `SandboxMediaBrowserService` + `AndroidAuto` Capacitor plugin sync the play queue for
 * browse/play in car media browsers. See `src/androidAuto.ts` and `docs/android-auto.md`.
 * Full AA certification and OEM voice utterances are not implemented yet.
 *
 * ## Voice hooks (future)
 * - `android.intent.action.VOICE_COMMAND` with `android.intent.extra.KEY_EVENT` for
 *   OEM voice assistants; map utterances to `dispatchCarVoiceAction`.
 * - `MediaSession.setCallback` on the native layer can forward custom voice actions
 *   registered through `registerCarVoiceActions`.
 *
 * ## Capacitor appearance
 * Car UI adapts via CSS `prefers-color-scheme`. Optional native sync:
 * `@capacitor/status-bar` / App theme when a native appearance plugin is added.
 */

import { Capacitor } from '@capacitor/core';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const CAR_MODE_PREF_KEY = 'sandbox_car_mode_enabled';
export const CAR_MODE_AUTO_OFFER_KEY = 'sandbox_car_mode_auto_offer';
export const CAR_MODE_OFFER_DISMISSED_KEY = 'sandbox_car_mode_offer_dismissed';

export type CarVoiceActionId = 'play' | 'pause' | 'next' | 'previous' | 'exit';

export interface CarVoiceAction {
  id: CarVoiceActionId;
  label: string;
  handler: () => void | Promise<void>;
}

export interface CarVoiceActionsRegistry {
  register: (actions: CarVoiceAction[]) => () => void;
  dispatch: (id: CarVoiceActionId) => boolean;
  list: () => readonly CarVoiceAction[];
}

let runtimeActive = false;
let navigationLocked = false;
const voiceActions = new Map<CarVoiceActionId, CarVoiceAction>();
const subscribers = new Set<() => void>();

function notify(): void {
  for (const fn of subscribers) fn();
}

export function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export function loadCarModeEnabled(): boolean {
  return prefsGetItem(CAR_MODE_PREF_KEY) === 'true';
}

export function saveCarModeEnabled(enabled: boolean): void {
  prefsSetItem(CAR_MODE_PREF_KEY, enabled ? 'true' : 'false');
}

export function loadCarModeAutoOffer(): boolean {
  const stored = prefsGetItem(CAR_MODE_AUTO_OFFER_KEY);
  if (stored === null) return isAndroidNative();
  return stored === 'true';
}

export function saveCarModeAutoOffer(enabled: boolean): void {
  prefsSetItem(CAR_MODE_AUTO_OFFER_KEY, enabled ? 'true' : 'false');
  notify();
}

export function loadCarModeOfferDismissed(): boolean {
  return prefsGetItem(CAR_MODE_OFFER_DISMISSED_KEY) === 'true';
}

export function saveCarModeOfferDismissed(dismissed: boolean): void {
  prefsSetItem(CAR_MODE_OFFER_DISMISSED_KEY, dismissed ? 'true' : 'false');
  notify();
}

export function isCarModeActive(): boolean {
  return runtimeActive;
}

/** When true, station nav and search are blocked; only playback + exit are allowed. */
export function isCarModeLocked(): boolean {
  return navigationLocked;
}

export function enterCarMode(): void {
  runtimeActive = true;
  navigationLocked = true;
  saveCarModeEnabled(true);
  notify();
}

export function exitCarMode(): void {
  runtimeActive = false;
  navigationLocked = false;
  saveCarModeEnabled(false);
  notify();
}

export function syncCarModeFromPrefs(): void {
  runtimeActive = loadCarModeEnabled();
  navigationLocked = runtimeActive;
}

export function subscribeCarMode(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

/**
 * Register voice action handlers for future Android Auto / Assistant integration.
 * Returns an unregister function (call on unmount).
 */
export function registerCarVoiceActions(actions: CarVoiceAction[]): () => void {
  for (const action of actions) {
    voiceActions.set(action.id, action);
  }
  return () => {
    for (const action of actions) {
      voiceActions.delete(action.id);
    }
  };
}

/** Invoke a registered voice action by id. Returns false when unregistered. */
export function dispatchCarVoiceAction(id: CarVoiceActionId): boolean {
  const action = voiceActions.get(id);
  if (!action) return false;
  void action.handler();
  return true;
}

export function getCarVoiceActions(): readonly CarVoiceAction[] {
  return Array.from(voiceActions.values());
}

export const carVoiceActionsRegistry: CarVoiceActionsRegistry = {
  register: registerCarVoiceActions,
  dispatch: dispatchCarVoiceAction,
  list: getCarVoiceActions,
};
