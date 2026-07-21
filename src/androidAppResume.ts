/**
 * Android foreground resume — re-sync native Exo + dismiss stuck player overlays.
 */

import { Capacitor } from '@capacitor/core';
import { isAndroid } from './platformEnv';

export type AndroidAppResumeOptions = {
  reconcileFromNativeExo: () => Promise<boolean>;
  setMobileNowPlayingOpen: (open: boolean) => void;
  setLyricsDrawerOpen: (open: boolean) => void;
  setHomeAwaitingUserResume: (awaiting: boolean) => void;
};

function nudgeLayoutReflow(): void {
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    document.documentElement.style.setProperty(
      '--sandbox-layout-tick',
      String(Date.now()),
    );
  });
}

export function initAndroidAppResume(options: AndroidAppResumeOptions): () => void {
  if (!Capacitor.isNativePlatform() || !isAndroid()) {
    return () => {};
  }

  const cleanups: Array<() => void> = [];
  let resumeInFlight = false;

  const onForeground = () => {
    if (resumeInFlight) return;
    resumeInFlight = true;
    void (async () => {
      try {
        options.setMobileNowPlayingOpen(false);
        options.setLyricsDrawerOpen(false);
        const live = await options.reconcileFromNativeExo();
        if (live) {
          options.setHomeAwaitingUserResume(false);
        }
        nudgeLayoutReflow();
      } finally {
        resumeInFlight = false;
      }
    })();
  };

  const onBackground = () => {
    options.setMobileNowPlayingOpen(false);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') onForeground();
    else onBackground();
  };

  document.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

  document.addEventListener('sandbox-e2e-simulate-background', onBackground);
  document.addEventListener('sandbox-e2e-simulate-foreground', onForeground);
  cleanups.push(() => {
    document.removeEventListener('sandbox-e2e-simulate-background', onBackground);
    document.removeEventListener('sandbox-e2e-simulate-foreground', onForeground);
  });

  void import('@capacitor/app').then(({ App }) => {
    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) onForeground();
      else onBackground();
    }).then((sub) => {
      cleanups.push(() => {
        void sub.remove();
      });
    });
  });

  return () => {
    for (const fn of cleanups) fn();
  };
}
