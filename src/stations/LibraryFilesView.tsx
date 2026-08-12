/**
 * The files themselves: what is on the disk, what it would become, and what it sounds like.
 *
 * Browsing, playing and organising are one surface because they are one job. Deciding whether a
 * rename is right means looking at the file, and often means hearing it — an untagged track called
 * "01.mp3" cannot be filed by anybody who cannot play it.
 *
 * Every change goes through the same plan-then-apply path as everything else: a preview listing
 * every affected path, including the ones it refuses, and nothing written until that has been seen.
 * The scheme rendering is libraryOrganise, pure and tested. This draws it and takes the choice.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Wand2,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import {
  addLibraryRoot,
  applyLibraryPlan,
  describePlan,
  isLibraryFsAvailable,
  libraryMediaUrl,
  listLibraryRoots,
  planLibraryOperations,
  scanLibrary,
  undoLastLibraryRun,
  type FileEntry,
  type LibraryPlan,
  type LibraryRoot,
} from '../libraryFs';
import {
  DEFAULT_SCHEME,
  proposeOrganise,
  type OrganiseProposal,
  type OrganiseTrack,
} from '../libraryOrganise';
import { getLockerEntries } from '../lockerStorage';
import { filePathFromUrl } from '../libraryHealthSources';
import { isAudioFile } from '../libraryHealth';
import { useSelection } from '../hooks/useSelection';
import DesktopFrame, { Inspector } from '../components/DesktopFrame';

type Phase = 'idle' | 'scanning' | 'planning' | 'applying';

export default function LibraryFilesView() {
  const { t } = useTranslation();
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [activeRoot, setActiveRoot] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [scheme, setScheme] = useState(DEFAULT_SCHEME);
  const [proposal, setProposal] = useState<OrganiseProposal | null>(null);
  const [plan, setPlan] = useState<LibraryPlan | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [audio] = useState(() =>
    typeof Audio === 'undefined' ? null : new Audio(),
  );

  const supported = isLibraryFsAvailable();

  useEffect(() => {
    if (!supported) return;
    void (async () => {
      const found = await listLibraryRoots();
      setRoots(found);
      setActiveRoot((current) => current ?? found[0]?.id ?? null);
    })();
  }, [supported]);

  // Stop the preview when leaving, so a track does not keep playing over the rest of the app.
  useEffect(() => () => audio?.pause(), [audio]);

  /**
   * Point the app at a folder.
   *
   * Lives here rather than in Settings because this is the screen that needs one, and being told
   * to go and find a setting is a worse answer than a button. The kind follows the active tab where
   * there is one, so adding a second music folder does not ask a question with an obvious answer.
   */
  const addRoot = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== 'string') return;
      const kind = roots.find((r) => r.id === activeRoot)?.kind ?? 'music';
      const added = await addLibraryRoot(picked, kind);
      setRoots(await listLibraryRoots());
      setActiveRoot(added.id);
      setNotice(null);
    } catch (err) {
      // The overlap and duplicate refusals arrive here, and both say something worth reading.
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }, [roots, activeRoot]);

  const scan = useCallback(async () => {
    if (!activeRoot) return;
    setPhase('scanning');
    setNotice(null);
    setProposal(null);
    setPlan(null);
    try {
      const result = await scanLibrary({ rootId: activeRoot });
      setFiles(result.entries.filter((entry) => !entry.isDir));
      if (result.truncated) setNotice(t('files.truncated', { count: result.entries.length }));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase('idle');
    }
  }, [activeRoot, t]);

  useEffect(() => {
    if (activeRoot) void scan();
  }, [activeRoot, scan]);

  const audioFiles = useMemo(
    () =>
      files.filter((file) =>
        isAudioFile({
          path: file.path,
          name: file.name,
          isDir: file.isDir,
          size: file.size,
          extension: file.extension,
        }),
      ),
    [files],
  );

  /*
   * Selection is over the scanned audio files, keyed by path.
   *
   * Ids are the paths themselves, so a rescan that finds the same files keeps the selection and one
   * that moved them drops it — which is exactly right after an organise run has just relocated the
   * things that were selected.
   */
  const fileIds = useMemo(() => audioFiles.map((file) => file.path), [audioFiles]);
  const selection = useSelection(fileIds);

  const togglePlay = useCallback(
    async (path: string) => {
      if (!audio) return;
      if (playing === path) {
        audio.pause();
        setPlaying(null);
        return;
      }
      /*
       * The bytes come over loopback from Rust rather than from the path directly: a WebView will
       * not open a file:// url, and this is the only way a file on disk reaches an audio element.
       */
      const url = await libraryMediaUrl(path);
      if (!url) {
        setNotice(t('files.cannotPlay'));
        return;
      }
      audio.src = url;
      try {
        await audio.play();
        setPlaying(path);
      } catch {
        setNotice(t('files.cannotPlay'));
      }
    },
    [audio, playing, t],
  );

  /**
   * Match scanned files to what the locker knows, so the scheme has tags to work with.
   *
   * A file the locker has never seen has no title or album, so the scheme will refuse to place it
   * and say which fields it wanted. That is the honest answer: filing an untagged file by guessing
   * from its name is how a library becomes wrong in a way nobody notices for a year.
   */
  const preview = useCallback(async () => {
    const root = roots.find((r) => r.id === activeRoot);
    if (!root) return;
    setPhase('planning');
    setNotice(null);
    try {
      const entries = await getLockerEntries();
      const byPath = new Map<string, (typeof entries)[number]>();
      for (const entry of entries) {
        const path = filePathFromUrl(entry.url);
        if (path) byPath.set(path.replace(/\\/g, '/').toLowerCase(), entry);
      }

      /*
       * A selection narrows the run; no selection means everything scanned.
       *
       * Organising a whole folder is the common case and should not need a select-all first, but
       * fixing one album out of forty thousand files is the case that makes the preview readable.
       */
      const subject =
        selection.count > 0
          ? audioFiles.filter((file) => selection.isSelected(file.path))
          : audioFiles;

      const tracks: OrganiseTrack[] = subject.map((file) => {
        const known = byPath.get(file.path.replace(/\\/g, '/').toLowerCase());
        return {
          path: file.path,
          title: known?.title,
          artist: known?.artist,
          albumArtist: known?.albumArtist,
          album: known?.albumName,
          releaseYear: known?.releaseYear,
          trackNumber: known?.trackNumber,
          discNumber: known?.discNumber,
        };
      });

      const organised = proposeOrganise(tracks, scheme, root.path);
      setProposal(organised);

      if (organised.operations.length === 0) {
        setPlan(null);
        return;
      }
      // The filesystem layer previews it a second time, and its answer is the one that counts:
      // it can see collisions with files this scan never listed.
      setPlan(await planLibraryOperations(organised.operations));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase('idle');
    }
  }, [roots, activeRoot, audioFiles, scheme, selection]);

  const apply = useCallback(async () => {
    if (!plan) return;
    setPhase('applying');
    try {
      const result = await applyLibraryPlan(plan.id);
      setNotice(
        t('files.applied', {
          applied: result.applied,
          failed: result.failed,
        }),
      );
      setPlan(null);
      setProposal(null);
      await scan();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase('idle');
    }
  }, [plan, scan, t]);

  const undo = useCallback(async () => {
    setPhase('applying');
    try {
      const result = await undoLastLibraryRun();
      setNotice(t('files.undone', { count: result.applied }));
      await scan();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setPhase('idle');
    }
  }, [scan, t]);

  /*
   * What the inspector says about the selection.
   *
   * Facts the list cannot show without becoming a spreadsheet: how much disk this is, what it is
   * made of, and the whole path of a single file rather than a truncated one. Worked out here
   * because this station owns the selection; the inspector itself knows nothing about files.
   */
  const inspectorRows = useMemo(() => {
    const chosen = audioFiles.filter((file) => selection.isSelected(file.path));
    if (chosen.length === 0) return [];

    const bytes = chosen.reduce((sum, file) => sum + file.size, 0);
    const kinds = [...new Set(chosen.map((f) => (f.extension ?? '?').toUpperCase()))].sort();
    const rows = [
      { label: t('files.inspectorSize'), value: formatBytes(bytes) },
      { label: t('files.inspectorKinds'), value: kinds.join(', ') },
    ];
    // One file gets its full path; forty do not, and a list of forty paths is the list again.
    if (chosen.length === 1) {
      rows.push({ label: t('files.inspectorPath'), value: chosen[0].path });
    }
    return rows;
  }, [audioFiles, selection, t]);

  const [inspectorOpen, setInspectorOpen] = useState(true);

  if (!supported) {
    return (
      <section className="files-view" aria-label={t('files.title')}>
        <h1 className="files-title">{t('files.title')}</h1>
        <p className="ui-hint">{t('files.desktopOnly')}</p>
      </section>
    );
  }

  const body = (
    <section className="files-view" aria-label={t('files.title')}>
      <header className="files-head">
        <h1 className="files-title">{t('files.title')}</h1>
        <p className="ui-hint">{t('files.lead')}</p>
      </header>

      {roots.length === 0 ? (
        <div className="files-empty">
          <p className="ui-hint">
            <FolderOpen className="w-3.5 h-3.5 inline mr-1.5" aria-hidden />
            {t('files.noRoots')}
          </p>
          <button
            type="button"
            className="btn-accent files-preview touch-manipulation"
            onClick={() => void addRoot()}
          >
            <FolderPlus className="w-3.5 h-3.5" aria-hidden />
            {t('files.addRoot')}
          </button>
          {notice ? (
            <p className="files-notice font-mono text-[10px]" role="status">
              {notice}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="files-roots" role="tablist" aria-label={t('files.rootsLabel')}>
            {roots.map((root) => (
              <button
                key={root.id}
                type="button"
                role="tab"
                aria-selected={root.id === activeRoot}
                className={`files-root touch-manipulation${root.id === activeRoot ? ' files-root--on' : ''}`}
                onClick={() => setActiveRoot(root.id)}
              >
                {root.path}
                <span className="ui-hint files-root-kind">{root.kind}</span>
              </button>
            ))}
            <button
              type="button"
              className="files-root touch-manipulation"
              onClick={() => void addRoot()}
              aria-label={t('files.addRoot')}
            >
              <FolderPlus className="w-3.5 h-3.5" aria-hidden />
              {t('files.addRoot')}
            </button>
          </div>

          <div className="files-actions">
            <input
              className="files-scheme"
              value={scheme}
              onChange={(e) => setScheme(e.target.value)}
              aria-label={t('files.schemeLabel')}
              spellCheck={false}
            />
            <button
              type="button"
              className="btn-accent files-preview touch-manipulation"
              onClick={() => void preview()}
              disabled={phase !== 'idle' || audioFiles.length === 0}
            >
              {phase === 'planning' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              ) : (
                <Wand2 className="w-3.5 h-3.5" aria-hidden />
              )}
              {selection.count > 0
                ? t('files.previewSelected', { count: selection.count })
                : t('files.preview')}
            </button>
            <button
              type="button"
              className="files-undo touch-manipulation"
              onClick={() => void undo()}
              disabled={phase !== 'idle'}
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden />
              {t('files.undo')}
            </button>
          </div>

          {notice ? (
            <p className="files-notice font-mono text-[10px]" role="status">
              {notice}
            </p>
          ) : null}

          <p className="ui-hint files-count">
            {phase === 'scanning'
              ? t('files.scanning')
              : t('files.count', { count: audioFiles.length })}
          </p>

          {proposal ? (
            <div className="files-plan">
              <p className="files-plan-summary">
                {t('files.planSummary', {
                  moving: proposal.moving,
                  blocked: proposal.blocked,
                  unchanged: proposal.unchanged,
                })}
                {plan ? ` ${describePlan(plan)}.` : ''}
              </p>

              <ul className="files-plan-rows">
                {proposal.rows.slice(0, 200).map((row) => (
                  <li className={`files-plan-row files-plan-row--${row.outcome}`} key={row.track.path}>
                    <span className="files-plan-from">{row.track.path}</span>
                    {row.outcome === 'ok' && row.target ? (
                      <>
                        <ChevronRight className="w-3 h-3 shrink-0" aria-hidden />
                        <span className="files-plan-to">{row.target}</span>
                      </>
                    ) : (
                      <span className="ui-hint files-plan-why">
                        {row.outcome === 'noChange' ? t('files.alreadyRight') : row.detail}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {/* Capped for the screen's sake, and said so rather than appearing complete. */}
              {proposal.rows.length > 200 ? (
                <p className="ui-hint">{t('files.andMore', { count: proposal.rows.length - 200 })}</p>
              ) : null}

              {plan && plan.blocked > 0 ? (
                <p className="files-blocked" role="note">
                  <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5" aria-hidden />
                  {t('files.blockedNote', { count: plan.blocked })}
                </p>
              ) : null}

              <button
                type="button"
                className="btn-accent files-apply touch-manipulation"
                onClick={() => void apply()}
                disabled={phase !== 'idle' || !plan || proposal.moving === 0}
              >
                {phase === 'applying' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                ) : (
                  <Check className="w-3.5 h-3.5" aria-hidden />
                )}
                {t('files.apply', { count: proposal.moving })}
              </button>
            </div>
          ) : (
            <>
              <div className="files-selectbar">
                <label className="files-selectall">
                  <input
                    type="checkbox"
                    checked={selection.headerState === 'all'}
                    /* Three states, not two: partly chosen is neither ticked nor empty. */
                    ref={(el) => {
                      if (el) el.indeterminate = selection.headerState === 'some';
                    }}
                    onChange={selection.toggleAll}
                    aria-label={t('files.selectAll')}
                  />
                  <span className="ui-hint">
                    {selection.count > 0
                      ? t('files.selectedCount', { count: selection.count })
                      : t('files.selectNone')}
                  </span>
                </label>
                {selection.count > 0 ? (
                  <button
                    type="button"
                    className="files-clearsel touch-manipulation"
                    onClick={selection.clear}
                  >
                    {t('files.clearSelection')}
                  </button>
                ) : null}
              </div>

              {/* Arrow keys and ctrl-A reach the list itself, so a keyboard can drive it without
                  tabbing through every row. */}
              <ul
                className="files-list"
                tabIndex={0}
                role="listbox"
                aria-multiselectable
                aria-label={t('files.title')}
                onKeyDown={selection.onKeyDown}
              >
                {audioFiles.slice(0, 300).map((file) => {
                  const chosen = selection.isSelected(file.path);
                  return (
                    <li
                      className={`files-row${chosen ? ' files-row--on' : ''}`}
                      key={file.path}
                      role="option"
                      aria-selected={chosen}
                      onClick={(e) => selection.onRowClick(file.path, e)}
                    >
                      <button
                        type="button"
                        className="files-play touch-manipulation"
                        /* Playing is not selecting: hearing a file to decide about it must not
                           throw away the selection being decided. */
                        onClick={(e) => {
                          e.stopPropagation();
                          void togglePlay(file.path);
                        }}
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
                      <span className="ui-hint files-path">{file.path}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );

  /*
   * The frame only where there is room for it. A phone renders the station alone; the inspector is
   * a desktop affordance and squeezing it onto a narrow window would take the width the list needs
   * to show a path.
   */
  return (
    <DesktopFrame
      inspectorOpen={inspectorOpen}
      onToggleInspector={() => setInspectorOpen((v) => !v)}
      inspector={
        selection.count > 0 ? (
          <Inspector
            title={t('files.inspectorTitle')}
            count={selection.count}
            rows={inspectorRows}
            actions={
              <button
                type="button"
                className="btn-accent files-preview touch-manipulation"
                onClick={() => void preview()}
                disabled={phase !== 'idle'}
              >
                <Wand2 className="w-3.5 h-3.5" aria-hidden />
                {t('files.previewSelected', { count: selection.count })}
              </button>
            }
          />
        ) : undefined
      }
    >
      {body}
    </DesktopFrame>
  );
}

/** Bytes as somebody would say them, not as a computer stores them. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
