import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEME,
  MAX_SEGMENT,
  proposeOrganise,
  renderScheme,
  sanitizeSegment,
  tokenValues,
  type OrganiseTrack,
} from './libraryOrganise';

const track = (over: Partial<OrganiseTrack> = {}): OrganiseTrack => ({
  path: 'C:/library/incoming/whatever.flac',
  title: 'Paranoid Android',
  artist: 'Radiohead',
  album: 'OK Computer',
  releaseYear: '1997',
  trackNumber: 2,
  ...over,
});

describe('sanitizeSegment', () => {
  it('keeps an ordinary name intact', () => {
    expect(sanitizeSegment('OK Computer')).toBe('OK Computer');
  });

  it('replaces a slash rather than letting it create a folder', () => {
    // "AC/DC" silently becoming a folder AC containing a folder DC is a rename turning into a
    // move nobody asked for.
    expect(sanitizeSegment('AC/DC')).toBe('AC DC');
    expect(sanitizeSegment('AC\\DC')).toBe('AC DC');
  });

  it('strips the characters Windows refuses', () => {
    expect(sanitizeSegment('What? "Really" <yes>: 100%*')).toBe('What Really yes 100%');
  });

  it('drops a trailing dot or space, which Windows silently removes on write', () => {
    expect(sanitizeSegment('Album.')).toBe('Album');
    expect(sanitizeSegment('Album ')).toBe('Album');
  });

  it('prefixes a reserved device name instead of destroying it', () => {
    expect(sanitizeSegment('NUL')).toBe('_NUL');
    expect(sanitizeSegment('Nul')).toBe('_Nul');
  });

  it('does not mistake a real name that merely contains a reserved word', () => {
    expect(sanitizeSegment('Conversations')).toBe('Conversations');
  });

  it('truncates a name too long for the filesystem', () => {
    const long = 'a'.repeat(300);
    expect(sanitizeSegment(long).length).toBeLessThanOrEqual(MAX_SEGMENT);
  });

  it('never returns an empty name', () => {
    expect(sanitizeSegment('///')).toBe('_');
    expect(sanitizeSegment('   ')).toBe('_');
  });
});

describe('tokenValues', () => {
  it('falls back from album artist to artist', () => {
    // Filing by album artist should not dump everything without one into Unknown when the track
    // knows perfectly well who played it.
    expect(tokenValues(track({ albumArtist: undefined })).albumartist).toBe('Radiohead');
  });

  it('pads track numbers so they sort', () => {
    expect(tokenValues(track({ trackNumber: 2 })).track).toBe('02');
    expect(tokenValues(track({ trackNumber: 12 })).track).toBe('12');
  });

  it('takes the extension from the current file', () => {
    expect(tokenValues(track({ path: 'C:/x/y.FLAC' })).ext).toBe('flac');
  });

  it('reports a missing field as missing rather than blank', () => {
    expect(tokenValues(track({ album: '   ' })).album).toBeUndefined();
  });
});

describe('renderScheme', () => {
  it('renders the default scheme', () => {
    const out = renderScheme(DEFAULT_SCHEME, track());
    expect(out).toEqual({
      status: 'ok',
      relativePath: 'Radiohead/OK Computer/02 Paranoid Android.flac',
    });
  });

  it('refuses rather than inventing when a field is missing', () => {
    // "Unknown Album" would file hundreds of unrelated tracks into one folder that then looks like
    // a real album, and undoing that is far harder than never doing it.
    const out = renderScheme(DEFAULT_SCHEME, track({ album: undefined }));
    expect(out.status).toBe('missing');
    if (out.status === 'missing') expect(out.tokens).toContain('album');
  });

  it('names every missing token, not just the first', () => {
    const out = renderScheme(DEFAULT_SCHEME, track({ album: undefined, trackNumber: undefined }));
    if (out.status !== 'missing') throw new Error('expected missing');
    expect(out.tokens.sort()).toEqual(['album', 'track']);
  });

  it('rejects a scheme with a token that does not exist', () => {
    const out = renderScheme('{albumartist}/{bogus}.{ext}', track());
    expect(out.status).toBe('badScheme');
  });

  it('sanitizes each segment without eating the separators', () => {
    const out = renderScheme(DEFAULT_SCHEME, track({ artist: 'AC/DC', albumArtist: 'AC/DC' }));
    if (out.status !== 'ok') throw new Error('expected ok');
    // One folder called "AC DC", not a folder AC containing DC.
    expect(out.relativePath.split('/')[0]).toBe('AC DC');
    expect(out.relativePath.split('/')).toHaveLength(3);
  });

  it('drops an empty segment rather than producing a double separator', () => {
    const out = renderScheme('{albumartist}//{title}.{ext}', track());
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(out.relativePath).toBe('Radiohead/Paranoid Android.flac');
  });

  it('supports a flat scheme with no folders', () => {
    const out = renderScheme('{artist} - {title}.{ext}', track());
    expect(out).toEqual({ status: 'ok', relativePath: 'Radiohead - Paranoid Android.flac' });
  });
});

