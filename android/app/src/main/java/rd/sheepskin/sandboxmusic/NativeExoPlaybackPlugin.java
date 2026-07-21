package rd.sheepskin.sandboxmusic;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import androidx.annotation.Nullable;
import java.io.File;
import java.io.IOException;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.os.Build;

/**
 * ExoPlayer-based decode path outside the WebView for locker/HTTP streams.
 * Gapless: MediaItem queue with preload — no stop/clear between consecutive tracks.
 */
@CapacitorPlugin(name = "NativeExoPlayback")
public class NativeExoPlaybackPlugin extends Plugin {

    private static final String TAG = "NativeExoPlayback";

    @Nullable
    private static NativeExoPlaybackPlugin instance;

    @Nullable
    private ExoPlayer player;
    private float replayGainLinear = 1f;
    private String lastError = null;
    private boolean gaplessEnabled = true;
    private boolean crossfadeEnabled = false;
    private long crossfadeDurationMs = 2500L;
    private long gaplessCrossfadeDurationMs = 600L;
    private boolean bitPerfectEnabled = false;
    /** Last preferred wired sink id — avoid re-binding the same device mid-playback. */
    private int lastPreferredWiredDeviceId = -1;
    private boolean wiredDacStabilityEnabled = false;
    private final Map<Integer, Float> queueIndexToGainLinear = new HashMap<>();
    private final ExoVolumeFader volumeFader;
    private final ExoPlaybackLoudness loudnessHelper = new ExoPlaybackLoudness();
    /** App volume slider 0–1.5 (150% = software boost above system max). */
    private float userVolumeLinear = 1f;
    private boolean pendingAutoPlay = false;
    /** Blocks OEM auto-play nudges while the user explicitly paused. */
    private boolean userPausedByUi = false;
    private int lastMediaItemIndex = -1;
    private String lastEnvelopeId = "";
    private String lastTitle = "";
    private String lastArtist = "";
    private String lastAlbum = "";
    private String lastArtworkUrl = "";
    private double lastCatalogDurationSecs = 0;
    private long lastPlaybackNudgeMs = 0;
    private final Map<String, TrackMeta> trackMetaByKey = new HashMap<>();
    private final Map<String, String> urlToMetaKey = new HashMap<>();
    private final ExecutorService playbackExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean destroyed = false;
    /** Transient audio-focus pause — distinct from explicit user pause. */
    private boolean systemAudioFocusPaused = false;
    private boolean screenLockKeepaliveActive = false;
    private volatile boolean nativePlaybackActiveCached = false;
    private long screenLockKeepaliveStartedMs = 0L;
    private static final long SCREEN_LOCK_NUDGE_MS = 2500L;
    private static final long SCREEN_LOCK_KEEPALIVE_MAX_MS = 30L * 60L * 1000L;

    public NativeExoPlaybackPlugin() {
        volumeFader = new ExoVolumeFader(mainHandler);
    }

    private static final class TrackMeta {
        String title = "";
        String artist = "";
        String album = "";
        String artworkUrl = "";
    }

    private String trackMetaKey(@Nullable String url, @Nullable String envelopeId) {
        if (envelopeId != null && !envelopeId.trim().isEmpty()) {
            return "env:" + envelopeId.trim();
        }
        if (url != null && !url.trim().isEmpty()) {
            return "url:" + url.trim();
        }
        return "";
    }

    private void storeTrackMetaForUrl(
        @Nullable String url,
        @Nullable String envelopeId,
        @Nullable String title,
        @Nullable String artist,
        @Nullable String album,
        @Nullable String artworkUrl
    ) {
        String key = trackMetaKey(url, envelopeId);
        if (key.isEmpty()) return;
        if (url != null && !url.trim().isEmpty() && envelopeId != null && !envelopeId.trim().isEmpty()) {
            urlToMetaKey.put(url.trim(), key);
        }
        TrackMeta meta = trackMetaByKey.get(key);
        if (meta == null) {
            meta = new TrackMeta();
            trackMetaByKey.put(key, meta);
        }
        if (title != null && !title.trim().isEmpty()) meta.title = title.trim();
        if (artist != null && !artist.trim().isEmpty()) meta.artist = artist.trim();
        if (album != null && !album.trim().isEmpty()) meta.album = album.trim();
        if (artworkUrl != null && !artworkUrl.trim().isEmpty()) meta.artworkUrl = artworkUrl.trim();
    }

    private void applyTrackMetaForUrl(@Nullable String url) {
        if (url == null || url.trim().isEmpty()) return;
        String key = urlToMetaKey.get(url.trim());
        if (key == null) {
            key = "url:" + url.trim();
        }
        TrackMeta meta = trackMetaByKey.get(key);
        if (meta == null) return;
        if (!meta.title.isEmpty()) lastTitle = meta.title;
        if (!meta.artist.isEmpty()) lastArtist = meta.artist;
        if (!meta.album.isEmpty()) lastAlbum = meta.album;
        if (!meta.artworkUrl.isEmpty()) lastArtworkUrl = meta.artworkUrl;
    }

    private void runOnMain(Runnable action) {
        if (destroyed) return;
        if (Looper.myLooper() == Looper.getMainLooper()) {
            action.run();
        } else {
            mainHandler.post(action);
        }
    }

    private void runOnMain(PluginCall call, Runnable action) {
        runOnMain(
            () -> {
                if (destroyed || call.isReleased()) return;
                try {
                    action.run();
                } catch (Exception e) {
                    if (!call.isReleased()) {
                        String msg = e.getMessage() != null ? e.getMessage() : "ExoPlayer error";
                        call.reject(msg);
                    }
                }
            });
    }

    @Override
    public void load() {
        instance = this;
        LocalStreamProxy.getInstance().setAppContext(getContext());
    }

    /** Becoming-noisy / unplug — pause Exo even when the WebView JS thread is frozen. */
    public static void pauseFromBecomingNoisy() {
        NativeExoPlaybackPlugin plug = instance;
        if (plug == null) {
            return;
        }
        plug.runOnMain(
            () -> {
                plug.userPausedByUi = true;
                plug.pendingAutoPlay = false;
                plug.systemAudioFocusPaused = false;
                plug.stopScreenLockKeepalive();
                plug.mainHandler.removeCallbacks(plug.autoPlayNudgeRunnable);
                ExoPlayer p = plug.player;
                if (p != null) {
                    p.setPlayWhenReady(false);
                    p.pause();
                    plug.syncForegroundFromPlayer(p);
                }
            });
    }

