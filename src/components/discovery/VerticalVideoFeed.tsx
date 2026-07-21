import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Volume2, VolumeX, X } from 'lucide-react';
import { useLockerVault } from '../../LockerVaultContext';
import {
  extractYoutubeVideoId,
  loadDiscoveryVideoFeed,
  youtubeEmbedUrl,
  type DiscoveryVideoItem,
} from '../../discoveryVideoFeed';
import { useTranslation } from '../../i18n';
import { seedGradient } from '../../seedGradient';

export interface VerticalVideoFeedProps {
  open: boolean;
  onClose: () => void;
  /** Optional seed query for tier34 video search. */
  query?: string;
}

function VideoSlide({
  item,
  active,
  muted,
}: {
  item: DiscoveryVideoItem;
  active: boolean;
  muted: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const youtubeId =
    item.source === 'tier34' ? extractYoutubeVideoId(item.watchUrl, item.id) : null;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || item.source !== 'locker') return;
    if (active) {
      void el.play().catch(() => {
        el.muted = true;
        void el.play().catch(() => {});
      });
    } else {
      el.pause();
      el.currentTime = 0;
    }
  }, [active, item.source]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || item.source !== 'locker') return;
    el.muted = muted;
  }, [muted, item.source]);

  const thumb = item.thumbnailUrl || undefined;

  return (
    <div className="vertical-video-slide-media">
      {item.source === 'locker' && item.streamUrl ? (
        <video
          ref={videoRef}
          className="vertical-video-player"
          src={item.streamUrl}
          poster={thumb}
          playsInline
          loop
          controls={active}
          muted={muted}
        />
      ) : youtubeId && active ? (
        <iframe
          className="vertical-video-embed"
          src={youtubeEmbedUrl(youtubeId, true)}
          title={item.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <div
          className="vertical-video-thumb"
          style={{
            background: thumb
              ? `center / cover no-repeat url(${thumb})`
              : seedGradient(item.title),
          }}
        />
      )}
      {!active && youtubeId ? (
        <div className="vertical-video-paused-overlay" aria-hidden />
      ) : null}
    </div>
  );
}

export default function VerticalVideoFeed({ open, onClose, query }: VerticalVideoFeedProps) {
  const { t } = useTranslation();
  const { entries } = useLockerVault();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<DiscoveryVideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(false);
    setActiveIndex(0);
    let cancelled = false;
    void loadDiscoveryVideoFeed(entries, query).then((feed) => {
      if (cancelled) return;
      setItems(feed);
      setLoading(false);
      setError(feed.length === 0);
    });
    return () => {
      cancelled = true;
    };
  }, [open, entries, query]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const observeSlides = useCallback(() => {
    const root = scrollerRef.current;
    if (!root) return () => {};

    const slides = root.querySelectorAll<HTMLElement>('[data-video-index]');
    const observer = new IntersectionObserver(
      (entriesObs) => {
        let bestIdx = -1;
        let bestRatio = 0;
        for (const entry of entriesObs) {
          const idx = Number(entry.target.getAttribute('data-video-index'));
          if (!Number.isFinite(idx)) continue;
          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestIdx = idx;
          }
        }
        if (bestIdx >= 0 && bestRatio >= 0.55) {
          setActiveIndex(bestIdx);
        }
      },
      { root, threshold: [0.55, 0.75, 0.95] },
    );

    slides.forEach((slide) => observer.observe(slide));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open || loading || items.length === 0) return;
    return observeSlides();
  }, [open, loading, items.length, observeSlides]);

  if (!open) return null;

  const activeItem = items[activeIndex];

  return (
    <div className="vertical-video-feed" role="dialog" aria-modal="true" aria-label={t('discover.videoFeed.title')}>
      <header className="vertical-video-feed-toolbar">
        <button
          type="button"
          className="vertical-video-feed-close touch-manipulation"
          onClick={onClose}
          aria-label={t('discover.videoFeed.close')}
        >
          <X aria-hidden />
        </button>
        <span className="vertical-video-feed-title">{t('discover.videoFeed.title')}</span>
        <div className="vertical-video-feed-actions">
          <button
            type="button"
            className="vertical-video-feed-icon-btn touch-manipulation"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? t('discover.videoFeed.unmute') : t('discover.videoFeed.mute')}
            disabled={!activeItem || activeItem.source !== 'locker'}
          >
            {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
          </button>
          {activeItem ? (
            <a
              href={activeItem.watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="vertical-video-feed-icon-btn touch-manipulation"
              aria-label={t('discover.videoFeed.openExternal')}
            >
              <ExternalLink aria-hidden />
            </a>
          ) : null}
        </div>
      </header>

      {loading ? (
        <div className="vertical-video-feed-state">
          <p>{t('discover.videoFeed.loading')}</p>
        </div>
      ) : error ? (
        <div className="vertical-video-feed-state">
          <p>{t('discover.videoFeed.empty')}</p>
          <button type="button" className="vertical-video-feed-retry touch-manipulation" onClick={onClose}>
            {t('discover.videoFeed.close')}
          </button>
        </div>
      ) : (
        <div ref={scrollerRef} className="vertical-video-feed-scroller hide-scrollbar">
          {items.map((item, index) => (
            <article
              key={item.id}
              className="vertical-video-slide"
              data-video-index={index}
            >
              <VideoSlide item={item} active={index === activeIndex} muted={muted} />
              <div className="vertical-video-slide-meta">
                <p className="vertical-video-slide-title">{item.title}</p>
                <p className="vertical-video-slide-channel">{item.channel}</p>
                {item.source === 'locker' ? (
                  <span className="vertical-video-slide-badge">{t('discover.videoFeed.lockerBadge')}</span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
