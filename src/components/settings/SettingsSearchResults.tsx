import React, { useMemo } from 'react';
import SettingsGroup from './SettingsGroup';
import SettingsRow from './SettingsRow';
import type { SettingsSearchItem } from './settingsSearchIndex';

export interface SettingsSearchResultsProps {
  items: SettingsSearchItem[];
  emptyLabel: string;
  onSelect: (item: SettingsSearchItem) => void;
}

export default function SettingsSearchResults({
  items,
  emptyLabel,
  onSelect,
}: SettingsSearchResultsProps) {
  const grouped = useMemo(() => {
    const map = new Map<string, SettingsSearchItem[]>();
    for (const item of items) {
      const list = map.get(item.categoryId) ?? [];
      list.push(item);
      map.set(item.categoryId, list);
    }
    return map;
  }, [items]);

  if (items.length === 0) {
    return (
      <p className="settings-search-empty" role="status">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div className="settings-search-results">
      {[...grouped.entries()].map(([categoryId, categoryItems]) => (
        <div key={categoryId} className="settings-search-group-wrap">
          <SettingsGroup title={categoryItems[0]?.categoryLabel ?? categoryId}>
            {categoryItems.map((item) => (
              <div key={item.id} role="presentation">
                <SettingsRow
                  title={item.title}
                  subtitle={item.subtitle ?? item.sectionLabel}
                  onClick={() => onSelect(item)}
                />
              </div>
            ))}
          </SettingsGroup>
        </div>
      ))}
    </div>
  );
}
