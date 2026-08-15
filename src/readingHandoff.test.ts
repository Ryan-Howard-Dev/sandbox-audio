/**
 * The book handed from the shelf to the reader.
 *
 * Reading used to be an entry in More, so a book lived in Audiobooks while the way to read it
 * lived somewhere else. Tapping a book now offers Read beside Listen, and this carries which book
 * across that one navigation.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearDocumentToRead,
  setDocumentToRead,
  takeDocumentToRead,
} from './readingHandoff';

beforeEach(() => {
  clearDocumentToRead();
});

describe('readingHandoff', () => {
  it('hands over the book that was tapped', () => {
    setDocumentToRead('doc-42');
    expect(takeDocumentToRead()).toBe('doc-42');
  });

  it('is consumed once, so returning to the reader shows the shelf', () => {
    /*
     * Otherwise opening the reader a second time would silently reopen the last book, and there
     * would be no way back to the shelf without closing it first.
     */
    setDocumentToRead('doc-42');
    expect(takeDocumentToRead()).toBe('doc-42');
    expect(takeDocumentToRead()).toBeNull();
  });

  it('reports nothing on an ordinary visit', () => {
    expect(takeDocumentToRead()).toBeNull();
  });

  it('keeps only the most recent choice', () => {
    // Two taps before the reader mounts means the second one is the one that was meant.
    setDocumentToRead('doc-1');
    setDocumentToRead('doc-2');
    expect(takeDocumentToRead()).toBe('doc-2');
  });

  it('can be abandoned when the navigation is', () => {
    setDocumentToRead('doc-42');
    clearDocumentToRead();
    expect(takeDocumentToRead()).toBeNull();
  });
});
