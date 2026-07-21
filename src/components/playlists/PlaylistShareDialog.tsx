import React, { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Link2, Loader2, RefreshCw, Upload } from 'lucide-react';
import ModalOverlay from '../../stations/ModalOverlay';
import type { StoredPlaylist } from '../../playlistStorage';
import { isSmartPlaylist } from '../../playlistStorage';
import { displayPlaylistName } from '../../importPlatforms';
import { useTranslation } from '../../i18n';
import { getTier34BaseUrl } from '../../tier34/client';
import {
  attachCollaborativeLink,
  buildPlaylistAppShareUrl,
  fetchSharedPlaylistManifest,
  importSharedPlaylistLocally,
  parsePlaylistShareLink,
  publishPlaylistShare,
  pushCollaborativePlaylistUpdate,
  pullCollaborativePlaylistUpdate,
  shareOrDownloadPlaylist,
  type PlaylistExportFormat,
} from '../../playlistCollaborativeShare';

export type PlaylistShareDialogProps = {
  open: boolean;
  playlist: StoredPlaylist | null;
  onClose: () => void;
  onPlaylistUpdated?: (playlist: StoredPlaylist) => void;
  onImported?: (playlist: StoredPlaylist) => void;
  initialImport?: { shareId: string; editToken?: string } | null;
};

