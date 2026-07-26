/**
 * Turns a document into narration chunks.
 *
 * This is the part that decides whether a listened-to research paper is bearable. Dumping
 * extracted text at a synthesiser reads reference lists aloud, says "open paren Smith et al
 * comma 2019 close paren" mid-sentence, and announces every markdown hash. None of that is the
 * synthesiser's fault, and no amount of voice quality fixes it.
 *
 * Deliberately engine-agnostic: Kokoro, the platform's own TTS, or anything else consumes the
 * same chunks. Deliberately pure, so the rules are testable without audio.
 */

export interface NarrationChunk {
  /** Text to speak. Already stripped of markup and citation noise. */
  text: string;
  /** Nearest preceding heading — becomes a chapter marker for resume and seeking. */
  section: string;
  /** True for a heading itself, so a reader can pause or announce it differently. */
  isHeading: boolean;
}

export interface NarrationOptions {
  /**
   * Neural TTS models have a hard context window (Kokoro's is ~510 tokens). Chunks are split
   * at sentence boundaries below this so no chunk is silently truncated mid-thought.
   */
  maxChars?: number;
  /** Read "(Smith et al., 2019)" aloud. Off by default — it wrecks sentence flow. */
  keepInlineCitations?: boolean;
  /** Read the reference list. Off by default — it is minutes of unlistenable strings. */
  keepReferences?: boolean;
}

const DEFAULT_MAX_CHARS = 600;

/** Headings that mark the point where a paper stops being prose. */
const REFERENCE_HEADING =
  /^(references|bibliography|works cited|citations|footnotes|endnotes)\b/i;

/*
 * "(Smith et al., 2019)", "(see Jones 2020)", "[12]", "[1,2,3]" — noise when spoken.
 *
 * Matches a short parenthetical that starts with a capital (or "see") and ends in a year.
 * Requiring the capital is what keeps ordinary prose like "(published in 2019)" intact; an
 * earlier attempt enumerated "et al."/"and" forms and missed the commonest shape of all.
 */
const INLINE_CITATION = /\s*(\((?:see\s+)?[A-Z][^()]{0,60}?\d{4}[a-z]?\)|\[\d+(?:\s*[,–-]\s*\d+)*\])/g;

function stripMarkdown(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // Keep link text, drop the URL — nobody wants an https read out character by character.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .trim();
}

/** Split on sentence ends, keeping the terminator so prosody survives. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function packSentences(sentences: string[], maxChars: number): string[] {
  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    // A single sentence over the limit still has to go somewhere; better one long chunk than
    // a hard cut mid-clause.
    if (!current) {
      current = sentence;
    } else if (`${current} ${sentence}`.length <= maxChars) {
      current = `${current} ${sentence}`;
    } else {
      out.push(current);
      current = sentence;
    }
  }
  if (current) out.push(current);
  return out;
}

export function documentToNarration(
  markdown: string,
  options: NarrationOptions = {},
): NarrationChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const chunks: NarrationChunk[] = [];
  let section = '';
  let inReferences = false;
  let inCodeFence = false;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    let text = paragraph.join(' ').replace(/\s+/g, ' ').trim();
    paragraph = [];
    if (!options.keepInlineCitations) text = text.replace(INLINE_CITATION, '');
    text = text.replace(/\s+([.,;:])/g, '$1').replace(/\s+/g, ' ').trim();
    if (!text) return;
    for (const piece of packSentences(splitSentences(text), maxChars)) {
      chunks.push({ text: piece, section, isHeading: false });
    }
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();

    // Code blocks are not narration. Read aloud they are pure noise.
    if (/^```/.test(line)) {
      if (!inCodeFence) flushParagraph();
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      const title = stripMarkdown(heading[2]!);
      inReferences = REFERENCE_HEADING.test(title) && !options.keepReferences;
      if (inReferences) continue;
      section = title;
      if (title) chunks.push({ text: title, section: title, isHeading: true });
      continue;
    }

    if (inReferences) continue;

    if (!line) {
      flushParagraph();
      continue;
    }

    // Horizontal rules and table pipes carry no spoken meaning.
    if (/^([-*_]\s*){3,}$/.test(line)) {
      flushParagraph();
      continue;
    }
    if (/^\|.*\|$/.test(line)) continue;

    const cleaned = stripMarkdown(line);
    if (cleaned) paragraph.push(cleaned);
  }

  flushParagraph();
  return chunks;
}

/** Rough listening time, for showing a duration before synthesis has run. */
export function estimateNarrationSeconds(chunks: NarrationChunk[], wordsPerMinute = 155): number {
  const words = chunks.reduce((n, c) => n + c.text.split(/\s+/).filter(Boolean).length, 0);
  return Math.round((words / wordsPerMinute) * 60);
}
