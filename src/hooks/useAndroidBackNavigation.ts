import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { isAndroid } from '../platformEnv';

/** Hardware back: dismiss overlays first, else minimize (never force-quit). */
export function useAndroidBackNavigation(onBack: () => boolean): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!isAndroid()) return;

    let disposed = false;
    let handle: PluginListenerHandle | undefined;

    void App.addListener('backButton', () => {
      if (disposed) return;
      try {
        const handled = onBackRef.current();
        if (!handled) {
          void App.minimizeApp();
        }
      } catch (err) {
        console.error('[AndroidBack] handler failed:', err);
        void App.minimizeApp();
      }
    }).then((h) => {
      if (disposed) {
        void h.remove();
        return;
      }
      handle = h;
    });

    return () => {
      disposed = true;
      void handle?.remove();
    };
  }, []);
}
