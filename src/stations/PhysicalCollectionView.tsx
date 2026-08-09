/**
 * The records you own, next to the files you have.
 *
 * A collection tracker on its own can tell you what is on the shelf. This one sits inside the app
 * that already knows what is on the disk, so it can answer the two questions neither half can
 * answer alone: what have I got on vinyl and never ripped, and what have I ripped that I do not
 * actually own. Those are the reasons to build it here rather than as a separate thing.
 *
 * Nothing here decides anything. Matching, state and totals are all in physicalCollection, which is
 * pure and tested; this draws the answer and takes the input.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Barcode, Disc3, Loader2, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from '../i18n';
import {
  overlayPhysicalOwnership,
  summarisePhysicalCollection,
  unmatchedCopies,
  findCopyByBarcode,
  isPlausibleBarcode,
  type PhysicalCopy,
  type PhysicalFormat,
} from '../physicalCollection';
import {
  addPhysicalCopy,
  loadPhysicalCopies,
  removePhysicalCopy,
  subscribePhysicalCollection,
} from '../physicalCollectionStore';
import { lookupBarcode } from '../barcodeRelease';
import { isBarcodeScanningAvailable, scanMusicBarcode } from '../barcodeScanner';
import { resolveDiscography, type CatalogueRelease } from '../discographyOwnership';

export interface PhysicalCollectionViewProps {
  /**
   * The artist discography to compare against, when one is open. Empty is the normal case: the
   * shelf stands on its own and only gains ownership state when there is a catalogue to compare to.
   */
  catalogue?: CatalogueRelease[];
  /** What the locker holds, for the files/physical/both split. */
  heldReleases?: Array<{ key: string; title: string; trackCount: number }>;
}

