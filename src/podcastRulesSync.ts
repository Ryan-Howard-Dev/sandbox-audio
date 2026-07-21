/**
 * Sync per-show podcast rules with Tier34 (LAN / multi-device).
 */

import {
  getSandboxClientHeader,
  getTier34BaseUrl,
  tier34HealthOk,
} from './tier34/client';
import {
  applyRulesToSubscription,
  rulesFromSubscription,
  type PodcastShowRulesRow,
} from './podcastShowRules';
import {
  loadSubscriptions,
  PODCASTS_CHANGE_EVENT,
  updateSubscriptionMeta,
  type PodcastSubscription,
} from './podcastStorage';

export async function fetchPodcastRulesFromTier34(): Promise<PodcastShowRulesRow[]> {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) return [];
  try {
    const res = await fetch(`${base}/api/podcast/rules`, {
      headers: getSandboxClientHeader(),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { rules?: PodcastShowRulesRow[] };
    return Array.isArray(data.rules) ? data.rules : [];
  } catch {
    return [];
  }
}

export async function syncPodcastRulesToTier34(
  subs?: PodcastSubscription[],
): Promise<boolean> {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) return false;
  const ok = await tier34HealthOk();
  if (!ok) return false;

  const rules = (subs ?? loadSubscriptions()).map(rulesFromSubscription);
  try {
    const res = await fetch(`${base}/api/podcast/rules`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getSandboxClientHeader(),
      },
      body: JSON.stringify({ rules }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pullAndMergePodcastRulesFromTier34(): Promise<number> {
  const remote = await fetchPodcastRulesFromTier34();
  if (!remote.length) return 0;
  let merged = 0;
  const subs = loadSubscriptions();
  for (const rules of remote) {
    const sub = subs.find((s) => s.id === rules.feedId);
    if (!sub) continue;
    const patch = applyRulesToSubscription(sub, rules);
    if (Object.keys(patch).length === 0) continue;
    updateSubscriptionMeta(sub.id, patch);
    merged += 1;
  }
  return merged;
}

export function initPodcastRulesSync(): () => void {
  if (typeof window === 'undefined') return () => {};

  const push = () => {
    void syncPodcastRulesToTier34();
  };
  const pull = () => {
    void pullAndMergePodcastRulesFromTier34();
  };

  pull();
  push();

  window.addEventListener(PODCASTS_CHANGE_EVENT, push);
  const interval = window.setInterval(pull, 15 * 60 * 1000);

  return () => {
    window.removeEventListener(PODCASTS_CHANGE_EVENT, push);
    window.clearInterval(interval);
  };
}
