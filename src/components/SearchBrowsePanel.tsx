import React from 'react';
import type { ExploreGroup } from '../exploreCatalog';
import {
  EXPLORE_GENRES,
  SEARCH_BROWSE_MOODS,
  SEARCH_BROWSE_DECADES,
  SEARCH_QUICK_FILTER_PODCASTS,
  SEARCH_QUICK_FILTER_VIDEOS,
  SEARCH_QUICK_FILTERS,
  type QuickBrowseFilter,
} from '../exploreBrowseData';

export interface SearchBrowsePanelProps {
  onPickCategory: (label: string, group: ExploreGroup) => void;
  onQuickFilter: (filter: QuickBrowseFilter) => void;
  podcastsEnabled?: boolean;
}

function BrowseSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="search-browse-section">
      <h3 className="search-browse-section-title">{title}</h3>
      {children}
    </section>
  );
}

function renderBrowseChip(label: string, onClick: () => void) {
  return (
    <button
      key={label}
      type="button"
      className="search-browse-chip touch-manipulation"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export default function SearchBrowsePanel({
  onPickCategory,
  onQuickFilter,
  podcastsEnabled = false,
}: SearchBrowsePanelProps) {
  const quickFilters = podcastsEnabled
    ? [...SEARCH_QUICK_FILTERS, SEARCH_QUICK_FILTER_VIDEOS, SEARCH_QUICK_FILTER_PODCASTS]
    : [...SEARCH_QUICK_FILTERS, SEARCH_QUICK_FILTER_VIDEOS];

  return (
    <div className="search-browse-panel" role="region" aria-label="Browse music">
      <BrowseSection title="Quick picks">
        <div className="search-browse-quick-row">
          {quickFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className="search-browse-quick-chip touch-manipulation"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onQuickFilter(filter)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </BrowseSection>

      <BrowseSection title="Genres">
        <div className="search-browse-chip-grid">
          {EXPLORE_GENRES.map((label) =>
            renderBrowseChip(label, () => onPickCategory(label, 'genre')),
          )}
        </div>
      </BrowseSection>

      <BrowseSection title="Moods & activities">
        <div className="search-browse-chip-row hide-scrollbar">
          {SEARCH_BROWSE_MOODS.map((label) =>
            renderBrowseChip(label, () => onPickCategory(label, 'mood')),
          )}
        </div>
      </BrowseSection>

      <BrowseSection title="Decades">
        <div className="search-browse-chip-row hide-scrollbar">
          {SEARCH_BROWSE_DECADES.map((label) =>
            renderBrowseChip(label, () => onPickCategory(label, 'decade')),
          )}
        </div>
      </BrowseSection>
    </div>
  );
}
