/**
 * The drop folder: what has arrived, what can be filed, and what is being held back.
 *
 * The held pile is the point. An importer that only shows what it managed to file is an importer
 * whose mistakes are invisible, and the ones it could not place are precisely the files that need a
 * person — so they are the larger half of this screen, each with the reason it is still sitting
 * there rather than a count.
 *
 * Nothing decides here. What a file is and where it goes is libraryIngest; carrying it there is the
 * ingest move, which confines the source to this folder and the destination to a library root. This
 * shows the answer and takes the choice.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, FolderInput, Loader2, Pause, Play, RefreshCw } from 'lucide-react';
import { useTranslation } from '../i18n';
import {
  applyIngestMoves,
  isLibraryFsAvailable,
  libraryMediaUrl,
  listLibraryRoots,
  onIngestChanged,
  scanDropFolder,
  watchDropFolder,
  type IngestCandidateFile,
  type IngestMove,
  type LibraryRoot,
} from '../libraryFs';
import {
  decideIngest,
  describeQuarantine,
  summariseIngest,
  type IngestDecision,
} from '../libraryIngest';
import { DEFAULT_SCHEME } from '../libraryOrganise';
import DesktopFrame, { Inspector } from '../components/DesktopFrame';
import { useSelection } from '../hooks/useSelection';

const DROP_FOLDER_KEY = 'sandbox_drop_folder_v1';

export default function IncomingView() {
  const { t } = useTranslation();
  const [dir, setDir] = useState(() => localStorage.getItem(DROP_FOLDER_KEY) ?? '');
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [files, setFiles] = useState<IngestCandidateFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [audio] = useState(() => (typeof Audio === 'undefined' ? null : new Audio()));

  const supported = isLibraryFsAvailable();

  useEffect(() => {
    if (supported) void (async () => setRoots(await listLibraryRoots()))();
  }, [supported]);

  useEffect(() => () => audio?.pause(), [audio]);

  const rescan = useCallback(async () => {
    if (!dir) return;
    setBusy(true);
    try {
      setFiles(await scanDropFolder(dir));
      setNotice(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [dir]);

  useEffect(() => {
    void rescan();
  }, [rescan]);

  /*
   * The watcher nudges; the rescan is what actually looks.
   *
   * Filesystem events are unreliable in their details -- a copy fires several, an editor writes
   * through a temp file -- so the event says only that something moved, and the folder is read
   * again from scratch rather than patched from the event.
   */
  useEffect(() => {
    if (!supported || !dir) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      await watchDropFolder(dir);
      const off = await onIngestChanged(() => void rescan());
      if (cancelled) off();
      else unsubscribe = off;
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
      void watchDropFolder(null);
    };
  }, [supported, dir, rescan]);

  /** The schemes each station will accept files under. A station with no folder accepts nothing. */
  const schemes = useMemo(() => {
    const out: Partial<Record<LibraryRoot['kind'], string>> = {};
    for (const root of roots) out[root.kind] = DEFAULT_SCHEME;
    return out;
  }, [roots]);

  const decisions = useMemo(() => {
    const map = new Map<string, IngestDecision>();
    for (const file of files) {
      // A file still arriving is not judged yet — reading a half-written tag is how a partial value
      // gets believed.
      if (!file.settled) continue;
      map.set(
        file.path,
        decideIngest(
          {
            path: file.path,
            extension: file.extension,
            title: file.title ?? undefined,
            artist: file.artist ?? undefined,
            albumArtist: file.albumArtist ?? undefined,
            album: file.album ?? undefined,
            releaseYear: file.releaseYear ?? undefined,
            trackNumber: file.trackNumber ?? undefined,
            discNumber: file.discNumber ?? undefined,
          },
          { schemes },
        ),
      );
    }
    return map;
  }, [files, schemes]);

  const fileable = useMemo(
    () => files.filter((f) => decisions.get(f.path)?.action === 'file'),
    [files, decisions],
  );
  const held = useMemo(
    () => files.filter((f) => decisions.get(f.path)?.action === 'quarantine'),
    [files, decisions],
  );
  const arriving = useMemo(() => files.filter((f) => !f.settled), [files]);

  const selection = useSelection(useMemo(() => held.map((f) => f.path), [held]));

  const summary = useMemo(
    () => summariseIngest([...decisions.values()]),
    [decisions],
  );

  const fileEverything = useCallback(async () => {
    setBusy(true);
    try {
      const moves: IngestMove[] = [];
      for (const file of fileable) {
        const decision = decisions.get(file.path);
        if (decision?.action !== 'file') continue;
        const root = roots.find((r) => r.kind === decision.kind);
        if (!root) continue;
        moves.push({
          from: file.path,
          // Either separator may end a root path — Windows stores backslashes, the scheme renders
          // forward ones — and a doubled separator is a different string to the same folder.
          to: root.path.replace(/[\\/]+$/, '') + '/' + decision.relativePath,
        });
      }
      if (moves.length === 0) return;

      /*
       * The ingest path rather than the ordinary apply. That one confines the source as well as the
       * destination, and a drop folder is outside the library on purpose -- so every import was
       * refused by the very rule that protects everything else.
       */
      const results = await applyIngestMoves(dir, moves);
      const ok = results.filter((r) => r.ok).length;
      setNotice(t('incoming.filed', { count: ok, failed: results.length - ok }));
      await rescan();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [fileable, decisions, roots, rescan, t, dir]);

  const togglePlay = useCallback(
    async (path: string) => {
      if (!audio) return;
      if (playing === path) {
        audio.pause();
        setPlaying(null);
        return;
      }
      const url = await libraryMediaUrl(path);
      // The drop folder is outside the library roots, so the media server refuses it — correctly.
      // Hearing an unfiled file is a want, not a right, and the confinement is worth more.
      if (!url) {
        setNotice(t('incoming.cannotPreview'));
        return;
      }
      audio.src = url;
      try {
        await audio.play();
        setPlaying(path);
      } catch {
        setNotice(t('incoming.cannotPreview'));
      }
    },
    [audio, playing, t],
  );

  if (!supported) {
    return (
      <section className="files-view" aria-label={t('incoming.title')}>
        <h1 className="files-title">{t('incoming.title')}</h1>
        <p className="ui-hint">{t('files.desktopOnly')}</p>
      </section>
    );
  }

  const body = (
    <section className="files-view" aria-label={t('incoming.title')}>
      <header className="files-head">
        <h1 className="files-title">{t('incoming.title')}</h1>
        <p className="ui-hint">{t('incoming.lead')}</p>
      </header>

      <div className="files-actions">
        <input
          className="files-scheme"
          value={dir}
          onChange={(e) => {
            setDir(e.target.value);
            localStorage.setItem(DROP_FOLDER_KEY, e.target.value);
          }}
          placeholder={t('incoming.folderPlaceholder')}
          aria-label={t('incoming.folderPlaceholder')}
          spellCheck={false}
        />
        <button
          type="button"
          className="files-undo touch-manipulation"
          onClick={() => void rescan()}
          disabled={busy || !dir}
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden />
          {t('incoming.rescan')}
        </button>
        <button
          type="button"
          className="btn-accent files-preview touch-manipulation"
          onClick={() => void fileEverything()}
          disabled={busy || fileable.length === 0}
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
          ) : (
            <Check className="w-3.5 h-3.5" aria-hidden />
          )}
          {t('incoming.fileThem', { count: fileable.length })}
        </button>
      </div>

      {notice ? (
        <p className="files-notice font-mono text-[10px]" role="status">
          {notice}
        </p>
      ) : null}

      <p className="ui-hint files-count">
        {t('incoming.counts', {
          ready: summary.filed,
          held: summary.quarantined,
          arriving: arriving.length,
        })}
      </p>

      {fileable.length > 0 ? (
        <ul className="files-list">
          {fileable.map((file) => {
            const decision = decisions.get(file.path);
            return (
              <li className="files-row files-row--ready" key={file.path}>
                <button
                  type="button"
                  className="files-play touch-manipulation"
                  onClick={() => void togglePlay(file.path)}
                  aria-label={t(playing === file.path ? 'files.pause' : 'files.play', {
                    name: file.name,
                  })}
                >
                  {playing === file.path ? (
                    <Pause className="w-3.5 h-3.5" aria-hidden />
                  ) : (
                    <Play className="w-3.5 h-3.5" aria-hidden />
                  )}
                </button>
                <span className="files-name">{file.name}</span>
                <span className="ui-hint files-path">
                  {decision?.action === 'file'
                    ? `${decision.kind} → ${decision.relativePath}`
                    : ''}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* The held pile, with the reason on every row. A count would say how big the problem is and
          nothing about what to do with it. */}
      {held.length > 0 ? (
        <>
          <h2 className="incoming-held-title">{t('incoming.heldTitle')}</h2>
          <ul
            className="files-list"
            role="listbox"
            aria-multiselectable
            tabIndex={0}
            onKeyDown={selection.onKeyDown}
          >
            {held.map((file) => {
              const decision = decisions.get(file.path);
              const chosen = selection.isSelected(file.path);
              return (
                <li
                  className={`files-row files-row--held${chosen ? ' files-row--on' : ''}`}
                  key={file.path}
                  role="option"
                  aria-selected={chosen}
                  onClick={(e) => selection.onRowClick(file.path, e)}
                >
                  <span className="files-name">{file.name}</span>
                  <span className="ui-hint files-path">
                    {decision?.action === 'quarantine'
                      ? `${describeQuarantine(decision.reason)} — ${decision.detail}`
                      : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {arriving.length > 0 ? (
        <p className="ui-hint">{t('incoming.arriving', { count: arriving.length })}</p>
      ) : null}
    </section>
  );

  const heldSelected = held.filter((f) => selection.isSelected(f.path));

  return (
    <DesktopFrame
      inspectorOpen
      onToggleInspector={() => selection.clear()}
      inspector={
        selection.count > 0 ? (
          <Inspector
            title={t('incoming.inspectorTitle')}
            count={selection.count}
            rows={[
              {
                label: t('incoming.inspectorWhy'),
                value: [
                  ...new Set(
                    heldSelected
                      .map((f) => decisions.get(f.path))
                      .filter((d) => d?.action === 'quarantine')
                      .map((d) => (d?.action === 'quarantine' ? describeQuarantine(d.reason) : '')),
                  ),
                ].join(', '),
              },
            ]}
          />
        ) : undefined
      }
    >
      {body}
    </DesktopFrame>
  );
}
