import { describe, expect, it } from 'vitest';
import {
  calibreLibraryName,
  describeSkippedFormats,
  directoryPickerSupport,
  newCalibreBooks,
  pickedLibraryPaths,
  planCalibreLibraryFiles,
  type PickedLibraryFile,
} from './calibreImportPlan';
import { planCalibreImport } from './calibreLibrary';

/*
 * These cover the arithmetic a confirmation step shows before anything is written. A wrong count
 * here is how a 4,000-book library gets imported twice, so it is tested rather than eyeballed in a
 * component that has no test runner.
 */

function picked(paths: string[]): PickedLibraryFile[] {
  return paths.map((path) => ({
    name: path.slice(path.lastIndexOf('/') + 1),
    webkitRelativePath: path,
  }));
}

const library = picked([
  'Calibre Library/metadata.db',
  'Calibre Library/metadata_db_prefs_backup.json',
  'Calibre Library/A A Milne/The Red House Mystery (7)/The Red House Myst - A A Milne.epub',
  'Calibre Library/A A Milne/The Red House Mystery (7)/cover.jpg',
  'Calibre Library/A A Milne/The Red House Mystery (7)/metadata.opf',
  'Calibre Library/Denzel Curry/Melt My Eyez (12)/Melt My Eyez - Denzel Curry.epub',
  'Calibre Library/Herman Melville/Moby Dick (3)/Moby Dick - Herman Melville.mobi',
]);

describe('pickedLibraryPaths', () => {
  it('reads the path inside the picked folder, not the bare filename', () => {
    expect(pickedLibraryPaths(picked(['Lib/Author/Book (1)/Book.epub']))).toEqual([
      'Lib/Author/Book (1)/Book.epub',
    ]);
  });

  /*
   * Books deleted in Calibre stay in .caltrash as complete EPUBs. Without this filter an import
   * silently restores everything the user threw away.
   */
  it('drops .caltrash, so deleted books are not resurrected', () => {
    const paths = pickedLibraryPaths(
      picked([
        'Lib/.caltrash/Author/Gone (9)/Gone.epub',
        'Lib/Author/Kept (1)/Kept.epub',
      ]),
    );
    expect(paths).toEqual(['Lib/Author/Kept (1)/Kept.epub']);
  });

  it('drops Calibre’s database and prefs backup', () => {
    expect(pickedLibraryPaths(library).some((p) => /metadata\.db|prefs_backup/.test(p))).toBe(false);
  });

  it('ignores files a picker reports with no usable path', () => {
    expect(pickedLibraryPaths([{ name: '', webkitRelativePath: '' }])).toEqual([]);
  });
});

describe('calibreLibraryName', () => {
  it('names the folder that was picked', () => {
    expect(calibreLibraryName(['Calibre Library/Author/Book (1)/Book.epub'])).toBe(
      'Calibre Library',
    );
  });

  /* A loose file has no folder above it and must not be mistaken for the library's name. */
  it('skips single-segment paths', () => {
    expect(calibreLibraryName(['loose.epub', 'Lib/Author/Book (1)/x.epub'])).toBe('Lib');
  });

  it('returns nothing when there is no folder at all', () => {
    expect(calibreLibraryName(['loose.epub'])).toBe('');
  });
});

