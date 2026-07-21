import React from 'react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import { isLocalVaultEnvelope } from '../../localVaultTrack';

export function LocalOfflineBadge({ envelope }: { envelope: MediaEnvelope }) {
  if (!isLocalVaultEnvelope(envelope)) return null;
  return (
    <span className="local-offline-badge" title="Available offline from Locker">
      Offline
    </span>
  );
}
