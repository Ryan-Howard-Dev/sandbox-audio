import React, { useMemo } from 'react';
import {
  ArrowDownCircle,
  ArrowLeft,
  ChevronRight,
  Heart,
  Play,
  Save,
  Share2,
  Shuffle,
} from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import { seedGradient } from '../../seedGradient';
import type { DiscoveryMix } from '../../discoveryMixes';
import { proxiedArtworkUrl } from '../../displaySanitize';
import { useTranslation } from '../../i18n';

function mixArtworkUrls(mix: DiscoveryMix): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const track of mix.tracks) {
    const raw = proxiedArtworkUrl(track.artworkUrl) ?? track.artworkUrl;
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    urls.push(raw);
    if (urls.length >= 4) break;
  }
  return urls;
}

function MixArt({ mix }: { mix: DiscoveryMix }) {
  const artUrls = useMemo(() => mixArtworkUrls(mix), [mix]);
  const artSeed = mix.title;

  if (artUrls.length >= 2 && mix.kind === 'release-radar') {
    return (
      <span className="mfy-mix-art mfy-mix-art-collage" aria-hidden>
        {artUrls.slice(0, 4).map((url, i) => (
          <img key={`${url}:${i}`} src={url} alt="" className="mfy-mix-art-tile" />
        ))}
      </span>
    );
  }

  const firstArt = artUrls[0];
  if (firstArt) {
    return (
      <span className="mfy-mix-art" aria-hidden>
        <img src={firstArt} alt="" className="w-full h-full object-cover" />
      </span>
    );
  }

  return (
    <span className="mfy-mix-art" aria-hidden>
      <span className="mfy-mix-art-fallback" style={{ background: seedGradient(artSeed) }} />
    </span>
  );
}

/**
 * Tapping the tile OPENS the mix; the play badge is its own control.
 *
 * The whole card used to be one button wired to onPlay, so a tap started playback and there was
 * no way to see what was in a mix first — a Daily Discovery tile behaved unlike every album and
 * playlist tile in the app. Tile -> page, play badge -> play, matching how albums open.
 */
