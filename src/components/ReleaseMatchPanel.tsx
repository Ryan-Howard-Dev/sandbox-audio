/**
 * Search the catalogue for an album, look at what a match would change, then change it.
 *
 * The automatic repair already in the app is right for a library and wrong for the record it gets
 * wrong — a reissue matched to the original, a self-titled album matched to the wrong band. This is
 * the manual path for exactly those, and the whole point of it is the middle step: the diff is
 * shown, field by field and row by row, before a single value is written.
 *
 * No decisions live here. Searching is releaseLookup, matching and diffing are metadataEdit, both
 * pure and tested. This shows the answer and takes the choice.
 */

import { useCallback, useMemo, useState } from 'react';
import { AlertCircle, Check, Loader2, Search } from 'lucide-react';
import { useTranslation } from '../i18n';
import ModalOverlay from '../stations/ModalOverlay';
import { C } from '../stations/theme';
import { searchReleases } from '../releaseLookup';
import {
  proposeEdits,
  patchForEdit,
  rankCandidates,
  type EditableRow,
  type EditProposal,
  type ReleaseCandidate,
} from '../metadataEdit';
import { updateLockerEntryMetadata } from '../lockerStorage';
import { canWriteTagsToFiles, writeTags, type TagWriteRequest } from '../libraryFs';
import { filePathFromUrl } from '../libraryHealthSources';

export interface ReleaseMatchPanelProps {
  open: boolean;
  onClose: () => void;
  /** The rows about to be matched — an album's tracks, normally. */
  rows: EditableRow[];
  /** Where each row's file is, keyed by row id, so a match can reach the file and not just the row. */
  pathsById?: Record<string, string | undefined>;
  albumName?: string;
  artist?: string;
  onDone?: (message: string) => void;
}

type Phase = 'search' | 'choosing' | 'preview' | 'applying';

