import React from 'react';
import LockerMoreMenu, { type LockerMenuAction } from './LockerMoreMenu';
import type { DownloadMode } from '../downloadQueue';

export interface CatalogDownloadMenuProps {
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When false, only show single-track download (singles / search hits). */
  showAlbumOptions?: boolean;
  onDownload: (mode: DownloadMode) => void;
  /** Stream via Tier 3/4 without saving to Locker. */
  onStream?: () => void;
  /** Cache audio locally for offline replay (lighter than Locker download). */
  onCache?: () => void;
  /** Label for the stream/play action (default: Stream now). */
  streamLabel?: string;
  disabled?: boolean;
  /** When false, ⋮ shows on card hover (artist discography). Default true for search hits. */
  alwaysVisible?: boolean;
}

export default function CatalogDownloadMenu({
  label,
  open,
  onOpenChange,
  showAlbumOptions = true,
  onDownload,
  onStream,
  onCache,
  streamLabel = 'Stream now',
  disabled = false,
  alwaysVisible = true,
}: CatalogDownloadMenuProps) {
  const actions: LockerMenuAction[] = [];

  if (onStream) {
    actions.push({
      id: 'stream-now',
      label: streamLabel,
      disabled,
      onClick: onStream,
    });
  }

  if (onCache) {
    actions.push({
      id: 'cache-offline',
      label: 'Cache for offline',
      disabled,
      onClick: onCache,
    });
  }

  if (showAlbumOptions) {
    actions.push(
      {
        id: 'dl-album',
        label: 'Download album',
        disabled,
        onClick: () => onDownload('album'),
      },
      {
        id: 'dl-tracks',
        label: 'Download as individual songs',
        disabled,
        divider: true,
        onClick: () => onDownload('tracks'),
      },
    );
  } else {
    actions.push({
      id: 'dl-track',
      label: 'Download to Locker',
      disabled,
      divider: Boolean(onStream || onCache),
      onClick: () => onDownload('tracks'),
    });
  }

  return (
    <LockerMoreMenu
      open={open}
      onOpenChange={onOpenChange}
      actions={actions}
      ariaLabel={`Download options for ${label}`}
      alwaysVisible={alwaysVisible}
      align="right"
      portaled
      panelClassName="catalog-download-menu-panel"
    />
  );
}
