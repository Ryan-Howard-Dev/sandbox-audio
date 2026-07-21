import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import ModalOverlay from '../stations/ModalOverlay';
import type { LockerEntry } from '../lockerStorage';
import {
  enrichAlbumMetadata,
  formatCreditLine,
  isClassicalGenre,
  parseStoredCredits,
  type AlbumCreditsResult,
} from '../albumCredits';

type AlbumGroup = {
  key: string;
  name: string;
  displayName: string;
  artist: string;
  tracks: LockerEntry[];
};

interface AlbumCreditsModalProps {
  open: boolean;
  onClose: () => void;
  album: AlbumGroup | null;
  onSaved: () => void;
}

function CreditSection({
  label,
  values,
}: {
  label: string;
  values: string | undefined;
}) {
  const line = formatCreditLine(values);
  if (!line) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-[var(--text-dim)] mb-1">
        {label}
      </p>
      <p className="text-sm text-[var(--text)] leading-relaxed">{line}</p>
    </div>
  );
}

function trackCreditSubtitle(track: LockerEntry, classical: boolean): string | null {
  const parts: string[] = [];
  const composer = formatCreditLine(track.composer);
  const soloists = formatCreditLine(track.trackSoloists);
  const performers = formatCreditLine(track.trackPerformers);
  const producers = formatCreditLine(track.trackProducers);

  if (composer) parts.push(`Composer: ${composer}`);
  if (classical && soloists) parts.push(`Soloist: ${soloists}`);
  if (performers && !classical) parts.push(performers);
  if (producers) parts.push(`Prod. ${producers}`);

  return parts.length > 0 ? parts.join(' · ') : null;
}

