/**
 * Selection state for a list, with the list's own changes handled.
 *
 * The model is pure and lives in selectionModel. This holds it, prunes it when the list changes
 * underneath, and turns a mouse event into the intent the model understands — so no view has to
 * remember that cmd is the Mac spelling of ctrl, and none of them can spell it differently.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  clickRow,
  clearSelection,
  EMPTY_SELECTION,
  invertSelection,
  moveSelection,
  pruneSelection,
  selectAll,
  selectAllState,
  selectedInOrder,
  type SelectAllState,
  type SelectionState,
} from '../selectionModel';

export interface UseSelectionResult {
  state: SelectionState;
  /** Chosen ids in list order — what an operation should act on. */
  selected: string[];
  count: number;
  isSelected: (id: string) => boolean;
  headerState: SelectAllState;
  /** Pass a click straight through; modifiers are read from the event. */
  onRowClick: (id: string, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onKeyDown: (event: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    preventDefault: () => void;
  }) => void;
  toggleAll: () => void;
  invert: () => void;
  clear: () => void;
}

export function useSelection(ids: readonly string[]): UseSelectionResult {
  const [state, setState] = useState<SelectionState>(EMPTY_SELECTION);

  /*
   * Pruned whenever the list changes. A filter is typed, a scan re-runs, or the files are moved by
   * the very operation applied to them — and a selection holding ids that are gone reports a count
   * nobody can see and hands them to whatever runs next.
   *
   * pruneSelection returns the same object when nothing changed, so this settles immediately
   * instead of looping.
   */
  useEffect(() => {
    setState((current) => pruneSelection(current, ids));
  }, [ids]);

  const onRowClick = useCallback<UseSelectionResult['onRowClick']>(
    (id, event) => {
      setState((current) =>
        clickRow(current, ids, id, {
          // cmd on a Mac is ctrl everywhere else, and no view should have to know that.
          toggle: event.ctrlKey || event.metaKey,
          range: event.shiftKey,
        }),
      );
    },
    [ids],
  );

  const onKeyDown = useCallback<UseSelectionResult['onKeyDown']>(
    (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setState(
          (current) =>
            moveSelection(current, ids, event.key === 'ArrowDown' ? 1 : -1, event.shiftKey).state,
        );
        return;
      }
      if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setState(selectAll(ids));
        return;
      }
      if (event.key === 'Escape') {
        setState(clearSelection());
      }
    },
    [ids],
  );

  const headerState = useMemo(() => selectAllState(state, ids), [state, ids]);

  const toggleAll = useCallback(() => {
    // A partial selection fills rather than empties: somebody who has ticked three of forty and
    // reaches for the header wants the rest, not to lose the three.
    setState((current) =>
      selectAllState(current, ids) === 'all' ? clearSelection() : selectAll(ids),
    );
  }, [ids]);

  return {
    state,
    selected: useMemo(() => selectedInOrder(state, ids), [state, ids]),
    count: state.selected.size,
    isSelected: useCallback((id: string) => state.selected.has(id), [state]),
    headerState,
    onRowClick,
    onKeyDown,
    toggleAll,
    invert: useCallback(() => setState((current) => invertSelection(current, ids)), [ids]),
    clear: useCallback(() => setState(clearSelection()), []),
  };
}
