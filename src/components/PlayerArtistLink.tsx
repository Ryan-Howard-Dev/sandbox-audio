import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../i18n';

const MENU_GAP_PX = 6;
const VIEWPORT_PAD_PX = 8;

const PLACEHOLDER_ARTIST_RE = /^(local[\s-]?upload|localupload)$/i;

function isNavigableArtist(artist: string): boolean {
  const trimmed = artist.trim();
  return Boolean(trimmed) && !PLACEHOLDER_ARTIST_RE.test(trimmed.replace(/\s+/g, ' '));
}

function computeMenuStyle(
  trigger: DOMRect,
  menuEl: HTMLElement | null,
  align: 'left' | 'right' | 'center',
): React.CSSProperties {
  const menuWidth = menuEl?.offsetWidth ?? 216;
  const menuHeight = menuEl?.offsetHeight ?? 120;

  let top = trigger.bottom + MENU_GAP_PX;
  let transform: string | undefined;

  const spaceBelow = window.innerHeight - trigger.bottom - MENU_GAP_PX;
  const spaceAbove = trigger.top - MENU_GAP_PX;
  if (menuHeight > spaceBelow && spaceAbove > spaceBelow) {
    top = trigger.top - MENU_GAP_PX;
    transform = 'translateY(-100%)';
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    top,
    transform,
    zIndex: 10050,
  };

  if (align === 'center') {
    let left = trigger.left + trigger.width / 2 - menuWidth / 2;
    if (left < VIEWPORT_PAD_PX) left = VIEWPORT_PAD_PX;
    if (left + menuWidth > window.innerWidth - VIEWPORT_PAD_PX) {
      left = window.innerWidth - menuWidth - VIEWPORT_PAD_PX;
    }
    style.left = left;
  } else if (align === 'right') {
    let right = window.innerWidth - trigger.right;
    const leftEdge = window.innerWidth - right - menuWidth;
    if (leftEdge < VIEWPORT_PAD_PX) {
      right = window.innerWidth - menuWidth - VIEWPORT_PAD_PX;
    }
    style.right = Math.max(VIEWPORT_PAD_PX, right);
  } else {
    let left = trigger.left;
    if (left + menuWidth > window.innerWidth - VIEWPORT_PAD_PX) {
      left = window.innerWidth - menuWidth - VIEWPORT_PAD_PX;
    }
    style.left = Math.max(VIEWPORT_PAD_PX, left);
  }

  return style;
}

export interface PlayerArtistLinkProps {
  artist: string;
  album?: string;
  onGoToArtist: (artist: string) => void;
  onGoToAlbum?: (artist: string, album: string) => void;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

export default function PlayerArtistLink({
  artist,
  album,
  onGoToArtist,
  onGoToAlbum,
  className = '',
  align = 'left',
}: PlayerArtistLinkProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const displayArtist = artist?.trim() || '—';
  const albumTitle = album?.trim() ?? '';
  const canNavigate = isNavigableArtist(artist);
  const canOpenAlbum = Boolean(albumTitle && canNavigate && onGoToAlbum);

  const updateMenuPosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuStyle(computeMenuStyle(rect, menuRef.current, align));
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const raf = requestAnimationFrame(updateMenuPosition);
    return () => cancelAnimationFrame(raf);
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => updateMenuPosition();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!canNavigate) {
    return <span className={className}>{displayArtist}</span>;
  }

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      className="sandbox-menu-panel sandbox-menu-panel-portaled player-artist-menu-panel"
      style={menuStyle}
    >
      <button
        type="button"
        role="menuitem"
        className="sandbox-menu-item player-artist-menu-item touch-manipulation"
        onClick={(e) => {
          e.stopPropagation();
          onGoToArtist(artist.trim());
          setOpen(false);
        }}
      >
        <span className="sandbox-menu-item-label">
          <span>{t('player.goToArtist')}</span>
        </span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!canOpenAlbum}
        className="sandbox-menu-item player-artist-menu-item touch-manipulation"
        onClick={(e) => {
          e.stopPropagation();
          if (!canOpenAlbum || !onGoToAlbum) return;
          onGoToAlbum(artist.trim(), albumTitle);
          setOpen(false);
        }}
      >
        <span className="sandbox-menu-item-label">
          <span>{t('player.goToAlbum')}</span>
        </span>
      </button>
    </div>
  ) : null;

  return (
    <span ref={rootRef} className="player-artist-link-wrap inline-flex max-w-full min-w-0">
      <button
        ref={triggerRef}
        type="button"
        className={`player-artist-link touch-manipulation ${className}`.trim()}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((o) => !o);
        }}
        aria-label={t('player.artistMenu', { artist: displayArtist })}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {displayArtist}
      </button>
      {open
        ? createPortal(
            <>
              <button
                type="button"
                className="sandbox-menu-backdrop player-artist-menu-backdrop"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
              />
              {menu}
            </>,
            document.body,
          )
        : null}
    </span>
  );
}
