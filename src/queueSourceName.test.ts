import { describe, expect, it } from 'vitest';
import { resolveQueueSourceName } from './queueSourceName';

describe('resolveQueueSourceName', () => {
  it('returns null without a session so the caller keeps the station sentence', () => {
    expect(resolveQueueSourceName(null)).toBeNull();
    expect(resolveQueueSourceName(undefined)).toBeNull();
  });

  it('names an artist mix by its seed artist', () => {
    expect(
      resolveQueueSourceName({ kind: 'mix', seedTitle: 'Fly Away', seedArtist: 'Lenny Kravitz' }),
    ).toEqual({ key: 'sourceArtistMix', params: { artist: 'Lenny Kravitz' } });
  });

  it('names track radio by its seed title', () => {
    expect(
      resolveQueueSourceName({ kind: 'radio', seedTitle: 'Fly Away', seedArtist: '' }),
    ).toEqual({ key: 'sourceTrackRadio', params: { title: 'Fly Away' } });
  });

  it('names the discovery station without a seed', () => {
    expect(
      resolveQueueSourceName({ kind: 'discovery-station', seedTitle: '', seedArtist: '' }),
    ).toEqual({ key: 'sourceDiscoveryStation' });
  });

  it('names a made-for-you mix by its title', () => {
    expect(
      resolveQueueSourceName({ kind: 'discovery-mfy', seedTitle: 'Deep Cuts', seedArtist: '' }),
    ).toEqual({ key: 'sourceDiscoveryMix', params: { title: 'Deep Cuts' } });
  });

  it('falls back to null when the seed it needs is blank', () => {
    expect(resolveQueueSourceName({ kind: 'mix', seedTitle: 'x', seedArtist: '  ' })).toBeNull();
    expect(resolveQueueSourceName({ kind: 'radio', seedTitle: '', seedArtist: 'x' })).toBeNull();
    expect(
      resolveQueueSourceName({ kind: 'discovery-mfy', seedTitle: '   ', seedArtist: '' }),
    ).toBeNull();
  });
});
