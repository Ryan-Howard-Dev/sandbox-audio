/**
 * The book in one column and the same book in another language beside it.
 *
 * Aligned on the narration chunks rather than on paragraphs or a separate split of its own, which
 * is the point: those are the passages the reader already speaks aloud, so the original, the
 * translation and the voice all agree on where you are. Nobody else has all three, and having two
 * different ideas of "passage" in one screen is how the highlight ends up on the wrong line.
 *
 * Only the passages near the reader are translated, extending as they scroll. Nothing here decides
 * which ones — translationLazy does, and it is pure and tested.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Languages, Loader2 } from 'lucide-react';
import { useTranslation } from '../i18n';
import {
  isWaitingOnVisible,
  nextTranslationBatch,
  pruneTranslations,
} from '../translationLazy';
import {
  describeTranslationResult,
  isRetryable,
  translatePassages,
  type LanguageCode,
  type TranslationEngine,
} from '../translationProvider';

export interface SideBySideReaderProps {
  /** The passages, already chunked — the same list narration reads from. */
  passages: readonly string[];
  /** The language the book is in. */
  from: LanguageCode;
  /** The language to show beside it. */
  to: LanguageCode;
  engine: TranslationEngine | null;
  /** Which passage is in view, from the reading position. */
  index: number;
  onIndexChange?: (index: number) => void;
}

export default function SideBySideReader({
  passages,
  from,
  to,
  engine,
  index,
  onIndexChange,
}: SideBySideReaderProps) {
  const { t } = useTranslation();
  const [translations, setTranslations] = useState<Map<number, string>>(new Map());
  const [inFlight, setInFlight] = useState<Set<number>>(new Set());
  const [refused, setRefused] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  /*
   * Held in a ref as well as state so the effect below can read the current sets without listing
   * them as dependencies. Depending on them would re-run the effect on every answer, which is the
   * request storm this is supposed to prevent rather than cause.
   */
  const live = useRef({ translations, inFlight, refused });
  live.current = { translations, inFlight, refused };

  const total = passages.length;

  const fetchBatch = useCallback(
    async (wanted: number[]) => {
      if (wanted.length === 0) return;
      setInFlight((current) => {
        const next = new Set(current);
        for (const i of wanted) next.add(i);
        return next;
      });

      const result = await translatePassages(
        { texts: wanted.map((i) => passages[i] ?? ''), from, to },
        engine,
      );

      setInFlight((current) => {
        const next = new Set(current);
        for (const i of wanted) next.delete(i);
        return next;
      });

      if (result.status === 'translated') {
        setTranslations((current) => {
          const next = new Map(current);
          wanted.forEach((passageIndex, i) => {
            next.set(passageIndex, result.texts[i] ?? '');
          });
          return next;
        });
        setNotice(null);
        return;
      }

      /*
       * A failure that will not change is marked refused so the window stops asking. Without this
       * a missing model means the same batch is requested forever, once per scroll, each one
       * failing the same way.
       */
      if (!isRetryable(result)) {
        setRefused((current) => {
          const next = new Set(current);
          for (const i of wanted) next.add(i);
          return next;
        });
      }
      setNotice(describeTranslationResult(result));
    },
    [passages, from, to, engine],
  );

  useEffect(() => {
    const wanted = nextTranslationBatch({
      total,
      index,
      done: new Set(live.current.translations.keys()),
      inFlight: live.current.inFlight,
      refused: live.current.refused,
    });
    void fetchBatch(wanted);
  }, [total, index, fetchBatch, translations, inFlight]);

  // Keep the cache near the reader; a long book translated end to end is held for nothing.
  useEffect(() => {
    setTranslations((current) => {
      const pruned = pruneTranslations(current, index);
      return pruned.size === current.size ? current : pruned;
    });
  }, [index]);

  const waiting = useMemo(
    () =>
      isWaitingOnVisible({
        total,
        index,
        done: new Set(translations.keys()),
        inFlight,
        refused,
      }),
    [total, index, translations, inFlight, refused],
  );

  return (
    <section className="sbs" aria-label={t('reader.sideBySide')}>
      {notice ? (
        <p className="sbs-notice font-mono text-[10px]" role="status">
          <Languages className="w-3 h-3 inline mr-1" aria-hidden />
          {notice}
        </p>
      ) : null}

      <ol className="sbs-rows">
        {passages.map((text, i) => {
          const translated = translations.get(i);
          return (
            <li
              className={`sbs-row${i === index ? ' sbs-row--here' : ''}`}
              key={i}
              onFocus={() => onIndexChange?.(i)}
              tabIndex={-1}
            >
              <p className="sbs-source">{text}</p>
              <p className="sbs-target" lang={to}>
                {translated ?? (
                  /*
                   * The spinner appears only on the passage being read. A book of spinners while a
                   * window fills in the background is noise: the reader can only look at one.
                   */
                  i === index && waiting ? (
                    <span className="sbs-waiting">
                      <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                    </span>
                  ) : null
                )}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