describe('proposeOrganise', () => {
  const ROOT = 'C:/library/music';

  it('produces a move for a track that is in the wrong place', () => {
    const proposal = proposeOrganise([track()], DEFAULT_SCHEME, ROOT);
    expect(proposal.moving).toBe(1);
    expect(proposal.rows[0].target).toBe(
      'C:/library/music/Radiohead/OK Computer/02 Paranoid Android.flac',
    );
    expect(proposal.operations.some((op) => op.kind === 'move')).toBe(true);
  });

  it('leaves a track that is already in the right place alone', () => {
    const already = track({
      path: 'C:/library/music/Radiohead/OK Computer/02 Paranoid Android.flac',
    });
    const proposal = proposeOrganise([already], DEFAULT_SCHEME, ROOT);
    expect(proposal.unchanged).toBe(1);
    expect(proposal.moving).toBe(0);
    expect(proposal.operations).toEqual([]);
  });

  it('ignores separator and case differences when deciding nothing has changed', () => {
    const already = track({
      path: 'c:\\library\\music\\Radiohead\\OK Computer\\02 Paranoid Android.flac',
    });
    expect(proposeOrganise([already], DEFAULT_SCHEME, ROOT).unchanged).toBe(1);
  });

  it('blocks the second of two tracks that would land on one name, naming the first', () => {
    // Applied in order the second overwrites the first and nothing reports it.
    const a = track({ path: 'C:/in/a.flac', trackNumber: 1, title: 'Intro' });
    const b = track({ path: 'C:/in/b.flac', trackNumber: 1, title: 'Intro' });
    const proposal = proposeOrganise([a, b], DEFAULT_SCHEME, ROOT);
    expect(proposal.moving).toBe(1);
    expect(proposal.blocked).toBe(1);
    expect(proposal.rows[1].detail).toContain('C:/in/a.flac');
  });

  it('reports a track it cannot place rather than dropping it from the plan', () => {
    const proposal = proposeOrganise([track({ album: undefined })], DEFAULT_SCHEME, ROOT);
    expect(proposal.rows).toHaveLength(1);
    expect(proposal.blocked).toBe(1);
    expect(proposal.operations).toEqual([]);
  });

  it('creates the destination folder as part of the plan', () => {
    const proposal = proposeOrganise([track()], DEFAULT_SCHEME, ROOT);
    const created = proposal.operations.find((op) => op.kind === 'createDir');
    expect(created).toBeDefined();
    if (created?.kind === 'createDir') {
      expect(created.path).toBe('C:/library/music/Radiohead/OK Computer');
    }
  });

  it('carries the new name on the move rather than following it with a rename', () => {
    /*
     * A separate rename could never be planned: its source does not exist at that path until the
     * move has run, and a plan is checked against the disk as it is.
     */
    const proposal = proposeOrganise([track()], DEFAULT_SCHEME, ROOT);
    expect(proposal.operations.some((op) => op.kind === 'rename')).toBe(false);
    const moved = proposal.operations.find((op) => op.kind === 'move');
    expect(moved).toBeDefined();
    if (moved?.kind === 'move') {
      expect(moved.toName).toBe('02 Paranoid Android.flac');
      expect(moved.toDir).toBe('C:/library/music/Radiohead/OK Computer');
    }
  });

  it('creates the folder before the move that lands in it', () => {
    const proposal = proposeOrganise([track()], DEFAULT_SCHEME, ROOT);
    const createdAt = proposal.operations.findIndex((op) => op.kind === 'createDir');
    const movedAt = proposal.operations.findIndex((op) => op.kind === 'move');
    expect(createdAt).toBeGreaterThanOrEqual(0);
    expect(createdAt).toBeLessThan(movedAt);
  });

  it('counts a mixed batch honestly', () => {
    const proposal = proposeOrganise(
      [
        track({ path: 'C:/in/a.flac' }),
        track({ path: 'C:/in/b.flac', album: undefined, title: 'B' }),
        track({ path: 'C:/library/music/Radiohead/OK Computer/02 Paranoid Android.flac' }),
      ],
      DEFAULT_SCHEME,
      ROOT,
    );
    expect(proposal.moving).toBe(1);
    expect(proposal.blocked).toBe(1);
    expect(proposal.unchanged).toBe(1);
    expect(proposal.rows).toHaveLength(3);
  });
});
