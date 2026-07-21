import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Loader2,
  Play,
  Radio,
  Share2,
  Shuffle,
  UserPlus,
} from 'lucide-react';
import { fetchArtistProfile, getCachedArtistImage } from '../../artistImage';
import { proxiedArtworkUrl } from '../../displaySanitize';
import {
  followArtist,
  isFollowingArtist,
  subscribeFollowedArtists,
  unfollowArtist,
} from '../../followedArtists';
import { useTranslation } from '../../i18n';
import { useMobileShell } from '../../hooks/useMobileShell';
import MobileShellBackButton from '../MobileShellBackButton';

const BIO_PREVIEW_CHARS = 180;

export interface LockerArtistProfileProps {
  artistName: string;
  albumCount: number;
  trackCount: number;
  /** Warm artwork from the artist grid tap — avoids placeholder flash. */
  initialArtworkUrl?: string;
  onBack: () => void;
  onPlayAll?: () => void;
  onShuffle?: () => void;
  /** Shuffle all downloaded tracks for this artist (artist radio). */
  onRadio?: () => void;
  onShare?: () => void;
  /** Top-right ⋮ overflow menu (fix song info, etc.). */
  overflowMenu?: React.ReactNode;
}

function resolveInitialArtwork(name: string, hint?: string): string | undefined {
  if (hint?.trim()) return hint.trim();
  const cached = getCachedArtistImage(name);
  if (typeof cached === 'string' && cached.trim()) return cached.trim();
  return undefined;
}

