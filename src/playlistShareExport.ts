import type { StoredPlaylist } from './playlistStorage';
import { displayPlaylistName } from './importPlatforms';

export type PlaylistExportFormat = 'json' | 'm3u';

export function exportPlaylistAsJson(playlist: StoredPlaylist): string {
  return JSON.stringify(
    {
      name: displayPlaylistName(playlist),
      description: playlist.description,
      exportedAt: new Date().toISOString(),
      tracks: playlist.tracks.map((t) => ({
        title: t.title,
        artist: t.artist,
        album: t.album,
        envelopeId: t.envelopeId,
        url: t.url,
        durationSeconds: t.durationSeconds,
      })),
    },
    null,
    2,
  );
}

export function exportPlaylistAsM3U(playlist: StoredPlaylist): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${displayPlaylistName(playlist)}`];
  for (const track of playlist.tracks) {
    const duration = Math.max(0, Math.round(track.durationSeconds ?? 0));
    lines.push(`#EXTINF:${duration},${track.artist} - ${track.title}`);
    if (track.url) lines.push(track.url);
  }
  return lines.join('\n');
}

function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeFilename(name: string): string {
  return name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'playlist';
}

export async function shareOrDownloadPlaylist(
  playlist: StoredPlaylist,
  format: PlaylistExportFormat,
): Promise<'shared' | 'downloaded' | 'clipboard'> {
  const title = displayPlaylistName(playlist);
  const body =
    format === 'json' ? exportPlaylistAsJson(playlist) : exportPlaylistAsM3U(playlist);
  const filename = `${safeFilename(title)}.${format === 'json' ? 'json' : 'm3u'}`;
  const mime = format === 'json' ? 'application/json' : 'audio/x-mpegurl';

  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      const file = new File([body], filename, { type: mime });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title,
          text: `${title} — ${playlist.tracks.length} tracks`,
          files: [file],
        });
        return 'shared';
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
    }
  }

  try {
    await navigator.clipboard.writeText(body);
    return 'clipboard';
  } catch {
    downloadBlob(filename, body, mime);
    return 'downloaded';
  }
}
