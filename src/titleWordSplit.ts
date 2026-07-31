/**
 * Put the spaces back into run-together titles.
 *
 * Files arrive named "ThescaredMusroom" or "the_hobbit_part2", and a shelf full of those is
 * unreadable and unsearchable. Two different things have gone wrong in that example and only one
 * of them is fixable here: the missing spaces are recoverable, the missing 'h' in "Musroom" is
 * not. This splits words; it does not correct spelling. Guessing at a typo risks renaming a book
 * to something its author never wrote.
 *
 * The safety rule throughout: a run is only split when it resolves *completely* into known words.
 * A partial match means we do not understand the string, and half-splitting a name — "Thescared"
 * into "The scare d" — is worse than leaving it alone. Unknown stays untouched.
 */

/*
 * A deliberately small, curated vocabulary rather than a real dictionary.
 *
 * Book titles are mostly function words plus a handful of common nouns, and those are exactly
 * what get swallowed at the front of a run-together name ("Thescared", "Alostboy"). A full
 * wordlist would add hundreds of kilobytes to a mobile bundle to buy very little, and would make
 * over-splitting *more* likely, not less: the more obscure words it knows, the more ways it can
 * carve up a proper noun that should have been left whole.
 */
const COMMON_WORDS = [
  // Articles, conjunctions, prepositions — the ones that actually cause this.
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet',
  'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'without',
  'into', 'onto', 'over', 'under', 'above', 'below', 'between', 'through',
  'after', 'before', 'during', 'against', 'across', 'behind', 'beyond',
  'up', 'down', 'out', 'off', 'about', 'around', 'near', 'past', 'upon',
  // Pronouns and common verbs.
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'they', 'them', 'their', 'who', 'whom', 'whose',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did',
  'has', 'have', 'had', 'will', 'would', 'can', 'could', 'shall', 'should',
  'may', 'might', 'must', 'not', 'no', 'all', 'any', 'some', 'every', 'each',
  'this', 'that', 'these', 'those', 'there', 'here', 'when', 'where', 'why', 'how',
  // Nouns and adjectives that turn up in titles often enough to matter.
  'book', 'books', 'part', 'parts', 'volume', 'chapter', 'story', 'stories',
  'tale', 'tales', 'saga', 'series', 'novel', 'guide', 'diary', 'journal',
  'man', 'men', 'woman', 'women', 'boy', 'boys', 'girl', 'girls', 'child', 'children',
  'king', 'queen', 'lord', 'lady', 'prince', 'princess', 'god', 'gods',
  'day', 'days', 'night', 'nights', 'year', 'years', 'time', 'times',
  'life', 'death', 'dead', 'living', 'love', 'war', 'wars', 'peace',
  'house', 'home', 'city', 'town', 'world', 'worlds', 'earth', 'sea', 'ocean',
  'river', 'mountain', 'forest', 'wood', 'woods', 'tree', 'garden', 'island',
  'road', 'path', 'way', 'door', 'key', 'gate', 'bridge', 'tower', 'castle',
  'fire', 'water', 'wind', 'storm', 'rain', 'snow', 'ice', 'sun', 'moon', 'star', 'stars',
  'light', 'dark', 'darkness', 'shadow', 'shadows', 'dream', 'dreams',
  'blood', 'bone', 'bones', 'heart', 'hand', 'hands', 'eye', 'eyes', 'head',
  'black', 'white', 'red', 'blue', 'green', 'grey', 'gray', 'golden', 'silver',
  'last', 'first', 'second', 'third', 'final', 'lost', 'found', 'hidden', 'secret',
  'great', 'little', 'big', 'small', 'long', 'short', 'old', 'new', 'young',
  'good', 'bad', 'evil', 'true', 'false', 'real', 'strange', 'wild', 'silent',
  'scared', 'afraid', 'brave', 'broken', 'burning', 'falling', 'rising',
  'mushroom', 'mushrooms', 'dragon', 'dragons', 'witch', 'wizard', 'ghost', 'ghosts',
  'murder', 'mystery', 'secrets', 'thief', 'hunter', 'soldier', 'sister', 'brother',
  'mother', 'father', 'son', 'daughter', 'friend', 'enemy', 'stranger',
  'rise', 'fall', 'return', 'journey', 'quest', 'adventure', 'escape', 'end',
];

const WORDS = new Set(COMMON_WORDS);

/** Single letters that are real words; every other one-letter split is a parsing accident. */
const SINGLE_LETTER_WORDS = new Set(['a', 'i']);

function isWord(candidate: string): boolean {
  if (!candidate) return false;
  if (candidate.length === 1) return SINGLE_LETTER_WORDS.has(candidate);
  return WORDS.has(candidate);
}

/**
 * Split a run of letters into known words, or return null.
 *
 * Fewest-words-wins, so "theend" prefers "the end" over any longer carve-up. Null means the run
 * was not fully understood, and the caller must leave the original alone.
 */
export function splitConcatenatedWords(run: string): string[] | null {
  const lower = (run ?? '').toLowerCase();
  if (!lower || !/^[a-z]+$/.test(lower)) return null;
  // Already a word on its own — nothing to do, and splitting would only invent structure.
  if (isWord(lower)) return null;

  // best[i] = fewest-word split of lower.slice(0, i), or null if that prefix is not coverable.
  const best: (string[] | null)[] = new Array(lower.length + 1).fill(null);
  best[0] = [];
  for (let end = 1; end <= lower.length; end++) {
    for (let start = 0; start < end; start++) {
      const prefix = best[start];
      if (!prefix) continue;
      const candidate = lower.slice(start, end);
      if (!isWord(candidate)) continue;
      const combined = [...prefix, candidate];
      if (!best[end] || combined.length < best[end]!.length) best[end] = combined;
    }
  }

  const full = best[lower.length];
  // A single-word "split" is just the original back; two or more is the only useful answer.
  return full && full.length > 1 ? full : null;
}

/** Restore the original run's capitalisation shape across the split pieces. */
function recase(original: string, pieces: string[]): string[] {
  const leadUpper = /^[A-Z]/.test(original);
  return pieces.map((piece, index) =>
    index === 0 && leadUpper ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece,
  );
}

/**
 * Insert spaces at camelCase boundaries.
 *
 * "ThescaredMusroom" -> "Thescared Musroom", "XMLHttpBook" -> "XML Http Book". Handled before the
 * dictionary pass because it is unambiguous: an author wrote that capital deliberately, whereas
 * the dictionary is guessing.
 */
export function splitCamelCase(token: string): string {
  return (token ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-zA-Z])/g, '$1 $2');
}

/**
 * Put the spaces back into a title.
 *
 * Camel boundaries first, then a dictionary pass over anything still run together. Tokens that
 * are not fully understood survive exactly as they arrived — "Musroom" stays "Musroom", because
 * this is not a spell checker.
 */
export function splitTitleWords(title: string): string {
  const raw = (title ?? '').trim();
  if (!raw) return '';
  // Nothing to recover from a title that already has spaces in sensible places.
  if (/\s/.test(raw) && !/[a-z][A-Z]/.test(raw)) return raw;

  const out: string[] = [];
  for (const token of splitCamelCase(raw).split(/\s+/).filter(Boolean)) {
    // Long enough to plausibly be several words, and short enough that a bad guess is cheap.
    if (/^[A-Za-z]{4,24}$/.test(token)) {
      const pieces = splitConcatenatedWords(token);
      if (pieces) {
        out.push(...recase(token, pieces));
        continue;
      }
    }
    out.push(token);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}
