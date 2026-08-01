import React, { useEffect, useRef } from 'react';

/**
 * The passage being read, with the spoken word marked as the engine reaches it.
 *
 * Android's TextToSpeech reports character offsets into the exact string it was handed, so this
 * takes that same string and slices it into three: what has been said, the word being said, and
 * what is still to come. No tokenising, no word counting, no guessing from elapsed time — the
 * engine is the only thing that knows where it actually is, and it is telling us.
 *
 * Offsets are treated as untrusted. An engine that normalises text before speaking ("Dr." →
 * "Doctor") can return an offset past the end of the original string, and a range that cannot be
 * trusted is dropped rather than allowed to mark the wrong word.
 */
export interface ReadAlongRange {
  start: number;
  end: number;
}

export default function ReadAlongText({
  text,
  range,
  ariaLabel,
}: {
  text: string;
  range: ReadAlongRange | null;
  ariaLabel?: string;
}) {
  const markRef = useRef<HTMLElement | null>(null);

  const valid =
    range !== null &&
    Number.isFinite(range.start) &&
    Number.isFinite(range.end) &&
    range.start >= 0 &&
    range.end > range.start &&
    range.end <= text.length;

  /*
   * Follow the reading rather than the scroll position. block: 'nearest' keeps a passage that
   * already fits entirely still — scrolling a paragraph that is fully visible is the kind of jitter
   * that makes a page unreadable.
   */
  useEffect(() => {
    if (!valid) return;
    markRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [valid, range?.start, range?.end]);

  if (!valid) {
    return (
      <p className="audiobook-readalong" aria-label={ariaLabel}>
        {text}
      </p>
    );
  }

  return (
    // aria-live is deliberately absent: a screen reader announcing every word over the top of the
    // narration would be unusable. The passage is one label, read once.
    <p className="audiobook-readalong" aria-label={ariaLabel}>
      <span className="audiobook-readalong-said">{text.slice(0, range!.start)}</span>
      <mark className="audiobook-readalong-word" ref={markRef}>
        {text.slice(range!.start, range!.end)}
      </mark>
      <span>{text.slice(range!.end)}</span>
    </p>
  );
}
