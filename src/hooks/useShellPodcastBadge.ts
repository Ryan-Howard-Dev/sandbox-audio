import { useEffect, useState } from 'react';
import { startPodcastEpisodePolling } from '../podcastEpisodePolling';
import { initPodcastMirrorSync } from '../podcastMirrorSync';
import { initPodcastRulesSync } from '../podcastRulesSync';
import { runPodcastPlayedRetention } from '../podcastPlayedRetention';
import { getUnseenPodcastEpisodeCount } from '../podcastEpisodeNotifications';
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
    void runPodcastPlayedRetention();
    const retentionInterval = window.setInterval(
      () => void runPodcastPlayedRetention(),
      6 * 60 * 60 * 1000,
    );
    return () => {
      stopMirror();
      stopRules();
      stopPoll();
      window.clearInterval(retentionInterval);
    };
  }, []);

  return badge;
}
