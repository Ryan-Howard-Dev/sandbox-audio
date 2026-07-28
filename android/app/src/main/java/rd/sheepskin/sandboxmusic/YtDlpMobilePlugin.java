package rd.sheepskin.sandboxmusic;

import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLException;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;
import java.io.File;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.json.JSONArray;

/**
 * On-device yt-dlp extraction via youtubedl-android (bundled Python + yt-dlp).
 */
@CapacitorPlugin(name = "YtDlpMobile")
public class YtDlpMobilePlugin extends Plugin {

    /**
     * Format preference, widest-last.
     *
     * The audio-only branches are tried first because a bare audio stream is smaller and decodes
     * cheaper. They are not sufficient on their own: with player_client=android YouTube regularly
     * offers no audio-only format at all, only progressive streams carrying video and audio
     * together. The old selector stopped at worstaudio, so those videos failed outright with
     * "Requested format is not available" — and the caller then paid for a second, slower resolve
     * to recover. Measured on device that turned a 3.5s resolve into 14.1s, on every track.
     *
     * The progressive fallbacks cost bandwidth we do not use, since the video track is ignored on
     * playback, but a stream that plays beats a stream that does not exist.
     */
    private static final String AUDIO_FORMAT_SELECTOR =
        "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/"
            + "best[acodec!=none][ext=mp4]/best[acodec!=none]/best";

    private static final String TAG = "YtDlpMobile";
    private static final long INIT_WAIT_MS = 45_000;
    /** Playback resolve — fail fast so UI can recover on cellular. */
    private static final long RESOLVE_TIMEOUT_MS = 45_000;
    /**
     * Per-track download cap. With ffmpeg audio-extraction the files are only a
     * few MB, so a track that hasn't finished in 2 min is stuck (unfindable /
     * hanging search) and must be skipped so the rest of the album keeps going —
     * 10 minutes stalled the whole album on one bad track.
     */
    /**
     * Absolute ceiling for one track. Generous on purpose: a long track plus ffmpeg audio
     * extraction on a slow phone can legitimately take several minutes, and a flat 2-minute
     * cancel was killing healthy downloads mid-transfer.
     */
    private static final long DOWNLOAD_TIMEOUT_MS = 900_000;
    /**
     * Cancel only when yt-dlp has reported no progress for this long. This is what actually
     * catches a hung download; the loop of unfindable tracks is prevented separately by the
     * JS-side resolve-failure cache, not by a short wall-clock timeout.
     */
    private static final long DOWNLOAD_STALL_TIMEOUT_MS = 90_000;
    private static final long DOWNLOAD_POLL_MS = 5_000;
    private static final long SEARCH_TIMEOUT_MS = 45_000;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    /** Search metadata only — must not queue behind playback resolve/download. */
    private final ExecutorService searchExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile Future<?> currentResolveFuture = null;
    private volatile Future<?> currentDownloadFuture = null;
    private volatile boolean initialized = false;
    private volatile boolean initFailed = false;
    @Nullable
    private volatile String initError = null;
    @Nullable
    private volatile String version = null;

    @Override
    public void load() {
        executor.execute(this::initializeYoutubeDl);
    }

