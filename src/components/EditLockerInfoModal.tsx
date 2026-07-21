import React, { useEffect, useRef, useState } from 'react';
import { Disc, Loader2 } from 'lucide-react';
import ModalOverlay from '../stations/ModalOverlay';
import { useTranslation } from '../i18n';

export interface EditLockerInfoValues {
  title?: string;
  artist?: string;
  albumArtist?: string;
  composer?: string;
  albumName?: string;
  releaseYear?: string;
  discCount?: string;
  genre?: string;
}

interface EditLockerInfoModalProps {
  open: boolean;
  onClose: () => void;
  mode: 'track' | 'album';
  initial: EditLockerInfoValues;
  onSave: (values: EditLockerInfoValues) => Promise<void>;
  /** Album mode — number of tracks in the album (read-only display) */
  trackCount?: number;
  /** Album mode — current cover art url for the inline thumbnail */
  coverUrl?: string;
  /** Album mode — open local JPG/PNG picker for cover art */
  onUploadCover?: () => void;
  /** Album mode — re-run the online cover lookup using the current form values */
  onRefreshCover?: (hint: {
    albumName?: string;
    artist?: string;
    albumArtist?: string;
  }) => void | Promise<void>;
  /** Album mode — auto-identify artist, genre, and cover from catalog */
  onIdentifyFromCatalog?: () => void | Promise<void>;
  /** Album mode — focus a field when the dialog opens */
  focusField?: 'albumArtist';
}

const GENRE_OPTIONS = [
  'Hip-Hop/Rap',
  'R&B/Soul',
  'Electronic',
  'Rock',
  'Pop',
  'Jazz',
  'Classical',
  'Ambient',
  'Metal',
  'Other',
];

const labelClass =
  'block mb-1 text-[10px] uppercase tracking-widest text-[var(--text-dim)]';
const fieldClass =
  'w-full h-11 px-3 border border-[var(--border)] rounded-lg input-elevated text-sm focus-accent';