export default function PhysicalCollectionView({ catalogue = [], heldReleases = [] }: PhysicalCollectionViewProps) {
  const { t } = useTranslation();
  const [copies, setCopies] = useState<PhysicalCopy[]>(() => loadPhysicalCopies());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');

  useEffect(() => subscribePhysicalCollection(() => setCopies(loadPhysicalCopies())), []);

  const entries = useMemo(
    () => overlayPhysicalOwnership(resolveDiscography(catalogue, heldReleases), copies),
    [catalogue, heldReleases, copies],
  );
  const summary = useMemo(
    () => summarisePhysicalCollection(entries, copies),
    [entries, copies],
  );
  const strays = useMemo(() => unmatchedCopies(entries, copies), [entries, copies]);

  /**
   * Add whatever a barcode resolves to.
   *
   * The three failure states are reported as three different sentences on purpose: retype it,
   * enter it by hand, or try again later are three different instructions, and one shared "could
   * not find it" tells somebody holding a record none of them.
   */
  const addByBarcode = useCallback(
    async (raw: string) => {
      if (!isPlausibleBarcode(raw)) {
        setNotice(t('collection.barcodeInvalid'));
        return;
      }
      const already = findCopyByBarcode(loadPhysicalCopies(), raw);
      if (already) {
        // Scanning a stack, it is easy to scan one twice. Say so rather than silently duplicating.
        setNotice(t('collection.barcodeAlready', { title: already.title }));
        return;
      }
      setBusy(true);
      setNotice(null);
      try {
        const result = await lookupBarcode(raw);
        if (result.status === 'found') {
          addPhysicalCopy({
            title: result.release.title,
            artist: result.release.artist,
            // The catalogue knows the media this barcode belongs to; trust it over a guess.
            format: formatFromMedia(result.release.media),
            barcode: result.release.barcode,
          });
          setNotice(t('collection.added', { title: result.release.title }));
          setManualBarcode('');
          return;
        }
        setNotice(
          result.status === 'invalid'
            ? t('collection.barcodeInvalid')
            : result.status === 'unknown'
              ? t('collection.barcodeUnknown')
              : t('collection.barcodeUnavailable'),
        );
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const scan = useCallback(async () => {
    setNotice(null);
    const outcome = await scanMusicBarcode();
    if (outcome.status === 'scanned') {
      await addByBarcode(outcome.barcode);
      return;
    }
    // A closed camera is not a failure and gets no message.
    if (outcome.status === 'denied') setNotice(t('collection.cameraDenied'));
    if (outcome.status === 'unavailable') setNotice(t('collection.cameraUnavailable'));
  }, [addByBarcode, t]);

  return (
    <section className="collection-view" aria-label={t('collection.title')}>
      <header className="collection-head">
        <h1 className="collection-title">{t('collection.title')}</h1>
        <p className="ui-hint">{t('collection.lead')}</p>
      </header>

      <div className="collection-actions">
        {isBarcodeScanningAvailable() ? (
          <button
            type="button"
            className="btn-accent touch-manipulation h-10 px-4 rounded-lg font-mono text-[10px] uppercase tracking-wider inline-flex items-center gap-2"
            onClick={() => void scan()}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
            ) : (
              <Barcode className="w-3.5 h-3.5" aria-hidden />
            )}
            {t('collection.scan')}
          </button>
        ) : null}

        {/* Typing the number does exactly what scanning it does — the lookup takes digits from
            anywhere, so the feature works with no camera and on every platform. */}
        <form
          className="collection-manual"
          onSubmit={(e) => {
            e.preventDefault();
            void addByBarcode(manualBarcode);
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            className="collection-manual-input"
            placeholder={t('collection.barcodePlaceholder')}
            value={manualBarcode}
            onChange={(e) => setManualBarcode(e.target.value)}
            aria-label={t('collection.barcodePlaceholder')}
          />
          <button
            type="submit"
            className="collection-manual-add touch-manipulation"
            disabled={busy || !manualBarcode.trim()}
            aria-label={t('collection.add')}
          >
            <Plus className="w-4 h-4" aria-hidden />
          </button>
        </form>
      </div>

      {notice ? (
        <p className="collection-notice font-mono text-[10px]" role="status">
          {notice}
        </p>
      ) : null}

      {copies.length === 0 ? (
        <p className="ui-hint shelf-empty">{t('collection.empty')}</p>
      ) : (
        <>
          <dl className="collection-summary">
            <Stat label={t('collection.statCopies')} value={summary.copies} />
            <Stat label={t('collection.statVinyl')} value={summary.byFormat.vinyl} />
            <Stat label={t('collection.statCd')} value={summary.byFormat.cd} />
            {/* The two answers nothing else in the app can give. */}
            <Stat label={t('collection.statToRip')} value={summary.physicalOnly} />
          </dl>

          <ul className="collection-list">
            {copies.map((copy) => (
              <li key={copy.id} className="collection-row">
                <span className="collection-row-icon" aria-hidden>
                  <Disc3 className="w-4 h-4" />
                </span>
                <span className="collection-row-copy">
                  <span className="collection-row-title">{copy.title}</span>
                  <span className="collection-row-meta">
                    {[copy.artist, t(`collection.format.${copy.format}`)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <button
                  type="button"
                  className="collection-row-remove touch-manipulation"
                  onClick={() => removePhysicalCopy(copy.id)}
                  aria-label={t('collection.remove', { title: copy.title })}
                >
                  <Trash2 className="w-4 h-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>

          {strays.length > 0 && catalogue.length > 0 ? (
            /*
             * Shown rather than hidden. A bootleg or a compilation is part of a collection, and an
             * app that quietly drops what it could not match is deleting somebody's records from
             * their own view of them.
             */
            <p className="ui-hint shelf-strays">
              {t('collection.unmatched', { count: strays.length })}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="collection-stat">
      <dt className="collection-stat-label">{label}</dt>
      <dd className="collection-stat-value font-mono tabular-nums">{value}</dd>
    </div>
  );
}

/** MusicBrainz says '12" Vinyl', 'CD', 'Cassette'; the shelf stores its own smaller vocabulary. */
function formatFromMedia(media?: string): PhysicalFormat {
  const value = (media ?? '').toLowerCase();
  if (value.includes('vinyl') || value.includes('lp')) return 'vinyl';
  if (value.includes('cassette')) return 'cassette';
  if (value.includes('cd')) return 'cd';
  return 'other';
}