export default function ReleaseMatchPanel({
  open,
  onClose,
  rows,
  pathsById,
  albumName,
  artist,
  onDone,
}: ReleaseMatchPanelProps) {
  const { t } = useTranslation();
  const [album, setAlbum] = useState(albumName ?? '');
  const [artistName, setArtistName] = useState(artist ?? '');
  const [phase, setPhase] = useState<Phase>('search');
  const [candidates, setCandidates] = useState<ReleaseCandidate[]>([]);
  const [chosen, setChosen] = useState<ReleaseCandidate | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Default on where it is possible: a fix that does not reach the file is half a fix.
  const [writeToFiles, setWriteToFiles] = useState(true);

  const proposal: EditProposal | null = useMemo(
    () => (chosen ? proposeEdits(rows, chosen, { overwriteExisting: overwrite }) : null),
    [chosen, rows, overwrite],
  );

  const search = useCallback(async () => {
    setPhase('choosing');
    setNotice(null);
    setChosen(null);
    const result = await searchReleases({ album, artist: artistName });
    if (result.status === 'found') {
      /*
       * Ranked against what the library already believes, track count included. That is what
       * separates an album from its deluxe reissue when the title and artist match both, and
       * picking the reissue writes bonus disc numbering over the original.
       */
      setCandidates(
        rankCandidates(result.candidates, {
          album,
          artist: artistName,
          trackCount: rows.length,
        }),
      );
      return;
    }
    setCandidates([]);
    setPhase('search');
    // Four outcomes, four sentences: they ask for four different things from the person searching.
    setNotice(
      result.status === 'none'
        ? t('releaseMatch.noneFound')
        : result.status === 'empty'
          ? t('releaseMatch.needAlbum')
          : t('releaseMatch.unavailable'),
    );
  }, [album, artistName, rows.length, t]);

  const apply = useCallback(async () => {
    if (!proposal) return;
    setPhase('applying');
    let written = 0;
    for (const edit of proposal.edits) {
      if (edit.changes.length === 0) continue;
      try {
        await updateLockerEntryMetadata(edit.rowId, patchForEdit(edit));
        written += 1;
      } catch {
        // One row failing must not abandon the rest; the count reported is what actually landed.
      }
    }
    /*
     * The same values into the files, where there are files to write to.
     *
     * Without this a corrected title is correct in this app and nowhere else: another player shows
     * the old one, and re-importing reads the old one straight back off the disk. Done after the
     * locker write rather than instead of it, because the locker is what this app reads and a file
     * write that fails should not leave the app showing the wrong thing too.
     */
    let toFiles = 0;
    if (writeToFiles && canWriteTagsToFiles()) {
      const requests: TagWriteRequest[] = [];
      for (const edit of proposal.edits) {
        if (edit.changes.length === 0) continue;
        const path = pathsById?.[edit.rowId];
        if (!path) continue;
        const patch = patchForEdit(edit);
        requests.push({
          path,
          patch: {
            title: typeof patch.title === 'string' ? patch.title : undefined,
            artist: typeof patch.artist === 'string' ? patch.artist : undefined,
            album: typeof patch.albumName === 'string' ? patch.albumName : undefined,
            albumArtist: typeof patch.albumArtist === 'string' ? patch.albumArtist : undefined,
            year: typeof patch.releaseYear === 'string' ? patch.releaseYear : undefined,
            genre: typeof patch.genre === 'string' ? patch.genre : undefined,
            trackNumber: typeof patch.trackNumber === 'number' ? patch.trackNumber : undefined,
            discNumber: typeof patch.discNumber === 'number' ? patch.discNumber : undefined,
          },
        });
      }
      if (requests.length > 0) {
        const results = await writeTags(requests);
        toFiles = results.filter((r) => r.ok).length;
      }
    }

    onDone?.(
      toFiles > 0
        ? t('releaseMatch.appliedWithFiles', { count: written, files: toFiles })
        : t('releaseMatch.applied', { count: written }),
    );
    onClose();
    setPhase('search');
    setChosen(null);
  }, [proposal, onDone, onClose, t, writeToFiles, pathsById]);

  if (!open) return null;

  return (
    <ModalOverlay open onClose={onClose} title={t('releaseMatch.title')} maxWidth="max-w-2xl">
      <div className="release-match" style={{ borderColor: C.border }}>
        <p className="ui-hint">{t('releaseMatch.lead')}</p>

        <form
          className="release-match-form"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input
            className="release-match-input"
            value={album}
            onChange={(e) => setAlbum(e.target.value)}
            placeholder={t('releaseMatch.albumPlaceholder')}
            aria-label={t('releaseMatch.albumPlaceholder')}
          />
          <input
            className="release-match-input"
            value={artistName}
            onChange={(e) => setArtistName(e.target.value)}
            placeholder={t('releaseMatch.artistPlaceholder')}
            aria-label={t('releaseMatch.artistPlaceholder')}
          />
          <button
            type="submit"
            className="btn-accent release-match-search touch-manipulation"
            disabled={phase === 'choosing' || phase === 'applying' || !album.trim()}
          >
            {phase === 'choosing' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
            ) : (
              <Search className="w-3.5 h-3.5" aria-hidden />
            )}
            {t('releaseMatch.search')}
          </button>
        </form>

        {notice ? (
          <p className="release-match-notice font-mono text-[10px]" role="status">
            <AlertCircle className="w-3 h-3 inline mr-1" aria-hidden />
            {notice}
          </p>
        ) : null}

        {candidates.length > 0 && !chosen ? (
          <ul className="release-match-candidates">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  className="release-match-candidate touch-manipulation"
                  onClick={() => setChosen(candidate)}
                >
                  <span className="release-match-candidate-title">{candidate.title}</span>
                  <span className="ui-hint release-match-candidate-meta">
                    {[
                      candidate.artist,
                      candidate.year,
                      candidate.media,
                      /* Track count is shown because it is the field that tells two pressings
                         apart, and the one worth checking against your own album. */
                      candidate.trackCount != null
                        ? t('releaseMatch.trackCount', { count: candidate.trackCount })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {chosen && proposal ? (
          <div className="release-match-preview">
            <p className="release-match-summary">
              {t('releaseMatch.summary', {
                rows: proposal.changing,
                fields: proposal.fieldChanges,
              })}
              {proposal.skipped > 0
                ? ` ${t('releaseMatch.summarySkipped', { count: proposal.skipped })}`
                : ''}
            </p>

            <label className="release-match-toggle">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              <span>{t('releaseMatch.overwrite')}</span>
            </label>

            {canWriteTagsToFiles() ? (
              <label className="release-match-toggle">
                <input
                  type="checkbox"
                  checked={writeToFiles}
                  onChange={(e) => setWriteToFiles(e.target.checked)}
                />
                <span>{t('releaseMatch.writeToFiles')}</span>
              </label>
            ) : null}

            <ul className="release-match-rows">
              {proposal.edits.map((edit) => (
                <li className="release-match-row" key={edit.rowId}>
                  <span className="release-match-row-label">{edit.label}</span>
                  {edit.skipped ? (
                    <span className="ui-hint release-match-row-skip">
                      {t(`releaseMatch.skip.${edit.skipped}`)}
                    </span>
                  ) : (
                    <ul className="release-match-fields">
                      {edit.changes.map((change) => (
                        <li className="release-match-field" key={change.field}>
                          <span className="release-match-field-name">
                            {t(`releaseMatch.field.${change.field}`)}
                          </span>
                          {/* Before and after both shown: "album art will change" is not something
                              anybody can approve without seeing what it is changing from. */}
                          <span className="release-match-field-before">
                            {change.before || t('releaseMatch.blank')}
                          </span>
                          <span className="release-match-field-after">{change.after}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            <div className="release-match-actions">
              <button
                type="button"
                className="release-match-back touch-manipulation"
                onClick={() => setChosen(null)}
                disabled={phase === 'applying'}
              >
                {t('releaseMatch.back')}
              </button>
              <button
                type="button"
                className="btn-accent release-match-apply touch-manipulation"
                onClick={() => void apply()}
                disabled={phase === 'applying' || proposal.changing === 0}
              >
                {phase === 'applying' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                ) : (
                  <Check className="w-3.5 h-3.5" aria-hidden />
                )}
                {t('releaseMatch.apply', { count: proposal.changing })}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </ModalOverlay>
  );
}
