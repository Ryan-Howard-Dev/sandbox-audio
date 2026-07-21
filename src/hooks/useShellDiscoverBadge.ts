import { useEffect, useState } from 'react';
import { startFollowedReleasePolling } from '../followedReleasePolling';
import { initFollowedReleaseBackgroundSchedule } from '../followedReleaseBackgroundSchedule';

/** Discover-tab badge + followed-artist release polling (foreground + Android background). */
export function useShellDiscoverBadge(): number {
  const [discoverReleaseBadge, setDiscoverReleaseBadge] = useState(0);

  useEffect(() => {
    const stopPolling = startFollowedReleasePolling(setDiscoverReleaseBadge);
    const stopBackground = initFollowedReleaseBackgroundSchedule((count) => {
      setDiscoverReleaseBadge(count);
    });
    return () => {
      stopPolling();
      stopBackground();
    };
  }, []);

  return discoverReleaseBadge;
}
