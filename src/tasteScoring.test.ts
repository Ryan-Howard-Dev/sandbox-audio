import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';
import type { SessionVector } from './sessionTaste';
import type { TasteProfileV1 } from './tasteProfile';
import {
  DISQUALIFIED_SCORE,
  explainCandidateScore,
  isCandidateDisqualified,
} from './tasteScoring';

vi.mock('./lockerStorage', () => ({
  getLockerEntriesSnapshot: vi.fn(() => []),
}));

vi.mock('./playHistory', () => ({
  getAllPlayEvents: vi.fn(() => []),
}));

vi.mock('./tasteProfile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tasteProfile')>();
  return {
    ...actual,
    scoreTrackForTaste: vi.fn(() => 3),
    getExplicitFeedback: vi.fn((id: string) =>
      id === 'disliked-track' ? 'dislike' : undefined,
    ),
  };
});

vi.mock('./sonicFeatures', () => ({
  getSonicFeaturesForEnvelope: vi.fn(() => null),
  hasComparableSonicFeatures: vi.fn(() => false),
  sonicSimilarity: vi.fn(() => 0),
}));

const emptySession: SessionVector = {
  sessionId: 'test-session',
  artists: {},
  genres: {},
  trackIds: [],
  avgEnergy: 0.5,
  updatedAt: Date.now(),
};

const baseProfile: TasteProfileV1 = {
  schemaVersion: 1,
  trackAffinity: {},
  artistAffinity: {},
  albumAffinity: {},
  genreAffinity: {},
  explicitFeedback: {},
  updatedAt: Date.now(),
};

function envelope(id: string, artist = 'Artist'): MediaEnvelope {
  return {
    envelopeId: id,
    sourceId: id,
    title: 'Track',
    artist,
    url: 'https://example.com/a.mp3',
    provider: 'local-vault',
    transport: 'element-src',
    durationSeconds: 180,
  };
}

describe('explainCandidateScore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disqualifies explicit dislike candidates', () => {
    const result = explainCandidateScore(
      envelope('disliked-track'),
      emptySession,
      baseProfile,
    );
    expect(result.disqualified).toBe(true);
    expect(result.total).toBe(DISQUALIFIED_SCORE);
    expect(result.factors).toHaveLength(0);
  });

  it('scores eligible tracks with weighted factor breakdown', () => {
    const result = explainCandidateScore(
      envelope('track-ok', 'Fresh Artist'),
      emptySession,
      baseProfile,
    );
    expect(result.disqualified).toBe(false);
    expect(result.total).toBeGreaterThan(0);
    expect(result.factors.some((f) => f.id === 'session')).toBe(true);
    expect(result.factors.some((f) => f.id === 'taste')).toBe(true);
    const tasteFactor = result.factors.find((f) => f.id === 'taste');
    expect(tasteFactor?.contribution).toBeGreaterThan(0);
  });

  it('isCandidateDisqualified mirrors dislike feedback', () => {
    expect(isCandidateDisqualified(envelope('disliked-track'), baseProfile)).toBe(true);
    expect(isCandidateDisqualified(envelope('track-ok'), baseProfile)).toBe(false);
  });
});
