import { describe, expect, it } from 'vitest';
import {
  catalogAlbumVersionGroupKey,
  catalogAlbumVersionLabel,
  type CatalogAlbum,
} from './searchCatalog';

function mkAlbum(overrides: Partial<CatalogAlbum> = {}): CatalogAlbum {
  return {
    kind: 'album',
    id: 'album-1',
    title: 'The College Dropout',
    artist: 'Kanye West',
    releaseYear: '2004',
    ...overrides,
  };
}

describe('catalogAlbumVersionGroupKey', () => {
  it('groups plain and deluxe titles with the same base name', () => {
    const standard = mkAlbum({ title: 'DONDA', collectionId: 1 });
    const deluxe = mkAlbum({
      id: 'album-2',
      title: 'DONDA (Deluxe Edition)',
      collectionId: 2,
    });
    expect(catalogAlbumVersionGroupKey(standard)).toBe(
      catalogAlbumVersionGroupKey(deluxe),
    );
  });
});

describe('catalogAlbumVersionLabel', () => {
  const collegeDropoutExplicit = mkAlbum({
    id: 'album-explicit',
    contentRating: 'explicit',
    collectionId: 1440742908,
    trackCount: 21,
  });
  const collegeDropoutClean = mkAlbum({
    id: 'album-clean',
    contentRating: 'clean',
    collectionId: 1440742910,
    trackCount: 21,
  });
  const collegeDropoutContext = [collegeDropoutExplicit, collegeDropoutClean];

  it('labels explicit and clean editions that share the same title', () => {
    expect(
      catalogAlbumVersionLabel(collegeDropoutExplicit, collegeDropoutContext),
    ).toBe('Explicit');
    expect(
      catalogAlbumVersionLabel(collegeDropoutClean, collegeDropoutContext),
    ).toBe('Clean');
  });

  it('hides labels when no sibling editions appear in the grid', () => {
    expect(catalogAlbumVersionLabel(collegeDropoutExplicit)).toBe('Explicit');
    expect(
      catalogAlbumVersionLabel(collegeDropoutExplicit, [collegeDropoutExplicit]),
    ).toBeNull();
  });

  it('disambiguates DONDA explicit vs clean duplicates', () => {
    const dondaExplicit = mkAlbum({
      id: 'donda-e',
      title: 'DONDA',
      artist: 'Kanye West',
      releaseYear: '2021',
      contentRating: 'explicit',
      collectionId: 1584281467,
      trackCount: 27,
    });
    const dondaClean = mkAlbum({
      id: 'donda-c',
      title: 'DONDA',
      artist: 'Kanye West',
      releaseYear: '2021',
      contentRating: 'clean',
      collectionId: 1584281470,
      trackCount: 27,
    });
    const context = [dondaExplicit, dondaClean];

    expect(catalogAlbumVersionLabel(dondaExplicit, context)).toBe('Explicit');
    expect(catalogAlbumVersionLabel(dondaClean, context)).toBe('Clean');
  });

  it('shows track-count delta when siblings differ in length', () => {
    const standard = mkAlbum({
      id: 'album-standard',
      title: 'DONDA',
      trackCount: 27,
      contentRating: 'explicit',
      collectionId: 1,
    });
    const deluxe = mkAlbum({
      id: 'album-deluxe',
      title: 'DONDA (Deluxe Edition)',
      trackCount: 31,
      contentRating: 'explicit',
      collectionId: 2,
    });
    const context = [standard, deluxe];

    expect(catalogAlbumVersionLabel(standard, context)).toBe('27 tracks · Explicit');
    expect(catalogAlbumVersionLabel(deluxe, context)).toBe('31 tracks · Explicit');
  });

  it('falls back to Standard when siblings exist but metadata is missing', () => {
    const a = mkAlbum({ id: 'a', collectionId: 10, trackCount: 21 });
    const b = mkAlbum({ id: 'b', collectionId: 11, trackCount: 21 });
    expect(catalogAlbumVersionLabel(a, [a, b])).toBe('Standard');
    expect(catalogAlbumVersionLabel(b, [a, b])).toBe('Standard');
  });

  it('does not repeat deluxe in version label when sibling title differs', () => {
    const standard = mkAlbum({
      id: 'future-standard',
      title: 'FUTURE',
      artist: 'Future',
      releaseYear: '2017',
      collectionId: 1001,
    });
    const deluxe = mkAlbum({
      id: 'future-deluxe',
      title: 'FUTURE (Deluxe Edition)',
      artist: 'Future',
      releaseYear: '2017',
      collectionId: 1002,
    });
    const context = [standard, deluxe];

    expect(catalogAlbumVersionLabel(deluxe, context)).toBe('Standard');
    expect(catalogAlbumVersionLabel(standard, context)).toBe('Standard');
  });

  it('returns null when no edition signal exists and no siblings', () => {
    expect(catalogAlbumVersionLabel(mkAlbum())).toBeNull();
    expect(catalogAlbumVersionLabel(mkAlbum(), [mkAlbum()])).toBeNull();
  });
});
