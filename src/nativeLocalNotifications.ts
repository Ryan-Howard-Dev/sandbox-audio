/**
 * Native Android notification channels + LocalNotifications for release/episode alerts.
 * Web/PWA falls back to the Web Notification API when granted.
 *
 * Device test (Android):
 * 1. Follow an artist (Discover) or subscribe to a podcast with alerts enabled in Settings.
 * 2. Grant notification permission when prompted (Android 13+).
 * 3. Background the app (home button) and wait for the next poll or trigger alarm check.
 * 4. New items should appear in shade under "New releases" or "New podcast episodes".
 */

import { isAndroid } from './platformEnv';

export const MUSIC_RELEASE_CHANNEL_ID = 'sandbox_new_releases';
export const PODCAST_EPISODE_CHANNEL_ID = 'sandbox_new_podcast_episodes';

export type NativeAlertChannel = 'music-release' | 'podcast-episode';

/** Stable positive int for Android notification id (derived from dedupe tag). */
export function notificationIdFromTag(tag: string): number {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) {
    hash = (Math.imul(31, hash) + tag.charCodeAt(i)) | 0;
  }
  return ((hash >>> 0) % 2_147_483_646) + 1;
}

function channelIdFor(kind: NativeAlertChannel): string {
  return kind === 'music-release' ? MUSIC_RELEASE_CHANNEL_ID : PODCAST_EPISODE_CHANNEL_ID;
}

/**
 * Wrapped in an object on purpose. Returning the plugin proxy directly from an async function
 * makes JS resolve it as a thenable — Capacitor's proxy answers *any* property access, so it
 * answers `.then`, the runtime calls `LocalNotifications.then(resolve, reject)`, and Android
 * throws `"LocalNotifications.then()" is not implemented on android`. The plugin never gets
 * returned and every caller's await rejects. The extra object breaks the thenable check.
 */
async function loadLocalNotifications(): Promise<{
  plugin: (typeof import('@capacitor/local-notifications'))['LocalNotifications'];
}> {
  const mod = await import('@capacitor/local-notifications');
  return { plugin: mod.LocalNotifications };
}

/** Create Android notification channels (no-op on web). */
export async function initNativeNotificationChannels(): Promise<void> {
  if (!isAndroid()) return;
  const { plugin: LocalNotifications } = await loadLocalNotifications();
  await LocalNotifications.createChannel({
    id: MUSIC_RELEASE_CHANNEL_ID,
    name: 'New releases',
    description: 'New music from artists you follow',
    importance: 4,
    visibility: 1,
    sound: 'default',
  }).catch(() => {});
  await LocalNotifications.createChannel({
    id: PODCAST_EPISODE_CHANNEL_ID,
    name: 'New podcast episodes',
    description: 'New episodes from podcasts you subscribe to',
    importance: 4,
    visibility: 1,
    sound: 'default',
  }).catch(() => {});
}

export type NotificationPermissionState = 'granted' | 'denied' | 'prompt';

export async function getNativeNotificationPermission(): Promise<NotificationPermissionState> {
  if (!isAndroid()) return 'denied';
  const { plugin: LocalNotifications } = await loadLocalNotifications();
  const status = await LocalNotifications.checkPermissions();
  if (status.display === 'granted') return 'granted';
  if (status.display === 'denied') return 'denied';
  return 'prompt';
}

export async function requestNativeNotificationPermission(): Promise<NotificationPermissionState> {
  if (!isAndroid()) return 'denied';
  await initNativeNotificationChannels();
  const { plugin: LocalNotifications } = await loadLocalNotifications();
  const current = await LocalNotifications.checkPermissions();
  if (current.display === 'granted') return 'granted';
  if (current.display === 'denied') return 'denied';
  const result = await LocalNotifications.requestPermissions();
  if (result.display === 'granted') return 'granted';
  if (result.display === 'denied') return 'denied';
  return 'prompt';
}

export type NativeBackgroundAlertInput = {
  channel: NativeAlertChannel;
  tag: string;
  title: string;
  body: string;
};

/** Post a background alert via native LocalNotifications (Android) or Web Notification API. */
export async function showNativeBackgroundAlert(
  input: NativeBackgroundAlertInput,
): Promise<boolean> {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
    return false;
  }

  if (isAndroid()) {
    const permission = await getNativeNotificationPermission();
    if (permission !== 'granted') return false;
    const { plugin: LocalNotifications } = await loadLocalNotifications();
    try {
      await LocalNotifications.schedule({
        notifications: [
          {
            id: notificationIdFromTag(input.tag),
            title: input.title,
            body: input.body,
            channelId: channelIdFor(input.channel),
            extra: { tag: input.tag },
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  try {
    new Notification(input.title, { body: input.body, tag: input.tag });
    return true;
  } catch {
    return false;
  }
}
