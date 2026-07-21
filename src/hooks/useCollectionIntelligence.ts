import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LockerEntry } from '../lockerStorage';
import {
  buildAlbumCollections,
  buildMediaGraph,
  loadPreferredEditionPrefs,
  resolvePreferredEdition,
  savePreferredEditionPref,
  type AlbumCollection,
  type AlbumEdition,
  type CollectionStats,
  type MediaGraph,
  type PreferredEditionPrefs,
} from '../collectionIntelligence';
import { tier34MediaGraphStats, type MediaGraphStats } from '../tier34/client';

export type UseCollectionIntelligenceResult = {
  collections: AlbumCollection[];
  graph: MediaGraph;
  stats: CollectionStats;
  graphStats: MediaGraphStats | null;
  prefs: PreferredEditionPrefs;
  preferredEdition: (collection: AlbumCollection) => AlbumEdition;
  setPreferredEdition: (collectionKey: string, editionKey: string) => void;
  refreshGraphStats: () => void;
};

export function useCollectionIntelligence(
  entries: LockerEntry[],
): UseCollectionIntelligenceResult {
  const [graphStats, setGraphStats] = useState<MediaGraphStats | null>(null);
  const [prefs, setPrefs] = useState<PreferredEditionPrefs>(() => loadPreferredEditionPrefs());

  const refreshGraphStats = useCallback(() => {
    void tier34MediaGraphStats().then(setGraphStats).catch(() => setGraphStats(null));
  }, []);

  useEffect(() => {
    refreshGraphStats();
  }, [refreshGraphStats, entries.length]);

  useEffect(() => {
    const sync = () => setPrefs(loadPreferredEditionPrefs());
    window.addEventListener('sandbox-collection-prefs-change', sync);
    window.addEventListener('sandbox-settings-change', sync);
    return () => {
      window.removeEventListener('sandbox-collection-prefs-change', sync);
      window.removeEventListener('sandbox-settings-change', sync);
    };
  }, []);

  const collections = useMemo(
    () => buildAlbumCollections(entries, undefined, prefs),
    [entries, prefs],
  );

  const graph = useMemo(
    () => buildMediaGraph(entries, undefined, prefs, graphStats),
    [entries, prefs, graphStats],
  );

  const stats = graph.stats;

  const preferredEdition = useCallback(
    (collection: AlbumCollection) => resolvePreferredEdition(collection, prefs),
    [prefs],
  );

  const setPreferredEdition = useCallback((collectionKey: string, editionKey: string) => {
    const next = savePreferredEditionPref(collectionKey, editionKey);
    setPrefs(next);
  }, []);

  return {
    collections,
    graph,
    stats,
    graphStats,
    prefs,
    preferredEdition,
    setPreferredEdition,
    refreshGraphStats,
  };
}
