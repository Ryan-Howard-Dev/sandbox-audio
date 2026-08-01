/**
 * Which of the four kinds of thing is playing, and what the player may show for it.
 *
 * The player was built for music and the others borrowed it, so a twelve-hour audiobook offered
 * shuffle, a news podcast offered repeat, and a document being read aloud offered both plus a
 * thumbs-down. None of those are merely unused: shuffling the chapters of a novel destroys the
 * thing you are listening to, and repeat on a daily podcast has no meaning to serve.
 *
 * Kept as data rather than as conditions inside the view. The view already carries an isPodcast
 * flag, and answering each new question with another boolean is what produced a component with
 * eleven guards in its class list. A table can be read, tested, and disagreed with; a chain of
 * ternaries in JSX cannot.
 */
import { isAnyAudiobookEnvelopeId } from './spokenWordPlayback';

export type MediaPillar = 'music' | 'podcast' | 'audiobook' | 'spoken-text';

const PODCAST_PREFIX = 'podcast:';

export function resolveMediaPillar(input: {
  envelopeId?: string | null;
  /** True while a book or document is being read aloud, which has no envelope at all. */
  narrating?: boolean;
}): MediaPillar {
  // Narration first: it has no envelope, so no envelope test could ever identify it.
  if (input.narrating) return 'spoken-text';
  const id = input.envelopeId?.trim() ?? '';
  if (id.startsWith(PODCAST_PREFIX)) return 'podcast';
  if (isAnyAudiobookEnvelopeId(id)) return 'audiobook';
  return 'music';
}

export interface PillarControls {
  /** Reordering is destructive to anything with a narrative. */
  shuffle: boolean;
  repeat: boolean;
  /** Rating a chapter of a novel or a passage of a document is not a thing anyone wants to do. */
  thumbs: boolean;
  /** False where there is no timeline to scrub, which is not the same as one that is merely long. */
  seekBar: boolean;
  /** Previous and next move between items, rather than seeking within one. */
  trackSkip: boolean;
  /** Previous and next seek by an interval, or by a passage where there are no seconds to seek. */
  intervalSkip: boolean;
  speedControl: boolean;
  queue: boolean;
  /** The spinning record. Music only; everything else gets its cover or a placeholder. */
  vinyl: boolean;
}

const MUSIC: PillarControls = {
  shuffle: true,
  repeat: true,
  thumbs: true,
  seekBar: true,
  trackSkip: true,
  intervalSkip: false,
  speedControl: false,
  queue: true,
  vinyl: true,
};

const PODCAST: PillarControls = {
  shuffle: false,
  repeat: false,
  // Kept for podcasts alone: a rating there feeds what gets recommended next.
  thumbs: true,
  seekBar: true,
  trackSkip: false,
  intervalSkip: true,
  speedControl: true,
  queue: true,
  vinyl: false,
};

const AUDIOBOOK: PillarControls = {
  shuffle: false,
  repeat: false,
  thumbs: false,
  seekBar: true,
  trackSkip: false,
  intervalSkip: true,
  speedControl: true,
  // One book at a time. A queue implies a next book, which is not how anyone reads.
  queue: false,
  vinyl: false,
};

const SPOKEN_TEXT: PillarControls = {
  shuffle: false,
  repeat: false,
  thumbs: false,
  /*
   * No seek bar at all.
   *
   * The engine decides how long a passage takes as it speaks it, so there is no duration until it
   * has been spoken. A bar drawn from an estimate is a bar that lies, and it invites a scrub that
   * cannot be honoured. Position belongs in pages, which the reader already counts.
   */
  seekBar: false,
  trackSkip: false,
  intervalSkip: true,
  speedControl: true,
  queue: false,
  vinyl: false,
};

const TABLE: Record<MediaPillar, PillarControls> = {
  music: MUSIC,
  podcast: PODCAST,
  audiobook: AUDIOBOOK,
  'spoken-text': SPOKEN_TEXT,
};

export function controlsForPillar(pillar: MediaPillar): PillarControls {
  return TABLE[pillar];
}
