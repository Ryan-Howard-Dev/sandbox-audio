import { describe, expect, it } from 'vitest';
import {
  addToSelection,
  clearSelection,
  clickRow,
  EMPTY_SELECTION,
  invertSelection,
  moveSelection,
  pruneSelection,
  selectAll,
  selectAllState,
  selectedInOrder,
  selectionCount,
  type SelectionState,
} from './selectionModel';

const IDS = ['a', 'b', 'c', 'd', 'e', 'f'];

const chosen = (state: SelectionState) => selectedInOrder(state, IDS);

describe('a plain click', () => {
  it('selects one row and drops the rest', () => {
    let state = selectAll(IDS);
    state = clickRow(state, IDS, 'c');
    expect(chosen(state)).toEqual(['c']);
  });

  it('sets the anchor', () => {
    const state = clickRow(EMPTY_SELECTION, IDS, 'c');
    expect(state.anchor).toBe('c');
  });

  it('ignores a row that is not in the list', () => {
    const state = clickRow(EMPTY_SELECTION, IDS, 'zzz');
    expect(state).toBe(EMPTY_SELECTION);
  });
});

describe('ctrl click', () => {
  it('adds without disturbing what is chosen', () => {
    let state = clickRow(EMPTY_SELECTION, IDS, 'b');
    state = clickRow(state, IDS, 'd', { toggle: true });
    expect(chosen(state)).toEqual(['b', 'd']);
  });

  it('removes a row that was already chosen', () => {
    let state = selectAll(IDS);
    state = clickRow(state, IDS, 'c', { toggle: true });
    expect(chosen(state)).not.toContain('c');
    expect(selectionCount(state)).toBe(5);
  });

  it('moves the anchor even when it deselects', () => {
    // A following shift-click measures from the last row touched, whichever way it went.
    let state = selectAll(IDS);
    state = clickRow(state, IDS, 'c', { toggle: true });
    expect(state.anchor).toBe('c');
  });
});

