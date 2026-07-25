import React, { useMemo } from 'react';
import { Play } from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import { useLockerVault } from '../../LockerVaultContext';
import { useCollectionIntelligence } from '../../hooks/useCollectionIntelligence';
import {
  buildLockerGenreShelves,
  lockerGenreSourceCollections,
} from '../../lockerGenreShelf';
import {
  buildWeeklyGenrePlaylists,
  type WeeklyGenreCover,
  type WeeklyGenrePlaylist,
} from '../../weeklyGenrePlaylists';
import { resolveLockerArtworkUrl } from '../../lockerStorage';
import { lockerEntryToEnvelope } from '../../smartPlaylistEngine';
import { proxiedArtworkUrl } from '../../displaySanitize';
import { seedGradient } from '../../seedGradient';
import { useTranslation } from '../../i18n';

export interface WeeklyGenreMixesShelfProps {
  onPlayAlbum?: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
}

/**
 * One mosaic tile that repairs itself.
 *
 * Locker entries inherit an album sibling's albumArt string, so when the art-heal path revokes
 * that entry's object URL every inheritor renders as a broken image — which is why these mixes
 * showed torn-photo placeholders after a restart while the album grid beside them was fine.
 * On error, re-resolve a live URL from the locker for the track this cover came from.
 */
interface MixTileProps {
  cover: WeeklyGenreCover;
}

function MixTile({ cover }: MixTileProps) {
  const [src, setSrc] = React.useState(() => proxiedArtworkUrl(cover.url) ?? cover.url);
  const repairedRef = React.useRef(false);

  React.useEffect(() => {
    repairedRef.current = false;
    setSrc(proxiedArtworkUrl(cover.url) ?? cover.url);
  }, [cover.url]);

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => {
        if (repairedRef.current) return;
        repairedRef.current = true;
        void resolveLockerArtworkUrl(cover.trackId).then((fresh) => {
          if (fresh) setSrc(proxiedArtworkUrl(fresh) ?? fresh);
        });
      }}
    />
  );
}

function MixCover({ covers, seed }: { covers: WeeklyGenreCover[]; seed: string }) {
  const available = covers.slice(0, 4);
  if (available.length === 0) {
    return (
      <div
        className="weekly-mix-cover-art weekly-mix-cover-art--empty"
        style={{ background: seedGradient(seed) }}
        aria-hidden
      />
    );
  }
  const tiles = available.length >= 4 ? available.slice(0, 4) : [available[0]!];
  return (
    <div
      className={`weekly-mix-cover-art weekly-mix-cover-art--${tiles.length >= 4 ? 'quad' : 'single'}`}
      aria-hidden
    >
      {tiles.map((cover, i) => (
        <React.Fragment key={`${cover.trackId}-${i}`}>
          <MixTile cover={cover} />
        </React.Fragment>
      ))}
    </div>
  );
}

export default function WeeklyGenreMixesShelf({ onPlayAlbum }: WeeklyGenreMixesShelfProps) {
  const { t } = useTranslation();
  const { entries } = useLockerVault();
  const { collections } = useCollectionIntelligence(entries);

  const mixes = useMemo<WeeklyGenrePlaylist[]>(() => {
    const source = lockerGenreSourceCollections(collections, entries);
    const shelves = buildLockerGenreShelves(source);
    return buildWeeklyGenrePlaylists(shelves);
  }, [collections, entries]);

  if (mixes.length === 0) return null;

  const playMix = (mix: WeeklyGenrePlaylist) => {
    if (!onPlayAlbum) return;
    const envs = mix.tracks.map(lockerEntryToEnvelope);
    if (envs.length > 0) onPlayAlbum(envs, false);
  };

  return (
    <section className="weekly-mix-shelf" aria-label={t('playlists.weeklyMixes.title')}>
      <div className="weekly-mix-shelf-head">
        <p className="weekly-mix-shelf-title">{t('playlists.weeklyMixes.title')}</p>
        <p className="weekly-mix-shelf-sub">{t('playlists.weeklyMixes.subtitle')}</p>
      </div>
      <div className="weekly-mix-row">
        {mixes.map((mix) => (
          <button
            key={mix.id}
            type="button"
            className={`weekly-mix-card weekly-mix-card--${mix.bucket} touch-manipulation`}
            onClick={() => playMix(mix)}
          >
            <div className="weekly-mix-cover">
              <MixCover covers={mix.covers} seed={mix.genreLabel} />
              <span className="weekly-mix-play" aria-hidden>
                <Play size={18} fill="currentColor" />
              </span>
            </div>
            <span className="weekly-mix-genre">{mix.genreLabel}</span>
            <span className="weekly-mix-meta">
              {t('playlists.weeklyMixes.cardMeta', { count: mix.tracks.length })}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
