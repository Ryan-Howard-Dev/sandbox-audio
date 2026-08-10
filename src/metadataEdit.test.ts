import { describe, expect, it } from 'vitest';
import {
  matchTrack,
  patchForEdit,
  proposeEdits,
  rankCandidates,
  scoreCandidate,
  type CandidateTrack,
  type EditableRow,
  type ReleaseCandidate,
} from './metadataEdit';

const row = (over: Partial<EditableRow> = {}): EditableRow => ({
  id: 'row-1',
  title: 'Paranoid Android',
  artist: 'Radiohead',
  ...over,
});

const track = (over: Partial<CandidateTrack> = {}): CandidateTrack => ({
  title: 'Paranoid Android',
  trackNumber: 2,
  ...over,
});

const candidate = (over: Partial<ReleaseCandidate> = {}): ReleaseCandidate => ({
  id: 'mb-1',
  title: 'OK Computer',
  artist: 'Radiohead',
  year: '1997',
  coverArtUrl: 'https://coverart/ok.jpg',
  tracks: [track({ title: 'Airbag', trackNumber: 1 }), track()],
  ...over,
});

describe('matchTrack', () => {
  it('matches on track number first, because a rip gets that right when tags are empty', () => {
    const matched = matchTrack(row({ title: '', trackNumber: 1 }), candidate().tracks);
    expect(matched?.title).toBe('Airbag');
  });

  it('falls back to the title when there is no number', () => {
    expect(matchTrack(row(), candidate().tracks)?.trackNumber).toBe(2);
  });

  it('matches a title through punctuation and casing', () => {
    const tracks = [track({ title: "Don't Panic", trackNumber: 1 })];
    expect(matchTrack(row({ title: 'dont panic' }), tracks)).toBeDefined();
  });

  it('keeps discs apart, so track 1 of disc 2 is not track 1 of disc 1', () => {
    const tracks = [
      track({ title: 'Disc One Opener', trackNumber: 1, discNumber: 1 }),
      track({ title: 'Disc Two Opener', trackNumber: 1, discNumber: 2 }),
    ];
    const matched = matchTrack(row({ title: '', trackNumber: 1, discNumber: 2 }), tracks);
    expect(matched?.title).toBe('Disc Two Opener');
  });

  it('returns nothing rather than guessing when neither number nor title lands', () => {
    expect(matchTrack(row({ title: 'Something Else' }), candidate().tracks)).toBeUndefined();
  });
});

