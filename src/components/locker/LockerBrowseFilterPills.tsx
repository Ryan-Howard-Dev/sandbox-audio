import React from 'react';
import type { LockerBrowseFilterId } from './lockerBrowseFilters';
import { LOCKER_BROWSE_FILTERS } from './lockerBrowseFilters';

export interface LockerBrowseFilterPillsProps {
  active: LockerBrowseFilterId;
  onChange: (id: LockerBrowseFilterId) => void;
  labelFor: (id: LockerBrowseFilterId) => string;
  /** Hide artist pill when browsing videos, etc. */
  hiddenFilters?: LockerBrowseFilterId[];
  ariaLabel: string;
}

/** Horizontal browse filters — Spotify “Your Library” style. */
export default function LockerBrowseFilterPills({
  active,
  onChange,
  labelFor,
  hiddenFilters = [],
  ariaLabel,
}: LockerBrowseFilterPillsProps) {
  const hidden = new Set(hiddenFilters);
  const filters = LOCKER_BROWSE_FILTERS.filter((id) => !hidden.has(id));

  return (
    <nav className="locker-browse-filters" aria-label={ariaLabel}>
      {filters.map((id) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            type="button"
            className={`locker-browse-filter-pill touch-manipulation${
              isActive ? ' locker-browse-filter-pill--active' : ''
            }`}
            aria-current={isActive ? 'true' : undefined}
            onClick={() => onChange(id)}
          >
            {labelFor(id)}
          </button>
        );
      })}
    </nav>
  );
}
