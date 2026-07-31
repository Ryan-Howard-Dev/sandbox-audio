/**
 * Single registration site for native plugin handles shared by more than one module.
 *
 * `registerPlugin` warns and discards the second call for a given name, so registering
 * `NativeExoPlayback` in three modules and `FollowedReleaseNative` in two produced the
 * "already registered" noise in every test run — and left the later call sites holding a handle
 * whose web fallback was whatever the first registration happened to declare. Register once here
 * and import the handle; the warning was pointing at a real inconsistency, not just noise.
 */

import { registerPlugin } from '@capacitor/core';
import type { NativeExoPlaybackPlugin } from './androidNativePlayback';

export const NativeExoPlayback = registerPlugin<NativeExoPlaybackPlugin>('NativeExoPlayback', {
  web: () => import('./androidNativePlayback.web').then((m) => new m.NativeExoPlaybackWeb()),
});

export interface FollowedReleaseNativePlugin {
  schedulePeriodicCheck(options: { intervalHours: number }): Promise<void>;
  cancelPeriodicCheck(): Promise<void>;
  addListener(
    eventName: 'backgroundCheck',
    listenerFunc: () => void,
  ): Promise<{ remove: () => void }>;
}

/** Android-only: no web fallback, callers gate on isAndroid(). */
export const FollowedReleaseNative =
  registerPlugin<FollowedReleaseNativePlugin>('FollowedReleaseNative');
