import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Loader2, Check } from 'lucide-react';
import {
  ensureLibraryFolders,
  getLibraryFolderStatus,
  isLibraryFolderSupported,
  readLibraryFolderCounts,
  releaseLibraryFolder,
  requestLibraryFolder,
  type LibraryFolderStatus,
} from '../../libraryFolderGrant';
import { LIBRARY_FOLDERS, FOLDER_DIR_NAME, type LibraryFolder } from '../../libraryFolders';

/**
 * The one permission prompt this app asks for, and what it buys.
 *
 * Hidden entirely where there is no Storage Access Framework — on desktop and web a card offering a
 * folder grant that cannot exist is worse than no card. Nothing here reads a file; the grant
 * creates the folders and reports what they hold.
 */
export default function LibraryFolderCard({ cardStyle }: { cardStyle?: React.CSSProperties }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<LibraryFolderStatus>({ granted: false });
  const [counts, setCounts] = useState<Record<LibraryFolder, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await getLibraryFolderStatus();
    setStatus(next);
    setCounts(next.granted ? await readLibraryFolderCounts() : null);
  }, []);

  useEffect(() => {
    void (async () => {
      const ok = await isLibraryFolderSupported();
      setSupported(ok);
      if (ok) await refresh();
    })();
  }, [refresh]);

  const onGrant = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await requestLibraryFolder();
      if (!res.granted) {
        // Cancelling is a choice, not a failure, and must not read like an error.
        setNote(res.cancelled ? null : 'That folder could not be used.');
        return;
      }
      setNote(
        res.created.length > 0
          ? `Created ${res.created.join(', ')}.`
          : 'Folders were already there.',
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onRelease = useCallback(async () => {
    setBusy(true);
    try {
      await releaseLibraryFolder();
      setNote('Folder forgotten. Nothing was deleted.');
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const onEnsure = useCallback(async () => {
    setBusy(true);
    try {
      const res = await ensureLibraryFolders();
      setNote(res && res.created.length > 0 ? `Created ${res.created.join(', ')}.` : 'All present.');
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  if (supported !== true) return null;

  return (
    <div className="settings-anchor-section p-5 rounded-xl border space-y-3" style={cardStyle}>
      <div className="flex items-center gap-2">
        <FolderOpen className="w-4 h-4 text-accent" />
        <p className="font-mono text-[11px] uppercase tracking-widest text-accent">Library folder</p>
      </div>

      <p className="text-sm text-white/70">
        Pick one folder and the app keeps your library inside it — Music, Podcasts, Audiobooks,
        Books and Documents, each in its own place. It only ever sees the folder you choose.
      </p>

      {status.granted ? (
        <>
          <p className="text-sm text-white/90 flex items-center gap-2">
            <Check className="w-4 h-4 text-accent shrink-0" />
            <span className="truncate">{status.displayName || 'Folder granted'}</span>
          </p>

          {counts ? (
            <ul className="text-sm text-white/60 space-y-1">
              {LIBRARY_FOLDERS.map((id) => (
                <li key={id} className="flex justify-between gap-3">
                  <span>{FOLDER_DIR_NAME[id]}</span>
                  <span className="tabular-nums">{counts[id]}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="audiobook-doc-import touch-manipulation"
              onClick={() => void onEnsure()}
              disabled={busy}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Check folders
            </button>
            <button
              type="button"
              className="audiobook-doc-import touch-manipulation"
              onClick={() => void onRelease()}
              disabled={busy}
            >
              Forget folder
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="audiobook-doc-import touch-manipulation"
          onClick={() => void onGrant()}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <FolderOpen className="w-3.5 h-3.5" />
          )}
          Choose library folder
        </button>
      )}

      {note ? <p className="text-xs text-white/50">{note}</p> : null}
    </div>
  );
}
