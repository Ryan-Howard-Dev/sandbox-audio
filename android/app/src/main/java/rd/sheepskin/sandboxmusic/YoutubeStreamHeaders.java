package rd.sheepskin.sandboxmusic;

import java.net.HttpURLConnection;
import java.util.Locale;

/** Request headers for YouTube CDN streams (googlevideo.com). */
final class YoutubeStreamHeaders {

    private static final String CHROME_UA =
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
    private static final String YOUTUBE_APP_UA =
        "com.google.android.youtube/19.09.37 (Linux; U; Android 14) gzip";

    private YoutubeStreamHeaders() {}

    static String userAgentFor(String targetUrl) {
        String lower = targetUrl.toLowerCase(Locale.US);
        if (lower.contains("c=android") || lower.contains("c%3dandroid")) {
            return YOUTUBE_APP_UA;
        }
        return CHROME_UA;
    }

    static void applyTo(HttpURLConnection conn, String targetUrl) {
        conn.setRequestProperty("User-Agent", userAgentFor(targetUrl));
        conn.setRequestProperty("Accept", "audio/*,*/*;q=0.9");
        conn.setRequestProperty("Referer", "https://www.youtube.com/");
        conn.setRequestProperty("Origin", "https://www.youtube.com");
    }
}