export default function PlaylistShareDialog({
  open,
  playlist,
  onClose,
  onPlaylistUpdated,
  onImported,
  initialImport = null,
}: PlaylistShareDialogProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [viewUrl, setViewUrl] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [lanUrl, setLanUrl] = useState('');
  const [importText, setImportText] = useState('');
  const [copied, setCopied] = useState<'view' | 'edit' | 'lan' | null>(null);

  const hasServer = Boolean(getTier34BaseUrl().trim());
  const isSmart = playlist ? isSmartPlaylist(playlist) : false;
  const linked = Boolean(playlist?.collaborativeShare?.shareId);

  useEffect(() => {
    if (!open) return;
    setStatus('');
    setCopied(null);
    if (playlist?.collaborativeShare) {
      setViewUrl(playlist.collaborativeShare.viewUrl);
      setEditUrl(playlist.collaborativeShare.editUrl);
      setLanUrl(playlist.collaborativeShare.lanUrl);
    } else {
      setViewUrl('');
      setEditUrl('');
      setLanUrl('');
    }
  }, [open, playlist?.id, playlist?.collaborativeShare]);

  useEffect(() => {
    if (!open || !initialImport) return;
    setImportText(
      initialImport.editToken
        ? buildPlaylistAppShareUrl(initialImport.shareId, initialImport.editToken)
        : buildPlaylistAppShareUrl(initialImport.shareId),
    );
  }, [open, initialImport]);

  const copyText = useCallback(async (text: string, kind: 'view' | 'edit' | 'lan') => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  }, []);

  const handlePublish = useCallback(async () => {
    if (!playlist || isSmart) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await publishPlaylistShare(playlist, true);
      attachCollaborativeLink(playlist.id, result.link);
      setViewUrl(result.viewUrl);
      setEditUrl(result.editUrl);
      setLanUrl(result.lanUrl);
      setStatus(t('playlists.share.published'));
      onPlaylistUpdated?.({ ...playlist, collaborativeShare: result.link });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('playlists.share.publishFailed'));
    } finally {
      setBusy(false);
    }
  }, [isSmart, onPlaylistUpdated, playlist, t]);

  const handleSync = useCallback(async () => {
    if (!playlist?.collaborativeShare) return;
    setBusy(true);
    setStatus('');
    try {
      if (playlist.updatedAt && playlist.updatedAt > (playlist.collaborativeShare.remoteUpdatedAt ?? 0)) {
        await pushCollaborativePlaylistUpdate(playlist);
        setStatus(t('playlists.share.syncedPush'));
      } else {
        const merged = await pullCollaborativePlaylistUpdate(playlist);
        if (merged) {
          onPlaylistUpdated?.(merged);
          setStatus(t('playlists.share.syncedPull'));
        } else {
          setStatus(t('playlists.share.syncUpToDate'));
        }
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('playlists.share.syncFailed'));
    } finally {
      setBusy(false);
    }
  }, [onPlaylistUpdated, playlist, t]);

  const handleImport = useCallback(async () => {
    const parsed = parsePlaylistShareLink(importText);
    if (!parsed) {
      setStatus(t('playlists.share.invalidLink'));
      return;
    }
    setBusy(true);
    setStatus('');
    try {
      const remote = await fetchSharedPlaylistManifest(parsed.shareId);
      if (!remote) {
        setStatus(t('playlists.share.notFound'));
        return;
      }
      const imported = importSharedPlaylistLocally(remote, {
        editToken: parsed.editToken,
        linkToOriginal: Boolean(parsed.editToken),
      });
      setStatus(t('playlists.share.imported', { name: imported.name }));
      onImported?.(imported);
      onClose();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('playlists.share.importFailed'));
    } finally {
      setBusy(false);
    }
  }, [importText, onClose, onImported, t]);

  const handleExport = useCallback(
    async (format: PlaylistExportFormat) => {
      if (!playlist) return;
      setBusy(true);
      try {
        const result = await shareOrDownloadPlaylist(playlist, format);
        setStatus(
          result === 'shared'
            ? t('playlists.share.exportShared')
            : result === 'clipboard'
              ? t('playlists.share.exportClipboard', { format: format.toUpperCase() })
              : t('playlists.share.exportDownloaded', { format: format.toUpperCase() }),
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStatus(t('playlists.share.exportFailed'));
      } finally {
        setBusy(false);
      }
    },
    [playlist, t],
  );

  const title = playlist
    ? t('playlists.share.title', { name: displayPlaylistName(playlist) })
    : t('playlists.share.importTitle');

  return (
    <ModalOverlay open={open} onClose={onClose} title={title} maxWidth="max-w-md">
      <div className="playlist-share-dialog space-y-4 font-mono text-[11px]">
        {playlist && !isSmart ? (
          <section className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-widest text-accent">
              {t('playlists.share.liveLink')}
            </h3>
            <p className="text-[var(--text-mid)] leading-relaxed">
              {hasServer
                ? t('playlists.share.liveLinkHint')
                : t('playlists.share.serverRequired')}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !hasServer}
                onClick={() => void handlePublish()}
                className="btn-accent px-3 py-2 rounded-lg text-[10px] uppercase font-bold touch-manipulation disabled:opacity-40"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : <Link2 className="w-3.5 h-3.5 inline" />}
                {' '}
                {linked ? t('playlists.share.republish') : t('playlists.share.createLink')}
              </button>
              {linked ? (
                <button
                  type="button"
                  disabled={busy || !hasServer}
                  onClick={() => void handleSync()}
                  className="px-3 py-2 rounded-lg border border-[var(--border)] text-[10px] uppercase font-bold touch-manipulation disabled:opacity-40"
                >
                  <RefreshCw className="w-3.5 h-3.5 inline" /> {t('playlists.share.syncNow')}
                </button>
              ) : null}
            </div>
            {viewUrl ? (
              <div className="space-y-2 rounded-lg border border-[var(--border)] p-3 bg-[var(--bg-void)]">
                <label className="block text-[9px] uppercase text-[var(--text-dim)]">
                  {t('playlists.share.viewLink')}
                </label>
                <p className="break-all text-[10px] select-all">{viewUrl}</p>
                <button
                  type="button"
                  onClick={() => void copyText(viewUrl, 'view')}
                  className="inline-flex items-center gap-1 text-accent touch-manipulation"
                >
                  {copied === 'view' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {t('playlists.share.copy')}
                </button>
              </div>
            ) : null}
            {editUrl && playlist?.collaborativeShare?.editToken ? (
              <div className="space-y-2 rounded-lg border border-[var(--border)] p-3 bg-[var(--bg-void)]">
                <label className="block text-[9px] uppercase text-[var(--text-dim)]">
                  {t('playlists.share.editLink')}
                </label>
                <p className="break-all text-[10px] select-all">{editUrl}</p>
                <button
                  type="button"
                  onClick={() => void copyText(editUrl, 'edit')}
                  className="inline-flex items-center gap-1 text-accent touch-manipulation"
                >
                  {copied === 'edit' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {t('playlists.share.copy')}
                </button>
                <p className="text-[9px] text-[var(--text-dim)]">{t('playlists.share.editLinkHint')}</p>
              </div>
            ) : null}
            {lanUrl ? (
              <div className="space-y-1">
                <p className="text-[9px] text-[var(--text-dim)] break-all">{lanUrl}</p>
                <button
                  type="button"
                  onClick={() => void copyText(lanUrl, 'lan')}
                  className="inline-flex items-center gap-1 text-[var(--text-dim)] touch-manipulation"
                >
                  {copied === 'lan' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {t('playlists.share.copyApi')}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {playlist ? (
          <section className="space-y-2 border-t border-[var(--border)] pt-3">
            <h3 className="text-[10px] uppercase tracking-widest text-[var(--text-dim)]">
              {t('playlists.share.fileExport')}
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleExport('json')}
                className="px-3 py-2 rounded-lg border border-[var(--border)] text-[10px] uppercase touch-manipulation"
              >
                JSON
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleExport('m3u')}
                className="px-3 py-2 rounded-lg border border-[var(--border)] text-[10px] uppercase touch-manipulation"
              >
                M3U
              </button>
            </div>
          </section>
        ) : null}

        <section className="space-y-2 border-t border-[var(--border)] pt-3">
          <h3 className="text-[10px] uppercase tracking-widest text-[var(--text-dim)]">
            {t('playlists.share.importSection')}
          </h3>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={t('playlists.share.importPlaceholder')}
            rows={3}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-void)] px-3 py-2 text-[10px] text-[var(--text)]"
          />
          <button
            type="button"
            disabled={busy || !importText.trim()}
            onClick={() => void handleImport()}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-[var(--border)] text-[10px] uppercase touch-manipulation disabled:opacity-40"
          >
            <Upload className="w-3.5 h-3.5" /> {t('playlists.share.import')}
          </button>
        </section>

        {status ? (
          <p className="text-[10px] text-[var(--text-mid)]" aria-live="polite">
            {status}
          </p>
        ) : null}
      </div>
    </ModalOverlay>
  );
}