    /** Screen lock — WebView timers freeze on OnePlus; keep Exo audible without JS polls. */
    public static void onScreenOff() {
        NativeExoPlaybackPlugin plug = instance;
        if (plug == null) {
            return;
        }
        plug.runOnMain(
            () -> {
                ExoPlayer p = plug.player;
                if (p == null || plug.userPausedByUi || p.getMediaItemCount() == 0) {
                    return;
                }
                boolean shouldKeepAlive =
                    p.isPlaying()
                        || (p.getPlayWhenReady() && p.getCurrentPosition() > 0);
                if (!shouldKeepAlive) {
                    return;
                }
                plug.screenLockKeepaliveActive = true;
                plug.screenLockKeepaliveStartedMs = System.currentTimeMillis();
                android.util.Log.i(TAG, "screenOff keepalive start pos=" + p.getCurrentPosition());
                // Do not re-request audio focus here — FGS already holds it; a second
                // request from AndroidAudioSessionHelper steals focus and pauses Exo on OnePlus.
                plug.applyWiredOutputIfAvailable(p);
                plug.nudgePlaybackIfStuck(p);
                boolean playing = p.isPlaying() || p.getPlayWhenReady();
                plug.syncForegroundMetadata(p, playing);
                plug.mainHandler.removeCallbacks(plug.screenLockKeepaliveRunnable);
                plug.scheduleScreenLockKeepaliveTick();
            });
    }

    public static void onScreenOn() {
        NativeExoPlaybackPlugin plug = instance;
        if (plug == null) {
            return;
        }
        plug.runOnMain(
            () -> {
                plug.stopScreenLockKeepalive();
                ExoPlayer p = plug.player;
                if (p != null) {
                    boolean playing = p.isPlaying() || p.getPlayWhenReady();
                    plug.syncForegroundMetadata(p, playing);
                }
            });
    }

    /** Audio focus loss — pause natively; JS bridge may be frozen after screen lock. */
    public static void pauseFromAudioFocusLoss(boolean transientLoss) {
        NativeExoPlaybackPlugin plug = instance;
        if (plug == null) {
            return;
        }
        plug.runOnMain(
            () -> {
                plug.systemAudioFocusPaused = true;
                android.util.Log.i(TAG, "audioFocus pause transient=" + transientLoss);
                plug.stopScreenLockKeepalive();
                if (!transientLoss) {
                    plug.pendingAutoPlay = false;
                }
                plug.mainHandler.removeCallbacks(plug.autoPlayNudgeRunnable);
                ExoPlayer p = plug.player;
                if (p != null) {
                    p.setPlayWhenReady(false);
                    p.pause();
                    plug.syncForegroundFromPlayer(p);
                }
            });
    }

    public static void resumeFromAudioFocusGain() {
        NativeExoPlaybackPlugin plug = instance;
        if (plug == null) {
            return;
        }
        plug.runOnMain(
            () -> {
                if (!plug.systemAudioFocusPaused || plug.userPausedByUi) {
                    return;
                }
                plug.systemAudioFocusPaused = false;
                android.util.Log.i(TAG, "audioFocus resume");
                plug.pendingAutoPlay = true;
                ExoPlayer p = plug.ensurePlayer();
                AndroidAudioSessionHelper.requestAppAudioFocus(plug.getContext());
                plug.applyWiredOutputIfAvailable(p);
                p.setPlayWhenReady(true);
                p.play();
                plug.scheduleAutoPlayNudge(120);
                plug.syncForegroundFromPlayer(p);
            });
    }

    public static void nudgePlaybackOnAudioFocusGain() {
        NativeExoPlaybackPlugin plug = instance;
        if (plug == null) {
            return;
        }
        plug.runOnMain(
            () -> {
                if (plug.userPausedByUi || plug.systemAudioFocusPaused) {
                    return;
                }
                ExoPlayer p = plug.player;
                if (p == null) {
                    return;
                }
                plug.applyWiredOutputIfAvailable(p);
                plug.nudgePlaybackIfStuck(p);
                plug.syncForegroundFromPlayer(p);
            });
    }

    public static boolean isScreenLockKeepaliveActive() {
        NativeExoPlaybackPlugin plug = instance;
        return plug != null && plug.screenLockKeepaliveActive;
    }

    /** True when native Exo still has a loaded track — safe from any thread (no ExoPlayer access). */
    public static boolean hasActiveNativePlayback() {
        NativeExoPlaybackPlugin plug = instance;
        return plug != null && !plug.destroyed && plug.nativePlaybackActiveCached;
    }

    private void updateNativePlaybackActiveCache(@Nullable ExoPlayer p) {
        if (p == null || p.getMediaItemCount() == 0) {
            nativePlaybackActiveCached = false;
            return;
        }
        if (lastTitle == null || lastTitle.isEmpty()) {
            nativePlaybackActiveCached = false;
            return;
        }
        nativePlaybackActiveCached =
            p.isPlaying()
                || (p.getPlayWhenReady() && p.getPlaybackState() != Player.STATE_ENDED)
                || p.getCurrentPosition() > 250;
    }

    private void stopScreenLockKeepalive() {
        screenLockKeepaliveActive = false;
        mainHandler.removeCallbacks(screenLockKeepaliveRunnable);
    }

    private void scheduleScreenLockKeepaliveTick() {
        mainHandler.postDelayed(screenLockKeepaliveRunnable, SCREEN_LOCK_NUDGE_MS);
    }

    private final Runnable screenLockKeepaliveRunnable =
        () -> {
            if (!screenLockKeepaliveActive || destroyed) {
                screenLockKeepaliveActive = false;
                return;
            }
            if (System.currentTimeMillis() - screenLockKeepaliveStartedMs > SCREEN_LOCK_KEEPALIVE_MAX_MS) {
                screenLockKeepaliveActive = false;
                return;
            }
            if (userPausedByUi || systemAudioFocusPaused) {
                screenLockKeepaliveActive = false;
                return;
            }
            ExoPlayer p = player;
            if (p == null || p.getMediaItemCount() == 0) {
                screenLockKeepaliveActive = false;
                return;
            }
            applyWiredOutputIfAvailable(p);
            if (pendingAutoPlay) {
                nudgePlaybackIfStuck(p);
                if (!p.isPlaying() && p.getPlayWhenReady()) {
                    scheduleAutoPlayNudge(0);
                }
            }
            boolean playing = p.isPlaying() || p.getPlayWhenReady();
            syncForegroundMetadata(p, playing);
            if (screenLockKeepaliveActive) {
                scheduleScreenLockKeepaliveTick();
            }
        };

