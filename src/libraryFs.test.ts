/**
 * The pure half of the desktop filesystem client — the parts a screen reads to decide what to show
 * before anything is applied. The commands themselves are covered on the Rust side, where the disk
 * actually is.
 */

import { describe, expect, it } from 'vitest';
import {
  describePlan,
  isLibraryFsAvailable,
  outcomeBlocks,
  type LibraryPlan,
  type PlanOutcome,
} from './libraryFs';

const change = (outcome: PlanOutcome) => ({
  operation: { kind: 'rename' as const, path: 'C:/library/a.flac', toName: 'b.flac' },
  from: 'C:/library/a.flac',
  to: 'C:/library/b.flac',
  outcome,
});

const plan = (outcomes: PlanOutcome[]): LibraryPlan => ({
  id: 'plan-1',
  changes: outcomes.map(change),
  blocked: outcomes.filter(outcomeBlocks).length,
  createdAt: 0,
});

describe('outcomeBlocks', () => {
  it('lets ok and noChange through', () => {
    expect(outcomeBlocks('ok')).toBe(false);
    expect(outcomeBlocks('noChange')).toBe(false);
  });

  it('stops everything else', () => {
    for (const outcome of [
      'collision',
      'sourceMissing',
      'outsideRoots',
      'noRoots',
      'invalidName',
    ] as PlanOutcome[]) {
      expect(outcomeBlocks(outcome), outcome).toBe(true);
    }
  });
});

describe('describePlan', () => {
  it('counts what will actually run', () => {
    expect(describePlan(plan(['ok', 'ok', 'ok']))).toBe('3 changes');
  });

  it('says one change rather than 1 changes', () => {
    expect(describePlan(plan(['ok']))).toBe('1 change');
  });

  it('surfaces blocked changes rather than burying them', () => {
    expect(describePlan(plan(['ok', 'collision', 'outsideRoots']))).toBe('1 change, 2 blocked');
  });

  it('separates files that are already correct from files that failed', () => {
    // A rename rule run twice is mostly noChange, and reporting that as blocked would look like
    // something went wrong when nothing did.
    expect(describePlan(plan(['ok', 'noChange', 'noChange']))).toBe(
      '1 change, 2 already correct',
    );
  });

  it('reports a plan that can do nothing at all', () => {
    expect(describePlan(plan(['collision', 'collision']))).toBe('0 changes, 2 blocked');
  });
});

describe('isLibraryFsAvailable', () => {
  it('is false in a plain browser, so callers can ask without knowing the platform', () => {
    expect(isLibraryFsAvailable()).toBe(false);
  });
});
