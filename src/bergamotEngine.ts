/**
 * The local translation engine: Bergamot, on this device, offline.
 *
 * Bergamot is the engine Firefox uses for its offline translation. It is a WASM build of Marian
 * with small quantised models, roughly fifteen to forty megabytes per language pair, and once a
 * pair is on the device it answers forever with nothing leaving the machine.
 *
 * That size is the whole reason models are opt-in and per pair. Bundling every pair would be
 * hundreds of megabytes in an app most people will use in one language, and downloading silently
 * on first use would spend somebody's data without asking. So a pair is listed, chosen, and
 * fetched deliberately — the same shape as the wake-word model decision.
 *
 * What is here is the engine and its model bookkeeping. The runtime is loaded lazily and only when
 * a translation is actually asked for, so a session that never opens a book never pays for it.
 */

import type {
  LanguageCode,
  LanguagePair,
  TranslationEngine,
  TranslationRequest,
} from './translationProvider';
import { languagePair, normalizeLanguage } from './translationProvider';

/**
 * Pairs published for the small quantised models, as the Firefox set ships them.
 *
 * Listed rather than discovered so the app can say "there is no pack for that" without a network
 * round trip, and so an offline device still gives a truthful answer about what could exist.
 */
export const BERGAMOT_PAIRS: LanguagePair[] = [
  'en-fr', 'fr-en',
  'en-de', 'de-en',
  'en-es', 'es-en',
  'en-it', 'it-en',
  'en-pt', 'pt-en',
  'en-nl', 'nl-en',
  'en-pl', 'pl-en',
  'en-cs', 'cs-en',
  'en-ru', 'ru-en',
  'en-uk', 'uk-en',
  'en-bg', 'bg-en',
  'en-et', 'et-en',
  'en-fa', 'fa-en',
  'en-is', 'is-en',
  'en-nb', 'nb-en',
];

export const BERGAMOT_MODELS_KEY = 'sandbox_translation_models_v1';

/** What the runtime has to provide. Injected so everything here is testable without a WASM build. */
export interface BergamotRuntime {
  /** Load a pair's model into memory. Rejects when the files are not present. */
  load(pair: LanguagePair): Promise<void>;
  /** Translate a batch. Must return one output per input, in order. */
  translate(pair: LanguagePair, texts: readonly string[]): Promise<string[]>;
}

export interface BergamotOptions {
  /** Supplies the runtime on first use, so no WASM is loaded until a translation is asked for. */
  loadRuntime: () => Promise<BergamotRuntime>;
  /** Pairs whose model files are on the device. Defaults to what the install record says. */
  readInstalled?: () => LanguagePair[];
}

/** Pairs recorded as downloaded. Kept in prefs so the list survives a restart. */
export function loadInstalledPairs(): LanguagePair[] {
  try {
    const raw = localStorage.getItem(BERGAMOT_MODELS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    // Validated against the published list, so a hand-edited pref cannot make the app promise a
    // pair that has no model behind it.
    return parsed.filter(
      (value): value is LanguagePair =>
        typeof value === 'string' && BERGAMOT_PAIRS.includes(value as LanguagePair),
    );
  } catch {
    return [];
  }
}

export function saveInstalledPairs(pairs: readonly LanguagePair[]): void {
  try {
    localStorage.setItem(BERGAMOT_MODELS_KEY, JSON.stringify([...new Set(pairs)]));
  } catch {
    /* A lost record means a pair looks uninstalled and gets offered again, not a crash. */
  }
}

/**
 * Which pairs could get a document from one language to another.
 *
 * Direct only. Pivoting through English — fr to en to de — is how a machine translation becomes a
 * translation of a translation, and the second hop compounds the first one's mistakes into
 * sentences that read fluently and say something else.
 */
export function pairsForLanguage(from: LanguageCode): LanguagePair[] {
  const source = normalizeLanguage(from);
  if (!source) return [];
  return BERGAMOT_PAIRS.filter((pair) => pair.startsWith(`${source}-`));
}

/** The languages a document in this language could be shown in. */
export function targetsForLanguage(from: LanguageCode): LanguageCode[] {
  return pairsForLanguage(from).map((pair) => pair.split('-')[1]);
}

export function createBergamotEngine(options: BergamotOptions): TranslationEngine {
  let runtime: BergamotRuntime | null = null;
  const loaded = new Set<LanguagePair>();

  async function ensureRuntime(): Promise<BergamotRuntime> {
    if (!runtime) runtime = await options.loadRuntime();
    return runtime;
  }

  return {
    id: 'bergamot',

    async supportedPairs(): Promise<LanguagePair[]> {
      return [...BERGAMOT_PAIRS];
    },

    async installedPairs(): Promise<LanguagePair[]> {
      return (options.readInstalled ?? loadInstalledPairs)();
    },

    async translate(request: TranslationRequest): Promise<string[]> {
      const pair = languagePair(request.from, request.to);
      const engine = await ensureRuntime();

      if (!loaded.has(pair)) {
        await engine.load(pair);
        loaded.add(pair);
      }

      /*
       * Blank passages are kept out of the batch and put back afterwards.
       *
       * A heading gap or a stray empty paragraph is nothing to translate, and some models answer a
       * blank input with a hallucinated sentence — which then appears beside a blank original as
       * text the book does not contain.
       */
      const indices: number[] = [];
      const payload: string[] = [];
      request.texts.forEach((text, index) => {
        if (text.trim()) {
          indices.push(index);
          payload.push(text);
        }
      });

      if (payload.length === 0) return request.texts.map(() => '');

      const translated = await engine.translate(pair, payload);
      if (translated.length !== payload.length) {
        throw new Error('Engine returned a different number of passages');
      }

      const out = request.texts.map(() => '');
      indices.forEach((target, i) => {
        out[target] = translated[i];
      });
      return out;
    },
  };
}
