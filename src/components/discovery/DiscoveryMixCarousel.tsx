import React, { useMemo } from 'react';
import { ChevronRight, Play, Save, Shuffle } from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import { seedGradient } from '../../seedGradient';
import type { DiscoveryMix } from '../../discoveryMixes';
import { proxiedArtworkUrl } from '../../displaySanitize';

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

function MixCard({
  mix,
  onPlay,
  onSave,
}: {
  mix: DiscoveryMix;
  onPlay: () => void;
  onSave?: () => void;
}) {
  return (
    <article className="mfy-mix-card-inner">
      <button
        type="button"
        className="mfy-mix-card touch-manipulation"
        onClick={onPlay}
        disabled={mix.tracks.length === 0}
      >
        <MixArt mix={mix} />
        <span className="mfy-mix-meta">
          <span className="mfy-mix-title">{mix.title}</span>
          <span className="mfy-mix-sub">{mix.subtitle}</span>
          {mix.tracks.length > 0 ? (
            <span className="mfy-mix-count">{mix.tracks.length} tracks</span>
          ) : null}
        </span>
        <Play className="w-4 h-4 mfy-mix-play" aria-hidden />
      </button>
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
  onClose,
}: {
  mix: DiscoveryMix;
  onPlay: () => void;
  onShuffle: () => void;
  onSave?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mfy-full-panel">
      <div className="mfy-full-head">
        <div>
          <h3 className="mfy-full-title">{mix.title}</h3>
          <p className="mfy-full-sub">{mix.subtitle}</p>
        </div>
        <button type="button" className="mfy-full-close touch-manipulation" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="mfy-full-actions">
        <button type="button" className="mfy-full-action touch-manipulation" onClick={onPlay}>
          <Play className="w-4 h-4" />
          Play
        </button>
        <button type="button" className="mfy-full-action touch-manipulation" onClick={onShuffle}>
          <Shuffle className="w-4 h-4" />
          Shuffle
        </button>
        {onSave ? (
          <button type="button" className="mfy-full-action touch-manipulation" onClick={onSave}>
            <Save className="w-4 h-4" />
            Save playlist
          </button>
        ) : null}
      </div>
      <ul className="mfy-full-tracks music-scrollbar">
        {mix.tracks.map((track, i) => (
          <li key={track.envelopeId} className="mfy-full-track">
            <span className="mfy-full-track-num">{i + 1}</span>
            <span className="mfy-full-track-title">{track.title}</span>
            <span className="mfy-full-track-artist">{track.artist}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
