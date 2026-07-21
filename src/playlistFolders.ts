import { prefsGetItem, prefsSetItem } from './prefsStorage';

export type PlaylistFolder = {
  id: string;
  name: string;
  order: number;
};

export const PLAYLIST_FOLDERS_CHANGE = 'sandbox-playlist-folders-change';

const KEY = 'sandbox_playlist_folders_v1';

export function loadPlaylistFolders(): PlaylistFolder[] {
  try {
    const raw = prefsGetItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PlaylistFolder[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f) => f?.id && f?.name)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function savePlaylistFolders(folders: PlaylistFolder[]): PlaylistFolder[] {
  const next = folders
    .map((f, i) => ({ ...f, order: f.order ?? i }))
    .sort((a, b) => a.order - b.order);
  prefsSetItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(PLAYLIST_FOLDERS_CHANGE));
  return next;
}

export function createPlaylistFolder(name: string): PlaylistFolder {
  const trimmed = name.trim();
  const folder: PlaylistFolder = {
    id: `pl-folder-${Date.now()}`,
    name: trimmed || 'New folder',
    order: loadPlaylistFolders().length,
  };
  savePlaylistFolders([...loadPlaylistFolders(), folder]);
  return folder;
}

export function renamePlaylistFolder(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  savePlaylistFolders(
    loadPlaylistFolders().map((f) => (f.id === id ? { ...f, name: trimmed } : f)),
  );
}

export function deletePlaylistFolder(id: string): void {
  savePlaylistFolders(loadPlaylistFolders().filter((f) => f.id !== id));
}
