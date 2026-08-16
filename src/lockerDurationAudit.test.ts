// @vitest-environment jsdom
/**
 * A file that is not the track it says it is.
 *
 * Reproduced on a phone: tapping "Vultures" played something else. The locker row had the right
 * title, artist and album, and stated 276 seconds. The audio ran 3945 — a whole album under one
 * song's name.
 *
 * Nothing caught it because mobile acquisition stamps the catalog's duration onto the row, so the
 * existing check compared that number against the catalog it came from and always agreed.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  auditPlayingDuration,
  clearDurationMismatch,
  fileDurationContradictsMetadata,
  listDurationMismatches,
  recordDurationMismatch,
} from './lockerDurationAudit';

beforeEach(() => {
  localStorage.clear();
});

describe('fileDurationContradictsMetadata', () => {
  it('catches an album filed as a song', () => {
    // The measured case, to the second.
    expect(fileDurationContradictsMetadata(276, 3945)).toBe(true);
  });

  it('catches a file far shorter than claimed, which is usually a preview', () => {
    expect(fileDurationContradictsMetadata(276, 30)).toBe(true);
  });

  it('accepts the seconds of difference between masters and encoders', () => {
    for (const actual of [265, 276, 290]) {
      expect(fileDurationContradictsMetadata(276, actual)).toBe(false);
    }
  });

  it('abstains when either side is unknown', () => {
    // A missing duration is not evidence of a wrong file.
    expect(fileDurationContradictsMetadata(undefined, 3945)).toBe(false);
    expect(fileDurationContradictsMetadata(276, undefined)).toBe(false);
    expect(fileDurationContradictsMetadata(0, 3945)).toBe(false);
  });

  it('abstains on clips too short to reason about', () => {
    expect(fileDurationContradictsMetadata(5, 12)).toBe(false);
  });
});

describe('recording what was heard', () => {
  const vultures = {
    envelopeId: 'local-locker-1784969876523-e1bv92',
    title: 'Vultures',
    artist: '¥$, Kanye West & Ty Dolla $ign',
    statedSeconds: 276,
    actualSeconds: 3945,
  };

  it('records a mismatch found while playing', () => {
    const found = auditPlayingDuration(vultures);
    expect(found).not.toBeNull();
    expect(listDurationMismatches()).toHaveLength(1);
    expect(listDurationMismatches()[0].actualSeconds).toBe(3945);
  });

  it('says nothing when the file matches', () => {
    expect(auditPlayingDuration({ ...vultures, actualSeconds: 276 })).toBeNull();
    expect(listDurationMismatches()).toHaveLength(0);
  });

  it('does not report the same file twice', () => {
    // Playing a wrong track again is not a second fault.
    expect(recordDurationMismatch(vultures)).toBe(true);
    expect(recordDurationMismatch(vultures)).toBe(false);
    expect(listDurationMismatches()).toHaveLength(1);
  });

  it('forgets a row once it has been dealt with', () => {
    recordDurationMismatch(vultures);
    clearDurationMismatch(vultures.envelopeId);
    expect(listDurationMismatches()).toHaveLength(0);
  });

  it('needs an envelope to attach the finding to', () => {
    expect(auditPlayingDuration({ ...vultures, envelopeId: '  ' })).toBeNull();
  });
});