    private synchronized ExoPlayer ensurePlayer() {
        LockerBlobRegistry.warmFromDisk(getContext());
        if (player == null) {
            DefaultLoadControl loadControl = buildLoadControl();

            DefaultHttpDataSource.Factory httpFactory =
                new DefaultHttpDataSource.Factory()
                    .setUserAgent(
                        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36")
                    .setAllowCrossProtocolRedirects(true);
            // Do not attach YouTube Referer/Origin globally — podcast CDNs reject them.
            // YouTube/googlevideo streams are proxied via LocalStreamProxy with per-URL headers.
            Map<String, String> streamHeaders = new HashMap<>();
            streamHeaders.put("Accept", "audio/*,*/*;q=0.9");
            httpFactory.setDefaultRequestProperties(streamHeaders);

            DefaultDataSource.Factory dataSourceFactory =
                new DefaultDataSource.Factory(getContext(), httpFactory);

            player =
                new ExoPlayer.Builder(getContext())
                    .setLooper(Looper.getMainLooper())
                    .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSourceFactory))
                    .setLoadControl(loadControl)
                    .build();

            AudioAttributes attrs =
                new AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build();
            player.setAudioAttributes(attrs, false);

            player.addListener(
                new Player.Listener() {
                    @Override
                    public void onPlayerError(PlaybackException error) {
                        lastError =
                            error.getMessage() != null
                                ? error.getMessage()
                                : "playback error";
                    }

                    @Override
                    public void onPlaybackStateChanged(int state) {
                        if (state != Player.STATE_ENDED) {
                            lastError = null;
                        }
                        ExoPlayer p = player;
                        if (p == null) return;
                        if (
                            pendingAutoPlay &&
                            state == Player.STATE_READY &&
                            p.getPlayWhenReady() &&
                            !p.isPlaying()
                        ) {
                            p.play();
                        }
                        if (state == Player.STATE_ENDED) {
                            int idx = p.getCurrentMediaItemIndex();
                            int count = p.getMediaItemCount();
                            if (count > 0 && idx < count - 1) {
                                pendingAutoPlay = true;
                                userPausedByUi = false;
                                p.seekTo(idx + 1, 0);
                                p.setPlayWhenReady(true);
                                p.play();
                                scheduleAutoPlayNudge(120);
                            } else {
                                pendingAutoPlay = false;
                                JSObject evt = new JSObject();
                                evt.put("event", "queueEnded");
                                evt.put("index", idx);
                                evt.put("queueLength", count);
                                notifyListeners("playbackEvent", evt);
                                syncForegroundMetadata(p, false);
                            }
                        }
                    }

                    @Override
                    public void onMediaItemTransition(
                        @Nullable MediaItem mediaItem,
                        int reason
                    ) {
                        ExoPlayer p = player;
                        if (p == null) return;
                        int idx = p.getCurrentMediaItemIndex();
                        if (idx != lastMediaItemIndex) {
                            lastMediaItemIndex = idx;
                            if (
                                reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO &&
                                !userPausedByUi
                            ) {
                                pendingAutoPlay = true;
                                p.setPlayWhenReady(true);
                                if (!p.isPlaying()) {
                                    p.play();
                                    scheduleAutoPlayNudge(120);
                                }
                            }
                            applyGainForQueueIndex(p, idx, reason);
                            JSObject evt = new JSObject();
                            evt.put("event", "mediaItemTransition");
                            evt.put("index", idx);
                            evt.put("queueLength", p.getMediaItemCount());
                            evt.put("reason", reason);
                            if (mediaItem != null && mediaItem.localConfiguration != null) {
                                Uri uri = mediaItem.localConfiguration.uri;
                                if (uri != null) {
                                    String url = uri.toString();
                                    evt.put("url", url);
                                    applyTrackMetaForUrl(url);
                                    syncForegroundMetadata(p, p.isPlaying());
                                }
                            }
                            notifyListeners("playbackEvent", evt);
                        }
                    }
                }
            );
        }
        return player;
    }

    @Nullable
    private String currentMediaUri() {
        ExoPlayer p = player;
        if (p == null) return null;
        MediaItem item = p.getCurrentMediaItem();
        if (item == null || item.localConfiguration == null) return null;
        Uri uri = item.localConfiguration.uri;
        return uri != null ? uri.toString() : null;
    }

    private final Runnable autoPlayNudgeRunnable =
        () -> {
            ExoPlayer p = player;
            if (p == null || userPausedByUi || systemAudioFocusPaused || !pendingAutoPlay || p.isPlaying()) return;
            AndroidAudioSessionHelper.requestAppAudioFocus(getContext());
            p.setPlayWhenReady(true);
            if (p.getPlaybackState() == Player.STATE_IDLE && p.getMediaItemCount() > 0) {
                p.prepare();
            }
            p.play();
        };

    /** OnePlus/OEM WebViews: prepared media can stay idle until an explicit play nudge. */
    private void scheduleAutoPlayNudge(long delayMs) {
        mainHandler.removeCallbacks(autoPlayNudgeRunnable);
        mainHandler.postDelayed(autoPlayNudgeRunnable, delayMs);
    }

    /**
     * Soft-bind Exo to USB/wired sink when connected (API 31+ preferred device).
     * Idempotent: skips setPreferredAudioDevice / session churn when already bound
     * to the same wired sink (repeated binds stutter on OnePlus + USB DAC).
     * handleAudioFocus stays false to match ensurePlayer (avoids focus churn on DAC).
     */
    private void applyWiredOutputIfAvailable(@Nullable ExoPlayer p) {
        if (p == null) {
            return;
        }
        Context ctx = getContext();
        if (ctx == null) {
            return;
        }
        if (!AndroidAudioSessionHelper.ROUTE_WIRED.equals(
            AndroidAudioSessionHelper.detectOutputRoute(ctx))) {
            lastPreferredWiredDeviceId = -1;
            return;
        }
        AudioDeviceInfo wired = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            wired = AndroidAudioSessionHelper.findWiredOutputDevice(ctx);
        }
        int wiredId = wired != null ? wired.getId() : -1;
        // Already soft-bound to this sink — do not reconfigure mid-playback.
        if (wiredId >= 0 && wiredId == lastPreferredWiredDeviceId) {
            return;
        }
        if (getActivity() != null) {
            AndroidAudioSessionHelper.configureActivityAudio(getActivity());
        }
        AndroidAudioSessionHelper.requestAppAudioFocus(ctx);
        AudioAttributes attrs =
            new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build();
        // false = do not let Exo steal/abandon focus on every route apply (Jul 7 stability).
        p.setAudioAttributes(attrs, false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && wired != null) {
            p.setPreferredAudioDevice(wired);
            lastPreferredWiredDeviceId = wiredId;
        }
    }

    /**
     * Hard hot-plug: pause/resume only while already playing so AudioTrack leaves the speaker.
     * Idle/loading paths use soft apply only — pause loops were breaking play start on DAC.
     */
    private void reroutePlaybackToWired(@Nullable ExoPlayer p, boolean forceRestartIfPlaying) {
        if (p == null) {
            return;
        }
        Context ctx = getContext();
        if (ctx == null) {
            return;
        }
        if (!AndroidAudioSessionHelper.ROUTE_WIRED.equals(
            AndroidAudioSessionHelper.detectOutputRoute(ctx))) {
            return;
        }
        boolean wasPlaying = p.isPlaying();
        if (!forceRestartIfPlaying || !wasPlaying) {
            applyWiredOutputIfAvailable(p);
            return;
        }
        // Force AudioTrack rebuild onto DAC — clear preferred cache so soft-bind re-applies.
        lastPreferredWiredDeviceId = -1;
        long pos = p.getCurrentPosition();
        p.pause();
        applyWiredOutputIfAvailable(p);
        if (pos > 0) {
            p.seekTo(pos);
        }
        userPausedByUi = false;
        pendingAutoPlay = true;
        p.setPlayWhenReady(true);
        p.play();
    }

    @PluginMethod
    public void rerouteToWiredOutput(PluginCall call) {
        boolean forceRestart = Boolean.TRUE.equals(call.getBoolean("forceRestart", false));
        runOnMain(
            call,
            () -> {
                reroutePlaybackToWired(player, forceRestart);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put(
                    "route",
                    AndroidAudioSessionHelper.detectOutputRoute(getContext())
                );
                call.resolve(ret);
            });
    }

    private void nudgePlaybackIfStuck(ExoPlayer p) {
        if (userPausedByUi || systemAudioFocusPaused || !pendingAutoPlay || p.isPlaying()) return;
        int ps = p.getPlaybackState();
        if (ps != Player.STATE_READY && ps != Player.STATE_IDLE) {
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastPlaybackNudgeMs < 500) return;
        lastPlaybackNudgeMs = now;
        AndroidAudioSessionHelper.requestAppAudioFocus(getContext());
        p.setPlayWhenReady(true);
        if (ps == Player.STATE_IDLE && p.getMediaItemCount() > 0) {
            p.prepare();
        }
        p.play();
    }

    private JSObject buildStatus() {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("wired", true);
        ret.put(
            "message",
            gaplessEnabled
                ? crossfadeEnabled
                    ? "ExoPlayer gapless queue + native crossfade — content:// locker bridge + HTTP streams."
                    : "ExoPlayer gapless queue — content:// locker bridge + HTTP streams."
                : crossfadeEnabled
                    ? "ExoPlayer decode + native crossfade — content:// locker bridge + HTTP streams."
                    : "ExoPlayer decode active — content:// locker bridge + HTTP streams."
        );

        ExoPlayer p = player;
        if (p == null) {
            ret.put("state", "idle");
            ret.put("positionSecs", 0);
            ret.put("durationSecs", 0);
            ret.put("queueIndex", 0);
            ret.put("queueLength", 0);
            ret.put("gaplessEnabled", gaplessEnabled);
            return ret;
        }

        nudgePlaybackIfStuck(p);

        String state;
        if (p.getPlayerError() != null) {
            state = "error";
        } else if (p.isPlaying()) {
            state = "playing";
        } else if (p.getPlaybackState() == Player.STATE_BUFFERING) {
            state = "loading";
        } else if (p.getPlaybackState() == Player.STATE_READY) {
            state = p.getPlayWhenReady() ? "loading" : "paused";
        } else if (p.getPlaybackState() == Player.STATE_ENDED) {
            state = "stopped";
        } else if (p.getCurrentPosition() > 0) {
            state = "paused";
        } else {
            state = "idle";
        }

        long durationMs = p.getDuration();
        if (durationMs == C.TIME_UNSET || durationMs <= 0) {
            if (lastCatalogDurationSecs > 0) {
                durationMs = (long) (lastCatalogDurationSecs * 1000.0);
            } else {
                durationMs = 0;
            }
        }

        ret.put("state", state);
        ret.put("positionSecs", p.getCurrentPosition() / 1000.0);
        ret.put("durationSecs", durationMs / 1000.0);
        ret.put("queueIndex", p.getCurrentMediaItemIndex());
        ret.put("queueLength", p.getMediaItemCount());
        ret.put("gaplessEnabled", gaplessEnabled);
        ret.put("crossfadeEnabled", crossfadeEnabled);
        ret.put(
            "bitPerfectActive",
            ExoUsbBitPerfectHelper.shouldBypassAppVolume(getContext(), bitPerfectEnabled)
        );
        String url = currentMediaUri();
        if (url != null) ret.put("currentUrl", url);
        if (lastError != null) ret.put("error", lastError);
        if (lastEnvelopeId != null && !lastEnvelopeId.isEmpty()) {
            ret.put("envelopeId", lastEnvelopeId);
        }
        if (lastTitle != null && !lastTitle.isEmpty()) ret.put("title", lastTitle);
        if (lastArtist != null && !lastArtist.isEmpty()) ret.put("artist", lastArtist);
        if (lastAlbum != null && !lastAlbum.isEmpty()) ret.put("album", lastAlbum);
        if (lastArtworkUrl != null && !lastArtworkUrl.isEmpty()) {
            ret.put("artworkUrl", lastArtworkUrl);
        }
        return ret;
    }

    private void syncForegroundPlaybackOnly(ExoPlayer p, boolean playing) {
        if (lastTitle == null || lastTitle.isEmpty()) return;
        long pos = p != null ? p.getCurrentPosition() : 0L;
        long dur = p != null ? p.getDuration() : 0L;
        if (dur == C.TIME_UNSET) dur = 0L;
        MediaPlaybackForegroundService.updatePlaybackState(
            playing,
            pos,
            dur,
            1f,
            System.currentTimeMillis()
        );
        MediaPlaybackForegroundService.requestRefresh(getContext());
    }

    /** Mirror actual Exo audible state — avoids lock-screen "playing" while AudioTrack is silent. */
    private void syncForegroundFromPlayer(@Nullable ExoPlayer p) {
        if (p == null || lastTitle == null || lastTitle.isEmpty()) {
            return;
        }
        boolean playing = p.isPlaying();
        long pos = p.getCurrentPosition();
        long dur = p.getDuration();
        if (dur == C.TIME_UNSET) {
            if (lastCatalogDurationSecs > 0) {
                dur = (long) (lastCatalogDurationSecs * 1000.0);
            } else {
                dur = 0L;
            }
        }
        long revision = MediaPlaybackForegroundService.allocateMetadataRevision();
        MediaPlaybackForegroundService.updatePlaybackState(playing, pos, dur, 1f, revision);
        MediaPlaybackForegroundService.requestRefresh(getContext());
    }

    private void syncForegroundMetadata(ExoPlayer p, boolean playing) {
        syncForegroundMetadata(p, playing, 0L);
    }

    private void syncForegroundMetadata(ExoPlayer p, boolean playing, long revisionOverride) {
        if (lastTitle == null || lastTitle.isEmpty()) return;
        long pos = p != null ? p.getCurrentPosition() : 0L;
        long dur = p != null ? p.getDuration() : 0L;
        if (dur == C.TIME_UNSET) {
            if (lastCatalogDurationSecs > 0) {
                dur = (long) (lastCatalogDurationSecs * 1000.0);
            } else {
                dur = 0L;
            }
        }
        long revision =
            revisionOverride > 0L
                ? revisionOverride
                : MediaPlaybackForegroundService.allocateMetadataRevision();
        MediaPlaybackForegroundService.updateMetadata(
            lastTitle,
            lastArtist != null ? lastArtist : "",
            lastAlbum != null ? lastAlbum : "",
            lastArtworkUrl,
            lastEnvelopeId,
            revision
        );
        MediaPlaybackForegroundService.updatePlaybackState(
            playing,
            pos,
            dur,
            1f,
            revision
        );
        MediaPlaybackForegroundService.ensureServiceRunning(getContext());
        MediaPlaybackForegroundService.requestRefresh(getContext());
        updateNativePlaybackActiveCache(p);
    }

    private void applyTrackMetadata(PluginCall call) {
        String envelopeId = call.getString("envelopeId");
        if (envelopeId != null) lastEnvelopeId = envelopeId.trim();
        String title = call.getString("title");
        if (title != null) lastTitle = title.trim();
        String artist = call.getString("artist");
        if (artist != null) lastArtist = artist.trim();
        String album = call.getString("album");
        if (album != null) lastAlbum = album.trim();
        String artworkUrl = call.getString("artworkUrl");
        if (artworkUrl != null) lastArtworkUrl = artworkUrl.trim();
        Double durationSecs = call.getDouble("durationSeconds");
        if (durationSecs != null && durationSecs > 0) {
            lastCatalogDurationSecs = durationSecs;
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        runOnMain(call, () -> call.resolve(buildStatus()));
    }

    /** Localhost CORS-safe proxy for WebView Web Audio (podcast Smart Speed / Voice Boost). */
    @PluginMethod
    public void localStreamProxyUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url required");
            return;
        }
        LocalStreamProxy.getInstance().setAppContext(getContext());
        String proxied = LocalStreamProxy.getInstance().proxyUrlFor(url.trim());
        JSObject ret = new JSObject();
        ret.put("url", proxied);
        call.resolve(ret);
    }

    @PluginMethod
    public void prepare(PluginCall call) {
        runOnMain(
            call,
            () -> {
                ensurePlayer();
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("message", "ExoPlayer ready.");
                call.resolve(ret);
            });
    }

    @PluginMethod
    public void setGaplessEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", false);
        gaplessEnabled = enabled != null && enabled;
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("gaplessEnabled", gaplessEnabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void setCrossfadeEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", false);
        crossfadeEnabled = enabled != null && enabled;
        Double durationMs = call.getDouble("durationMs");
        if (durationMs != null && durationMs > 0) {
            crossfadeDurationMs = Math.round(durationMs);
        }
        Double gaplessMs = call.getDouble("gaplessDurationMs");
        if (gaplessMs != null && gaplessMs > 0) {
            gaplessCrossfadeDurationMs = Math.round(gaplessMs);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("crossfadeEnabled", crossfadeEnabled);
        ret.put("durationMs", crossfadeDurationMs);
        call.resolve(ret);
    }

    @PluginMethod
    public void setReplayGainDb(PluginCall call) {
        Double replayGainDb = call.getDouble("replayGainDb");
        runOnMain(
            call,
            () -> {
                replayGainLinear = effectiveLinearGain(replayGainDb);
                applyCombinedVolume(player);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("replayGainLinear", replayGainLinear);
                call.resolve(ret);
            });
    }

    @PluginMethod
    public void setBitPerfectEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", false);
        bitPerfectEnabled = enabled != null && enabled;
        runOnMain(
            call,
            () -> {
                ExoPlayer p = player;
                if (p != null) {
                    applyCombinedVolume(p);
                }
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("bitPerfectEnabled", bitPerfectEnabled);
                ret.put(
                    "bitPerfectActive",
                    ExoUsbBitPerfectHelper.shouldBypassAppVolume(getContext(), bitPerfectEnabled)
                );
                call.resolve(ret);
            });
    }

    @PluginMethod
    public void setWiredDacStabilityEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", true);
        wiredDacStabilityEnabled = enabled != null && enabled;
        WiredDacStabilityPrefs.setEnabled(getContext(), wiredDacStabilityEnabled);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put("wiredDacStabilityEnabled", wiredDacStabilityEnabled);
        call.resolve(ret);
    }

    private DefaultLoadControl buildLoadControl() {
        boolean usbStability =
            wiredDacStabilityEnabled
                && (WiredDacStabilityPrefs.isEnabled(getContext())
                    || ExoUsbBitPerfectHelper.isUsbDacRoute(getContext()));
        if (usbStability) {
            return new DefaultLoadControl.Builder()
                .setBufferDurationsMs(90_000, 240_000, 8_000, 16_000)
                .setPrioritizeTimeOverSizeThresholds(true)
                .setBackBuffer(45_000, true)
                .build();
        }
        return new DefaultLoadControl.Builder()
            .setBufferDurationsMs(60_000, 180_000, 5_000, 10_000)
            .setPrioritizeTimeOverSizeThresholds(true)
            .setBackBuffer(30_000, true)
            .build();
    }

    @PluginMethod
    public void getUsbBitPerfectSupport(PluginCall call) {
        ExoUsbBitPerfectHelper.JSObjectProbe probe =
            ExoUsbBitPerfectHelper.probe(getContext());
        JSObject ret = new JSObject();
        ret.put("available", probe.available);
        ret.put("usbDacConnected", probe.usbDacConnected);
        ret.put(
            "active",
            ExoUsbBitPerfectHelper.shouldBypassAppVolume(getContext(), bitPerfectEnabled)
        );
        ret.put("apiLevel", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    private boolean shouldBypassAppVolume() {
        return ExoUsbBitPerfectHelper.shouldBypassAppVolume(getContext(), bitPerfectEnabled);
    }

    private void applyCombinedVolume(@Nullable ExoPlayer p) {
        if (p == null) return;
        if (shouldBypassAppVolume()) {
            p.setVolume(1f);
            loudnessHelper.setBoostMillibels(0);
            return;
        }
        loudnessHelper.ensureAttached(p);
        float combined = userVolumeLinear * replayGainLinear;
        if (combined <= 0f) {
            p.setVolume(0f);
            loudnessHelper.setBoostMillibels(0);
            return;
        }
        if (combined <= 1f) {
            p.setVolume(combined);
            loudnessHelper.setBoostMillibels(0);
            return;
        }
        p.setVolume(1f);
        loudnessHelper.setBoostMillibels(ExoPlaybackLoudness.linearExtraToMillibels(combined));
    }

    private float effectiveLinearGain(@Nullable Double replayGainDb) {
        if (shouldBypassAppVolume()) {
            return 1f;
        }
        return ExoReplayGainUtil.linearGainFromNullableDb(replayGainDb);
    }

    private void storeGainForIndex(int index, @Nullable Double replayGainDb) {
        queueIndexToGainLinear.put(index, effectiveLinearGain(replayGainDb));
    }

    private float gainForQueueIndex(int index) {
        Float gain = queueIndexToGainLinear.get(index);
        if (gain != null) return gain;
        return shouldBypassAppVolume() ? 1f : replayGainLinear;
    }

    private void applyGainForQueueIndex(ExoPlayer p, int index, int reason) {
        float target = gainForQueueIndex(index);
        replayGainLinear = target;
        if (shouldBypassAppVolume()) {
            p.setVolume(1f);
            loudnessHelper.setBoostMillibels(0);
            return;
        }
        // Gapless queue handoff: avoid fade-to-zero between pre-enqueued items (audible gap).
        applyCombinedVolume(p);
    }

    @PluginMethod
    public void setUserVolume(PluginCall call) {
        Double volume = call.getDouble("volume");
        if (volume == null) {
            call.reject("volume required");
            return;
        }
        userVolumeLinear = (float) Math.max(0, Math.min(2.0, volume));
        runOnMain(
            call,
            () -> {
                applyCombinedVolume(player);
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("userVolumeLinear", userVolumeLinear);
                call.resolve(ret);
            });
    }

    @PluginMethod
    public void setPlaybackSpeed(PluginCall call) {
        Double speed = call.getDouble("speed");
        if (speed == null) {
            call.reject("speed required");
            return;
        }
        final float clamped = (float) Math.max(0.5, Math.min(3.0, speed));
        runOnMain(
            call,
            () -> {
                if (player != null) {
                    player.setPlaybackSpeed(clamped);
                }
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("speed", clamped);
                call.resolve(ret);
            });
    }

    @PluginMethod
    public void playUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url required");
            return;
        }

        Double replayGainDb = call.getDouble("replayGainDb");
        replayGainLinear = effectiveLinearGain(replayGainDb);

        boolean autoPlay = call.getBoolean("autoPlay", true);
        boolean resetQueue = call.getBoolean("resetQueue", true);
        boolean crossfade = Boolean.TRUE.equals(call.getBoolean("crossfade", false));
        Boolean gapless = call.getBoolean("gaplessEnabled");
        if (gapless != null) {
            gaplessEnabled = gapless;
        }

        final String trimmed = url.trim();
        final boolean useCrossfade = crossfade;
        if (YoutubeDlStreamResolver.isYoutubeWatchUrl(trimmed)) {
            playbackExecutor.execute(
                () -> {
                    if (destroyed) return;
                    YoutubeDlStreamResolver.FastWatchResolve fast =
                        YoutubeDlStreamResolver.resolveWatchUrlFast(getContext(), trimmed);
                    if (destroyed) return;
                    if (fast != null) {
                        String playUri = fast.uri;
                        if (!playUri.startsWith("file:") && LocalStreamProxy.needsLocalProxy(playUri)) {
                            playUri = LocalStreamProxy.getInstance().proxyUrlFor(playUri);
                        }
                        if (!"cache".equals(fast.kind)) {
                            cacheWatchInBackground(trimmed);
                        }
                        android.util.Log.i(TAG, "watch fast start kind=" + fast.kind);
                        runPlayUrlOnMain(call, playUri, autoPlay, resetQueue, useCrossfade, replayGainDb);
                        return;
                    }
                    String local =
                        YoutubeDlStreamResolver.downloadAudioToCache(getContext(), trimmed);
                    if (destroyed) return;
                    if (local != null) {
                        String fileUri = Uri.fromFile(new File(local)).toString();
                        android.util.Log.i(TAG, "watch url resolved to file cache");
                        runPlayUrlOnMain(call, fileUri, autoPlay, resetQueue, useCrossfade, replayGainDb);
                        return;
                    }
                    runOnMain(
                        call,
                        () ->
                            call.reject(
                                "YouTube offline playback requires yt-dlp download — no stream available"));
                });
            return;
        }

        String playUri = trimmed;
        if (LocalStreamProxy.needsLocalProxy(trimmed)) {
            playUri = LocalStreamProxy.getInstance().proxyUrlFor(trimmed);
        }
        runPlayUrlOnMain(call, playUri, autoPlay, resetQueue, useCrossfade, replayGainDb);
    }

    /** Cache full audio in background while streaming — instant replay on skip-back. */
    private void cacheWatchInBackground(String watchUrl) {
        playbackExecutor.execute(
            () -> {
                try {
                    YoutubeDlStreamResolver.downloadAudioToCache(getContext(), watchUrl);
                } catch (Exception e) {
                    android.util.Log.w(TAG, "background cache failed: " + e.getMessage());
                }
            });
    }

    private void runPlayUrlOnMain(
        PluginCall call,
        String trimmed,
        boolean autoPlay,
        boolean resetQueue,
        boolean crossfade,
        @Nullable Double replayGainDb
    ) {
        if (getActivity() == null) {
            call.reject("activity unavailable");
            return;
        }
        runOnMain(
            call,
            () -> {
                ExoPlayer p = ensurePlayer();
                lastError = null;
                applyTrackMetadata(call);

                AndroidAudioSessionHelper.requestAppAudioFocus(getContext());
                applyWiredOutputIfAvailable(p);
                // FGS sync only after prepare/play via syncForegroundMetadata — early
                // requestRefresh raced with WebView stop/start and killed the process on OnePlus.

                final float targetGain = effectiveLinearGain(replayGainDb);
                replayGainLinear = targetGain;

                Runnable finishSwitch =
                    () -> {
                        if (!resetQueue && gaplessEnabled && p.getMediaItemCount() > 0) {
                            int idx = indexOfUrl(p, trimmed);
                            if (idx >= 0) {
                                int currentIdx = p.getCurrentMediaItemIndex();
                                if (idx != currentIdx) {
                                    p.seekTo(idx, 0);
                                } else if (p.getPlaybackState() == Player.STATE_ENDED) {
                                    p.seekTo(idx, 0);
                                }
                                if (p.getPlaybackState() == Player.STATE_IDLE) {
                                    p.prepare();
                                }
                                storeGainForIndex(idx, replayGainDb);
                                lastMediaItemIndex = idx;
                                applyCombinedVolume(p);
                                pendingAutoPlay = autoPlay;
                                if (autoPlay) {
                                    userPausedByUi = false;
                                }
                                p.setPlayWhenReady(autoPlay);
                                if (autoPlay) {
                                    p.play();
                                    scheduleAutoPlayNudge(500);
                                }
                                storeTrackMetaForUrl(
                                    trimmed,
                                    lastEnvelopeId,
                                    lastTitle,
                                    lastArtist,
                                    lastAlbum,
                                    lastArtworkUrl
                                );
                                syncForegroundMetadata(p, autoPlay);
                                return;
                            }
                        }

                        if (resetQueue) {
                            p.clearMediaItems();
                            queueIndexToGainLinear.clear();
                            trackMetaByKey.clear();
                            urlToMetaKey.clear();
                            lastMediaItemIndex = -1;
                        }

                        applyCombinedVolume(p);
                        MediaItem item = MediaItem.fromUri(Uri.parse(trimmed));
                        int newIndex;
                        if (resetQueue || p.getMediaItemCount() == 0) {
                            p.setMediaItem(item);
                            newIndex = 0;
                        } else {
                            p.addMediaItem(item);
                            newIndex = p.getMediaItemCount() - 1;
                            p.seekTo(newIndex, 0);
                        }
                        storeGainForIndex(newIndex, replayGainDb);
                        lastMediaItemIndex = newIndex;
                        storeTrackMetaForUrl(
                            trimmed,
                            lastEnvelopeId,
                            lastTitle,
                            lastArtist,
                            lastAlbum,
                            lastArtworkUrl
                        );
                        p.prepare();
                        pendingAutoPlay = autoPlay;
                        if (autoPlay) {
                            userPausedByUi = false;
                        }
                        p.setPlayWhenReady(autoPlay);
                        if (autoPlay) {
                            p.play();
                            scheduleAutoPlayNudge(500);
                        }
                        syncForegroundMetadata(p, autoPlay);
                    };

                boolean shouldCrossfade =
                    crossfade &&
                    crossfadeEnabled &&
                    p.isPlaying() &&
                    p.getPlaybackState() != Player.STATE_IDLE &&
                    p.getMediaItemCount() > 0;

                if (shouldCrossfade && !shouldBypassAppVolume()) {
                    float currentVol = p.getVolume();
                    long half = Math.max(100L, crossfadeDurationMs / 2);
                    volumeFader.fade(
                        p,
                        currentVol,
                        0f,
                        half,
                        () -> {
                            finishSwitch.run();
                            volumeFader.fade(p, 0f, targetGain, half, null);
                        }
                    );
                } else {
                    finishSwitch.run();
                }

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("crossfaded", shouldCrossfade);
                call.resolve(ret);
            });
    }

    /** Preload the next track for gapless handoff (buffers before current ends). */
    @PluginMethod
    public void enqueueNext(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("url required");
            return;
        }
        final String trimmedRaw = url.trim();
        runOnMain(
            call,
            () -> {
                String trimmed = trimmedRaw;
                ExoPlayer p = ensurePlayer();

                if (LocalStreamProxy.needsLocalProxy(trimmed)) {
                    trimmed = LocalStreamProxy.getInstance().proxyUrlFor(trimmed);
                }

                if (indexOfUrl(p, trimmed) >= 0) {
                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    ret.put("alreadyQueued", true);
                    call.resolve(ret);
                    return;
                }

                Double replayGainDb = call.getDouble("replayGainDb");
                String title = call.getString("title");
                String artist = call.getString("artist");
                String album = call.getString("album");
                String artworkUrl = call.getString("artworkUrl");
                int newIndex = p.getMediaItemCount();
                p.addMediaItem(MediaItem.fromUri(Uri.parse(trimmed)));
                storeGainForIndex(newIndex, replayGainDb);
                String envelopeId = call.getString("envelopeId");
                storeTrackMetaForUrl(trimmed, envelopeId, title, artist, album, artworkUrl);
                if (p.getPlaybackState() == Player.STATE_IDLE) {
                    p.prepare();
                }

                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("queueLength", p.getMediaItemCount());
                ret.put("index", newIndex);
                call.resolve(ret);
            });
    }

    private int indexOfUrl(ExoPlayer p, String url) {
        int count = p.getMediaItemCount();
        for (int i = 0; i < count; i++) {
            MediaItem item = p.getMediaItemAt(i);
            if (item.localConfiguration == null) continue;
            Uri uri = item.localConfiguration.uri;
            if (uri != null && url.equals(uri.toString())) {
                return i;
            }
        }
        return -1;
    }

    @PluginMethod
    public void probeLocalFile(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.trim().isEmpty()) {
            call.reject("path required");
            return;
        }
        final String safePath = path.trim();
        playbackExecutor.execute(
            () -> {
                try {
                    File file;
                    if (safePath.startsWith("file://")) {
                        String parsed = Uri.parse(safePath).getPath();
                        file = parsed != null ? new File(parsed) : new File(safePath);
                    } else {
                        file = new File(safePath);
                    }
                    JSObject ret = new JSObject();
                    boolean exists = file.isFile() && file.length() > 0;
                    ret.put("exists", exists);
                    if (exists) {
                        ret.put("bytes", file.length());
                    }
                    mainHandler.post(() -> call.resolve(ret));
                } catch (Exception e) {
                    String msg = e.getMessage() != null ? e.getMessage() : "probe failed";
                    mainHandler.post(() -> call.reject(msg));
                }
            });
    }

    @PluginMethod
    public void importLockerBlobFromPath(PluginCall call) {
        String id = call.getString("id");
        String sourcePath = call.getString("sourcePath");
        String mimeType = call.getString("mimeType");
        if (id == null || id.trim().isEmpty()) {
            call.reject("id required");
            return;
        }
        if (sourcePath == null || sourcePath.trim().isEmpty()) {
            call.reject("sourcePath required");
            return;
        }
        final String safeId = id.trim();
        final String safePath = sourcePath.trim();
        playbackExecutor.execute(
            () -> {
                try {
                    File file =
                        LockerBlobRegistry.importFromPath(
                            getContext(), safeId, safePath, mimeType);
                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    ret.put("contentUri", LockerBlobRegistry.contentUriFor(safeId));
                    ret.put("bytes", file.length());
                    mainHandler.post(() -> call.resolve(ret));
                } catch (Exception e) {
                    String msg = e.getMessage() != null ? e.getMessage() : "import failed";
                    mainHandler.post(() -> call.reject(msg));
                }
            });
    }

    @PluginMethod
    public void beginLockerBlob(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.trim().isEmpty()) {
            call.reject("id required");
            return;
        }
        try {
            LockerBlobRegistry.beginWrite(getContext(), id, call.getString("mimeType"));
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (IOException e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "begin locker blob failed");
        }
    }

    @PluginMethod
    public void appendLockerBlobChunk(PluginCall call) {
        String id = call.getString("id");
        String chunkBase64 = call.getString("chunkBase64");
        if (id == null || id.trim().isEmpty()) {
            call.reject("id required");
            return;
        }
        if (chunkBase64 == null || chunkBase64.isEmpty()) {
            call.reject("chunkBase64 required");
            return;
        }
        try {
            byte[] chunk = Base64.decode(chunkBase64, Base64.DEFAULT);
            LockerBlobRegistry.appendChunk(id, chunk);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (IOException e) {
            LockerBlobRegistry.abortWrite(id);
            call.reject(e.getMessage() != null ? e.getMessage() : "append locker chunk failed");
        }
    }

    @PluginMethod
    public void finishLockerBlob(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.trim().isEmpty()) {
            call.reject("id required");
            return;
        }
        try {
            File file = LockerBlobRegistry.finishWrite(id);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("contentUri", LockerBlobRegistry.contentUriFor(id));
            ret.put("bytes", file.length());
            call.resolve(ret);
        } catch (IOException e) {
            LockerBlobRegistry.abortWrite(id);
            call.reject(e.getMessage() != null ? e.getMessage() : "finish locker blob failed");
        }
    }

    @PluginMethod
    public void abortLockerBlob(PluginCall call) {
        String id = call.getString("id");
        if (id != null && !id.trim().isEmpty()) {
            LockerBlobRegistry.abortWrite(id);
        }
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void auditLockerStorage(PluginCall call) {
        playbackExecutor.execute(
            () -> {
                try {
                    JSObject audit = LockerBlobRegistry.auditStorage(getContext());
                    if (audit == null) {
                        mainHandler.post(() -> call.reject("audit unavailable"));
                        return;
                    }
                    mainHandler.post(() -> call.resolve(audit));
                } catch (Exception e) {
                    String msg = e.getMessage() != null ? e.getMessage() : "audit failed";
                    mainHandler.post(() -> call.reject(msg));
                }
            });
    }

    @PluginMethod
    public void getLockerBlobUri(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.trim().isEmpty()) {
            call.reject("id required");
            return;
        }
        File file = LockerBlobRegistry.getFile(getContext(), id);
        JSObject ret = new JSObject();
        // Require real audio bytes — empty/stub files must not look playable.
        if (file != null && file.isFile() && file.length() > 0) {
            ret.put("contentUri", LockerBlobRegistry.contentUriFor(id));
            ret.put("bytes", file.length());
        }
        call.resolve(ret);
    }

  /** Push track metadata to FGS/MediaSession without reloading the stream (in-place queue seek). */
    @PluginMethod
    public void updateTrackMetadata(PluginCall call) {
        runOnMain(
            call,
            () -> {
                applyTrackMetadata(call);
                String url = currentMediaUri();
                if (url != null) {
                    storeTrackMetaForUrl(
                        url,
                        lastEnvelopeId,
                        lastTitle,
                        lastArtist,
                        lastAlbum,
                        lastArtworkUrl
                    );
                }
                Long revision = call.getLong("revision", 0L);
                ExoPlayer p = player;
                syncForegroundMetadata(
                    p,
                    p != null && p.isPlaying(),
                    revision != null ? revision : 0L
                );
                call.resolve();
            });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        runOnMain(
            call,
            () -> {
                userPausedByUi = true;
                systemAudioFocusPaused = false;
                pendingAutoPlay = false;
                stopScreenLockKeepalive();
                mainHandler.removeCallbacks(autoPlayNudgeRunnable);
                if (player != null) {
                    player.setPlayWhenReady(false);
                    player.pause();
                    syncForegroundFromPlayer(player);
                }
                call.resolve();
            });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        runOnMain(
            call,
            () -> {
                if (player != null) {
                    userPausedByUi = false;
                    systemAudioFocusPaused = false;
                    pendingAutoPlay = true;
                    AndroidAudioSessionHelper.requestAppAudioFocus(getContext());
                    applyWiredOutputIfAvailable(player);
                    player.setPlayWhenReady(true);
                    player.play();
                    // Single FGS sync after play — duplicate requestRefresh before play
                    // raced with stopForeground and caused ForegroundServiceDidNotStartInTimeException.
                    syncForegroundFromPlayer(player);
                }
                call.resolve();
            });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        runOnMain(
            call,
            () -> {
                if (player != null) {
                    volumeFader.cancel();
                    userPausedByUi = false;
                    pendingAutoPlay = false;
                    mainHandler.removeCallbacks(autoPlayNudgeRunnable);
                    player.stop();
                    player.clearMediaItems();
                    queueIndexToGainLinear.clear();
                    lastMediaItemIndex = -1;
                    nativePlaybackActiveCached = false;
                }
                call.resolve();
            });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Double seconds = call.getDouble("seconds");
        if (seconds == null) {
            call.reject("seconds required");
            return;
        }
        runOnMain(
            call,
            () -> {
                if (player != null) {
                    long ms = Math.max(0, Math.round(seconds * 1000));
                    player.seekTo(ms);
                }
                call.resolve();
            });
    }

    @Override
    protected void handleOnDestroy() {
        instance = null;
        destroyed = true;
        stopScreenLockKeepalive();
        playbackExecutor.shutdownNow();
        mainHandler.post(
            () -> {
                volumeFader.cancel();
                loudnessHelper.release();
                if (player != null) {
                    player.release();
                    player = null;
                    lastPreferredWiredDeviceId = -1;
                }
            });
        super.handleOnDestroy();
    }
}
