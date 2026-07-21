import { useEffect, useState } from 'react';
import {
  computeMobileShellLayout,
  MOBILE_SHELL_MAX_WIDTH_PX,
} from './mobileShellLayout';

export { isDevMobilePreview } from './mobileShellLayout';

/**
 * Phone / bottom-nav shell selection:
 * - Tauri desktop: always desktop shell (Windows/Linux/macOS exe)
 * - Capacitor native phone (non-TV, not tablet): always mobile shell
 * - Capacitor native tablet portrait: mobile bottom nav (Home · Library · Search · Pods · Menu)
 * - Capacitor native tablet landscape: desktop shell with pinned CollapsibleStationNav
 * - Web/PWA: mobile shell when viewport width ≤ 767px (iPhone Safari, installed PWA, etc.)
 * - Dev web: `?mobile=1` also forces mobile shell
 */
export function useMobileShell(maxWidthPx = MOBILE_SHELL_MAX_WIDTH_PX): boolean {
  const [mobile, setMobile] = useState(() => computeMobileShellLayout(maxWidthPx));

  useEffect(() => {
    const sync = () => setMobile(computeMobileShellLayout(maxWidthPx));
    sync();
    const mq = window.matchMedia(`(max-width: ${maxWidthPx}px)`);
    mq.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, [maxWidthPx]);

  return mobile;
}
