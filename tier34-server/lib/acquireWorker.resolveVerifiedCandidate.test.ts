/**
 * A source answering is not the same as a source answering correctly.
 *
 * Reported from a real album download: two or three tracks out of every run failed with
 * "Identity check blocked store", consistently, on every album. Traced to resolveCandidatesForTier
 * stopping at whichever source answered first, whether or not any of its rows were the right
 * track — the proxy tier (YouTube search) answers for almost anything by title, but its top hits
 * for one specific song are often a reaction video, a sped-up reupload, or a live set, which is
 * exactly what the identity gate exists to reject. Debrid and Soulseek, which index real audio
 * files rather than video reuploads, were never tried for those tracks.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./proxyResolve.js', () => ({
  resolveProxyCandidates: vi.fn(),
  proxyStreamUpstream: vi.fn(),
}));
vi.mock('./debridResolve.js', () => ({ resolveDebridCandidates: vi.fn() }));
vi.mock('./soulseek.js', () => ({
  isSoulseekConfigured: vi.fn(() => false),
  resolveSoulseekCandidate: vi.fn(),
  parseSoulseekUrl: vi.fn(() => null),
  readSoulseekDownloadBuffer: vi.fn(),
}));
vi.mock('./search.js', () => ({ searchProxyTier: vi.fn(async () => []) }));

const { resolveProxyCandidates } = await import('./proxyResolve.js');
const { resolveDebridCandidates } = await import('./debridResolve.js');
const { isSoulseekConfigured } = await import('./soulseek.js');
const { resolveVerifiedCandidate } = await import('./acquireWorker.js');

const opts = { prowlarrUrl: '', prowlarrApiKey: '', realDebridApiKey: '' };

function row(url: string, title: string, durationSeconds: number) {
  return { id: url, sourceId: url, title, artist: 'Denzel Curry', url, durationSeconds };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSoulseekConfigured).mockReturnValue(false);
});

describe('resolveVerifiedCandidate', () => {
  it('falls through to the next source when the first answers with only renditions', async () => {
    vi.mocked(resolveProxyCandidates).mockResolvedValue([
      row('https://yt/1', '13LOOD 1N + 13LOOD OUT MIXX (Sped Up)', 700),
      row('https://yt/2', '13LOOD 1N + 13LOOD OUT MIXX (Live)', 690),
    ]);
    vi.mocked(resolveDebridCandidates).mockResolvedValue([
      row('https://debrid/1', '13LOOD 1N + 13LOOD OUT MIXX', 700),
    ]);

    const reject = (c: { title?: string }) => (/sped up|live/i.test(c.title ?? '') ? 'rendition' : null);
    const result = await resolveVerifiedCandidate('13LOOD 1N + 13LOOD OUT MIXX', 'best', opts, reject);

    expect(resolveDebridCandidates).toHaveBeenCalled();
    expect(result.hit?.url).toBe('https://debrid/1');
    expect(result.sawAnyCandidate).toBe(true);
  });

  it('stops at the first source once it has a passing candidate, without trying the next', async () => {
    vi.mocked(resolveProxyCandidates).mockResolvedValue([
      row('https://yt/1', 'Correct Track', 700),
    ]);
    vi.mocked(resolveDebridCandidates).mockResolvedValue([
      row('https://debrid/1', 'Correct Track', 700),
    ]);

    const result = await resolveVerifiedCandidate('Correct Track', 'best', opts, () => null);

    expect(result.hit?.url).toBe('https://yt/1');
    expect(resolveDebridCandidates).not.toHaveBeenCalled();
  });

  it('reports no candidate seen when every source is empty, not an identity failure', async () => {
    vi.mocked(resolveProxyCandidates).mockResolvedValue([]);
    vi.mocked(resolveDebridCandidates).mockResolvedValue([]);

    const result = await resolveVerifiedCandidate('Obscure Interlude', 'best', opts, () => 'never called');

    expect(result.sawAnyCandidate).toBe(false);
    expect(result.hit).toBeNull();
  });

  it('carries every rejection reason across sources, not just the last source tried', async () => {
    vi.mocked(resolveProxyCandidates).mockResolvedValue([
      row('https://yt/1', 'Wrong (Live)', 700),
    ]);
    vi.mocked(resolveDebridCandidates).mockResolvedValue([
      row('https://debrid/1', 'Also Wrong', 60),
    ]);

    const result = await resolveVerifiedCandidate('Real Track', 'best', opts, (c) =>
      c.title === 'Wrong (Live)' ? 'unrequested rendition' : 'duration mismatch',
    );

    expect(result.hit).toBeNull();
    expect(result.rejectReasons).toEqual([
      'Wrong (Live): unrequested rendition',
      'Also Wrong: duration mismatch',
    ]);
  });

  it('never asks soulseek for a proxy-only tier', async () => {
    vi.mocked(resolveProxyCandidates).mockResolvedValue([]);
    await resolveVerifiedCandidate('Track', 'proxy', opts, () => null);
    expect(isSoulseekConfigured).not.toHaveBeenCalled();
  });
});
