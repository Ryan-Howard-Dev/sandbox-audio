package rd.sheepskin.sandboxmusic;

import android.content.Context;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.util.Log;
import androidx.annotation.Nullable;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;
import com.yausername.youtubedl_android.YoutubeDLResponse;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/** Resolve YouTube watch/search URLs via bundled yt-dlp + Piped fallback. */
final class YoutubeDlStreamResolver {

    private static final String TAG = "YoutubeDlStreamResolver";
    /** Reject partial yt-dlp fragments and tiny preview clips in session cache. */
    private static final long MIN_CACHED_AUDIO_BYTES = 400_000L;
    private static final int MIN_FULL_TRACK_DURATION_SECS = 60;
    /** Prefer full audio — relaxed fallbacks when m4a/http-only formats unavailable. */
    private static final String YTDLP_AUDIO_FORMAT =
        "bestaudio[ext=m4a]/bestaudio/best[height<=0]/best";
    private static final String YTDLP_AUDIO_FORMAT_FALLBACK = "bestaudio/best";
    /**
     * Public Piped/Invidious instances are frequently dead or rate-limited. Keep per-instance
     * timeouts short and race all instances in parallel so the fastest healthy one wins instead
     * of paying a sequential timeout penalty for every dead instance.
     */
    private static final int NET_CONNECT_TIMEOUT_MS = 4_000;
    private static final int NET_READ_TIMEOUT_MS = 5_000;
    private static final long RACE_TIMEOUT_MS = 6_500;
    private static final Pattern VIDEO_ID =
        Pattern.compile("(?:v=|youtu\\.be/)([a-zA-Z0-9_-]{11})");
    private static final String[] PIPED_BASES = {
        "https://pipedapi.kavin.rocks",
        "https://pipedapi.adminforge.de",
        "https://api-piped.mha.fi",
    };
    private static final String[] INVIDIOUS_BASES = {
        "https://yewtu.be",
        "https://invidious.nerdvpn.de",
        "https://vid.puffyan.us",
    };

    private YoutubeDlStreamResolver() {}

    static boolean isYoutubeWatchUrl(String url) {
        if (url == null || url.isEmpty()) return false;
        String lower = url.toLowerCase(Locale.US);
        return lower.contains("youtube.com/watch") || lower.contains("youtu.be/");
    }

    @Nullable
    static String extractVideoId(String watchUrl) {
        Matcher m = VIDEO_ID.matcher(watchUrl);
        return m.find() ? m.group(1) : null;
    }

    /** Piped / Invidious audio stream — playable without googlevideo Referer tricks. */
    @Nullable
    static String resolveViaPiped(String watchUrl) {
        String videoId = extractVideoId(watchUrl);
        if (videoId == null) return null;
        List<Callable<String>> tasks = new ArrayList<>();
        for (final String base : PIPED_BASES) {
            tasks.add(() -> fetchPipedStream(base, videoId));
        }
        for (final String base : INVIDIOUS_BASES) {
            tasks.add(() -> fetchInvidiousStream(base, videoId));
        }
        return raceFirstSuccess(tasks, RACE_TIMEOUT_MS);
    }

