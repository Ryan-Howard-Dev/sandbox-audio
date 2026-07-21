import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

/** Gboard / Samsung Keyboard: predictive text + voice dictation on mobile WebView. */
export const imeTextInputProps = {
  inputMode: 'text',
  autoComplete: 'on',
  autoCorrect: 'on',
  autoCapitalize: 'sentences',
  spellCheck: true,
  lang: 'en',
} satisfies Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'inputMode' | 'autoComplete' | 'autoCorrect' | 'autoCapitalize' | 'spellCheck' | 'lang'
>;

/** Search fields — signals the IME to show suggestions + mic. */
export const imeSearchInputProps = {
  ...imeTextInputProps,
  autoComplete: 'search',
  role: 'searchbox',
} satisfies Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'inputMode' | 'autoComplete' | 'autoCorrect' | 'autoCapitalize' | 'spellCheck' | 'lang' | 'role'
>;

/** URL fields — use text inputMode so the keyboard keeps mic + suggestions. */
export const imeUrlInputProps = {
  inputMode: 'text',
  autoComplete: 'url',
  autoCorrect: 'off',
  autoCapitalize: 'none',
  spellCheck: false,
  lang: 'en',
} satisfies Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'inputMode' | 'autoComplete' | 'autoCorrect' | 'autoCapitalize' | 'spellCheck' | 'lang'
>;

export const imeTextareaProps = {
  ...imeTextInputProps,
} satisfies Pick<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'inputMode' | 'autoComplete' | 'autoCorrect' | 'autoCapitalize' | 'spellCheck' | 'lang'
>;
