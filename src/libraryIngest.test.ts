import { describe, expect, it } from 'vitest';
import {
  classifyKind,
  decideIngest,
  describeQuarantine,
  LONG_FILE_SECONDS,
  summariseIngest,
  type IngestCandidate,
  type IngestDecision,
  type QuarantineReason,
} from './libraryIngest';
import { DEFAULT_SCHEME } from './libraryOrganise';

const SCHEMES = {
  music: DEFAULT_SCHEME,
  audiobook: '{artist}/{album}/{title}.{ext}',
  document: '{artist}/{title}.{ext}',
};

const candidate = (over: Partial<IngestCandidate> = {}): IngestCandidate => ({
  path: 'C:/incoming/whatever.mp3',
  extension: 'mp3',
  title: 'Paranoid Android',
  artist: 'Radiohead',
  album: 'OK Computer',
  trackNumber: 2,
  durationSeconds: 383,
  ...over,
});

describe('classifyKind', () => {
  it('trusts an extension that only means one thing', () => {
    expect(classifyKind(candidate({ extension: 'm4b' }))).toBe('audiobook');
    expect(classifyKind(candidate({ extension: 'epub' }))).toBe('document');
  });

  it('treats a narrator tag as decisive, because only audiobook tooling writes one', () => {
    expect(classifyKind(candidate({ narrator: 'Simon Vance' }))).toBe('audiobook');
  });

  it('calls an ordinary audio file music', () => {
    expect(classifyKind(candidate())).toBe('music');
  });

  it('refuses to choose for a long file with no other signal', () => {
    /*
     * A ninety minute mp3 is a DJ set as readily as a book chapter. Filing it either way is a
     * confident guess, and a confident wrong guess is the failure this module exists to avoid.
     */
    expect(classifyKind(candidate({ durationSeconds: LONG_FILE_SECONDS + 1 }))).toBeNull();
  });

  it('still trusts a narrator on a long file', () => {
    expect(
      classifyKind(candidate({ durationSeconds: 9999, narrator: 'Simon Vance' })),
    ).toBe('audiobook');
  });

  it('says nothing for a format it does not read', () => {
    expect(classifyKind(candidate({ extension: 'zip' }))).toBeNull();
  });
});

describe('decideIngest files what it can place', () => {
  it('files a fully tagged track', () => {
    const decision = decideIngest(candidate(), { schemes: SCHEMES });
    expect(decision).toEqual({
      action: 'file',
      kind: 'music',
      relativePath: 'Radiohead/OK Computer/02 Paranoid Android.mp3',
    });
  });

  it('files a book by its own scheme', () => {
    const decision = decideIngest(
      candidate({
        extension: 'm4b',
        path: 'C:/incoming/dune.m4b',
        title: 'Dune',
        artist: 'Frank Herbert',
        album: 'Dune',
      }),
      { schemes: SCHEMES },
    );
    expect(decision).toEqual({
      action: 'file',
      kind: 'audiobook',
      relativePath: 'Frank Herbert/Dune/Dune.m4b',
    });
  });
});

describe('decideIngest refuses rather than guessing', () => {
  const reason = (decision: IngestDecision) =>
    decision.action === 'quarantine' ? decision.reason : 'filed';

  it('holds a file with no tags at all', () => {
    // Guessing a title from "01 - track.mp3" is how a library becomes wrong in a way that looks
    // tidy, and nobody goes looking for a mistake they were never told about.
    const decision = decideIngest(
      candidate({ title: undefined, artist: undefined, album: undefined }),
      { schemes: SCHEMES },
    );
    expect(reason(decision)).toBe('untagged');
  });

  it('separates untagged from merely incomplete', () => {
    /*
     * Two different instructions: tag it from the catalogue, versus it is nearly there. Collapsing
     * them makes the larger pile look like the smaller problem.
     */
    const decision = decideIngest(candidate({ album: undefined }), { schemes: SCHEMES });
    expect(reason(decision)).toBe('incomplete');
  });

  it('names the fields that were missing', () => {
    const decision = decideIngest(
      candidate({ album: undefined, trackNumber: undefined }),
      { schemes: SCHEMES },
    );
    if (decision.action !== 'quarantine') throw new Error('expected quarantine');
    expect(decision.detail).toContain('{album}');
    expect(decision.detail).toContain('{track}');
  });

  it('asks about a long file instead of filing it somewhere plausible', () => {
    const decision = decideIngest(
      candidate({ durationSeconds: 90 * 60 }),
      { schemes: SCHEMES },
    );
    expect(reason(decision)).toBe('ambiguousKind');
  });

  it('holds a format it cannot read', () => {
    const decision = decideIngest(candidate({ extension: 'zip' }), { schemes: SCHEMES });
    expect(reason(decision)).toBe('unsupported');
  });

  it('holds a file when its station has nowhere to put it', () => {
    const decision = decideIngest(candidate(), { schemes: { audiobook: SCHEMES.audiobook } });
    expect(reason(decision)).toBe('noDestination');
  });

  it('never invents a value to make a file placeable', () => {
    // The scheme refuses, and this passes the refusal through rather than substituting Unknown.
    const decision = decideIngest(candidate({ artist: undefined }), { schemes: SCHEMES });
    expect(decision.action).toBe('quarantine');
  });
});

describe('summariseIngest', () => {
  it('counts what landed and what is being held, by reason', () => {
    const decisions: IngestDecision[] = [
      { action: 'file', kind: 'music', relativePath: 'a.mp3' },
      { action: 'quarantine', reason: 'untagged', detail: '' },
      { action: 'quarantine', reason: 'untagged', detail: '' },
      { action: 'quarantine', reason: 'ambiguousKind', detail: '' },
    ];
    const summary = summariseIngest(decisions);
    expect(summary.filed).toBe(1);
    expect(summary.quarantined).toBe(3);
    expect(summary.reasons.untagged).toBe(2);
    expect(summary.reasons.ambiguousKind).toBe(1);
  });

  it('survives an empty run', () => {
    expect(summariseIngest([])).toEqual({ filed: 0, quarantined: 0, reasons: {} });
  });
});

describe('describeQuarantine', () => {
  it('gives every reason its own sentence', () => {
    const reasons: QuarantineReason[] = [
      'untagged',
      'incomplete',
      'ambiguousKind',
      'unsupported',
      'noDestination',
    ];
    const messages = reasons.map(describeQuarantine);
    expect(new Set(messages).size).toBe(reasons.length);
    expect(messages.every((m) => m.length > 0)).toBe(true);
  });
});
