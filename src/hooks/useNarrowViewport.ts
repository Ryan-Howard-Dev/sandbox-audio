import { useEffect, useState } from 'react';
import { isTauri } from '../platformEnv';
import {
  isDevMobilePreview,
  isNativeMobileShellClient,
  isTabletViewport,
  MOBILE_SHELL_MAX_WIDTH_PX,
  matchesMobileShellViewport,
} from './mobileShellLayout';

/** True when viewport is phone-width (settings layout, local menus, etc.). */
export function useNarrowViewport(maxWidthPx = MOBILE_SHELL_MAX_WIDTH_PX): boolean {
  const [narrow, setNarrow] = useState(() => matchesMobileShellViewport(maxWidthPx));

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidthPx}px)`);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [maxWidthPx]);

  if (isTauri()) return narrow;
  if (isTabletViewport()) return false;

  return narrow || isDevMobilePreview() || isNativeMobileShellClient();
}
