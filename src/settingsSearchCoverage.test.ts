import { describe, expect, it } from 'vitest';
import { SETTINGS_SEARCH_ANCHORS } from './components/settings/settingsSearchAnchors';
import { buildSettingsSearchIndex } from './components/settings/settingsSearchIndex';

/**
 * Every settings section has to be findable by name.
 *
 * The failure this guards is small, silent and recurring: a control gets added, it renders, it
 * works, and it is never registered with the search — so it exists and nobody can find it. That is
 * how the library folder ended up with an anchor that was rendered, linked to from elsewhere in
 * settings, and absent from the index. There is no type that connects the two files, so nothing but
 * this notices.
 *
 * It is the same shape as the bug that gave the fourth listening format a row in the data and none
 * on screen: extending a model without extending the thing that consumes it.
 */

/** The index needs a translator; the keys themselves are what matters here, not the language. */
const t = (key: string) => key;

describe('settings search covers the settings', () => {
  it('indexes every anchor that exists', () => {
    const index = buildSettingsSearchIndex(t);
    const indexed = new Set(index.map((row) => row.anchorId).filter(Boolean));
    const missing = Object.entries(SETTINGS_SEARCH_ANCHORS)
      .filter(([, anchorId]) => !indexed.has(anchorId))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it('points every search result at an anchor that exists', () => {
    // The reverse failure: a result that scrolls to nothing, which reads as a dead tap.
    const anchors = new Set<string>(Object.values(SETTINGS_SEARCH_ANCHORS));
    const index = buildSettingsSearchIndex(t);
    const dangling = index
      .filter((row) => row.anchorId && !anchors.has(row.anchorId))
      .map((row) => row.id);
    expect(dangling).toEqual([]);
  });

  it('gives every entry a stable id and no duplicates', () => {
    const index = buildSettingsSearchIndex(t);
    const ids = index.map((row) => row.id);
    expect(ids.every((id) => id.trim().length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves every title through the locale rather than leaving one blank', () => {
    const index = buildSettingsSearchIndex(t);
    const blank = index.filter((row) => !row.title || !row.title.trim()).map((row) => row.id);
    expect(blank).toEqual([]);
  });
});