describe('planCalibreLibraryFiles', () => {
  it('reports what would be imported and what cannot be', () => {
    const plan = planCalibreLibraryFiles(library);
    expect(plan.libraryName).toBe('Calibre Library');
    expect(plan.books).toHaveLength(3);
    expect(plan.readable.map((b) => b.title)).toEqual(['The Red House Mystery', 'Melt My Eyez']);
    expect(plan.fresh).toHaveLength(2);
    expect(plan.duplicateCount).toBe(0);
    expect(plan.skipped).toEqual({ mobi: 1 });
    expect(plan.skippedCount).toBe(1);
  });

  it('carries the cover and opf beside each book through to the plan', () => {
    const plan = planCalibreLibraryFiles(library);
    const milne = plan.readable.find((b) => b.author === 'A A Milne');
    expect(milne?.coverPath).toBe(
      'Calibre Library/A A Milne/The Red House Mystery (7)/cover.jpg',
    );
    expect(milne?.opfPath).toContain('metadata.opf');
  });

  /*
   * Re-picking a library after adding a few books is the normal case, and it is the one that used
   * to double the shelf: only the new books count as fresh.
   */
  it('excludes books already on the shelf', () => {
    const plan = planCalibreLibraryFiles(library, [
      { calibreId: 7, name: 'The Red House Mystery', author: 'A A Milne' },
    ]);
    expect(plan.readable).toHaveLength(2);
    expect(plan.fresh.map((b) => b.title)).toEqual(['Melt My Eyez']);
    expect(plan.duplicateCount).toBe(1);
  });

  /*
   * A flat folder of EPUBs is not a Calibre library, and importing it anyway is the right outcome:
   * the folder-derived title is only ever a fallback, and the EPUB's own metadata wins at import.
   * Refusing would mean a picker that works on one folder layout and silently does nothing on the
   * other.
   */
  it('still imports a plain folder of EPUBs, titled from the file’s own metadata later', () => {
    const plan = planCalibreLibraryFiles(picked(['Downloads/book.epub']));
    expect(plan.fresh).toHaveLength(1);
    expect(plan.fresh[0]?.author).toBeUndefined();
  });

  /* Files with no folder above them cannot be placed in a library tree at all. */
  it('finds nothing in a listing of loose files', () => {
    const plan = planCalibreLibraryFiles([{ name: 'book.epub' }]);
    expect(plan.books).toEqual([]);
    expect(plan.fresh).toEqual([]);
  });
});

describe('newCalibreBooks', () => {
  const candidates = planCalibreImport([
    'Lib/Author/Book (1)/Book.epub',
    'Lib/Other/Untracked/Untracked.epub',
  ]);

  it('matches on Calibre’s id, so a renamed title is still recognised', () => {
    const fresh = newCalibreBooks(candidates, [
      { calibreId: 1, name: 'Renamed Entirely', author: 'Someone Else' },
    ]);
    expect(fresh.map((b) => b.title)).toEqual(['Untracked']);
  });

  /* A folder with no "(id)" has only its title and author to be recognised by. */
  it('falls back to title and author when there is no id', () => {
    const fresh = newCalibreBooks(candidates, [{ name: 'untracked', author: 'OTHER' }]);
    expect(fresh.map((b) => b.title)).toEqual(['Book']);
  });

  it('keeps everything when the shelf is empty', () => {
    expect(newCalibreBooks(candidates, [])).toHaveLength(2);
  });
});

describe('describeSkippedFormats', () => {
  it('lists the commonest skipped format first', () => {
    expect(describeSkippedFormats({ mobi: 1, pdf: 3, azw3: 3 })).toBe('azw3 (3), pdf (3), mobi (1)');
  });

  it('says nothing when nothing was skipped', () => {
    expect(describeSkippedFormats({})).toBe('');
  });
});

describe('directoryPickerSupport', () => {
  it('allows a folder picker where the attribute exists', () => {
    expect(directoryPickerSupport({ platform: 'web', hasWebkitDirectory: true })).toBe('supported');
    expect(directoryPickerSupport({ platform: 'tauri', hasWebkitDirectory: true })).toBe(
      'supported',
    );
  });

  /*
   * Android's document picker returns files stripped of the folders they came from, so a Calibre
   * plan built from them is always empty. Offering the control there ships a button that cannot
   * work, which is the failure this distinction exists to prevent.
   */
  it('refuses on mobile even though the attribute is present', () => {
    expect(directoryPickerSupport({ platform: 'android', hasWebkitDirectory: true })).toBe(
      'no-folder-picker-on-mobile',
    );
    expect(directoryPickerSupport({ platform: 'android-tv', hasWebkitDirectory: true })).toBe(
      'no-folder-picker-on-mobile',
    );
    expect(directoryPickerSupport({ platform: 'ios', hasWebkitDirectory: true })).toBe(
      'no-folder-picker-on-mobile',
    );
  });

  it('refuses an old browser with no directory support', () => {
    expect(directoryPickerSupport({ platform: 'web', hasWebkitDirectory: false })).toBe(
      'unsupported',
    );
  });
});
