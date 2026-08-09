import { useEffect, useState } from 'react';
import { startPodcastEpisodePolling } from '../podcastEpisodePolling';
import { initPodcastMirrorSync } from '../podcastMirrorSync';
import { initPodcastRulesSync } from '../podcastRulesSync';
import { runPodcastPlayedRetention } from '../podcastPlayedRetention';
import {
  getUnseenPodcastEpisodeCount,
  subscribePodcastEpisodeNotifications,
} from '../podcastEpisodeNotifications';
import { loadPodcastsEnabled } from '../podcastSettings';

/** Podcasts-tab badge + background episode polling. */
export function useShellPodcastBadge(): number {
  const [badge, setBadge] = useState(() =>
    loadPodcastsEnabled() ? getUnseenPodcastEpisodeCount() : 0,
  );

  useEffect(() => {
    if (!loadPodcastsEnabled()) {
      setBadge(0);
      return;
    }
    const stopMirror = initPodcastMirrorSync();
    const stopRules = initPodcastRulesSync();
    const stopPoll = startPodcastEpisodePolling(setBadge);
    /*
     * Listen for episodes being marked seen, not just for the poll finding new ones.
     *
     * The store published this the whole time and nothing subscribed. Marking episodes seen
     * therefore cleared the storage and left the badge showing whatever the last poll had found —
     * so the bell sat on its count while you were looking at the very episodes it was counting,
     * and pressing it appeared to do nothing at all. It was doing something; the number just could
     * not hear about it until the next poll came round.
     */
    const stopSeenUpdates = subscribePodcastEpisodeNotifications(() => {
      setBadge(getUnseenPodcastEpisodeCount());
    });
    void runPodcastPlayedRetention();
    const retentionInterval = window.setInterval(
      () => void runPodcastPlayedRetention(),
      6 * 60 * 60 * 1000,
    );
    return () => {
      stopMirror();
      stopRules();
      stopPoll();
      stopSeenUpdates();
      window.clearInterval(retentionInterval);
    };
  }, []);

  return badge;
}