/** Tidal-style artist header for downloaded content in the locker. */
export default function LockerArtistProfile({
  artistName,
  albumCount,
  trackCount,
  initialArtworkUrl,
  onBack,
  onPlayAll,
  onShuffle,
  onRadio,
  onShare,
  overflowMenu,
}: LockerArtistProfileProps) {
  const { t } = useTranslation();
  const isMobileShell = useMobileShell();
  const [artworkUrl, setArtworkUrl] = useState<string | undefined>(() =>
    resolveInitialArtwork(artistName, initialArtworkUrl),
  );
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [heroArtReady, setHeroArtReady] = useState(false);
  const [bio, setBio] = useState<string | undefined>();
  const [bioExpanded, setBioExpanded] = useState(false);
  const [following, setFollowing] = useState(() => isFollowingArtist(artistName));
  const [followBusy, setFollowBusy] = useState(false);

  useEffect(() => {
    setArtworkUrl(resolveInitialArtwork(artistName, initialArtworkUrl));
    setArtworkFailed(false);
    setHeroArtReady(false);
    setBio(undefined);
    setBioExpanded(false);
    setFollowing(isFollowingArtist(artistName));
  }, [artistName, initialArtworkUrl]);

  useEffect(() => {
    return subscribeFollowedArtists(() => setFollowing(isFollowingArtist(artistName)));
  }, [artistName]);

  useEffect(() => {
    let cancelled = false;
    void fetchArtistProfile(artistName).then((profile) => {
      if (cancelled) return;
      if (profile.bio) setBio(profile.bio);
      const hero = profile.wideImageUrl ?? profile.imageUrl;
      if (hero) {
        setArtworkUrl(hero);
        setArtworkFailed(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [artistName]);

  const heroImage = proxiedArtworkUrl(artworkUrl) ?? artworkUrl;
  const showHeroPhotos = Boolean(heroImage) && !artworkFailed;

  useEffect(() => {
    if (!heroImage) {
      setHeroArtReady(false);
      return;
    }
    let cancelled = false;
    const img = new Image();
    const markReady = () => {
      if (!cancelled) setHeroArtReady(true);
    };
    img.onload = markReady;
    img.onerror = () => {
      if (!cancelled) {
        setArtworkFailed(true);
        setHeroArtReady(false);
      }
    };
    img.src = heroImage;
    if (img.complete) markReady();
    return () => {
      cancelled = true;
    };
  }, [heroImage]);

  const bioPreview =
    bio && !bioExpanded && bio.length > BIO_PREVIEW_CHARS
      ? `${bio.slice(0, BIO_PREVIEW_CHARS).trim()}…`
      : bio;
  const canPlay = trackCount > 0 && Boolean(onPlayAll);

  const onHeroPhotoLoad = () => setHeroArtReady(true);
  const onHeroPhotoError = () => {
    setArtworkFailed(true);
    setHeroArtReady(false);
  };

  const handleFollowToggle = async () => {
    if (followBusy) return;
    setFollowBusy(true);
    try {
      if (following) {
        unfollowArtist(artistName);
      } else {
        await followArtist({ name: artistName, source: 'locker', skipMbLookup: false });
      }
    } finally {
      setFollowBusy(false);
    }
  };

  const handleShare = async () => {
    if (onShare) {
      onShare();
      return;
    }
    const text = `${artistName} — ${albumCount} ${albumCount === 1 ? t('locker.artistHubAlbum') : t('locker.artistHubAlbums')}, ${trackCount} ${trackCount === 1 ? t('locker.artistHubTrack') : t('locker.artistHubTracks')} in my Locker`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: artistName, text });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      /* user cancelled share */
    }
  };

  return (
    <section className="artist-page locker-artist-profile" aria-label={t('locker.artistHubAria')}>
      <div
        className={`artist-hero${heroArtReady ? ' artist-hero--art-ready' : ''}`}
        aria-label={artistName}
      >
        <div className="artist-hero-bg artist-hero-bg--placeholder" aria-hidden />

        {showHeroPhotos ? (
          <>
            <div className="artist-hero-bg artist-hero-bg--left" aria-hidden>
              <img src={heroImage} alt="" onLoad={onHeroPhotoLoad} onError={onHeroPhotoError} />
            </div>
            <div className="artist-hero-bg artist-hero-bg--center" aria-hidden>
              <img src={heroImage} alt="" onError={onHeroPhotoError} />
            </div>
            <div className="artist-hero-bg artist-hero-bg--right" aria-hidden>
              <img src={heroImage} alt="" onError={onHeroPhotoError} />
            </div>
          </>
        ) : null}

        <div className="artist-hero-overlay" aria-hidden />

        {isMobileShell ? (
          <MobileShellBackButton
            onClick={onBack}
            variant="on-dark"
            className="artist-hero-back"
          />
        ) : (
          <button
            type="button"
            onClick={onBack}
            className="artist-hero-back locker-album-back touch-manipulation"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('locker.artistHubBackAll')}
          </button>
        )}

        {overflowMenu ? <div className="artist-hero-menu">{overflowMenu}</div> : null}

        <div className="artist-hero-content">
          <h1 className="artist-hero-title">{artistName}</h1>
          <p className="artist-hero-stats">
            {albumCount}{' '}
            {albumCount === 1 ? t('locker.artistHubAlbum') : t('locker.artistHubAlbums')}
            {' · '}
            {trackCount}{' '}
            {trackCount === 1 ? t('locker.artistHubTrack') : t('locker.artistHubTracks')}
          </p>

          {bioPreview ? (
            <p className="artist-hero-bio">
              {bioPreview}
              {bio && bio.length > BIO_PREVIEW_CHARS ? (
                <button
                  type="button"
                  className="artist-hero-bio-more"
                  onClick={() => setBioExpanded((v) => !v)}
                >
                  {bioExpanded ? t('locker.artistHubBioLess') : t('locker.artistHubBioMore')}
                </button>
              ) : null}
            </p>
          ) : null}

          {canPlay ? (
            <div className="artist-hero-actions">
              <button
                type="button"
                className="artist-btn artist-btn-primary"
                onClick={onPlayAll}
              >
                <Play className="w-4 h-4 fill-current" />
                {t('locker.play')}
              </button>
              <button
                type="button"
                className="artist-btn artist-btn-primary"
                onClick={onShuffle}
              >
                <Shuffle className="w-4 h-4" />
                {t('locker.shuffle')}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="locker-artist-secondary-actions" role="group" aria-label={t('locker.artistHubActionsAria')}>
        <button
          type="button"
          className="locker-artist-secondary-btn touch-manipulation"
          onClick={onRadio ?? onShuffle}
          disabled={!canPlay}
        >
          <Radio className="w-5 h-5" />
          <span>{t('locker.artistHubRadio')}</span>
        </button>
        <button
          type="button"
          className={`locker-artist-secondary-btn touch-manipulation${following ? ' locker-artist-secondary-btn--active' : ''}`}
          onClick={() => void handleFollowToggle()}
          disabled={followBusy}
          aria-pressed={following}
        >
          {followBusy ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : following ? (
            <Check className="w-5 h-5" />
          ) : (
            <UserPlus className="w-5 h-5" />
          )}
          <span>{following ? t('artist.following') : t('artist.follow')}</span>
        </button>
        <button
          type="button"
          className="locker-artist-secondary-btn touch-manipulation"
          onClick={() => void handleShare()}
        >
          <Share2 className="w-5 h-5" />
          <span>{t('locker.artistHubShare')}</span>
        </button>
      </div>
    </section>
  );
}
