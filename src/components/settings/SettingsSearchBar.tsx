import React, { type RefObject } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { useImeFriendlyInput } from '../../useImeFriendlyInput';
import { imeSearchInputProps } from '../../imeInputProps';

export interface SettingsSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

/** Settings search — same shell-search styling as the main app search bar. */
export default function SettingsSearchBar({
  value,
  onChange,
  placeholder,
  ariaLabel,
  inputRef,
  onKeyDown,
}: SettingsSearchBarProps) {
  const field = useImeFriendlyInput(value, onChange, inputRef);

  return (
    <label className="settings-search-form">
      <SearchIcon
        className="shell-search-icon settings-search-form-icon absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
        aria-hidden
      />
      <input
        ref={field.setInputRef}
        type="text"
        {...imeSearchInputProps}
        value={field.value}
        onChange={field.onChange}
        onInput={field.onInput}
        onCompositionStart={field.onCompositionStart}
        onCompositionEnd={field.onCompositionEnd}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="shell-search settings-search-input w-full h-10 pl-11 pr-4 rounded-lg font-mono text-xs tracking-wide"
        aria-label={ariaLabel ?? placeholder}
        enterKeyHint="search"
      />
    </label>
  );
}
