import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Disc } from 'lucide-react';
import type { CollectionAlbumGroup } from '../../collectionIntelligence';
import { findAlbumCoverForLockerGroup } from '../../albumCover';
import { rememberKnownGoodAlbumArt, getKnownGoodAlbumArt } from '../../albumArtCache';
import { findArtistImage, getCachedArtistImage, pickLockerArtistCoverArt } from '../../artistImage';
import { canonicalArtworkSrc, proxiedArtworkUrl, sanitizeCoverArtUrl } from '../../displaySanitize';
import { refreshLockerEntryAlbumArt, persistAlbumCoverForGroup, type LockerEntry } from '../../lockerStorage';
import { seedGradient } from '../../seedGradient';

function artistInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

function resolveProxiedSrc(raw: string | undefined): string | undefined {
  const safe = sanitizeCoverArtUrl(raw);
  if (!safe) return undefined;
  return proxiedArtworkUrl(safe);
}

/** Probe load off-DOM — never mount <img> until this passes. */
export function probeArtworkUrl(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve(true);
    probe.onerror = () => resolve(false);
    probe.src = src;
  });
}

/** Hide a failed <img> synchronously so the broken icon never paints. */
function hideBrokenImg(el: HTMLImageElement): void {
  el.style.display = 'none';
  el.removeAttribute('src');
}

export function lockerAlbumBannerEntryId(album: CollectionAlbumGroup): string | undefined {
  if (album.key.startsWith('orphan:')) return album.key.slice('orphan:'.length);
  return album.tracks[0]?.id;
}

export interface LockerAlbumBannerCoverProps {
  album: CollectionAlbumGroup;
  artSrc?: string;
  entryId?: string;
  onArtError?: (failedSrc?: string) => void;
  onArtValidated?: (validatedSrc: string) => void;
}