export default function EditLockerInfoModal({
  open,
  onClose,
  mode,
  initial,
  onSave,
  trackCount,
  coverUrl,
  onUploadCover,
  onRefreshCover,
  onIdentifyFromCatalog,
  focusField,
}: EditLockerInfoModalProps) {
  const { t } = useTranslation();
  const albumArtistRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [albumArtist, setAlbumArtist] = useState('');
  const [composer, setComposer] = useState('');
  const [albumName, setAlbumName] = useState('');
  const [releaseYear, setReleaseYear] = useState('');
  const [discCount, setDiscCount] = useState('');
  const [genre, setGenre] = useState('');
  const [saving, setSaving] = useState(false);
  const [coverSearching, setCoverSearching] = useState(false);
  const [identifying, setIdentifying] = useState(false);
  const [coverError, setCoverError] = useState(false);

  useEffect(() => {
    if (!open) {
      setCoverSearching(false);
      setIdentifying(false);
    }
  }, [open]);

  useEffect(() => {
    setCoverError(false);
  }, [coverUrl, open]);

  useEffect(() => {
    if (!open) return;
    setTitle(initial.title ?? '');
    setArtist(initial.artist ?? '');
    setAlbumArtist(initial.albumArtist ?? '');
    setComposer(initial.composer ?? '');
    setAlbumName(initial.albumName ?? '');
    setReleaseYear(initial.releaseYear ?? '');
    setDiscCount(initial.discCount ?? '');
    setGenre(initial.genre ?? '');
  }, [open, initial]);

  useEffect(() => {
    if (!open || mode !== 'album' || focusField !== 'albumArtist') return;
    const id = window.requestAnimationFrame(() => {
      albumArtistRef.current?.focus();
      albumArtistRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, mode, focusField]);

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({
        title: title.trim() || undefined,
        artist: artist.trim() || undefined,
        albumName: albumName.trim() || undefined,
        albumArtist: albumArtist.trim() || undefined,
        composer: composer.trim() || undefined,
        releaseYear: releaseYear.trim() || undefined,
        discCount: discCount.trim() || undefined,
        genre: genre.trim() || undefined,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const findCoverOnline = async () => {
    if (!onRefreshCover || coverSearching) return;
    setCoverSearching(true);
    setCoverError(false);
    try {
      await onRefreshCover({
        albumName: albumName.trim() || undefined,
        artist: artist.trim() || undefined,
        albumArtist: albumArtist.trim() || undefined,
      });
    } finally {
      setCoverSearching(false);
    }
  };

  const identifyFromCatalog = async () => {
    if (!onIdentifyFromCatalog || identifying) return;
    setIdentifying(true);
    try {
      await onIdentifyFromCatalog();
    } finally {
      setIdentifying(false);
    }
  };

  const busy = saving || coverSearching || identifying;

  const genreDatalist = (
    <datalist id="edit-genre-options">
      {GENRE_OPTIONS.map((g) => (
        <option key={g} value={g} />
      ))}
    </datalist>
  );

  return (
    <ModalOverlay
      open={open}
      onClose={() => !busy && onClose()}
      title={
        mode === 'album'
          ? t('locker.menu.editModalTitleAlbum')
          : t('locker.menu.editModalTitleTrack')
      }
      maxWidth="max-w-lg"
      borderAccent
    >
      <div className="space-y-3 font-mono">
        {mode === 'track' ? (
          <>
            <label className="block">
              <span className={labelClass}>Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Track title"
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Artist</span>
              <input
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Artist"
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Album</span>
              <input
                value={albumName}
                onChange={(e) => setAlbumName(e.target.value)}
                placeholder="Album"
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Composer</span>
              <input
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder="Composer"
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Genre</span>
              <input
                list="edit-genre-options"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="Genre"
                className={fieldClass}
              />
              {genreDatalist}
            </label>
          </>
        ) : (
          <>
            <div className="flex gap-4">
              <div className="flex-1 space-y-3 min-w-0">
                <label className="block">
                  <span className={labelClass}>Artist</span>
                  <input
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    placeholder="Artist"
                    className={fieldClass}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Album artist</span>
                  <input
                    ref={albumArtistRef}
                    value={albumArtist}
                    onChange={(e) => setAlbumArtist(e.target.value)}
                    placeholder="Album artist (banner & catalog)"
                    className={fieldClass}
                    autoComplete="on"
                    autoCorrect="on"
                    autoCapitalize="words"
                    spellCheck
                  />
                  <span className="mt-1 block text-[10px] text-[var(--text-dim)] leading-snug">
                    Shown on the album banner and used for catalog search.
                  </span>
                </label>
              </div>

              <div className="shrink-0 flex flex-col items-center gap-1.5">
                <div className="w-[88px] h-[88px] rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg-void)] flex items-center justify-center">
                  {coverUrl && !coverError ? (
                    <div className="relative w-full h-full">
                      <img
                        src={coverUrl}
                        alt=""
                        onError={() => setCoverError(true)}
                        className="w-full h-full object-cover"
                      />
                      {coverSearching ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <Loader2 size={28} className="text-accent animate-spin" />
                        </div>
                      ) : null}
                    </div>
                  ) : coverSearching ? (
                    <Loader2 size={28} className="text-accent animate-spin" />
                  ) : (
                    <Disc size={32} className="text-[var(--text-dim)]" />
                  )}
                </div>
                {onUploadCover && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onUploadCover()}
                    className="text-[10px] font-bold uppercase tracking-widest text-accent hover:brightness-110 touch-manipulation disabled:opacity-50"
                  >
                    {t('locker.menu.changeCover')}
                  </button>
                )}
                {onRefreshCover && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void findCoverOnline()}
                    className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-mid)] hover:text-[var(--text)] touch-manipulation disabled:opacity-50"
                  >
                    {coverSearching
                      ? t('locker.menu.searchingCover')
                      : t('locker.menu.searchCoverOnline')}
                  </button>
                )}
              </div>
            </div>

            <label className="block">
              <span className={labelClass}>Album</span>
              <input
                value={albumName}
                onChange={(e) => setAlbumName(e.target.value)}
                placeholder="Album name"
                className={fieldClass}
              />
            </label>

            <label className="block">
              <span className={labelClass}>Composer</span>
              <input
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder="Composer"
                className={fieldClass}
              />
            </label>

            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className={labelClass}>Year</span>
                <input
                  type="number"
                  min="1900"
                  max="2030"
                  value={releaseYear}
                  onChange={(e) => setReleaseYear(e.target.value)}
                  placeholder="Year"
                  className={fieldClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Tracks</span>
                <input
                  value={trackCount ?? ''}
                  readOnly
                  disabled
                  className={`${fieldClass} opacity-60 cursor-default`}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Discs</span>
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={discCount}
                  onChange={(e) => setDiscCount(e.target.value)}
                  placeholder="1"
                  className={fieldClass}
                />
              </label>
            </div>

            <label className="block">
              <span className={labelClass}>Genres</span>
              <input
                list="edit-genre-options"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="Genre"
                className={fieldClass}
              />
              {genreDatalist}
            </label>

            {onIdentifyFromCatalog && (
              <div className="space-y-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void identifyFromCatalog()}
                  className="w-full h-11 rounded-lg border border-[var(--border)] text-xs font-bold uppercase tracking-wide text-[var(--text-mid)] hover:border-[var(--orange)] hover:text-[var(--text)] transition-colors touch-manipulation disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {identifying ? (
                    <>
                      <Loader2 size={14} className="animate-spin text-accent" />
                      {t('locker.menu.identifying')}
                    </>
                  ) : (
                    t('locker.menu.identifyFromCatalog')
                  )}
                </button>
                <p className="text-[10px] text-[var(--text-dim)] leading-snug">
                  {t('locker.menu.identifyFromCatalogHint')}
                </p>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs uppercase text-[var(--text-mid)] hover:border-[var(--orange)] hover:text-[var(--text)] transition-colors touch-manipulation disabled:opacity-40"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="px-5 py-2 rounded-lg btn-accent text-xs font-bold uppercase tracking-wide disabled:opacity-50 touch-manipulation"
          >
            {saving ? t('common.saving') : t('locker.menu.updateInfo')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}
