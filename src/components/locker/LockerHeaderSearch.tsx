import React, { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { imeSearchInputProps } from '../../imeInputProps';

export interface LockerHeaderSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}

/** Real in-header search — filters the library grid in place (Spotify Your Library). */
export default function LockerHeaderSearch({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: LockerHeaderSearchProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (draft !== value) onChange(draft);
    }, 200);
    return () => window.clearTimeout(t);
  }, [draft, onChange, value]);

  return (
    <div className="locker-header-search">
      <Search className="locker-header-search-icon w-4 h-4 shrink-0" aria-hidden />
      <input
        {...imeSearchInputProps}
        type="text"
        className="locker-header-search-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        enterKeyHint="search"
      />
      {draft ? (
        <button
          type="button"
          className="locker-header-search-clear touch-manipulation"
          onClick={() => {
            setDraft('');
            onChange('');
          }}
          aria-label="Clear search"
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}