    @Nullable
    private static String fetchPipedStream(String base, String videoId) {
        try {
            URL endpoint = new URL(base + "/streams/" + videoId);
            HttpURLConnection conn = (HttpURLConnection) endpoint.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(NET_CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(NET_READ_TIMEOUT_MS);
            conn.setRequestProperty("User-Agent", "SandboxMusic/1.0");
            if (conn.getResponseCode() != 200) return null;
            String body = readBody(conn);
            JSONObject data = new JSONObject(body);
            JSONArray streams = data.optJSONArray("audioStreams");
            if (streams == null || streams.length() == 0) return null;
            String bestUrl = null;
            int bestBitrate = -1;
            for (int i = 0; i < streams.length(); i++) {
                JSONObject stream = streams.getJSONObject(i);
                String url = stream.optString("url", "").trim();
                if (!url.startsWith("http")) continue;
                int bitrate = stream.optInt("bitrate", 0);
                if (bitrate >= bestBitrate) {
                    bestBitrate = bitrate;
                    bestUrl = url;
                }
            }
            if (bestUrl != null) {
                Log.i(TAG, "piped stream resolved via " + base);
                return bestUrl;
            }
        } catch (Exception e) {
            Log.w(TAG, "piped " + base + " failed: " + e.getMessage());
        }
        return null;
    }

    @Nullable
    static String resolveViaInvidious(String videoId) {
        List<Callable<String>> tasks = new ArrayList<>();
        for (final String base : INVIDIOUS_BASES) {
            tasks.add(() -> fetchInvidiousStream(base, videoId));
        }
        return raceFirstSuccess(tasks, RACE_TIMEOUT_MS);
    }

    @Nullable
    private static String fetchInvidiousStream(String base, String videoId) {
        try {
            URL endpoint = new URL(base + "/api/v1/videos/" + videoId);
            HttpURLConnection conn = (HttpURLConnection) endpoint.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(NET_CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(NET_READ_TIMEOUT_MS);
            conn.setRequestProperty("User-Agent", "SandboxMusic/1.0");
            if (conn.getResponseCode() != 200) return null;
            String body = readBody(conn);
            JSONObject data = new JSONObject(body);
            JSONArray adaptive = data.optJSONArray("adaptiveFormats");
            if (adaptive == null) return null;
            String bestUrl = null;
            int bestBitrate = -1;
            for (int i = 0; i < adaptive.length(); i++) {
                JSONObject fmt = adaptive.getJSONObject(i);
                String type = fmt.optString("type", "");
                if (!type.startsWith("audio/")) continue;
                String url = fmt.optString("url", "").trim();
                if (!url.startsWith("http")) continue;
                int bitrate = fmt.optInt("bitrate", 0);
                if (bitrate >= bestBitrate) {
                    bestBitrate = bitrate;
                    bestUrl = url;
                }
            }
            if (bestUrl != null) {
                Log.i(TAG, "invidious stream resolved via " + base);
                return bestUrl;
            }
        } catch (Exception e) {
            Log.w(TAG, "invidious " + base + " failed: " + e.getMessage());
        }
        return null;
    }

    private static String readBody(HttpURLConnection conn) throws Exception {
        StringBuilder body = new StringBuilder();
        try (BufferedReader reader =
                new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                body.append(line);
            }
        }
        return body.toString();
    }

    /**
     * Run all tasks concurrently and return the first non-null result, cancelling the rest.
     * Caps total wait at {@code timeoutMs} so a batch of dead instances cannot stall playback.
     */
    @Nullable
    private static <T> T raceFirstSuccess(List<Callable<T>> tasks, long timeoutMs) {
        if (tasks.isEmpty()) return null;
        if (tasks.size() == 1) {
            try {
                return tasks.get(0).call();
            } catch (Exception e) {
                return null;
            }
        }
        ExecutorService pool = Executors.newFixedThreadPool(tasks.size());
        CompletionService<T> ecs = new ExecutorCompletionService<>(pool);
        List<Future<T>> futures = new ArrayList<>();
        try {
            for (Callable<T> task : tasks) {
                futures.add(ecs.submit(task));
            }
            long deadline = System.currentTimeMillis() + timeoutMs;
            for (int i = 0; i < tasks.size(); i++) {
                long wait = deadline - System.currentTimeMillis();
                if (wait <= 0) break;
                Future<T> done = ecs.poll(wait, TimeUnit.MILLISECONDS);
                if (done == null) break;
                try {
                    T result = done.get();
                    if (result != null) return result;
                } catch (Exception ignored) {
                    /* try next completed task */
                }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            for (Future<T> f : futures) {
                f.cancel(true);
            }
            pool.shutdownNow();
        }
        return null;
    }

    /**
     * Download best audio to app cache for offline ExoPlayer playback.
     * googlevideo CDN URLs often 403 in ExoPlayer/HttpURLConnection even with Referer headers.
     * Reuses existing cache file for the same video id within the session.
     */
    @Nullable
    static String downloadAudioToCache(Context context, String watchUrl) {
        String trimmed = watchUrl.trim();
        if (!isYoutubeWatchUrl(trimmed)) return null;
        String videoId = extractVideoId(trimmed);
        if (videoId == null) return null;
        try {
            File dir = new File(context.getCacheDir(), "ytdlp-playback");
            if (!dir.exists() && !dir.mkdirs()) return null;
            purgeIncompleteCacheFiles(dir, videoId);
            String existing = findCachedAudioForVideoId(dir, videoId);
            if (existing != null) {
                Log.i(TAG, "session cache hit " + videoId);
                return existing;
            }
            String outTemplate = new File(dir, videoId + ".%(ext)s").getAbsolutePath();
            String cached = executeDownload(trimmed, outTemplate, YTDLP_AUDIO_FORMAT);
            if (cached == null) {
                purgeIncompleteCacheFiles(dir, videoId);
                cached = executeDownload(trimmed, outTemplate, YTDLP_AUDIO_FORMAT_FALLBACK);
            }
            if (cached != null) {
                Log.i(
                    TAG,
                    "cached audio "
                        + videoId
                        + " bytes="
                        + new File(cached).length()
                        + " durSec="
                        + probeLocalAudioDurationSecs(cached));
                return cached;
            }
        } catch (Exception e) {
            Log.w(TAG, "yt-dlp download failed: " + e.getMessage());
        }
        return null;
    }

    /**
     * Download audio for locker acquisition — uses durable files/ytdlp-locker
     * (not getCacheDir, which Android may purge under storage pressure).
     * Playback cache files are evicted during album queues; locker imports need a stable path.
     */
    @Nullable
    static String downloadAudioToLockerCache(Context context, String watchUrl) {
        String trimmed = watchUrl.trim();
        if (!isYoutubeWatchUrl(trimmed)) return null;
        String videoId = extractVideoId(trimmed);
        if (videoId == null) return null;
        try {
            File dir = new File(context.getFilesDir(), "ytdlp-locker");
            if (!dir.exists() && !dir.mkdirs()) return null;
            migrateYtdlpLockerFromCache(context, dir);
            purgeIncompleteCacheFiles(dir, videoId);
            String existing = findCachedAudioForVideoId(dir, videoId);
            if (existing != null) {
                Log.i(TAG, "locker cache hit " + videoId);
                return existing;
            }
            String outTemplate = new File(dir, videoId + ".%(ext)s").getAbsolutePath();
            String cached = executeDownload(trimmed, outTemplate, YTDLP_AUDIO_FORMAT);
            if (cached == null) {
                purgeIncompleteCacheFiles(dir, videoId);
                cached = executeDownload(trimmed, outTemplate, YTDLP_AUDIO_FORMAT_FALLBACK);
            }
            if (cached != null) {
                Log.i(
                    TAG,
                    "locker cached audio "
                        + videoId
                        + " bytes="
                        + new File(cached).length());
                return cached;
            }
        } catch (Exception e) {
            Log.w(TAG, "yt-dlp locker download failed: " + e.getMessage());
        }
        return null;
    }

    /** Best-effort move of legacy cache/ytdlp-locker temps into durable filesDir. */
    private static void migrateYtdlpLockerFromCache(Context context, File durable) {
        File legacy = new File(context.getCacheDir(), "ytdlp-locker");
        if (!legacy.isDirectory()) return;
        File[] entries = legacy.listFiles();
        if (entries == null) return;
        for (File src : entries) {
            if (!src.isFile() || src.length() <= 0) continue;
            File dest = new File(durable, src.getName());
            if (dest.isFile() && dest.length() == src.length()) {
                //noinspection ResultOfMethodCallIgnored
                src.delete();
                continue;
            }
            if (dest.exists()) continue;
            if (!src.renameTo(dest)) {
                // Leave in cache rather than risk loss.
            }
        }
    }

    /** Session cache lookup only — no network download. */
    @Nullable
    static String findCachedAudioPath(Context context, String watchUrl) {
        String trimmed = watchUrl.trim();
        if (!isYoutubeWatchUrl(trimmed)) return null;
        String videoId = extractVideoId(trimmed);
        if (videoId == null) return null;
        File dir = new File(context.getCacheDir(), "ytdlp-playback");
        if (!dir.isDirectory()) return null;
        return findCachedAudioForVideoId(dir, videoId);
    }

    /**
     * Fast playback resolve without yt-dlp init: cache → Piped/Invidious only.
     */
    @Nullable
    static FastWatchResolve resolveWatchUrlFastPreInit(Context context, String watchUrl) {
        String trimmed = watchUrl.trim();
        if (!isYoutubeWatchUrl(trimmed)) return null;

        String cached = findCachedAudioPath(context, trimmed);
        if (cached != null) {
            Log.i(TAG, "fast resolve cache hit " + extractVideoId(trimmed));
            return new FastWatchResolve(Uri.fromFile(new File(cached)).toString(), "cache");
        }

        String piped = resolveViaPiped(trimmed);
        if (piped != null) {
            Log.i(TAG, "fast resolve piped stream");
            return new FastWatchResolve(piped, "piped");
        }

        return null;
    }

    /**
     * Fast playback resolve: cache → Piped/Invidious stream → yt-dlp -g URL.
     * Skips full download so ExoPlayer can start streaming immediately.
     */
    @Nullable
    static FastWatchResolve resolveWatchUrlFast(Context context, String watchUrl) {
        FastWatchResolve preInit = resolveWatchUrlFastPreInit(context, watchUrl);
        if (preInit != null) return preInit;

        String stream = resolveStreamUrl(context, watchUrl.trim());
        if (stream != null) {
            Log.i(TAG, "fast resolve yt-dlp stream");
            return new FastWatchResolve(stream, "stream");
        }

        return null;
    }

    static final class FastWatchResolve {
        final String uri;
        final String kind;

        FastWatchResolve(String uri, String kind) {
            this.uri = uri;
            this.kind = kind;
        }
    }

    @Nullable
    private static String executeDownload(String watchUrl, String outTemplate, String format) {
        try {
            YoutubeDLRequest req = new YoutubeDLRequest(watchUrl);
            req.addOption("-f", format);
            req.addOption("-o", outTemplate);
            req.addOption("--no-playlist");
            req.addOption("--no-part");
            req.addOption("--no-warnings");
            req.addOption("--restrict-filenames");
            req.addOption("--extractor-args", "youtube:player_client=android,web");
            YoutubeDLResponse response = YoutubeDL.getInstance().execute(req);
            String err = response.getErr();
            if (err != null && err.toLowerCase(Locale.US).contains("error")) {
                Log.w(TAG, "yt-dlp download stderr: " + err.substring(0, Math.min(200, err.length())));
            }
            File dir = new File(outTemplate).getParentFile();
            String videoId = extractVideoId(watchUrl);
            if (dir == null || videoId == null) return null;
            return findCachedAudioForVideoId(dir, videoId);
        } catch (Exception e) {
            Log.w(TAG, "yt-dlp download failed: " + e.getMessage());
            return null;
        }
    }

    /** Pick first ytsearch hit with duration >= MIN_FULL_TRACK_DURATION_SECS. */
    @Nullable
    static String searchBestWatchUrl(String query) {
        try {
            YoutubeDLRequest searchReq = new YoutubeDLRequest("ytsearch8:" + query);
            searchReq.addOption("--no-playlist");
            searchReq.addOption("--no-warnings");
            searchReq.addOption("--flat-playlist");
            searchReq.addOption("--extractor-args", "youtube:player_client=android,web");
            searchReq.addOption("--print", "%(webpage_url)s\t%(duration)s");

            YoutubeDLResponse response = YoutubeDL.getInstance().execute(searchReq);
            String out = response.getOut();
            if (out == null) return null;
            for (String line : out.split("\n")) {
                String trimmed = line.trim();
                if (!trimmed.startsWith("http")) continue;
                String url = trimmed;
                int tab = trimmed.indexOf('\t');
                if (tab > 0) {
                    url = trimmed.substring(0, tab).trim();
                    String durRaw = trimmed.substring(tab + 1).trim();
                    try {
                        double dur = Double.parseDouble(durRaw);
                        if (dur > 0 && dur < MIN_FULL_TRACK_DURATION_SECS) {
                            Log.i(TAG, "skip short search hit dur=" + dur + "s url=" + url);
                            continue;
                        }
                    } catch (NumberFormatException ignored) {
                        /* duration unknown — allow and verify after download */
                    }
                }
                if (url.startsWith("http")) {
                    return url;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "ytsearch failed: " + e.getMessage());
        }
        return null;
    }

    /** Flat ytsearch hits for catalog typeahead (metadata only — no download). */
    static JSONArray searchTrackHits(String query, int limit) {
        JSONArray results = new JSONArray();
        if (query == null || query.trim().isEmpty() || limit <= 0) {
            return results;
        }
        int searchCount = Math.min(Math.max(limit + 2, 6), 12);
        try {
            YoutubeDLRequest searchReq =
                new YoutubeDLRequest("ytsearch" + searchCount + ":" + query.trim());
            searchReq.addOption("--no-playlist");
            searchReq.addOption("--no-warnings");
            searchReq.addOption("--flat-playlist");
            searchReq.addOption("--extractor-args", "youtube:player_client=android,web");
            searchReq.addOption("--print", "%(duration)s\t%(id)s\t%(title)s\t%(channel)s");

            YoutubeDLResponse response = YoutubeDL.getInstance().execute(searchReq);
            String out = response.getOut();
            if (out == null) return results;

            for (String line : out.split("\n")) {
                if (results.length() >= limit) break;
                String trimmed = line.trim();
                if (trimmed.isEmpty()) continue;
                String[] parts = trimmed.split("\t");
                if (parts.length < 3) continue;
                String id = parts[1].trim();
                String title = parts[2].trim();
                if (id.isEmpty() || title.isEmpty()) continue;
                String channel = parts.length > 3 ? parts[3].trim() : "YouTube";
                double duration = 0;
                try {
                    duration = Double.parseDouble(parts[0].trim());
                } catch (NumberFormatException ignored) {
                    /* unknown duration */
                }
                if (duration > 0 && duration < MIN_FULL_TRACK_DURATION_SECS) {
                    continue;
                }
                JSONObject row = new JSONObject();
                row.put("id", id);
                row.put("title", title);
                row.put("artist", channel.isEmpty() ? "YouTube" : channel);
                row.put("watchUrl", "https://www.youtube.com/watch?v=" + id);
                if (duration > 0) {
                    row.put("durationSeconds", (int) Math.round(duration));
                }
                results.put(row);
            }
        } catch (Exception e) {
            Log.w(TAG, "searchTrackHits failed: " + e.getMessage());
        }
        return results;
    }

    static int probeLocalAudioDurationSecs(String path) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(path);
            String dur = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (dur == null) return 0;
            long ms = Long.parseLong(dur);
            return ms > 0 ? (int) Math.round(ms / 1000.0) : 0;
        } catch (Exception e) {
            return 0;
        } finally {
            try {
                retriever.release();
            } catch (Exception ignored) {
            }
        }
    }

    private static boolean isUsableCachedAudioFile(File f) {
        if (!f.isFile() || f.length() < MIN_CACHED_AUDIO_BYTES) return false;
        String name = f.getName().toLowerCase(Locale.US);
        if (name.endsWith(".part") || name.endsWith(".tmp") || name.endsWith(".ytdl")) {
            return false;
        }
        int durSecs = probeLocalAudioDurationSecs(f.getAbsolutePath());
        if (durSecs > 0 && durSecs < MIN_FULL_TRACK_DURATION_SECS) {
            Log.w(TAG, "reject cached clip durSec=" + durSecs + " file=" + f.getName());
            return false;
        }
        return true;
    }

    private static void purgeIncompleteCacheFiles(File dir, String videoId) {
        File[] files = dir.listFiles();
        if (files == null) return;
        String prefix = videoId + ".";
        for (File f : files) {
            if (!f.getName().startsWith(prefix)) continue;
            if (isUsableCachedAudioFile(f)) continue;
            if (f.delete()) {
                Log.i(TAG, "purged incomplete cache " + f.getName());
            }
        }
    }

    @Nullable
    private static String findCachedAudioForVideoId(File dir, String videoId) {
        File[] files = dir.listFiles();
        if (files == null) return null;
        File best = null;
        long bestMs = 0;
        String prefix = videoId + ".";
        for (File f : files) {
            if (!f.getName().startsWith(prefix)) continue;
            if (!isUsableCachedAudioFile(f)) continue;
            if (f.lastModified() >= bestMs) {
                bestMs = f.lastModified();
                best = f;
            }
        }
        return best != null ? best.getAbsolutePath() : null;
    }

    @Nullable
    static String searchWatchUrlViaInvidious(String query) {
        String q = query == null ? "" : query.trim();
        if (q.isEmpty()) return null;
        final String encoded;
        try {
            encoded = java.net.URLEncoder.encode(q, StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            return null;
        }
        List<Callable<String>> tasks = new ArrayList<>();
        for (final String base : INVIDIOUS_BASES) {
            tasks.add(() -> searchWatchUrlViaInvidiousBase(base, encoded));
        }
        return raceFirstSuccess(tasks, RACE_TIMEOUT_MS);
    }

    @Nullable
    private static String searchWatchUrlViaInvidiousBase(String base, String encoded) {
        try {
            URL endpoint = new URL(base + "/api/v1/search?q=" + encoded + "&type=video");
            HttpURLConnection conn = (HttpURLConnection) endpoint.openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(NET_CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(NET_READ_TIMEOUT_MS);
            conn.setRequestProperty("User-Agent", "SandboxMusic/1.0");
            if (conn.getResponseCode() != 200) return null;
            String body = readBody(conn);
            JSONArray results = new JSONArray(body);
            for (int i = 0; i < results.length(); i++) {
                JSONObject row = results.optJSONObject(i);
                if (row == null) continue;
                if (!"video".equalsIgnoreCase(row.optString("type", "video"))) continue;
                String videoId = row.optString("videoId", "").trim();
                if (videoId.isEmpty()) continue;
                int lengthSecs = row.optInt("lengthSeconds", 0);
                if (lengthSecs > 0 && lengthSecs < MIN_FULL_TRACK_DURATION_SECS) {
                    Log.i(TAG, "invidious skip short hit dur=" + lengthSecs + " id=" + videoId);
                    continue;
                }
                String watch = "https://www.youtube.com/watch?v=" + videoId;
                Log.i(TAG, "invidious search hit via " + base + " id=" + videoId);
                return watch;
            }
        } catch (Exception e) {
            Log.w(TAG, "invidious search " + base + " failed: " + e.getMessage());
        }
        return null;
    }

    @Nullable
    static String resolveStreamUrl(Context context, String target) {
        String trimmed = target.trim();
        if (!trimmed.startsWith("http")) return null;
        if (trimmed.contains("googlevideo.com")) {
            return trimmed;
        }
        if (!isYoutubeWatchUrl(trimmed)) {
            return trimmed;
        }
        try {
            YoutubeDLRequest req = new YoutubeDLRequest(trimmed);
            req.addOption("-g");
            req.addOption("-f", YTDLP_AUDIO_FORMAT);
            req.addOption("--no-playlist");
            req.addOption("--no-warnings");
            req.addOption("--extractor-args", "youtube:player_client=android,web");
            YoutubeDLResponse response = YoutubeDL.getInstance().execute(req);
            String out = response.getOut();
            if (out == null) return null;
            String uri = out.trim().split("\n")[0].trim();
            if (uri.startsWith("http")) {
                Log.i(TAG, "resolved watch url to stream len=" + uri.length());
                return uri;
            }
        } catch (Exception e) {
            Log.w(TAG, "yt-dlp stream resolve failed: " + e.getMessage());
        }
        return null;
    }
}
