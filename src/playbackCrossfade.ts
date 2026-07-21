/**
 * Web Audio gain routing for crossfade between HTMLAudioElement tracks.
 *
 * Chain (Sandbox Sonic enabled):
 *   Source → ReplayGain → PEQ preset / route EQ → Spatial widener (headphones) → limiter / ear safety → Master Volume → Destination
 *
 * Chain (Sandbox Sonic disabled):
 *   Source → ReplayGain → Master Volume → Destination
 *
 * Tauri audiophile mode bypasses this router entirely (native PCM path).
 */

import { CROSSFADE_DURATION_SEC, loadCrossfadeEnabled, loadSandboxSonicEnabled } from './sandboxSettings';
import { loadPodcastVoiceBoostEnabled } from './podcastSettings';
import { PodcastVoiceBoostChain, resolveVoiceBoostEnabled } from './podcastVoiceBoost';
import { updatePlaybackDiagnostics } from './playbackDiagnostics';
import { computePlaybackGainDb, replayGainMultiplier } from './replayGainPlayback';
import { SandboxSonicChain } from './sandboxSonic';
import { resetEarSafetySession } from './earSafety';

export class PlaybackCrossfadeRouter {
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private replayGain: GainNode | null = null;
  private sonic: SandboxSonicChain | null = null;
  private voiceBoost: PodcastVoiceBoostChain | null = null;
  private podcastPlayback = false;
  private podcastFeedId: string | null = null;
  private episodeVolumeBoostDb = 0;
  private masterGain: GainNode | null = null;
  private boundElement: HTMLAudioElement | null = null;
  private directElement: HTMLAudioElement | null = null;
  private directMode = false;
  private userVolume = 0.8;
  private replayGainDb = 0;
  private sonicEnabled = loadSandboxSonicEnabled();
  private monitorAnalyser: AnalyserNode | null = null;
  private monitorAnalyserAttached = false;

  get usesDirectOutput(): boolean {
    return this.directMode;
  }

  /** True once createMediaElementSource ran — element cannot revert to direct output. */
  get hasWebAudioBinding(): boolean {
    return this.source != null;
  }