describe('proposeEdits', () => {
  it('fills blanks without being asked to overwrite', () => {
    const proposal = proposeEdits([row()], candidate());
    const fields = proposal.edits[0].changes.map((c) => c.field);
    expect(fields).toContain('albumName');
    expect(fields).toContain('releaseYear');
    expect(fields).toContain('albumArt');
  });

  it('leaves a field that already has a value alone by default', () => {
    // Replacing something a person may have corrected by hand is the failure mode here.
    const proposal = proposeEdits([row({ albumName: 'My Own Name For It' })], candidate());
    const albumChange = proposal.edits[0].changes.find((c) => c.field === 'albumName');
    expect(albumChange).toBeUndefined();
  });

  it('replaces an existing value when overwrite is asked for', () => {
    const proposal = proposeEdits([row({ albumName: 'Wrong Album' })], candidate(), {
      overwriteExisting: true,
    });
    const albumChange = proposal.edits[0].changes.find((c) => c.field === 'albumName');
    expect(albumChange).toEqual({ field: 'albumName', before: 'Wrong Album', after: 'OK Computer' });
  });

  it('does not report a change when the value is the same but punctuated differently', () => {
    const proposal = proposeEdits(
      [row({ albumName: 'ok computer' })],
      candidate(),
      { overwriteExisting: true },
    );
    expect(proposal.edits[0].changes.find((c) => c.field === 'albumName')).toBeUndefined();
  });

  it('skips a locked row and says that is why', () => {
    const proposal = proposeEdits([row({ userMetadataLocked: true })], candidate());
    expect(proposal.edits[0].skipped).toBe('locked');
    expect(proposal.edits[0].changes).toEqual([]);
  });

  it('touches a locked row only when explicitly told to', () => {
    const proposal = proposeEdits([row({ userMetadataLocked: true })], candidate(), {
      includeLocked: true,
    });
    expect(proposal.edits[0].skipped).toBeUndefined();
    expect(proposal.edits[0].changes.length).toBeGreaterThan(0);
  });

  it('reports an unmatched row rather than dropping it from the preview', () => {
    const proposal = proposeEdits([row({ title: 'Not On This Album' })], candidate());
    expect(proposal.edits).toHaveLength(1);
    expect(proposal.edits[0].skipped).toBe('unmatched');
  });

  it('separates a row that is already correct from one that could not be matched', () => {
    const complete = row({
      title: 'Paranoid Android',
      albumName: 'OK Computer',
      albumArtist: 'Radiohead',
      releaseYear: '1997',
      trackNumber: 2,
      albumArt: 'https://coverart/ok.jpg',
    });
    const proposal = proposeEdits([complete], candidate());
    expect(proposal.edits[0].skipped).toBe('alreadyCorrect');
  });

  it('honours an excluded field even when it would otherwise change', () => {
    const proposal = proposeEdits([row()], candidate(), { exclude: ['albumArt'] });
    expect(proposal.edits[0].changes.find((c) => c.field === 'albumArt')).toBeUndefined();
  });

  it('never invents a value the candidate does not have', () => {
    const proposal = proposeEdits([row()], candidate({ year: undefined, coverArtUrl: undefined }));
    const fields = proposal.edits[0].changes.map((c) => c.field);
    expect(fields).not.toContain('releaseYear');
    expect(fields).not.toContain('albumArt');
  });

  it('counts rows and field changes so a confirm step can say what it is about to do', () => {
    const proposal = proposeEdits(
      [row({ id: 'a' }), row({ id: 'b', title: 'Airbag' }), row({ id: 'c', userMetadataLocked: true })],
      candidate(),
    );
    expect(proposal.changing).toBe(2);
    expect(proposal.skipped).toBe(1);
    expect(proposal.fieldChanges).toBeGreaterThan(0);
  });
});

describe('patchForEdit', () => {
  it('translates changes into a store patch without deciding anything new', () => {
    const proposal = proposeEdits([row()], candidate());
    const patch = patchForEdit(proposal.edits[0]);
    expect(patch.albumName).toBe('OK Computer');
    expect(patch.releaseYear).toBe('1997');
  });

  it('writes track and disc numbers as numbers, not strings', () => {
    const proposal = proposeEdits([row({ title: '', trackNumber: undefined })], candidate());
    const patch = patchForEdit(proposal.edits[0]);
    if ('trackNumber' in patch) expect(typeof patch.trackNumber).toBe('number');
  });

  it('produces nothing for a skipped row', () => {
    const proposal = proposeEdits([row({ userMetadataLocked: true })], candidate());
    expect(patchForEdit(proposal.edits[0])).toEqual({});
  });
});

describe('scoreCandidate and rankCandidates', () => {
  it('puts an exact match above a partial one', () => {
    const exact = candidate({ id: 'exact', title: 'OK Computer', trackCount: 12 });
    const partial = candidate({ id: 'partial', title: 'OK Computer OKNOTOK', trackCount: 23 });
    expect(scoreCandidate(exact, { album: 'OK Computer', artist: 'Radiohead', trackCount: 12 }))
      .toBeGreaterThan(
        scoreCandidate(partial, { album: 'OK Computer', artist: 'Radiohead', trackCount: 12 }),
      );
  });

  it('separates an album from its deluxe reissue by track count', () => {
    // Title and artist match on both; the count is the only thing that tells them apart, and
    // picking the reissue writes bonus disc numbering over the original.
    const original = candidate({ id: 'original', trackCount: 12 });
    const deluxe = candidate({ id: 'deluxe', trackCount: 23 });
    const [first] = rankCandidates([deluxe, original], {
      album: 'OK Computer',
      artist: 'Radiohead',
      trackCount: 12,
    });
    expect(first.id).toBe('original');
  });

  it('keeps the catalogue order for candidates that score the same', () => {
    const a = candidate({ id: 'a' });
    const b = candidate({ id: 'b' });
    expect(rankCandidates([a, b], { album: 'OK Computer' }).map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('scores nothing when there is nothing to compare against', () => {
    expect(scoreCandidate(candidate(), {})).toBe(0);
  });
});
