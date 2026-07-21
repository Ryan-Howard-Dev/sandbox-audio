import React from 'react';
import type { SearchHistoryEntry } from '../searchHistory';
import { displayTrackTitle } from '../displaySanitize';

function ExplicitBadge() {
  return (
    <span className="font-mono text-[8px] px-1 py-0.5 rounded border border-[var(--border)] text-[var(--text-dim)] uppercase shrink-0">
      E
    </span>
  );
}

export function recentSearchPrimaryLabel(entry: SearchHistoryEntry): string {
  switch (entry.kind) {
    case 'query':
      return entry.query;
    case 'artist':
      return entry.name;
    case 'album':
      return entry.title;
    case 'track':
      return displayTrackTitle(entry.title);
    default:
      return '';
  }
}

export function RecentSearchRowBody({
  entry,
  query,
  highlight,
}: {
  entry: SearchHistoryEntry;
  query: string;
  highlight?: (text: string, query: string) => React.ReactNode;
}) {
  const hl = highlight ?? ((text: string) => text);
  const primary = recentSearchPrimaryLabel(entry);

  if (entry.kind === 'album') {
    return (
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="search-recent-title truncate">{hl(primary, query)}</p>
          {entry.explicit ? <ExplicitBadge /> : null}
        </div>
        <p className="search-recent-meta truncate">
          Album by {entry.artist}
          {entry.releaseYear ? ` · ${entry.releaseYear}` : ''}
        </p>
      </div>
    );
  }

  if (entry.kind === 'track') {
    return (
      <div className="min-w-0 flex-1">
        <p className="search-recent-title truncate">{hl(primary, query)}</p>
        <p className="search-recent-meta truncate">Track · {entry.artist}</p>
      </div>
    );
  }

  if (entry.kind === 'artist') {
    return (
      <div className="min-w-0 flex-1">
        <p className="search-recent-title truncate">{hl(primary, query)}</p>
        <p className="search-recent-meta">Artist</p>
      </div>
    );
  }

  return (
    <span className="search-recent-title truncate flex-1 text-left">{hl(primary, query)}</span>
  );
}