    private void resolveCall(PluginCall call, JSObject result) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            if (!call.isReleased()) call.resolve(result);
        } else {
            mainHandler.post(
                () -> {
                    if (!call.isReleased()) call.resolve(result);
                });
        }
    }

    private void rejectCall(PluginCall call, String message) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            if (!call.isReleased()) call.reject(message);
        } else {
            mainHandler.post(
                () -> {
                    if (!call.isReleased()) call.reject(message);
                });
        }
    }

    private void initializeYoutubeDl() {
        long startMs = System.currentTimeMillis();
        try {
            YoutubeDL.getInstance().init(getContext());
            // Required so `-x` (extract-audio) works — downloads are always
            // remuxed/extracted to audio-only m4a, never stored as video.
            try {
                com.yausername.ffmpeg.FFmpeg.getInstance().init(getContext());
            } catch (Throwable ffmpegErr) {
                Log.w(TAG, "ffmpeg init failed (audio extraction unavailable): " + ffmpegErr.getMessage());
            }
            initialized = true;
            try {
                version = YoutubeDL.getInstance().version(getContext());
            } catch (Exception ignored) {
                version = null;
            }
            long elapsedMs = System.currentTimeMillis() - startMs;
            if (version != null) {
                Log.i(TAG, "youtubedl-android initialized in " + elapsedMs + " ms version=" + version);
            } else {
                Log.i(TAG, "youtubedl-android initialized in " + elapsedMs + " ms");
            }
            maybeUpdateYtDlp();
        } catch (YoutubeDLException e) {
            initFailed = true;
            initError = e.getMessage() != null ? e.getMessage() : "yt-dlp init failed";
            long elapsedMs = System.currentTimeMillis() - startMs;
            Log.e(TAG, "failed to initialize youtubedl-android after " + elapsedMs + " ms", e);
        }
    }

    private static final String UPDATE_PREFS = "ytdlp_update_v1";
    private static final String LAST_UPDATE_KEY = "last_update_ms";
    /** How stale the extractor may get before another update is attempted. */
    private static final long UPDATE_INTERVAL_MS = 7L * 24 * 60 * 60 * 1000;

    /**
     * Refresh the yt-dlp binary itself, not the library wrapping it.
     *
     * The dependency pins a yt-dlp snapshot taken when that library was released, and YouTube
     * changes its extractor contract far faster than the library ships. Measured on device, the
     * bundled build could no longer obtain adaptive audio from any player client — every request
     * came back "Requested format is not available", leaving only a 360p progressive stream whose
     * audio is capped at 96 kbps. Nothing in the app's own code can fix that; the extractor has to
     * be newer.
     *
     * Rate limited to once a week and run after init rather than before it, so a slow or refused
     * download delays nothing: playback keeps working on the bundled version either way. Failures
     * are logged and swallowed for the same reason.
     */
    private void maybeUpdateYtDlp() {
        try {
            android.content.SharedPreferences prefs =
                getContext().getSharedPreferences(UPDATE_PREFS, android.content.Context.MODE_PRIVATE);
            long last = prefs.getLong(LAST_UPDATE_KEY, 0L);
            long now = System.currentTimeMillis();
            if (now - last < UPDATE_INTERVAL_MS) return;

            long t = System.currentTimeMillis();
            YoutubeDL.UpdateStatus status =
                YoutubeDL.getInstance()
                    .updateYoutubeDL(getContext(), YoutubeDL.UpdateChannel.STABLE.INSTANCE);
            // Recorded even when already up to date, so a device with no newer build available
            // does not retry the network call on every launch.
            prefs.edit().putLong(LAST_UPDATE_KEY, now).apply();
            String updated = null;
            try {
                updated = YoutubeDL.getInstance().version(getContext());
            } catch (Exception ignored) {
                /* version is a nicety */
            }
            if (updated != null) version = updated;
            Log.i(
                TAG,
                "yt-dlp update status=" + status
                    + " version=" + (updated != null ? updated : "unknown")
                    + " ms=" + (System.currentTimeMillis() - t));
        } catch (Throwable e) {
            // Offline, air-gapped, GitHub unreachable, or the API changed — none of which should
            // stop playback on the version already on disk.
            Log.w(TAG, "yt-dlp update skipped: " + e.getMessage());
        }
    }

    private void awaitInit() throws YoutubeDLException, InterruptedException {
        long deadline = System.currentTimeMillis() + INIT_WAIT_MS;
        while (!initialized && !initFailed && System.currentTimeMillis() < deadline) {
            Thread.sleep(100);
        }
        if (initFailed) {
            throw new YoutubeDLException(initError != null ? initError : "yt-dlp init failed");
        }
        if (!initialized) {
            throw new YoutubeDLException("yt-dlp init timeout");
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("initialized", initialized);
        if (version != null) {
            ret.put("version", version);
        }
        if (initFailed && initError != null) {
            ret.put("error", initError);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Future<?> pending = currentResolveFuture;
        if (pending != null) {
            pending.cancel(true);
            currentResolveFuture = null;
            Log.i(TAG, "resolve cancelled");
        }
        call.resolve();
    }

    @PluginMethod
    public void downloadAudio(PluginCall call) {
        String query = call.getString("query");
        if (query == null || query.trim().isEmpty()) {
            call.reject("query is required");
            return;
        }
        Future<?> pending = currentDownloadFuture;
        if (pending != null) {
            pending.cancel(true);
            currentDownloadFuture = null;
        }
        final String trimmed = query.trim();
        Log.i(TAG, "downloadAudio start query=" + trimmed);
        Future<?> task =
            executor.submit(
                () -> {
                    try {
                        awaitInit();
                        return downloadQuery(trimmed);
                    } catch (Exception e) {
                        throw new RuntimeException(
                            e.getMessage() != null ? e.getMessage() : "download failed", e);
                    }
                });
        currentDownloadFuture = task;
        executor.execute(
            () -> {
                try {
                    JSObject result = awaitDownloadWithStallWatchdog(task, trimmed);
                    if (result == null) {
                        rejectCall(call, "download failed");
                    } else {
                        Log.i(TAG, "downloadAudio ok query=" + trimmed);
                        resolveCall(call, result);
                    }
                } catch (TimeoutException e) {
                    task.cancel(true);
                    Log.w(TAG, "downloadAudio stalled/timeout query=" + trimmed);
                    rejectCall(call, "yt-dlp download timed out");
                } catch (Exception e) {
                    String message = e.getMessage() != null ? e.getMessage() : "download failed";
                    Log.w(TAG, "downloadAudio failed query=" + trimmed + " err=" + message);
                    rejectCall(call, message);
                } finally {
                    if (currentDownloadFuture == task) {
                        currentDownloadFuture = null;
                    }
                }
            });
    }

    /**
     * Wait for a download, cancelling only on a genuine stall (no yt-dlp progress for
     * DOWNLOAD_STALL_TIMEOUT_MS) or after the absolute ceiling. Polling in slices lets a
     * slow-but-progressing transfer run to completion instead of being cut off.
     */
    @Nullable
    private JSObject awaitDownloadWithStallWatchdog(Future<?> task, String query)
        throws Exception {
        long deadline = System.currentTimeMillis() + DOWNLOAD_TIMEOUT_MS;
        long lastBytes = -1L;
        long lastGrowthAt = System.currentTimeMillis();
        while (true) {
            try {
                return (JSObject) task.get(DOWNLOAD_POLL_MS, TimeUnit.MILLISECONDS);
            } catch (TimeoutException slice) {
                long now = System.currentTimeMillis();
                if (now >= deadline) {
                    Log.w(TAG, "downloadAudio hit absolute ceiling query=" + query);
                    throw slice;
                }
                // Bytes landing on disk means it is working, however slowly.
                long bytes = YoutubeDlStreamResolver.currentDownloadBytes();
                if (bytes != lastBytes) {
                    lastBytes = bytes;
                    lastGrowthAt = now;
                } else if (now - lastGrowthAt > DOWNLOAD_STALL_TIMEOUT_MS) {
                    Log.w(
                        TAG,
                        "downloadAudio stalled at " + bytes + " bytes query=" + query);
                    throw slice;
                }
            }
        }
    }

    @Nullable
    private JSObject downloadQuery(String query) throws Exception {
        String target = query;
        if (!isHttpUrl(query)) {
            target = searchFirstWatchUrl(query);
            if (target == null) {
                return null;
            }
        }

        if (YoutubeDlStreamResolver.isYoutubeWatchUrl(target)) {
            String localPath =
                YoutubeDlStreamResolver.downloadAudioToLockerCache(getContext(), target);
            if (localPath != null) {
                JSObject ret = new JSObject();
                ret.put("uri", Uri.fromFile(new File(localPath)).toString());
                ret.put("watchUrl", target);
                ret.put("bitrate", 0);
                ret.put("format", guessFormat(localPath));
                return ret;
            }
            return null;
        }

        YoutubeDLRequest streamReq = new YoutubeDLRequest(target);
        streamReq.addOption("-f", AUDIO_FORMAT_SELECTOR);
        streamReq.addOption("-o", new File(getContext().getFilesDir(), "ytdlp-locker/%(id)s.%(ext)s").getAbsolutePath());
        streamReq.addOption("--no-playlist");
        streamReq.addOption("--no-warnings");
        streamReq.addOption("--restrict-filenames");
        streamReq.addOption("--extractor-args", "youtube:player_client=android,web");
        YoutubeDLResponse response = YoutubeDL.getInstance().execute(streamReq);
        String err = response.getErr();
        if (err != null && err.toLowerCase(Locale.US).contains("error")) {
            Log.w(TAG, "yt-dlp locker download stderr: " + err.substring(0, Math.min(200, err.length())));
        }
        File lockerDir = new File(getContext().getFilesDir(), "ytdlp-locker");
        if (!lockerDir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            lockerDir.mkdirs();
        }
        File[] files = lockerDir.listFiles();
        if (files == null) return null;
        File newest = null;
        long newestMs = 0;
        for (File f : files) {
            if (!f.isFile() || f.length() <= 0) continue;
            if (f.lastModified() >= newestMs) {
                newestMs = f.lastModified();
                newest = f;
            }
        }
        if (newest == null) return null;
        JSObject ret = new JSObject();
        ret.put("uri", Uri.fromFile(newest).toString());
        ret.put("watchUrl", target);
        ret.put("bitrate", 0);
        ret.put("format", guessFormat(newest.getAbsolutePath()));
        return ret;
    }

    @PluginMethod
    public void search(PluginCall call) {
        String query = call.getString("query");
        if (query == null || query.trim().isEmpty()) {
            call.reject("query is required");
            return;
        }
        int limit = call.getInt("limit", 8);
        final String trimmed = query.trim();
        Future<?> task =
            searchExecutor.submit(
                () -> {
                    try {
                        awaitInit();
                        return YoutubeDlStreamResolver.searchTrackHits(trimmed, limit);
                    } catch (Exception e) {
                        throw new RuntimeException(
                            e.getMessage() != null ? e.getMessage() : "search failed", e);
                    }
                });
        searchExecutor.execute(
            () -> {
                try {
                    JSONArray hits = (JSONArray) task.get(SEARCH_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                    JSObject ret = new JSObject();
                    ret.put("results", hits);
                    resolveCall(call, ret);
                } catch (TimeoutException e) {
                    task.cancel(true);
                    rejectCall(call, "yt-dlp search timed out");
                } catch (Exception e) {
                    String message = e.getMessage() != null ? e.getMessage() : "search failed";
                    rejectCall(call, message);
                }
            });
    }

    @PluginMethod
    public void resolve(PluginCall call) {
        String query = call.getString("query");
        if (query == null || query.trim().isEmpty()) {
            call.reject("query is required");
            return;
        }
        final String trimmed = query.trim();
        Future<?> pending = currentResolveFuture;
        if (pending != null && !pending.isDone()) {
            Log.i(TAG, "resolve queued query=" + trimmed);
        }
        final long resolveStartMs = System.currentTimeMillis();
        Log.i(TAG, "resolve start query=" + trimmed);
        Future<?> task =
            executor.submit(
                () -> {
                    try {
                        JSObject preInit = tryResolvePreInit(trimmed);
                        if (preInit != null) {
                            return preInit;
                        }
                        awaitInit();
                        JSObject result = resolveQuery(trimmed);
                        if (result == null) {
                            throw new RuntimeException("no stream found");
                        }
                        Log.i(TAG, "resolve ok query=" + trimmed);
                        return result;
                    } catch (Exception e) {
                        throw new RuntimeException(
                            e.getMessage() != null ? e.getMessage() : "resolve failed", e);
                    }
                });
        currentResolveFuture = task;
        executor.execute(
            () -> {
                try {
                    JSObject result = (JSObject) task.get(RESOLVE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                    long elapsedMs = System.currentTimeMillis() - resolveStartMs;
                    Log.i(TAG, "resolve finished query=" + trimmed + " elapsedMs=" + elapsedMs);
                    resolveCall(call, result);
                } catch (TimeoutException e) {
                    task.cancel(true);
                    Log.w(TAG, "resolve timeout query=" + trimmed);
                    rejectCall(call, "yt-dlp resolve timed out");
                } catch (Exception e) {
                    Throwable cause = e;
                    if (e instanceof java.util.concurrent.ExecutionException && e.getCause() != null) {
                        cause = e.getCause();
                    }
                    if (cause instanceof java.util.concurrent.CancellationException) {
                        Log.i(TAG, "resolve cancelled query=" + trimmed);
                        rejectCall(call, "resolve cancelled");
                        return;
                    }
                    String message = e.getMessage() != null ? e.getMessage() : "resolve failed";
                    Log.w(TAG, "resolve failed query=" + trimmed + " err=" + message);
                    rejectCall(call, message);
                } finally {
                    if (currentResolveFuture == task) {
                        currentResolveFuture = null;
                    }
                }
            });
    }

    private JSObject watchResolveToJs(
        String watchUrl, YoutubeDlStreamResolver.FastWatchResolve fast
    ) {
        JSObject ret = new JSObject();
        ret.put("uri", fast.uri);
        ret.put("watchUrl", watchUrl);
        ret.put("bitrate", 0);
        ret.put("format", fast.kind);
        if ("cache".equals(fast.kind)) {
            String path = fast.uri;
            if (path.startsWith("file://")) {
                path = path.substring("file://".length());
            }
            ret.put(
                "durationSeconds",
                YoutubeDlStreamResolver.probeLocalAudioDurationSecs(path));
        }
        return ret;
    }

    /** Cache / Piped / Invidious search — no yt-dlp init wait. */
    @Nullable
    private JSObject tryResolvePreInit(String query) {
        String trimmed = query.trim();
        if (isHttpUrl(trimmed) && YoutubeDlStreamResolver.isYoutubeWatchUrl(trimmed)) {
            long t = System.currentTimeMillis();
            YoutubeDlStreamResolver.FastWatchResolve preInit =
                YoutubeDlStreamResolver.resolveWatchUrlFastPreInit(getContext(), trimmed);
            Log.i(TAG, "timing preInit(watch) ms=" + (System.currentTimeMillis() - t)
                + " hit=" + (preInit != null));
            if (preInit != null) {
                Log.i(TAG, "resolve pre-init hit kind=" + preInit.kind);
                return watchResolveToJs(trimmed, preInit);
            }
            return null;
        }
        // Plain text query: there is no video id to hit the local cache, and the public
        // Invidious->Piped chain is unreliable. Skip straight to the combined yt-dlp
        // search+extract in resolveQuery rather than paying a dead-instance round trip first.
        return null;
    }

    @Nullable
    private JSObject resolveQuery(String query) throws Exception {
        String target = query;
        if (!isHttpUrl(query)) {
            // Single yt-dlp call that searches AND extracts the stream URL in one process.
            // The public Piped/Invidious instances are usually dead, so the two-step
            // (flat search -> separate -g extract) just pays the yt-dlp startup cost twice.
            JSObject direct = resolveTextQueryDirect(query);
            if (direct != null) {
                return direct;
            }
            long tSearch = System.currentTimeMillis();
            target = searchFirstWatchUrl(query);
            Log.i(TAG, "timing ytsearch ms=" + (System.currentTimeMillis() - tSearch)
                + " hit=" + (target != null));
            if (target == null) {
                return null;
            }
        }

        if (YoutubeDlStreamResolver.isYoutubeWatchUrl(target)) {
            long tFast = System.currentTimeMillis();
            YoutubeDlStreamResolver.FastWatchResolve fast =
                YoutubeDlStreamResolver.resolveWatchUrlFast(getContext(), target);
            Log.i(TAG, "timing fastResolve ms=" + (System.currentTimeMillis() - tFast)
                + " hit=" + (fast != null));
            if (fast != null) {
                return watchResolveToJs(target, fast);
            }
            JSObject ret = new JSObject();
            ret.put("uri", target);
            ret.put("watchUrl", target);
            ret.put("bitrate", 0);
            ret.put("format", "watch");
            return ret;
        }

        YoutubeDLRequest streamReq = new YoutubeDLRequest(target);
        streamReq.addOption("-f", AUDIO_FORMAT_SELECTOR);
        streamReq.addOption("-g");
        streamReq.addOption("--no-playlist");
        streamReq.addOption("--no-warnings");
        long tExtract = System.currentTimeMillis();
        YoutubeDLResponse response = YoutubeDL.getInstance().execute(streamReq);
        Log.i(TAG, "timing ytdlpExtract ms=" + (System.currentTimeMillis() - tExtract));
        String out = response.getOut();
        if (out != null) {
            for (String line : out.split("\n")) {
                String uri = line.trim();
                if (uri.startsWith("http://") || uri.startsWith("https://")) {
                    JSObject ret = new JSObject();
                    ret.put("uri", uri);
                    ret.put("watchUrl", target);
                    ret.put("bitrate", 0);
                    ret.put("format", guessFormat(uri));
                    return ret;
                }
            }
        }
        return null;
    }

    /** One yt-dlp invocation: ytsearch the query and print the best-audio stream URL. */
    @Nullable
    private JSObject resolveTextQueryDirect(String query) {
        try {
            YoutubeDLRequest req = new YoutubeDLRequest("ytsearch1:" + query);
            req.addOption("-f", AUDIO_FORMAT_SELECTOR);
            req.addOption("-g");
            req.addOption("--no-playlist");
            req.addOption("--no-warnings");
            req.addOption("--extractor-args", "youtube:player_client=android,web");
            long t = System.currentTimeMillis();
            YoutubeDLResponse response = YoutubeDL.getInstance().execute(req);
            Log.i(TAG, "timing ytsearchExtract ms=" + (System.currentTimeMillis() - t));
            String out = response.getOut();
            if (out == null) return null;
            for (String line : out.split("\n")) {
                String uri = line.trim();
                if (uri.startsWith("http://") || uri.startsWith("https://")) {
                    JSObject ret = new JSObject();
                    ret.put("uri", uri);
                    ret.put("bitrate", 0);
                    ret.put("format", guessFormat(uri));
                    Log.i(TAG, "resolve direct ytsearch hit");
                    return ret;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "ytsearch direct resolve failed: " + e.getMessage());
        }
        return null;
    }

    @Nullable
    private String searchFirstWatchUrl(String query) throws Exception {
        JSONArray hits = YoutubeDlStreamResolver.searchTrackHits(query, 1);
        if (hits.length() == 0) return null;
        return hits.getJSONObject(0).optString("watchUrl", null);
    }

    private static boolean isHttpUrl(String value) {
        String lower = value.toLowerCase(Locale.US);
        return lower.startsWith("http://") || lower.startsWith("https://");
    }

    private static String guessFormat(String uri) {
        if (uri.contains(".m4a") || uri.contains("mime=audio%2Fmp4")) {
            return "m4a";
        }
        if (uri.contains(".webm") || uri.contains("mime=audio%2Fwebm")) {
            return "webm";
        }
        if (uri.contains(".mp3") || uri.contains("mime=audio%2Fmpeg")) {
            return "mp3";
        }
        return "unknown";
    }

    @Override
    protected void handleOnDestroy() {
        Future<?> resolve = currentResolveFuture;
        if (resolve != null) resolve.cancel(true);
        Future<?> download = currentDownloadFuture;
        if (download != null) download.cancel(true);
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
