import React, { useMemo } from 'react';
import { MoreVertical } from 'lucide-react';
import LockerMoreMenu, { type LockerMenuAction } from './LockerMoreMenu';
import MobileTrackActionSheet from '../mobile/MobileTrackActionSheet';
import { useMobileShell } from '../hooks/useMobileShell';
import { useNarrowViewport } from '../hooks/useNarrowViewport';
import {
  isPlaylistPinned,
  isSmartPlaylist,
  type StoredPlaylist,
} from '../playlistStorage';
import { resolvePlaylistImportContext } from '../importPlatforms';
import type { PlaylistFolder } from '../playlistFolders';

export interface PlaylistMoreMenuProps {
  playlist: StoredPlaylist;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlayNow: () => void;
  onShuffle: () => void;
  onPlayNext: () => void;
  onAddToPlaylist: () => void;
  onEdit: () => void;
  onDelete?: () => void;
  onShare: () => void;
  shareLabel?: string;
  onExportJson?: () => void;
  onExportM3u?: () => void;
  onPin?: () => void;
  onUnpin?: () => void;
  onMoveToFolder?: (folderId: string | null) => void;
  folders?: PlaylistFolder[];
  pendingImport?: boolean;
  onAddTracksFromLocker?: () => void;
  onSearchForTracks?: () => void;
  onRefreshImport?: () => void;
  onRematchLocker?: () => void;
  onDownload?: () => void;
  downloadLabel?: string;
}

export function buildPlaylistMenuActions(props: PlaylistMoreMenuProps): LockerMenuAction[] {
  const {
    playlist,
    onPlayNow,
    onShuffle,
    onPlayNext,
    onAddToPlaylist,
    onEdit,
    onDelete,
    onShare,
    shareLabel = 'Share…',
    onExportJson,
    onExportM3u,
    onPin,
    onUnpin,
    onMoveToFolder,
    folders = [],
    pendingImport = false,
    onAddTracksFromLocker,
    onSearchForTracks,
    onRefreshImport,
    onRematchLocker,
    onDownload,
    downloadLabel = 'Save all for offline',
  } = props;

  const hasTracks = playlist.tracks.length > 0;
  const isImported = Boolean(resolvePlaylistImportContext(playlist).sourceUrl);
  const isSmart = isSmartPlaylist(playlist);
  const pinned = isPlaylistPinned(playlist);
  const hasStubs = (playlist.importTrackStubs?.length ?? 0) > 0;

  const pendingActions: LockerMenuAction[] =
    pendingImport && !hasTracks && !isSmart
      ? [
          {
            id: 'add-from-locker',
            label: 'Add tracks from Locker',
            onClick: () => onAddTracksFromLocker?.(),
          },
          {
            id: 'search-tracks',
            label: 'Search for tracks',
            divider: true,
            onClick: () => onSearchForTracks?.(),
          },
        ]
      : [];

  const folderActions: LockerMenuAction[] =
    onMoveToFolder && folders.length > 0 && !isSmart
      ? [
          {
            id: 'folder-none',
            label: playlist.folderId ? 'Remove from folder' : 'No folder',
            onClick: () => onMoveToFolder(null),
          },
          ...folders.map(
            (f) =>
              ({
                id: `folder-${f.id}`,
                label: `Move to ${f.name}`,
                onClick: () => onMoveToFolder(f.id),
              }) satisfies LockerMenuAction,
          ),
        ]
      : [];

  const actions: LockerMenuAction[] = [
    ...pendingActions,
    {
      id: 'play',
      label: 'Play now',
      disabled: !hasTracks,
      onClick: onPlayNow,
    },
    {
      id: 'shuffle',
      label: 'Shuffle',
      disabled: !hasTracks,
      onClick: onShuffle,
    },
    {
      id: 'play-next',
      label: 'Play next',
      disabled: !hasTracks,
      onClick: onPlayNext,
    },
    {
      id: 'add-to-playlist',
      label: 'Add to playlist',
      disabled: !hasTracks,
      divider: !onDownload,
      onClick: onAddToPlaylist,
    },
    ...(onDownload
      ? [
          {
            id: 'download',
            label: downloadLabel,
            disabled: !hasTracks,
            divider: true,
            onClick: () => onDownload(),
          } satisfies LockerMenuAction,
        ]
      : []),
    ...(pinned
      ? [
          {
            id: 'unpin',
            label: 'Unpin playlist',
            onClick: () => onUnpin?.(),
          } satisfies LockerMenuAction,
        ]
      : onPin
        ? [
            {
              id: 'pin',
              label: 'Pin playlist',
              onClick: () => onPin(),
            } satisfies LockerMenuAction,
          ]
        : []),
    ...folderActions,
    {
      id: 'edit',
      label: isSmart ? 'Edit smart rules' : 'Edit playlist',
      onClick: onEdit,
    },
    ...(isImported
      ? [
          {
            id: 'refresh-import',
            label: 'Refresh import',
            onClick: () => onRefreshImport?.(),
          } satisfies LockerMenuAction,
        ]
      : []),
    ...(hasStubs && onRematchLocker
      ? [
          {
            id: 'rematch-locker',
            label: 'Match from Locker',
            onClick: () => onRematchLocker(),
          } satisfies LockerMenuAction,
        ]
      : []),
    {
      id: 'share',
      label: shareLabel,
      onClick: onShare,
    },
    ...(onExportJson
      ? [
          {
            id: 'export-json',
            label: 'Export JSON',
            onClick: () => onExportJson(),
          } satisfies LockerMenuAction,
        ]
      : []),
    ...(onExportM3u
      ? [
          {
            id: 'export-m3u',
            label: 'Export M3U',
            onClick: () => onExportM3u(),
          } satisfies LockerMenuAction,
        ]
      : []),
    ...(onDelete
      ? [
          {
            id: 'delete',
            label: 'Delete playlist',
            divider: true,
            danger: true,
            deferSheetClose: true,
            onClick: onDelete,
          } satisfies LockerMenuAction,
        ]
      : []),
  ];

  return actions;
}

export default function PlaylistMoreMenu(props: PlaylistMoreMenuProps) {
  const { playlist, open, onOpenChange } = props;
  const mobileShell = useMobileShell();
  const narrow = useNarrowViewport(767);
  const useSheet = mobileShell || narrow;
  const actions = useMemo(() => buildPlaylistMenuActions(props), [props]);

  if (useSheet) {
    return (
      <>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenChange(true);
          }}
          className="sandbox-menu-trigger touch-manipulation opacity-100"
          aria-label={`Options for ${playlist.name}`}
          aria-haspopup="dialog"
        >
          <MoreVertical className="w-4 h-4" strokeWidth={2} />
        </button>
        <MobileTrackActionSheet
          open={open}
          onClose={() => onOpenChange(false)}
          title={playlist.name}
          subtitle={`${playlist.tracks.length} tracks`}
          actions={actions}
          ariaLabel={`Options for ${playlist.name}`}
        />
      </>
    );
  }

  return (
    <LockerMoreMenu
      open={open}
      onOpenChange={onOpenChange}
      actions={actions}
      ariaLabel={`Options for ${playlist.name}`}
      alwaysVisible
      align="right"
      portaled
      panelClassName="playlist-more-menu-panel"
    />
  );
}
