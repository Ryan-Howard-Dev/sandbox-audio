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

    private static final String TAG = "YtDlpMobile";
    private static final long INIT_WAIT_MS = 45_000;
    /** Playback resolve — fail fast so UI can recover on cellular. */
    private static final long RESOLVE_TIMEOUT_MS = 45_000;
    /** Explicit locker download — may run longer. */
    private static final long DOWNLOAD_TIMEOUT_MS = 600_000;
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
        } catch (YoutubeDLException e) {
            initFailed = true;
            initError = e.getMessage() != null ? e.getMessage() : "yt-dlp init failed";
            long elapsedMs = System.currentTimeMillis() - startMs;
            Log.e(TAG, "failed to initialize youtubedl-android after " + elapsedMs + " ms", e);
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
                    JSObject result = (JSObject) task.get(DOWNLOAD_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                    if (result == null) {
                        rejectCall(call, "download failed");
                    } else {
                        Log.i(TAG, "downloadAudio ok query=" + trimmed);
                        resolveCall(call, result);
                    }
                } catch (TimeoutException e) {
                    task.cancel(true);
                    Log.w(TAG, "downloadAudio timeout query=" + trimmed);
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
        streamReq.addOption("-f", "bestaudio[ext=m4a]/bestaudio/best[height<=0]/best");
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
        streamReq.addOption("-f", "bestaudio[ext=m4a]/bestaudio/best[height<=0]/best");
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
            req.addOption("-f", "bestaudio[ext=m4a]/bestaudio/best[height<=0]/best");
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
