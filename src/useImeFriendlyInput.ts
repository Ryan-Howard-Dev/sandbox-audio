import {
  useCallback,
  useEffect,
  useRef,
  type ChangeEvent,
  type CompositionEvent,
  type FocusEvent,
  type FormEvent,
  type MutableRefObject,
  type Ref,
} from 'react';

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
    return;
  }
  (ref as MutableRefObject<T | null>).current = value;
}

/** Keeps controlled inputs compatible with Android IME (Gboard predictions + voice dictation). */
export function useImeFriendlyInput(
  value: string,
  setValue: (next: string) => void,
  externalRef?: Ref<HTMLInputElement | null>,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const focusedRef = useRef(false);

  const syncFromDom = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const next = el.value;
    setValue(next);
  }, [setValue]);

  const setInputRef = useCallback(
    (el: HTMLInputElement | null) => {
      inputRef.current = el;
      assignRef(externalRef, el);
    },
    [externalRef],
  );

  // Android voice dictation sometimes commits without a React change event.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const onNativeInput = () => syncFromDom();
    const onNativeChange = () => syncFromDom();
    el.addEventListener('input', onNativeInput);
    el.addEventListener('change', onNativeChange);
    return () => {
      el.removeEventListener('input', onNativeInput);
      el.removeEventListener('change', onNativeChange);
    };
  }, [syncFromDom]);

  // External clears (e.g. clear button) while the field is not focused.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || focusedRef.current) return;
    if (el.value !== value) {
      el.value = value;
    }
  }, [value]);

  const onFocus = useCallback((_event: FocusEvent<HTMLInputElement>) => {
    focusedRef.current = true;
  }, []);

  const onBlur = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      focusedRef.current = false;
      setValue(event.currentTarget.value);
    },
    [setValue],
  );

  const onCompositionStart = useCallback(() => {}, []);

  const onCompositionEnd = useCallback(
    (event: CompositionEvent<HTMLInputElement>) => {
      setValue(event.currentTarget.value);
    },
    [setValue],
  );

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setValue(event.target.value);
    },
    [setValue],
  );

  const onInput = useCallback(
    (event: FormEvent<HTMLInputElement>) => {
      setValue(event.currentTarget.value);
    },
    [setValue],
  );

  return {
    value,
    onChange,
    onInput,
    onFocus,
    onBlur,
    onCompositionStart,
    onCompositionEnd,
    setInputRef,
    inputRef,
  };
}