function MixCard({
  mix,
  onOpen,
  onPlay,
  onSave,
}: {
  mix: DiscoveryMix;
  onOpen?: () => void;
  onPlay: () => void;
  onSave?: () => void;
}) {
  const empty = mix.tracks.length === 0;
  return (
    <article className="mfy-mix-card-inner">
      <button
        type="button"
        className="mfy-mix-card touch-manipulation"
        onClick={onOpen ?? onPlay}
        disabled={empty}
      >
        <MixArt mix={mix} />
        <span className="mfy-mix-meta">
          <span className="mfy-mix-title">{mix.title}</span>
          <span className="mfy-mix-sub">{mix.subtitle}</span>
          {mix.tracks.length > 0 ? (
            <span className="mfy-mix-count">{mix.tracks.length} tracks</span>
          ) : null}
        </span>
      </button>
      {!empty ? (
        <button
          type="button"
          className="mfy-mix-play-btn touch-manipulation"
          aria-label={`Play ${mix.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
        >
          <Play className="w-4 h-4 mfy-mix-play" aria-hidden />
        </button>
      ) : null}
      {onSave && mix.tracks.length > 0 ? (
        <button
          type="button"
          className="mfy-mix-save touch-manipulation"
          aria-label={`Save ${mix.title}`}
          title="Save as playlist"
          onClick={(e) => {
            e.stopPropagation();
            onSave();
          }}
        >
          <Save className="w-3.5 h-3.5" />
        </button>
      ) : null}
    </article>
  );
}

export interface DiscoveryMixCarouselProps {
  title: string;
  subtitle?: string;
  mixes: DiscoveryMix[];
  onPlayMix: (tracks: MediaEnvelope[], mix: DiscoveryMix) => void;
  onSeeAll?: (mix: DiscoveryMix) => void;
  onSaveMix?: (mix: DiscoveryMix) => void;
  /** Single-card row (Daily, Weekly) vs multi-card (My Mix). */
  layout?: 'single' | 'multi';
}

export default function DiscoveryMixCarousel({
  title,
  subtitle,
  mixes,
  onPlayMix,
  onSeeAll,
  onSaveMix,
  layout = 'multi',
}: DiscoveryMixCarouselProps) {
  const visible = mixes.filter((m) => m.tracks.length > 0);
  if (visible.length === 0) return null;

  const primary = visible[0]!;

  if (layout === 'single' && visible.length === 1) {
    return (
      <section className="mfy-carousel-section" aria-label={title}>
        <div className="mfy-carousel-head">
          <div>
            <h3 className="mfy-carousel-title">{title}</h3>
            {subtitle ? <p className="mfy-carousel-sub">{subtitle}</p> : null}
          </div>
          {onSeeAll ? (
            <button
              type="button"
              className="mfy-see-all touch-manipulation"
              onClick={() => onSeeAll(primary)}
            >
              See all
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
        <div className="mfy-mix-scroll hide-scrollbar">
          <MixCard
            mix={primary}
            onOpen={onSeeAll ? () => onSeeAll(primary) : undefined}
            onPlay={() => onPlayMix(primary.tracks, primary)}
            onSave={onSaveMix ? () => onSaveMix(primary) : undefined}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="mfy-carousel-section" aria-label={title}>
      <div className="mfy-carousel-head">
        <div>
          <h3 className="mfy-carousel-title">{title}</h3>
          {subtitle ? <p className="mfy-carousel-sub">{subtitle}</p> : null}
        </div>
      </div>
      <div className="mfy-mix-scroll hide-scrollbar">
        {visible.map((mix) => (
          <div key={mix.id} className="mfy-mix-card-wrap">
            <MixCard
              mix={mix}
              onOpen={onSeeAll ? () => onSeeAll(mix) : undefined}
              onPlay={() => onPlayMix(mix.tracks, mix)}
              onSave={onSaveMix ? () => onSaveMix(mix) : undefined}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

export function DiscoveryMixFullPanel({
  mix,
  onPlay,
  onShuffle,
  onSave,
  onDownload,
  onShare,
  onClose,
}: {
  mix: DiscoveryMix;
  onPlay: () => void;
  onShuffle: () => void;
  onSave?: () => void;
  onDownload?: () => void;
  onShare?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  /*
   * Album-page layout, not a compact panel: full-bleed hero, big title + description, a pinned
   * Play / Shuffle pair, a secondary icon row, then ordinary track rows. Matches how albums and
   * playlists already open elsewhere in the app so a mix does not feel like a different species.
   */
  const heroArt = mix.tracks.find((track) => track.artworkUrl?.trim())?.artworkUrl?.trim();

  return (
    <div className="mfy-full-panel">
      <div className="mfy-full-hero">
        {heroArt ? (
          <img className="mfy-full-hero-art" src={heroArt} alt="" aria-hidden />
        ) : (
          <span
            className="mfy-full-hero-art mfy-full-hero-art--fallback"
            style={{ background: seedGradient(mix.title) }}
            aria-hidden
          />
        )}
        <button
          type="button"
          className="mfy-full-back touch-manipulation"
          onClick={onClose}
          aria-label={t('common.back')}
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="mfy-full-hero-text">
          <h2 className="mfy-full-title">{mix.title}</h2>
          <p className="mfy-full-sub">{mix.subtitle}</p>
        </div>
      </div>

      {/* Stays put while the track list scrolls under it. */}
      <div className="mfy-full-primary">
        <button type="button" className="mfy-full-play touch-manipulation" onClick={onPlay}>
          <Play className="w-4 h-4" fill="currentColor" />
          Play
        </button>
        <button type="button" className="mfy-full-shuffle touch-manipulation" onClick={onShuffle}>
          <Shuffle className="w-4 h-4" />
          Shuffle
        </button>
      </div>

      {/*
        Add · Download · Share, matching the reference. Add saves the mix as a playlist, Download
        caches its tracks for offline, Share exports it. Each still degrades to a visibly disabled
        button when its handler is absent — a control that silently does nothing is worse than one
        that shows it is unavailable.
      */}
      <div className="mfy-full-secondary">
        <button
          type="button"
          className="mfy-full-sec-btn touch-manipulation"
          onClick={onSave}
          disabled={!onSave}
        >
          <Heart className="w-5 h-5" />
          <span>Add</span>
        </button>
        <button
          type="button"
          className="mfy-full-sec-btn touch-manipulation"
          onClick={onDownload}
          disabled={!onDownload}
        >
          <ArrowDownCircle className="w-5 h-5" />
          <span>Download</span>
        </button>
        <button
          type="button"
          className="mfy-full-sec-btn touch-manipulation"
          onClick={onShare}
          disabled={!onShare}
        >
          <Share2 className="w-5 h-5" />
          <span>Share</span>
        </button>
      </div>

      <ul className="mfy-full-tracks music-scrollbar">
        {mix.tracks.map((track) => (
          <li key={track.envelopeId} className="mfy-full-track">
            {track.artworkUrl?.trim() ? (
              <img className="mfy-full-track-art" src={track.artworkUrl} alt="" aria-hidden />
            ) : (
              <span
                className="mfy-full-track-art"
                style={{ background: seedGradient(track.album ?? track.title) }}
                aria-hidden
              />
            )}
            <span className="mfy-full-track-meta">
              <span className="mfy-full-track-title">{track.title}</span>
              <span className="mfy-full-track-artist">{track.artist}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