/** Album hero cover — blob-first IDB recovery, never shows a broken <img>. */
export function LockerAlbumBannerCover({
  album,
  artSrc,
  entryId,
  onArtError,
  onArtValidated,
}: LockerAlbumBannerCoverProps) {
  const [candidateSrc, setCandidateSrc] = useState<string | undefined>();
  const [visibleSrc, setVisibleSrc] = useState<string | undefined>();
  const visibleSrcRef = useRef<string | undefined>();
  visibleSrcRef.current = visibleSrc;
  const onlineFetchAttempted = useRef(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const settleCandidate = useCallback(
    async (raw: string | undefined): Promise<string | undefined> => {
      const proxied = resolveProxiedSrc(raw);
      if (!proxied) return undefined;
      if (await probeArtworkUrl(proxied)) return proxied;
      return undefined;
    },
    [],
  );

  const fetchOnlineCover = useCallback(async (): Promise<string | undefined> => {
    if (onlineFetchAttempted.current) return undefined;
    onlineFetchAttempted.current = true;
    try {
      const artist =
        album.artist?.trim() ||
        album.tracks.find((t) => t.albumArtist?.trim())?.albumArtist?.trim() ||
        album.tracks.find((t) => t.artist?.trim())?.artist?.trim() ||
        '';
      const found = await findAlbumCoverForLockerGroup(
        album.displayName || album.name,
        artist,
        album.tracks,
      );
      const url = found?.url?.trim();
      if (!url) return undefined;
      const settled = await settleCandidate(url);
      if (settled) {
        void persistAlbumCoverForGroup(album.name, artist, url, {
          artist,
          releaseYear: found?.year,
        });
      }
      return settled;
    } catch {
      return undefined;
    }
  }, [album, settleCandidate]);

  const recoverCover = useCallback(async (): Promise<string | undefined> => {
    if (entryId) {
      const fresh = await refreshLockerEntryAlbumArt(entryId);
      const fromIdb = await settleCandidate(fresh ?? undefined);
      if (fromIdb) return fromIdb;
    }
    return fetchOnlineCover();
  }, [entryId, settleCandidate, fetchOnlineCover]);

  useEffect(() => {
    const known = getKnownGoodAlbumArt(album.key);
    const showing = visibleSrcRef.current;
    if (showing && known && showing === known && artSrc?.startsWith('blob:')) {
      return;
    }

    let cancelled = false;
    onlineFetchAttempted.current = false;
    setCandidateSrc(undefined);
    setVisibleSrc(undefined);

    void (async () => {
      let next = await settleCandidate(artSrc);
      if (cancelled) return;

      if (!next && entryId) {
        const fresh = await refreshLockerEntryAlbumArt(entryId);
        if (cancelled) return;
        next = await settleCandidate(fresh ?? undefined);
      }

      if (!next) {
        next = await fetchOnlineCover();
        if (cancelled) return;
      }

      if (next) {
        setCandidateSrc(next);
      } else {
        onArtError?.(artSrc);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artSrc, entryId, album.key, settleCandidate, fetchOnlineCover, onArtError]);

  const handleImgError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const failed = e.currentTarget.src;
      hideBrokenImg(e.currentTarget);
      setVisibleSrc(undefined);
      setCandidateSrc(undefined);
      void recoverCover().then((next) => {
        if (next && canonicalArtworkSrc(next) !== canonicalArtworkSrc(failed)) {
          setCandidateSrc(next);
          return;
        }
        onArtError?.(failed);
      });
    },
    [onArtError, recoverCover],
  );

  const handleImgLoad = useCallback(() => {
    if (!candidateSrc) return;
    setVisibleSrc(candidateSrc);
    rememberKnownGoodAlbumArt(album.key, candidateSrc);
    onArtValidated?.(candidateSrc);
  }, [album.key, candidateSrc, onArtValidated]);

  return (
    <div className="locker-album-banner-cover-frame">
      <div
        className="locker-album-banner-cover-placeholder"
        style={{ background: seedGradient(album.displayName) }}
        aria-hidden={Boolean(visibleSrc)}
      >
        <Disc className="w-10 h-10 text-[var(--text-dim)]" />
      </div>
      {candidateSrc ? (
        <img
          ref={imgRef}
          src={candidateSrc}
          alt=""
          className={`locker-album-banner-cover-img${
            visibleSrc ? ' locker-album-banner-cover-img--visible' : ''
          }`}
          onLoad={handleImgLoad}
          onError={handleImgError}
        />
      ) : null}
    </div>
  );
}

export interface LockerAlbumBannerArtistAvatarProps {
  artistName: string;
  vaultEntries: LockerEntry[];
  lockerFallback?: string;
}

/** Round artist avatar — locker art, then TheAudioDB; initials gradient on failure. */
export function LockerAlbumBannerArtistAvatar({
  artistName,
  vaultEntries,
  lockerFallback,
}: LockerAlbumBannerArtistAvatarProps) {
  const resolvedFallback =
    lockerFallback?.trim() || pickLockerArtistCoverArt(artistName, vaultEntries);

  const [candidateSrc, setCandidateSrc] = useState<string | undefined>();
  const [visibleSrc, setVisibleSrc] = useState<string | undefined>();

  const settleCandidate = useCallback(async (raw: string | undefined): Promise<string | undefined> => {
    const proxied = resolveProxiedSrc(raw);
    if (!proxied) return undefined;
    if (await probeArtworkUrl(proxied)) return proxied;
    return undefined;
  }, []);

  const trySources = useCallback(
    async (sources: Array<string | undefined>): Promise<string | undefined> => {
      for (const raw of sources) {
        const ok = await settleCandidate(raw);
        if (ok) return ok;
      }
      return undefined;
    },
    [settleCandidate],
  );

  useEffect(() => {
    let cancelled = false;
    setCandidateSrc(undefined);
    setVisibleSrc(undefined);

    void (async () => {
      const cached = getCachedArtistImage(artistName);
      const warm =
        typeof cached === 'string' ? cached : resolvedFallback || undefined;
      let next = await trySources([warm]);
      if (cancelled) return;

      if (!next) {
        const found = await findArtistImage(artistName);
        if (cancelled) return;
        next = await trySources([found, resolvedFallback]);
      }

      if (!cancelled && next) setCandidateSrc(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [artistName, resolvedFallback, trySources]);

  const handleImgError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      hideBrokenImg(e.currentTarget);
      setVisibleSrc(undefined);
      setCandidateSrc(undefined);
      void trySources([resolvedFallback]).then((next) => {
        if (next) setCandidateSrc(next);
      });
    },
    [resolvedFallback, trySources],
  );

  const handleImgLoad = useCallback(() => {
    if (candidateSrc) setVisibleSrc(candidateSrc);
  }, [candidateSrc]);

  return (
    <span className="locker-album-banner-artist-avatar-frame">
      <span
        className="locker-album-banner-artist-avatar-fallback"
        aria-hidden={Boolean(visibleSrc)}
        style={{ background: seedGradient(artistName) }}
      >
        <span className="locker-album-banner-artist-avatar-initials">
          {artistInitials(artistName)}
        </span>
      </span>
      {candidateSrc ? (
        <img
          src={candidateSrc}
          alt=""
          className={`locker-album-banner-artist-avatar-img${
            visibleSrc ? ' locker-album-banner-artist-avatar-img--visible' : ''
          }`}
          onLoad={handleImgLoad}
          onError={handleImgError}
        />
      ) : null}
    </span>
  );
}