export default function AlbumCreditsModal({
  open,
  onClose,
  album,
  onSaved,
}: AlbumCreditsModalProps) {
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [liveCredits, setLiveCredits] = useState<AlbumCreditsResult | null>(null);

  const sample = album?.tracks[0];
  const storedNotes = useMemo(() => parseStoredCredits(sample), [sample?.creditsJson]);

  const genre = album?.tracks.find((t) => t.genre?.trim())?.genre ?? '';
  const classical = isClassicalGenre(genre);

  const albumPerformers = sample?.performers;
  const albumProducers = sample?.producers;
  const albumEngineers = sample?.engineers;
  const albumComposer = sample?.composer;
  const linerNotesUrl = sample?.linerNotesUrl ?? storedNotes?.linerNotesUrl;
  const bookletUrl = sample?.bookletUrl ?? storedNotes?.bookletUrl;
  const linerNotesText =
    liveCredits?.linerNotes ?? storedNotes?.linerNotes ?? undefined;

  const hasAnyCredits = Boolean(
    albumPerformers ||
      albumProducers ||
      albumEngineers ||
      albumComposer ||
      linerNotesUrl ||
      bookletUrl ||
      linerNotesText ||
      album?.tracks.some(
        (t) =>
          t.composer ||
          t.trackPerformers ||
          t.trackProducers ||
          t.trackSoloists,
      ),
  );

  useEffect(() => {
    if (!open) {
      setLiveCredits(null);
      setError('');
      setFetching(false);
    }
  }, [open]);

  const runEnrich = useCallback(async () => {
    if (!album) return;
    setFetching(true);
    setError('');
    try {
      const result = await enrichAlbumMetadata(album.name, album.artist);
      if (!result) {
        setError('No credits found online for this album.');
        return;
      }
      setLiveCredits(result);
      onSaved();
    } catch {
      setError('Could not fetch credits. Try again later.');
    } finally {
      setFetching(false);
    }
  }, [album, onSaved]);

  if (!album) return null;

  const displayPerformers = liveCredits?.performers.join(', ') ?? albumPerformers;
  const displayProducers = liveCredits?.producers.join(', ') ?? albumProducers;
  const displayEngineers = liveCredits?.engineers.join(', ') ?? albumEngineers;
  const displayComposers =
    liveCredits?.composers.join(', ') ?? albumComposer ?? undefined;

  return (
    <ModalOverlay
      open={open}
      onClose={() => !fetching && onClose()}
      title="Album credits"
      maxWidth="max-w-2xl"
      borderAccent
    >
      <div className="space-y-5 font-mono">
        <div>
          <h3 className="font-display text-lg font-bold text-[var(--text)]">
            {album.displayName}
          </h3>
          <p className="text-sm text-[var(--text-mid)] mt-0.5">{album.artist}</p>
        </div>

        {!hasAnyCredits && !fetching && !liveCredits && (
          <p className="text-sm text-[var(--text-mid)] border border-dashed border-[var(--border)] rounded-lg px-4 py-6 text-center">
            No credits stored yet. Fetch from MusicBrainz and TheAudioDB to populate
            composers, performers, producers, and liner notes.
          </p>
        )}

        {(hasAnyCredits || liveCredits) && (
          <div className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-void)]/40 p-4">
            <CreditSection label="Composers" values={displayComposers} />
            <CreditSection label="Performers" values={displayPerformers} />
            <CreditSection label="Producers" values={displayProducers} />
            <CreditSection label="Engineers" values={displayEngineers} />
          </div>
        )}

        {(linerNotesText || linerNotesUrl || bookletUrl || liveCredits?.bookletUrl) && (
          <div className="space-y-3 rounded-lg border border-[var(--border)] p-4">
            <p className="text-[10px] uppercase tracking-widest text-accent">
              Liner notes / booklet
            </p>
            {linerNotesText && (
              <p className="text-sm text-[var(--text-mid)] leading-relaxed max-h-40 overflow-y-auto music-scrollbar whitespace-pre-wrap">
                {linerNotesText}
              </p>
            )}
            {(linerNotesUrl || liveCredits?.linerNotesUrl) && (
              <a
                href={linerNotesUrl ?? liveCredits?.linerNotesUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-accent hover:brightness-110"
              >
                View liner notes
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            {(bookletUrl || liveCredits?.bookletUrl) && (
              <a
                href={bookletUrl ?? liveCredits?.bookletUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-accent hover:brightness-110"
              >
                Digital booklet (external link)
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}

        <div>
          <p className="text-[10px] uppercase tracking-widest text-[var(--text-dim)] mb-2">
            Track credits
          </p>
          <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden max-h-56 overflow-y-auto music-scrollbar">
            {album.tracks.map((track, index) => {
              const live = liveCredits?.tracks.find(
                (t) =>
                  t.title.toLowerCase() === track.title.toLowerCase() ||
                  track.title.toLowerCase().includes(t.title.toLowerCase()),
              );
              const subtitle =
                trackCreditSubtitle(track, classical) ||
                (live
                  ? [
                      live.composer ? `Composer: ${live.composer}` : '',
                      classical && live.soloists?.length
                        ? `Soloist: ${live.soloists.join(', ')}`
                        : '',
                      live.performers?.length ? live.performers.join(', ') : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : null);

              return (
                <li key={track.id} className="px-3 py-2.5 bg-[var(--bg-card)]/30">
                  <div className="flex gap-2 text-sm">
                    <span className="text-[var(--text-dim)] w-5 shrink-0">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[var(--text)]">{track.title}</p>
                      {subtitle ? (
                        <p className="text-xs text-[var(--text-mid)] mt-0.5 leading-snug">
                          {subtitle}
                        </p>
                      ) : (
                        <p className="text-xs text-[var(--text-dim)] mt-0.5 italic">
                          No track credits
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {error && (
          <p className="text-sm text-red-400/90 px-3 py-2 rounded border border-red-500/30 bg-red-500/10">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={fetching}
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs uppercase text-[var(--text-mid)] hover:border-[var(--orange)] hover:text-[var(--text)] transition-colors touch-manipulation disabled:opacity-40"
          >
            Close
          </button>
          <button
            type="button"
            disabled={fetching}
            onClick={() => void runEnrich()}
            className="px-5 py-2 rounded-lg btn-accent text-xs font-bold uppercase tracking-wide disabled:opacity-50 touch-manipulation inline-flex items-center gap-2"
          >
            {fetching ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Fetching…
              </>
            ) : (
              'Fetch credits online'
            )}
          </button>
        </div>

        <p className="text-[10px] text-[var(--text-dim)] leading-relaxed">
          Sources: MusicBrainz (release and recording relationships), TheAudioDB
          (album descriptions). Booklet PDFs open via external links when
          available; hosting embedded PDFs is not supported yet.
        </p>
      </div>
    </ModalOverlay>
  );
}
