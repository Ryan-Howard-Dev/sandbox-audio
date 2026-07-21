import React, { useCallback, useState } from 'react';
import { ChevronDown, Loader2, Plus, Rss, Youtube } from 'lucide-react';
import { fetchPodcastFeed } from '../../podcastRss';
import { isYoutubePodcastListUrl } from '../../podcastYoutube';
import { tier34HealthOk } from '../../tier34/client';
import {
  addSubscription,
  saveEpisodesForFeed,
} from '../../podcastStorage';
import { onPodcastEpisodesUpdated } from '../../podcastEpisodeSync';
import { importPodcastOpml } from '../../podcastOpml';
import {
  requestPodcastMirrorPull,
  syncPodcastSubscriptionsToMirror,
} from '../../podcastMirrorSync';

export interface PodcastManualSubscribeSectionProps {
  onSubscribed?: (feedId: string) => void;
  onError?: (message: string) => void;
  /** Expand RSS / YouTube / OPML fields by default. */
  defaultExpanded?: boolean;
}

export default function PodcastManualSubscribeSection({
  onSubscribed,
  onError,
  defaultExpanded = false,
}: PodcastManualSubscribeSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [feedUrl, setFeedUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [subscribing, setSubscribing] = useState(false);
  const [subscribingYoutube, setSubscribingYoutube] = useState(false);
  const [opmlImporting, setOpmlImporting] = useState(false);

  const pushMirrorSync = useCallback(async (feedId?: string) => {
    await syncPodcastSubscriptionsToMirror();
    await requestPodcastMirrorPull(feedId);
  }, []);

  const subscribeFromUrl = useCallback(
    async (url: string, clear: () => void, setBusy: (v: boolean) => void) => {
      if (!url.trim()) return;
      setBusy(true);
      onError?.('');
      try {
        const parsed = await fetchPodcastFeed(url);
        const sub = addSubscription({
          ...parsed.subscription,
          subscribedAt: Date.now(),
          lastFetchedAt: Date.now(),
        });
        saveEpisodesForFeed(sub.id, parsed.episodes);
        onPodcastEpisodesUpdated(sub.id, parsed.episodes);
        clear();
        void pushMirrorSync(sub.id);
        onSubscribed?.(sub.id);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : 'Subscribe failed');
      } finally {
        setBusy(false);
      }
    },
    [onError, onSubscribed, pushMirrorSync],
  );

  const handleRssSubscribe = useCallback(async () => {
    const url = feedUrl.trim();
    if (!url || isYoutubePodcastListUrl(url)) {
      onError?.('Paste an RSS or Atom feed URL here — use the video channel field below.');
      return;
    }
    await subscribeFromUrl(url, () => setFeedUrl(''), setSubscribing);
  }, [feedUrl, onError, subscribeFromUrl]);

  const handleYoutubeSubscribe = useCallback(async () => {
    const url = youtubeUrl.trim();
    if (!url) return;
    if (!isYoutubePodcastListUrl(url)) {
      onError?.('Paste a video channel (@handle) or playlist URL.');
      return;
    }
    const tier34Up = await tier34HealthOk();
    if (!tier34Up) {
      onError?.(
        'Sandbox Server required for video-channel podcasts. Start it on your network with yt-dlp installed (Settings → Addons → Server URL).',
      );
      return;
    }
    await subscribeFromUrl(url, () => setYoutubeUrl(''), setSubscribingYoutube);
  }, [onError, subscribeFromUrl, youtubeUrl]);

  const handleOpmlImport = useCallback(
    async (file: File) => {
      setOpmlImporting(true);
      onError?.('');
      try {
        const xml = await file.text();
        const result = await importPodcastOpml(xml);
        if (result.imported.length > 0) {
          onSubscribed?.(result.imported[0]!.id);
        }
        if (result.failed.length > 0) {
          onError?.(
            `Imported ${result.imported.length} shows; ${result.failed.length} failed.`,
          );
        }
      } catch (e) {
        onError?.(e instanceof Error ? e.message : 'OPML import failed');
      } finally {
        setOpmlImporting(false);
      }
    },
    [onError, onSubscribed],
  );

  return (
    <section className="podcasts-manual-subscribe">
      <button
        type="button"
        className="podcasts-manual-subscribe-toggle touch-manipulation"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-dim)]">
          Add by feed URL or OPML
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[var(--text-dim)] transition-transform${expanded ? ' rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {expanded ? (
        <div className="podcasts-manual-subscribe-body space-y-3">
          <p className="font-mono text-[9px] text-[var(--text-dim)]">
            Search above for most shows. Use these for a direct RSS link, video channel, or OPML import.
          </p>
          <div className="podcasts-subscribe-card">
            <Rss className="w-5 h-5 shrink-0 mt-2.5 text-accent" />
            <input
              type="url"
              value={feedUrl}
              onChange={(e) => setFeedUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
              className="input-elevated flex-1 min-w-0 px-3 py-2.5 font-mono text-xs focus-accent"
            />
            <button
              type="button"
              onClick={() => void handleRssSubscribe()}
              disabled={subscribing || !feedUrl.trim()}
              className="shrink-0 h-10 px-4 rounded btn-accent font-mono text-[10px] font-bold uppercase disabled:opacity-40 touch-manipulation flex items-center gap-1.5"
            >
              {subscribing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Subscribe
            </button>
          </div>

          <div className="podcasts-subscribe-card podcasts-subscribe-card--youtube">
            <Youtube className="w-5 h-5 shrink-0 mt-2.5 text-accent" />
            <div className="flex-1 min-w-0 space-y-2">
              <input
                type="url"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/@channel or playlist URL"
                className="input-elevated w-full px-3 py-2.5 font-mono text-xs focus-accent"
              />
              <p className="font-mono text-[9px] uppercase text-[var(--text-dim)]">
                Audio-only via Tier 3/4 + yt-dlp — saved offline here, not in music Locker.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleYoutubeSubscribe()}
              disabled={subscribingYoutube || !youtubeUrl.trim()}
              className="shrink-0 self-start h-10 px-4 rounded btn-accent font-mono text-[10px] font-bold uppercase disabled:opacity-40 touch-manipulation flex items-center gap-1.5"
            >
              {subscribingYoutube ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Subscribe
            </button>
          </div>

          <div className="podcasts-subscribe-card podcasts-subscribe-card--opml">
            <div className="flex-1 min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-widest text-accent mb-2">
                Import OPML
              </p>
              <p className="font-mono text-[9px] text-[var(--text-dim)] mb-2">
                Bulk-import subscriptions from another podcast app.
              </p>
              <label className="inline-flex items-center gap-2 h-10 px-4 rounded btn-accent font-mono text-[10px] font-bold uppercase touch-manipulation cursor-pointer">
                {opmlImporting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Choose OPML file
                <input
                  type="file"
                  accept=".opml,.xml,text/xml,application/xml"
                  className="sr-only"
                  disabled={opmlImporting}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void handleOpmlImport(file);
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
