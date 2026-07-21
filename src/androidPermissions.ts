/**
 * Android runtime permission prompts — notifications (API 33+) and exact-alarm guidance.
 */

import { isAndroid, isCapacitorNative } from './platformEnv';
import { requestNativeNotificationPermission } from './nativeLocalNotifications';

const PERMISSIONS_REQUESTED_KEY = 'sandbox_permissions_requested';

export function requestAndroidPermissions(
  showToast: (message: string, durationMs?: number) => void,
): void {
  if (!isAndroid()) return;

  try {
    if (localStorage.getItem(PERMISSIONS_REQUESTED_KEY) === 'true') return;
    localStorage.setItem(PERMISSIONS_REQUESTED_KEY, 'true');
  } catch {
    return;
  }

  void (async () => {
    if (isCapacitorNative()) {
      await requestNativeNotificationPermission().catch(() => {});
    } else if ('Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        /* user dismissed or WebView lacks support */
      }
    }

    const androidVersion = parseInt(
      navigator.userAgent.match(/Android (\d+)/)?.[1] ?? '0',
      10,
    );
    if (androidVersion >= 12) {
      showToast(
        'For wake alarm: allow exact alarms in Settings → Apps → Sandbox Music → Alarms & Reminders',
        8000,
      );
    }
  })();
}
