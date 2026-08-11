/**
 * Turning a passage into the same passage in another language, without telling anybody about it.
 *
 * The shape is deliberately the one barcodeRelease uses: a small pure surface, an injected engine,
 * and a result union whose failures are kept apart because they ask different things of the person
 * reading. "No model for that pair", "the model is not downloaded yet" and "the engine broke" are
 * three different sentences — install something, wait, or try again — and collapsing them into null
 * tells a reader none of it.
 *
 * On-device only, by design. The obvious way to build this is to post the text to a free web
 * translation endpoint, and that is what the app it is modelled on does; it is also why that app
 * cannot ship on a phone, and it means every book somebody reads goes through a third party a
 * sentence at a time. A local model is slower to set up once and then answers forever, offline,
 * with nothing leaving the device.
 */

/** A language, as the models name them: 'en', 'fr', 'de'. Not a locale — 'en-GB' has no model. */
export type LanguageCode = string;

/** The two-language key a model is published under. */
export type LanguagePair = `${string}-${string}`;

export function languagePair(from: LanguageCode, to: LanguageCode): LanguagePair {
  return `${normalizeLanguage(from)}-${normalizeLanguage(to)}` as LanguagePair;
}

/**
 * Reduce a locale to the language a model is published for.
 *
 * Documents carry whatever the EPUB declared, which is often 'en-GB' or 'pt_BR'. Models are
 * published per language, so a locale that is not reduced looks like an unsupported pair and the
 * reader is told to install something that does not exist.
 */
export function normalizeLanguage(code: string | undefined): LanguageCode {
  return (code ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .split('-')[0]
    .slice(0, 3);
}

export interface TranslationRequest {
  /** Passages, in order. Translated as a batch so an engine can amortise its setup. */
  texts: readonly string[];
  from: LanguageCode;
  to: LanguageCode;
}

export type TranslationResult =
  | { status: 'translated'; texts: string[] }
  /** Nothing was asked for, or everything asked for was blank. */
  | { status: 'empty' }
  /** Already in the target language. Not a failure, and not something to show a pane for. */
  | { status: 'sameLanguage' }
  /** A model exists for this pair and is not on the device yet. */
  | { status: 'modelMissing'; pair: LanguagePair }
  /** No model exists for this pair at all. Downloading will not help. */
  | { status: 'unsupported'; pair: LanguagePair }
  /** The engine was there and failed. Worth retrying, unlike the two above. */
  | { status: 'unavailable'; reason?: string };

/**
 * What a translation engine has to be able to do.
 *
 * Three methods, so a screen can say what is wrong before asking for anything: which pairs could
 * work, which are ready now, and then the translation itself.
 */
export interface TranslationEngine {
  readonly id: string;
  /** Pairs the engine has models published for, whether or not they are downloaded. */
  supportedPairs(): Promise<LanguagePair[]>;
  /** Pairs whose models are on this device and usable right now. */
  installedPairs(): Promise<LanguagePair[]>;
  translate(request: TranslationRequest): Promise<string[]>;
}

/**
 * Translate, with the answers a reader needs rather than an exception.
 *
 * The short circuits happen before the engine is consulted at all: an engine should never be woken
 * up, or a model loaded, to discover that the passage was blank or already in the right language.
 */
export async function translatePassages(
  request: TranslationRequest,
  engine: TranslationEngine | null,
): Promise<TranslationResult> {
  const from = normalizeLanguage(request.from);
  const to = normalizeLanguage(request.to);

  if (!from || !to) return { status: 'unavailable', reason: 'No language given' };
  if (from === to) return { status: 'sameLanguage' };
  if (request.texts.length === 0 || request.texts.every((t) => !t.trim())) {
    return { status: 'empty' };
  }
  if (!engine) return { status: 'unavailable', reason: 'No translation engine' };

  const pair = languagePair(from, to);

  try {
    const installed = await engine.installedPairs();
    if (!installed.includes(pair)) {
      const supported = await engine.supportedPairs();
      return supported.includes(pair)
        ? { status: 'modelMissing', pair }
        : { status: 'unsupported', pair };
    }

    const texts = await engine.translate({ texts: request.texts, from, to });

    /*
     * An engine returning a different number of passages has lost the alignment, and a pane that
     * pairs passage 4 with translation 5 is worse than one that says it could not translate: it is
     * wrong in a way that looks right.
     */
    if (texts.length !== request.texts.length) {
      return { status: 'unavailable', reason: 'Engine returned a different number of passages' };
    }
    return { status: 'translated', texts };
  } catch (err) {
    return {
      status: 'unavailable',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** One sentence per outcome, because each one asks something different of the reader. */
export function describeTranslationResult(result: TranslationResult): string | null {
  switch (result.status) {
    case 'translated':
    case 'empty':
      return null;
    case 'sameLanguage':
      // Not a problem, and saying nothing would leave a blank pane unexplained.
      return 'This is already in your language';
    case 'modelMissing':
      return `The ${result.pair} language pack is not installed yet`;
    case 'unsupported':
      return `There is no language pack for ${result.pair}`;
    case 'unavailable':
      return result.reason
        ? `Could not translate: ${result.reason}`
        : 'Could not translate just now';
  }
}

/** True where trying again might work. Distinguishes a broken engine from a missing model. */
export function isRetryable(result: TranslationResult): boolean {
  return result.status === 'unavailable';
}
