import { describe, expect, it } from 'vitest';
import {
  MUSIC_RELEASE_CHANNEL_ID,
  PODCAST_EPISODE_CHANNEL_ID,
  notificationIdFromTag,
} from './nativeLocalNotifications';

describe('capacitor plugin thenable hazard', () => {
  /*
   * A Capacitor plugin is a Proxy that answers ANY property access, including `.then`. Returning
   * one directly from an async function makes the runtime treat it as a thenable and call
   * `plugin.then(resolve, reject)`, which Android rejects with
   * `"LocalNotifications.then()" is not implemented on android`. The plugin is then never
   * returned and every caller's await rejects — it broke app startup and the E2E gate.
   *
   * This reproduces the mechanism against a stand-in proxy so the shape stays understood: any
   * loader must wrap the plugin rather than return it bare.
   */
  const pluginLikeProxy = () =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === 'then') {
            return () => {
              throw new Error('"LocalNotifications.then()" is not implemented on android');
            };
          }
          return () => undefined;
        },
      },
    );

  it('throws when an async function returns the plugin proxy bare', async () => {
    const bad = async () => pluginLikeProxy();
    await expect(bad()).rejects.toThrow(/then\(\)" is not implemented/);
  });

  it('resolves when the plugin is wrapped, which is what loadLocalNotifications does', async () => {
    const good = async () => ({ plugin: pluginLikeProxy() });
    const { plugin } = await good();
    expect(plugin).toBeDefined();
  });
});

describe('nativeLocalNotifications', () => {
  it('derives stable positive notification ids from tags', () => {
    const a = notificationIdFromTag('followed-release-abc');
    const b = notificationIdFromTag('followed-release-abc');
    const c = notificationIdFromTag('podcast-episode-xyz');
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(c).toBeGreaterThan(0);
    expect(a).not.toBe(c);
  });

  it('exports distinct channel ids for music and podcasts', () => {
    expect(MUSIC_RELEASE_CHANNEL_ID).not.toBe(PODCAST_EPISODE_CHANNEL_ID);
    expect(MUSIC_RELEASE_CHANNEL_ID).toContain('release');
    expect(PODCAST_EPISODE_CHANNEL_ID).toContain('podcast');
  });
});
