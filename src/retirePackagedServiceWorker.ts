/**
 * Remove the service worker from installs that already have one.
 *
 * A packaged app carries every asset locally, so a worker caches files that were never going to be
 * fetched and gains nothing. It costs something real though: the desktop app was found serving a
 * bundle that no longer existed on disk, which meant a rebuilt app kept showing the previous
 * version's interface and every change looked like it had silently failed to ship.
 *
 * The build no longer produces one, and that alone fixes nothing for anybody who has already run
 * the app: a registered worker outlives the build that registered it and would go on serving its
 * cache indefinitely. So it is unregistered here, once, on the platforms that should never have
 * had one.
 *
 * The web build keeps its worker. There it is doing the job it exists for.
 */

const DONE_KEY = 'sandbox_service_worker_retired_v1';

/** True in a packaged shell — Tauri on the desktop, Capacitor on Android. */
function isPackaged(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    '__TAURI_INTERNALS__' in window ||
    (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
      ?.isNativePlatform?.() === true
  );
}

export async function retirePackagedServiceWorker(): Promise<void> {
  if (!isPackaged()) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (registrations.length === 0) {
      localStorage.setItem(DONE_KEY, '1');
      return;
    }

    await Promise.all(registrations.map((registration) => registration.unregister()));

    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      // Only the worker's own precache. catalog-cache and anything else holds real data the app
      // put there deliberately, and dropping it would throw away work rather than stale copies.
      await Promise.all(
        keys.filter((key) => key.startsWith('workbox-')).map((key) => caches.delete(key)),
      );
    }

    /*
     * One reload, once. The page still has the old worker's assets loaded, and without this the
     * running session keeps whatever it was already given -- correct only from the next launch,
     * which is exactly the "my change did not ship" confusion this is meant to end.
     */
    if (!localStorage.getItem(DONE_KEY)) {
      localStorage.setItem(DONE_KEY, '1');
      window.location.reload();
    }
  } catch {
    // Never worth breaking startup over. The next launch tries again.
  }
}
