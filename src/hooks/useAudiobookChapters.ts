import { useEffect, useState } from 'react';
import { audiobookChaptersFor } from '../audiobookChapters';
import { mayCarryChapters } from '../audiobookChapterSource';
import type { ChapterMark } from '../chapterScrubber';

/**
 * The chapter table inside the audiobook that is playing, when it has one.
 *
 * A book shipped as one M4B is the case the chapter scrubber was written for and the one case it
 * could not serve: the player had no chapter marks for it, so a fourteen hour file got the plain
 * fourteen hour bar. The marks were always in the file.
 *
 * Empty for everything else — music, podcasts, books held as one file per chapter — because those
 * either have no chapter table or already play one chapter at a time.
 */
export function useAudiobookChapters(input: {
  /** Null when what is playing is not a single audiobook file. */
  envelopeId: string | null | undefined;
  url: string | null | undefined;
  mimeType?: string | null;
  title?: string | null;
  enabled: boolean;
}): ChapterMark[] {
  const { envelopeId, url, mimeType, title, enabled } = input;
  const [chapters, setChapters] = useState<ChapterMark[]>([]);

  useEffect(() => {
    /*
     * Cleared on every change of book, not merely on a successful read. Holding the previous
     * book's chapters while the next one is being walked would draw a bar scoped to a chapter of
     * something that is no longer playing, which is worse than the plain bar it replaces.
     */
    setChapters([]);
    if (!enabled) return;

    const id = envelopeId?.trim() ?? '';
    const uri = url?.trim() ?? '';
    if (!id && !uri) return;
    // Cheap containers test first: opening every MP3 to learn it is an MP3 costs a round trip per
    // book, and the answer is always no.
    if (!mayCarryChapters({ uri, mimeType: mimeType ?? undefined, name: title ?? undefined })) {
      return;
    }

    let cancelled = false;
    void audiobookChaptersFor({
      // The envelope id carries its prefix; the file it names does not.
      id: id.replace(/^audiobook:/, ''),
      uri,
    }).then((rows) => {
      if (!cancelled) setChapters(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [envelopeId, url, mimeType, title, enabled]);

  return chapters;
}
