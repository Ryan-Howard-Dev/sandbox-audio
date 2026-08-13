/**
 * The local translation engine: opus-mt models, run through ONNX, on this device.
 *
 * ONNX rather than Bergamot's WASM, for a reason specific to this app: sherpa-onnx and onnxruntime
 * are already in the build for the Piper voices, with a settled way of shipping models and an entry
 * in the attributions. Adding Bergamot would mean a second inference runtime and a WASM binary
 * whose npm package has not been touched since October 2022 — a stale dependency shipping compiled
 * code, for a job the runtime already present can do.
 *
 * Same models either way. Bergamot runs quantised Marian; these are the same opus-mt Marian models
 * converted to ONNX, so the translation quality argument is unchanged and only the runtime differs.
 *
 * Size is the thing to be honest about. A pair is roughly 110 MB — an encoder, a merged decoder and
 * a tokenizer — which is why pairs are opt-in, one at a time, with the number shown first. Nobody
 * should discover that figure after agreeing to it.
 */

import type {
  LanguageCode,
  LanguagePair,
  TranslationEngine,
  TranslationRequest,
} from './translationProvider';
import { languagePair, normalizeLanguage } from './translationProvider';

/**
 * The pairs published as ONNX conversions of opus-mt.
 *
 * Listed rather than discovered so the app can say "there is no pack for that" without a network
 * round trip, and so an offline device still answers truthfully about what could exist.
 *
 * Wider than Bergamot's set, and in a way that matters: it has direct pairs that do not pass
 * through English at all — de-fr, es-it, ru-uk — so a French reader of a German book gets one
 * translation rather than two stacked on each other.
 */
export const OPUS_MT_PAIRS: LanguagePair[] = [
  'af-en', 'ar-en', 'cs-en', 'da-de', 'da-en', 'de-en', 'de-es', 'de-fr',
  'en-af', 'en-ar', 'en-cs', 'en-da', 'en-de', 'en-es', 'en-fi', 'en-fr',
  'en-hi', 'en-hu', 'en-id', 'en-it', 'en-nl', 'en-ro', 'en-ru', 'en-sv',
  'en-uk', 'en-vi', 'en-zh', 'es-de', 'es-en', 'es-fr', 'es-it', 'es-ru',
  'et-en', 'fi-de', 'fi-en', 'fr-de', 'fr-en', 'fr-es', 'fr-ro', 'fr-ru',
  'hi-en', 'hu-en', 'id-en', 'it-en', 'it-es', 'it-fr', 'ja-en', 'ko-en',
  'nl-en', 'nl-fr', 'pl-en', 'ro-fr', 'ru-en', 'ru-es', 'ru-fr', 'ru-uk',
  'sv-en', 'th-en', 'tr-en', 'uk-en', 'uk-ru', 'vi-en', 'zh-en',
] as LanguagePair[];

/** Where a pair's model lives, for a downloader that needs a real name. */
export function modelRepoForPair(pair: LanguagePair): string {
  return `Xenova/opus-mt-${pair}`;
}

/**
 * The files a pair needs, and nothing more.
 *
 * The repositories also carry unquantised weights and a separate non-merged decoder. Fetching those
 * would roughly triple the download for no benefit: the merged decoder does the job of the other
 * two, and the quantised weights are what runs on a phone.
 */
export const MODEL_FILES = [
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
  'tokenizer.json',
  'tokenizer_config.json',
  'config.json',
  'generation_config.json',
] as const;

/**
 * Roughly what one pair weighs, measured rather than estimated.
 *
 * en-fr is 48 MB of encoder, 55 MB of merged decoder and about 6 MB of tokenizer. Pairs vary by a
 * few percent; this is the number to show somebody before they agree to a download, and it is five
 * times what a Bergamot pack would have been.
 */
export const APPROX_PAIR_BYTES = 110 * 1024 * 1024;

export const TRANSLATION_MODELS_KEY = 'sandbox_translation_models_v1';

/** What the runtime has to provide. Injected so all of this is testable without loading a model. */
export interface TranslationRuntime {
  /** Load a pair's model into memory. Rejects when the files are not on the device. */
  load(pair: LanguagePair): Promise<void>;
  /** Translate a batch. Must return one output per input, in order. */
  translate(pair: LanguagePair, texts: readonly string[]): Promise<string[]>;
}

export interface EngineOptions {
  /** Supplies the runtime on first use, so nothing is loaded until a translation is asked for. */
  loadRuntime: () => Promise<TranslationRuntime>;
  /** Pairs whose models are on the device. Defaults to what the install record says. */
  readInstalled?: () => LanguagePair[];
}

export function loadInstalledPairs(): LanguagePair[] {
  try {
    const raw = localStorage.getItem(TRANSLATION_MODELS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    // Validated against the published list, so a hand-edited pref cannot make the app promise a
    // pair that has no model behind it.
    return parsed.filter(
      (value): value is LanguagePair =>
        typeof value === 'string' && OPUS_MT_PAIRS.includes(value as LanguagePair),
    );
  } catch {
    return [];
  }
}

export function saveInstalledPairs(pairs: readonly LanguagePair[]): void {
  try {
    localStorage.setItem(TRANSLATION_MODELS_KEY, JSON.stringify([...new Set(pairs)]));
  } catch {
    /* A lost record means a pair looks uninstalled and is offered again, not a crash. */
  }
}

/**
 * Which pairs can get a document out of this language.
 *
 * Direct only. Pivoting — fr to en to de — is how a machine translation becomes a translation of a
 * translation, and the second hop compounds the first one's mistakes into sentences that read
 * fluently and say something else.
 */
export function pairsForLanguage(from: LanguageCode): LanguagePair[] {
  const source = normalizeLanguage(from);
  if (!source) return [];
  return OPUS_MT_PAIRS.filter((pair) => pair.startsWith(`${source}-`));
}

/** The languages a document in this language could be shown in. */
export function targetsForLanguage(from: LanguageCode): LanguageCode[] {
  return pairsForLanguage(from).map((pair) => pair.split('-')[1]);
}

export function createTranslationEngine(options: EngineOptions): TranslationEngine {
  let runtime: TranslationRuntime | null = null;
  const loaded = new Set<LanguagePair>();

  async function ensureRuntime(): Promise<TranslationRuntime> {
    if (!runtime) runtime = await options.loadRuntime();
    return runtime;
  }

  return {
    id: 'opus-mt-onnx',

    async supportedPairs(): Promise<LanguagePair[]> {
      return [...OPUS_MT_PAIRS];
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
       * A heading gap or a stray empty paragraph is nothing to translate, and a sequence model
       * given an empty input will happily generate a sentence — which then appears beside a blank
       * original as text the book does not contain.
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