  private ensureGraph(): boolean {
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (!this.replayGain) {
        this.replayGain = this.ctx.createGain();
        this.replayGain.gain.value = replayGainMultiplier(computePlaybackGainDb(this.replayGainDb));
      }
      if (!this.masterGain) {
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.userVolume;
      }
      this.syncSonicChain();
      return true;
    } catch (err) {
      console.warn('[PlaybackCrossfadeRouter] Web Audio graph init failed:', err);
      return false;
    }
  }

  private syncSonicChain(): void {
    if (!this.ctx || !this.replayGain || !this.masterGain) return;

    this.sonicEnabled = loadSandboxSonicEnabled();
    this.replayGain.disconnect();
    this.sonic?.getOutput()?.disconnect();
    this.voiceBoost?.disconnect();
    this.masterGain.disconnect();

    const voiceBoostOn =
      this.podcastPlayback && resolveVoiceBoostEnabled(this.podcastFeedId);
    if (voiceBoostOn) {
      if (!this.voiceBoost) {
        this.voiceBoost = new PodcastVoiceBoostChain(this.ctx);
      }
      this.voiceBoost.setEnabled(true);
    }

    let tail: AudioNode = this.replayGain;
    if (voiceBoostOn && this.voiceBoost) {
      tail.connect(this.voiceBoost.getInput());
      tail = this.voiceBoost.getOutput();
    }

    if (this.sonicEnabled) {
      if (!this.sonic) {
        this.sonic = new SandboxSonicChain(this.ctx);
      }
      this.sonic.setEnabled(true);
      this.sonic.setUserVolume(this.userVolume);
      tail.connect(this.sonic.getInput());
      this.sonic.getOutput().connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      void this.sonic.refreshRoute(true);
      return;
    }

    this.sonic?.setEnabled(false);
    tail.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
    updatePlaybackDiagnostics({ sonicRoute: null, earSafetyGain: 1 });
  }

  /** Podcast-only Voice Boost — rebuilds output chain when toggled. */
  setPodcastPlayback(active: boolean): void {
    const changed = this.podcastPlayback !== active;
    this.podcastPlayback = active;
    if (!active) {
      this.podcastFeedId = null;
      this.episodeVolumeBoostDb = 0;
    }
    if (!this.ctx) return;
    if (changed || active) {
      this.syncSonicChain();
      void this.sonic?.refreshRoute(true);
      this.applyReplayGainImmediate();
    }
    if (!active && this.voiceBoost) {
      this.voiceBoost.dispose();
      this.voiceBoost = null;
      this.syncSonicChain();
    }
  }

  setPodcastFeedId(feedId: string | null): void {
    if (this.podcastFeedId === feedId) return;
    this.podcastFeedId = feedId;
    if (!this.ctx || !this.podcastPlayback) return;
    this.syncSonicChain();
    void this.sonic?.refreshRoute(true);
    this.applyReplayGainImmediate();
  }

  setPodcastEpisodeVolumeBoostDb(db: number): void {
    this.episodeVolumeBoostDb = Number.isFinite(db) ? db : 0;
    this.applyReplayGainImmediate();
  }

  private applyReplayGainImmediate(): void {
    if (!this.replayGain || !this.ctx) return;
    const gainDb =
      computePlaybackGainDb(this.replayGainDb) + (this.podcastPlayback ? this.episodeVolumeBoostDb : 0);
    const mult = replayGainMultiplier(gainDb);
    this.replayGain.gain.setValueAtTime(mult, this.ctx.currentTime);
    updatePlaybackDiagnostics({
      replayGainDb: gainDb,
      calculatedMultiplier: mult,
      finalUserVolume: this.userVolume,
    });
  }

  /** Re-read Settings toggles and rebuild the sonic chain if needed. */
  refreshSandboxSonic(): void {
    if (!this.ctx) return;
    this.syncSonicChain();
    void this.sonic?.refreshRoute(true);
    this.applyReplayGainImmediate();
  }

  refreshPodcastVoiceBoost(): void {
    if (!this.ctx) return;
    this.syncSonicChain();
    void this.sonic?.refreshRoute(true);
    this.applyReplayGainImmediate();
  }

  /** Set ReplayGain correction (dB) before playback starts on a new track. */
  setReplayGainDb(db: number): void {
    this.replayGainDb = db;
    this.ensureGraph();
    this.applyReplayGainImmediate();
  }

  /** Bypass Web Audio for cross-origin streams without CORS (catalog previews). */
  attachDirect(audio: HTMLAudioElement, volume: number): void {
    this.directMode = true;
    this.directElement = audio;
    this.userVolume = volume;
    audio.volume = volume;
    audio.muted = false;
    updatePlaybackDiagnostics({
      replayGainDb: computePlaybackGainDb(this.replayGainDb),
      calculatedMultiplier: replayGainMultiplier(computePlaybackGainDb(this.replayGainDb)),
      finalUserVolume: volume,
      sonicRoute: null,
      earSafetyGain: 1,
    });
  }

  attach(audio: HTMLAudioElement, volume: number): void {
    this.directMode = false;
    this.directElement = null;
    this.userVolume = volume;
    if (!this.ensureGraph()) {
      audio.volume = volume;
      updatePlaybackDiagnostics({
        replayGainDb: computePlaybackGainDb(this.replayGainDb),
        calculatedMultiplier: replayGainMultiplier(computePlaybackGainDb(this.replayGainDb)),
        finalUserVolume: volume,
      });
      return;
    }

    if (this.boundElement === audio && this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(volume, this.ctx.currentTime);
      this.sonic?.setUserVolume(volume);
      this.applyReplayGainImmediate();
      audio.volume = 1.0;
      return;
    }
    if (this.boundElement && this.boundElement !== audio) {
      console.warn('[PlaybackCrossfadeRouter] cannot rebind MediaElementSource');
      return;
    }
    try {
      if (!this.source) {
        this.source = this.ctx!.createMediaElementSource(audio);
        this.source.connect(this.replayGain!);
        this.boundElement = audio;
      }
      audio.volume = 1.0;
      this.applyReplayGainImmediate();
      this.masterGain!.gain.setValueAtTime(volume, this.ctx!.currentTime);
      this.sonic?.setUserVolume(volume);
      void this.sonic?.refreshRoute();
    } catch (err) {
      console.warn('[PlaybackCrossfadeRouter] Web Audio attach failed:', err);
      audio.volume = volume;
    }
  }

  detach(): void {
    try {
      this.source?.disconnect();
      this.replayGain?.disconnect();
      this.sonic?.dispose();
      this.voiceBoost?.dispose();
      this.masterGain?.disconnect();
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.source = null;
    this.replayGain = null;
    this.sonic = null;
    this.voiceBoost = null;
    this.masterGain = null;
    this.ctx = null;
    this.boundElement = null;
    this.directElement = null;
    this.directMode = false;
    this.detachLevelMonitor();
    resetEarSafetySession();
  }

  setVolume(level: number): void {
    this.userVolume = level;
    if (this.directMode && this.directElement) {
      this.directElement.volume = level;
      updatePlaybackDiagnostics({ finalUserVolume: level });
      return;
    }
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(level, this.ctx.currentTime);
      this.sonic?.setUserVolume(level);
      updatePlaybackDiagnostics({ finalUserVolume: level });
      return;
    }
    if (this.boundElement) {
      this.boundElement.volume = level;
      updatePlaybackDiagnostics({ finalUserVolume: level });
    }
  }

  setPlaying(playing: boolean): void {
    this.sonic?.setPlaying(playing);
  }

  async fadeOut(durationSec = CROSSFADE_DURATION_SEC): Promise<void> {
    if (!loadCrossfadeEnabled() || !this.masterGain || !this.ctx) return;
    const now = this.ctx.currentTime;
    const current = Math.max(this.masterGain.gain.value, 0.0001);
    this.masterGain.gain.setValueAtTime(current, now);
    this.masterGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    await new Promise((r) => setTimeout(r, durationSec * 1000));
  }

  fadeIn(durationSec = CROSSFADE_DURATION_SEC): void {
    if (!this.masterGain || !this.ctx) return;
    if (!loadCrossfadeEnabled()) {
      this.masterGain.gain.setValueAtTime(this.userVolume, this.ctx.currentTime);
      updatePlaybackDiagnostics({ finalUserVolume: this.userVolume });
      return;
    }
    const now = this.ctx.currentTime;
    this.masterGain.gain.setValueAtTime(0.0001, now);
    this.masterGain.gain.exponentialRampToValueAtTime(
      Math.max(this.userVolume, 0.0001),
      now + durationSec,
    );
    updatePlaybackDiagnostics({ finalUserVolume: this.userVolume });
  }

  async resumeContext(): Promise<void> {
    if (!this.ctx || this.directMode) return;
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (err) {
        console.warn('[PlaybackCrossfadeRouter] AudioContext resume failed:', err);
      }
    }
  }

  /** Tap playback levels for podcast Smart Speed (parallel branch, does not affect output). */
  attachLevelMonitor(): AnalyserNode | null {
    if (this.directMode || !this.ensureGraph() || !this.replayGain || !this.ctx) {
      return null;
    }
    if (!this.monitorAnalyser) {
      this.monitorAnalyser = this.ctx.createAnalyser();
      this.monitorAnalyser.fftSize = 2048;
      this.monitorAnalyser.smoothingTimeConstant = 0.38;
    }
    if (!this.monitorAnalyserAttached) {
      try {
        this.replayGain.connect(this.monitorAnalyser);
        this.monitorAnalyserAttached = true;
      } catch (err) {
        console.warn('[PlaybackCrossfadeRouter] level monitor attach failed:', err);
        return null;
      }
    }
    return this.monitorAnalyser;
  }

  detachLevelMonitor(): void {
    try {
      this.monitorAnalyser?.disconnect();
    } catch {
      /* ignore */
    }
    this.monitorAnalyser = null;
    this.monitorAnalyserAttached = false;
  }
}
