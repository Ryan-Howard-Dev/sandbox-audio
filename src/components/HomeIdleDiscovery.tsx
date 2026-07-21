import React, { useState } from 'react';
import { useTranslation } from '../i18n';

export type HomeIdleDiscoveryTab = 'recent' | 'queue' | 'stats';

export type HomeIdleRecentItem = {
  id: string;
  title: string;
  subtitle: string;
};

export type HomeIdleListeningPreview = {
  minutesLabel: string;
  topArtist?: string;
  sessionCount: number;
};

export interface HomeIdleDiscoveryProps {
  recentItems: HomeIdleRecentItem[];
  queueCount: number;
  listening: HomeIdleListeningPreview;
  onOpenInsights: () => void;
  onOpenPlaylistsPrompt?: () => void;
  onPlayRecent?: (id: string) => void;
  onResumeQueue?: () => void;
  className?: string;
}

export default function HomeIdleDiscovery({
  recentItems,
  queueCount,
  listening,
  onOpenInsights,
  onOpenPlaylistsPrompt,
  onPlayRecent,
  onResumeQueue,
  className = '',
}: HomeIdleDiscoveryProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<HomeIdleDiscoveryTab>('stats');

  const tabs: Array<{ id: HomeIdleDiscoveryTab; label: string }> = [
    { id: 'recent', label: t('home.tabRecent') },
    { id: 'queue', label: t('home.tabQueue') },
    { id: 'stats', label: t('home.tabStats') },
  ];

  return (
    <section
      className={`home-discovery-compact home-discovery-list--desktop ${className}`.trim()}
      aria-label={t('home.discoveryTabs')}
      data-testid="home-idle-discovery"
    >
      <div className="home-discovery-tabs" role="tablist" aria-label={t('home.discoveryTabs')}>
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className="home-discovery-tab touch-manipulation"
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'recent' ? (
        <ul className="home-discovery-list">
          {recentItems.length === 0 ? (
            <li className="home-discovery-row" aria-disabled>
              <span className="home-discovery-row-label">{t('home.recentlyAdded')}</span>
              <span className="home-discovery-row-meta">{t('home.uploadTracks')}</span>
            </li>
          ) : (
            recentItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="home-discovery-row touch-manipulation w-full text-left"
                  onClick={() => onPlayRecent?.(item.id)}
                  disabled={!onPlayRecent}
                >
                  <span className="home-discovery-row-label">{t('home.recentlyAdded')}</span>
                  <span className="home-discovery-row-title">{item.title}</span>
                  <span className="home-discovery-row-meta">{item.subtitle}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {tab === 'queue' ? (
        <ul className="home-discovery-list">
          <li>
            <button
              type="button"
              className="home-discovery-row touch-manipulation w-full text-left"
              onClick={() => onResumeQueue?.()}
              disabled={queueCount === 0 || !onResumeQueue}
            >
              <span className="home-discovery-row-label">{t('home.resumeQueue')}</span>
              <span className="home-discovery-row-title">
                {queueCount > 0
                  ? queueCount === 1
                    ? t('home.tracksInQueue', { count: queueCount })
                    : t('home.tracksInQueuePlural', { count: queueCount })
                  : t('home.noSavedQueue')}
              </span>
            </button>
          </li>
        </ul>
      ) : null}

      {tab === 'stats' ? (
        <div className="home-discovery-list space-y-2">
          <button
            type="button"
            className="home-discovery-panel touch-manipulation w-full text-left"
            onClick={onOpenInsights}
          >
            <span className="home-discovery-row-label">{t('home.yourListening')}</span>
            <span className="home-discovery-row-title">
              {listening.sessionCount > 0
                ? t('home.minutesThisMonth', { minutes: listening.minutesLabel })
                : t('home.localStats')}
            </span>
            <span className="home-discovery-row-meta">
              {listening.topArtist
                ? t('home.topArtist', { artist: listening.topArtist })
                : t('home.openWrapped')}
            </span>
          </button>

          {onOpenPlaylistsPrompt ? (
            <button
              type="button"
              className="home-discovery-panel touch-manipulation w-full text-left"
              onClick={onOpenPlaylistsPrompt}
            >
              <span className="home-discovery-row-label">{t('home.promptPlaylist')}</span>
              <span className="home-discovery-row-title">{t('home.promptPlaylistCta')}</span>
              <span className="home-discovery-row-meta">{t('home.promptPlaylistHint')}</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
