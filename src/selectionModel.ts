/**
 * Picking things out of a list, the way every desktop list has worked for thirty years.
 *
 * Click replaces, ctrl-click toggles, shift-click extends a range. People do not read a manual for
 * this; they already know it, and a list that gets it subtly wrong is worse than one with no
 * multi-select at all — the mistake is invisible until an operation runs on the wrong forty files.
 *
 * The part everybody gets wrong is the anchor. Shift-click extends from the anchor, which is the
 * last plain or ctrl click, not from whatever was most recently touched by a shift-click. Without
 * that, shift-clicking twice walks the range instead of resizing it, and the second click silently
 * abandons half the first selection.
 *
 * Pure, and ordered by the list rather than by the order things were clicked, because every
 * consumer wants "the selected rows, in the order they appear".
 */

export interface SelectionState {
  /** Chosen ids. Membership only — order comes from the list. */
  readonly selected: ReadonlySet<string>;
  /**
   * Where a shift-click measures from.
   *
   * Null after a clear, and after the anchored row leaves the list: extending from a row that is
   * no longer there would select an arbitrary span.
   */
  readonly anchor: string | null;
}

export const EMPTY_SELECTION: SelectionState = { selected: new Set(), anchor: null };

/** How a row was clicked. Named for intent rather than for which key was held. */
export interface ClickModifiers {
  /** ctrl on Windows and Linux, cmd on a Mac. Adds or removes one row. */
  toggle?: boolean;
  /** shift. Extends from the anchor to here. */
  range?: boolean;
}

export function isSelected(state: SelectionState, id: string): boolean {
  return state.selected.has(id);
}

export function selectionCount(state: SelectionState): number {
  return state.selected.size;
}

/**
 * The selected ids in list order.
 *
 * A Set iterates in insertion order, which is click order, and an operation applied in click order
 * renames files in whatever sequence somebody happened to tick them. List order is what a preview
 * shows and therefore what an operation must follow.
 */
export function selectedInOrder(
  state: SelectionState,
  ids: readonly string[],
): string[] {
  return ids.filter((id) => state.selected.has(id));
}

/** Apply a click to the selection. */
export function clickRow(
  state: SelectionState,
  ids: readonly string[],
  id: string,
  modifiers: ClickModifiers = {},
): SelectionState {
  if (!ids.includes(id)) return state;

  if (modifiers.range && state.anchor && ids.includes(state.anchor)) {
    const from = ids.indexOf(state.anchor);
    const to = ids.indexOf(id);
    const [low, high] = from <= to ? [from, to] : [to, from];
    const span = ids.slice(low, high + 1);

    /*
     * Shift with ctrl adds the range to what is already chosen; shift alone replaces. Both are
     * standard, and the difference is how somebody picks two separate runs of tracks.
     */
    const selected = modifiers.toggle ? new Set(state.selected) : new Set<string>();
    for (const rowId of span) selected.add(rowId);

    // The anchor deliberately does not move: shift-clicking again resizes this range rather than
    // starting a new one from where the last one happened to end.
    return { selected, anchor: state.anchor };
  }

  if (modifiers.toggle) {
    const selected = new Set(state.selected);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    // The anchor follows a ctrl-click even when it deselects, because that is where a following
    // shift-click should measure from.
    return { selected, anchor: id };
  }

  return { selected: new Set([id]), anchor: id };
}

export function selectAll(ids: readonly string[]): SelectionState {
  return { selected: new Set(ids), anchor: ids[0] ?? null };
}

export function clearSelection(): SelectionState {
  return EMPTY_SELECTION;
}

/** Everything not currently chosen. */
export function invertSelection(
  state: SelectionState,
  ids: readonly string[],
): SelectionState {
  const selected = new Set(ids.filter((id) => !state.selected.has(id)));
  return { selected, anchor: state.anchor && selected.has(state.anchor) ? state.anchor : null };
}

/** Add ids without disturbing what is already chosen — for "select everything matching". */
export function addToSelection(
  state: SelectionState,
  ids: readonly string[],
): SelectionState {
  if (ids.length === 0) return state;
  const selected = new Set(state.selected);
  for (const id of ids) selected.add(id);
  return { selected, anchor: state.anchor ?? ids[0] ?? null };
}

/**
 * Drop ids that are no longer in the list.
 *
 * Lists change under a selection constantly — a filter is typed, a scan re-runs, files are moved
 * away by the very operation that was applied to them. A selection holding ids that no longer
 * exist reports a count nobody can see and, worse, hands them to the next operation.
 */
export function pruneSelection(
  state: SelectionState,
  ids: readonly string[],
): SelectionState {
  const present = new Set(ids);
  let changed = false;
  const selected = new Set<string>();
  for (const id of state.selected) {
    if (present.has(id)) selected.add(id);
    else changed = true;
  }
  const anchor = state.anchor && present.has(state.anchor) ? state.anchor : null;
  if (!changed && anchor === state.anchor) return state;
  return { selected, anchor };
}

/** For a header checkbox, which has three states and not two. */
export type SelectAllState = 'none' | 'some' | 'all';

export function selectAllState(
  state: SelectionState,
  ids: readonly string[],
): SelectAllState {
  if (ids.length === 0 || state.selected.size === 0) return 'none';
  const chosen = ids.filter((id) => state.selected.has(id)).length;
  if (chosen === 0) return 'none';
  return chosen === ids.length ? 'all' : 'some';
}

/**
 * Keyboard movement, with shift extending rather than jumping.
 *
 * Returned as a new state plus the row to scroll to, because a list that moves the selection
 * without moving the viewport leaves somebody arrowing into rows they cannot see.
 */
export function moveSelection(
  state: SelectionState,
  ids: readonly string[],
  direction: -1 | 1,
  extend = false,
): { state: SelectionState; focus: string | null } {
  if (ids.length === 0) return { state, focus: null };

  const current = [...state.selected];
  const lastId = current.length > 0 ? current[current.length - 1] : null;
  const from = lastId ? ids.indexOf(lastId) : -1;

  /*
   * With nothing selected, the first press lands on the end being moved towards rather than one
   * step in from it. Treating "no selection" as position zero makes Down skip the first row, which
   * is a small thing that feels broken every single time.
   */
  const next =
    from < 0
      ? direction > 0
        ? 0
        : ids.length - 1
      : Math.min(ids.length - 1, Math.max(0, from + direction));
  const id = ids[next];

  if (extend) {
    return { state: clickRow(state, ids, id, { range: true }), focus: id };
  }
  return { state: clickRow(state, ids, id), focus: id };
}
