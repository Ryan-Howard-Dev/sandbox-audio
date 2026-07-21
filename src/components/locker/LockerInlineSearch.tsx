import React from 'react';
import { Search } from 'lucide-react';

export interface LockerInlineSearchProps {
  placeholder: string;
  onActivate: () => void;
  ariaLabel: string;
}

/** Tap-to-search bar for mobile locker (opens full LockerSearchView). */
export default function LockerInlineSearch({
  placeholder,
  onActivate,
  ariaLabel,
}: LockerInlineSearchProps) {
  return (
    <button
      type="button"
      className="locker-inline-search touch-manipulation"
      onClick={onActivate}
      aria-label={ariaLabel}
    >
      <Search className="locker-inline-search-icon w-4 h-4 shrink-0" aria-hidden />
      <span className="locker-inline-search-placeholder">{placeholder}</span>
    </button>
  );
}