describe('shift click', () => {
  it('selects the span between the anchor and here', () => {
    let state = clickRow(EMPTY_SELECTION, IDS, 'b');
    state = clickRow(state, IDS, 'e', { range: true });
    expect(chosen(state)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('works backwards', () => {
    let state = clickRow(EMPTY_SELECTION, IDS, 'e');
    state = clickRow(state, IDS, 'b', { range: true });
    expect(chosen(state)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('resizes the range rather than walking it', () => {
    /*
     * The mistake everybody makes. If the anchor moved to the end of the last range, a second
     * shift-click would select from there instead of from where the user started, silently
     * abandoning half of what they had.
     */
    let state = clickRow(EMPTY_SELECTION, IDS, 'b');
    state = clickRow(state, IDS, 'e', { range: true });
    state = clickRow(state, IDS, 'c', { range: true });
    expect(chosen(state)).toEqual(['b', 'c']);
    expect(state.anchor).toBe('b');
  });

  it('replaces the previous selection by default', () => {
    let state = clickRow(EMPTY_SELECTION, IDS, 'a');
    state = clickRow(state, IDS, 'f', { toggle: true });
    state = clickRow(state, IDS, 'c', { range: true });
    // Anchor is f from the ctrl-click, so the span is c..f and the lone 'a' is dropped.
    expect(chosen(state)).toEqual(['c', 'd', 'e', 'f']);
  });

  it('adds the range to what is chosen when ctrl is held too', () => {
    // How somebody picks two separate runs of tracks.
    let state = clickRow(EMPTY_SELECTION, IDS, 'a');
    state = clickRow(state, IDS, 'b', { range: true, toggle: true });
    state = clickRow(state, IDS, 'e', { toggle: true });
    state = clickRow(state, IDS, 'f', { range: true, toggle: true });
    expect(chosen(state)).toEqual(['a', 'b', 'e', 'f']);
  });

  it('behaves like a plain click when there is no anchor', () => {
    const state = clickRow(EMPTY_SELECTION, IDS, 'c', { range: true });
    expect(chosen(state)).toEqual(['c']);
  });

  it('behaves like a plain click when the anchor has left the list', () => {
    // Extending from a row that is no longer there would select an arbitrary span.
    const stale: SelectionState = { selected: new Set(['x']), anchor: 'x' };
    const state = clickRow(stale, IDS, 'c', { range: true });
    expect(chosen(state)).toEqual(['c']);
  });
});

describe('selectedInOrder', () => {
  it('returns list order, not click order', () => {
    /*
     * A Set iterates in insertion order. An operation applied in click order renames files in
     * whatever sequence somebody happened to tick them, which is not the order the preview showed.
     */
    let state = clickRow(EMPTY_SELECTION, IDS, 'e');
    state = clickRow(state, IDS, 'a', { toggle: true });
    state = clickRow(state, IDS, 'c', { toggle: true });
    expect(chosen(state)).toEqual(['a', 'c', 'e']);
  });
});

describe('bulk operations', () => {
  it('selects everything', () => {
    expect(chosen(selectAll(IDS))).toEqual(IDS);
  });

  it('clears', () => {
    expect(selectionCount(clearSelection())).toBe(0);
  });

  it('inverts', () => {
    let state = clickRow(EMPTY_SELECTION, IDS, 'b');
    state = clickRow(state, IDS, 'd', { toggle: true });
    expect(chosen(invertSelection(state, IDS))).toEqual(['a', 'c', 'e', 'f']);
  });

  it('drops the anchor when inverting deselects it', () => {
    const state = clickRow(EMPTY_SELECTION, IDS, 'b');
    expect(invertSelection(state, IDS).anchor).toBeNull();
  });

  it('adds a match without disturbing what is chosen', () => {
    let state = clickRow(EMPTY_SELECTION, IDS, 'a');
    state = addToSelection(state, ['c', 'e']);
    expect(chosen(state)).toEqual(['a', 'c', 'e']);
  });
});

describe('pruneSelection', () => {
  it('drops ids that have left the list', () => {
    /*
     * Lists change under a selection constantly: a filter is typed, a scan re-runs, files are moved
     * by the very operation applied to them. Keeping a vanished id reports a count nobody can see
     * and hands it to the next operation.
     */
    const state = selectAll(IDS);
    const pruned = pruneSelection(state, ['a', 'c']);
    expect(chosen(pruned)).toEqual(['a', 'c']);
  });

  it('drops the anchor when its row is gone', () => {
    const state = clickRow(EMPTY_SELECTION, IDS, 'e');
    expect(pruneSelection(state, ['a', 'b']).anchor).toBeNull();
  });

  it('returns the same object when nothing changed, so React does not re-render', () => {
    const state = clickRow(EMPTY_SELECTION, IDS, 'b');
    expect(pruneSelection(state, IDS)).toBe(state);
  });

  it('survives the list emptying', () => {
    expect(selectionCount(pruneSelection(selectAll(IDS), []))).toBe(0);
  });
});

describe('selectAllState', () => {
  it('has three states, because a header checkbox does', () => {
    expect(selectAllState(EMPTY_SELECTION, IDS)).toBe('none');
    expect(selectAllState(clickRow(EMPTY_SELECTION, IDS, 'a'), IDS)).toBe('some');
    expect(selectAllState(selectAll(IDS), IDS)).toBe('all');
  });

  it('is none for an empty list rather than all', () => {
    // "Everything is selected" is a strange thing to say about nothing.
    expect(selectAllState(selectAll(IDS), [])).toBe('none');
  });

  it('counts only rows currently in the list', () => {
    // A filter narrowing to two rows that are both chosen is 'all', however much is selected
    // outside the filter.
    const state = selectAll(IDS);
    expect(selectAllState(state, ['a', 'b'])).toBe('all');
  });
});

describe('keyboard movement', () => {
  it('moves down from the last selected row', () => {
    const state = clickRow(EMPTY_SELECTION, IDS, 'b');
    const moved = moveSelection(state, IDS, 1);
    expect(chosen(moved.state)).toEqual(['c']);
    expect(moved.focus).toBe('c');
  });

  it('extends instead of jumping when shift is held', () => {
    const state = clickRow(EMPTY_SELECTION, IDS, 'b');
    const moved = moveSelection(state, IDS, 1, true);
    expect(chosen(moved.state)).toEqual(['b', 'c']);
  });

  it('stops at both ends rather than wrapping', () => {
    const atTop = moveSelection(clickRow(EMPTY_SELECTION, IDS, 'a'), IDS, -1);
    expect(chosen(atTop.state)).toEqual(['a']);

    const atEnd = moveSelection(clickRow(EMPTY_SELECTION, IDS, 'f'), IDS, 1);
    expect(chosen(atEnd.state)).toEqual(['f']);
  });

  it('lands on the first row when nothing is selected, not the second', () => {
    // Treating "no selection" as position zero makes Down skip row one, which feels broken every
    // time somebody arrows into a fresh list.
    expect(chosen(moveSelection(EMPTY_SELECTION, IDS, 1).state)).toEqual(['a']);
  });

  it('lands on the last row when arrowing up from nothing', () => {
    expect(chosen(moveSelection(EMPTY_SELECTION, IDS, -1).state)).toEqual(['f']);
  });

  it('does nothing to an empty list', () => {
    expect(moveSelection(EMPTY_SELECTION, [], 1).focus).toBeNull();
  });
});
