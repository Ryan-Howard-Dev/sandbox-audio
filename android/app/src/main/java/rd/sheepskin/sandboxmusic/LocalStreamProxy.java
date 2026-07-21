package rd.sheepskin.sandboxmusic;

import android.content.Context;
import android.util.Base64;
import android.util.Log;
import androidx.annotation.Nullable;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Lightweight localhost HTTP proxy for YouTube/googlevideo streams when Sandbox Server is offline.
 * ExoPlayer plays http://127.0.0.1:PORT/local/proxy/stream?url=... — upstream fetched with Referer headers.
 */
public final class LocalStreamProxy {

    private static final String TAG = "LocalStreamProxy";
    private static final int MAX_PORT_ATTEMPTS = 16;
    private static final int BASE_PORT = 28765;

    private static volatile LocalStreamProxy instance;
    private static final Object LOCK = new Object();

    private static final int PROXY_POOL_SIZE = 6;

    private final ExecutorService executor =
        new ThreadPoolExecutor(
            2,
            PROXY_POOL_SIZE,
            60L,
            TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(32),
            r -> {
                Thread t = new Thread(r, "LocalStreamProxy");
                t.setDaemon(true);
                return t;
            },
            new ThreadPoolExecutor.CallerRunsPolicy());
    private final AtomicBoolean running = new AtomicBoolean(false);

    private volatile int port = -1;
    @Nullable private ServerSocket serverSocket;
    @Nullable private volatile Context appContext;

    private LocalStreamProxy() {}

    public void setAppContext(Context context) {
        appContext = context.getApplicationContext();
    }

    public static LocalStreamProxy getInstance() {
        if (instance == null) {
            synchronized (LOCK) {
                if (instance == null) {
                    instance = new LocalStreamProxy();
                }
            }
        }
        return instance;
    }

    public static boolean needsLocalProxy(String url) {
        if (url == null || url.isEmpty()) return false;
        String lower = url.toLowerCase(Locale.US);
        if (lower.contains("/local/proxy/")) return false;
        return lower.contains("googlevideo.com")
            || lower.contains("youtube.com/watch")
            || lower.contains("youtu.be/");
    }

    public String proxyUrlFor(String targetUrl) {
        ensureStarted();
        if (port <= 0) return targetUrl;
        String b64 =
            Base64.encodeToString(
                targetUrl.getBytes(StandardCharsets.UTF_8),
                Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        return "http://127.0.0.1:" + port + "/local/proxy/b64/" + b64;
    }

    public void ensureStarted() {
        if (running.get() && port > 0) return;
        synchronized (LOCK) {
            if (running.get() && port > 0) return;
            for (int i = 0; i < MAX_PORT_ATTEMPTS; i++) {
                int candidate = BASE_PORT + i;
                try {
                    ServerSocket socket = new ServerSocket(candidate, 8, InetAddress.getByName("127.0.0.1"));
                    serverSocket = socket;
                    port = candidate;
                    running.set(true);
                    executor.execute(this::acceptLoop);
                    Log.i(TAG, "local stream proxy listening on 127.0.0.1:" + port);
                    return;
                } catch (IOException e) {
                    closeQuietly(serverSocket);
                    serverSocket = null;
                }
            }
            Log.e(TAG, "failed to bind local stream proxy");
        }
    }

    private void acceptLoop() {
        while (running.get() && serverSocket != null && !serverSocket.isClosed()) {
            try {
                Socket client = serverSocket.accept();
                executor.execute(() -> handleClient(client));
            } catch (IOException e) {
                if (running.get()) {
                    Log.w(TAG, "accept failed: " + e.getMessage());
                }
                break;
            }
        }
    }

    private void handleClient(Socket client) {
        try (Socket c = client) {
            c.setSoTimeout(30_000);
            InputStream in = c.getInputStream();
            OutputStream out = c.getOutputStream();

            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0];
            String path = parts[1];

            String line;
            String range = null;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                String lower = line.toLowerCase(Locale.US);
                if (lower.startsWith("range:")) {
                    range = line.substring(6).trim();
                }
            }

            if (!"GET".equalsIgnoreCase(method) || !path.startsWith("/local/proxy/")) {
                writeResponse(out, 404, "Not Found", "text/plain", "not found".getBytes(StandardCharsets.UTF_8));
                return;
            }

            String target = extractTargetUrl(path);
            if (target == null || !target.startsWith("http")) {
                writeResponse(out, 400, "Bad Request", "text/plain", "url required".getBytes(StandardCharsets.UTF_8));
                return;
            }

            proxyUpstream(target, range, out);
        } catch (Exception e) {
            Log.w(TAG, "client handler error: " + e.getMessage());
        }
    }

    @Nullable
    private static String extractTargetUrl(String path) {
        if (path.startsWith("/local/proxy/b64/")) {
            String b64 = path.substring("/local/proxy/b64/".length());
            try {
                byte[] decoded = Base64.decode(b64, Base64.URL_SAFE | Base64.NO_PADDING);
                return new String(decoded, StandardCharsets.UTF_8);
            } catch (IllegalArgumentException e) {
                return null;
            }
        }
        int q = path.indexOf('?');
        if (q < 0) return null;
        String query = path.substring(q + 1);
        for (String pair : query.split("&")) {
            if (pair.startsWith("url=")) {
                return fullyDecodeUrlParam(pair.substring(4));
            }
        }
        return null;
    }

    private static String fullyDecodeUrlParam(String raw) {
        String decoded = raw;
        for (int i = 0; i < 4; i++) {
            String next = URLDecoder.decode(decoded, StandardCharsets.UTF_8);
            if (next.equals(decoded)) break;
            decoded = next;
        }
        return decoded;
    }

    private void proxyUpstream(String target, @Nullable String range, OutputStream out) throws IOException {
        String streamUrl = target;
        if (YoutubeDlStreamResolver.isYoutubeWatchUrl(target) && appContext != null) {
            String local = YoutubeDlStreamResolver.downloadAudioToCache(appContext, target);
            if (local != null) {
                proxyLocalFile(local, range, out);
                return;
            }
            String piped = YoutubeDlStreamResolver.resolveViaPiped(target);
            if (piped != null) {
                Log.w(TAG, "piped proxy fallback (may be unstable)");
                streamUrl = piped;
            } else {
                String resolved = YoutubeDlStreamResolver.resolveStreamUrl(appContext, target);
                if (resolved != null) {
                    streamUrl = resolved;
                }
            }
        }

        HttpURLConnection conn = (HttpURLConnection) new URL(streamUrl).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(20_000);
        conn.setReadTimeout(120_000);
        YoutubeStreamHeaders.applyTo(conn, streamUrl);
        if (range != null && !range.isEmpty()) {
            conn.setRequestProperty("Range", range);
        }

        int code = conn.getResponseCode();
        InputStream upstream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        if (upstream == null || code >= 400) {
            Log.w(TAG, "upstream HTTP " + code + " for " + target.substring(0, Math.min(120, target.length())));
            writeResponse(out, 502, "Bad Gateway", "text/plain", ("upstream " + code).getBytes(StandardCharsets.UTF_8));
            return;
        }

        String statusLine = code == 206 ? "HTTP/1.1 206 Partial Content" : "HTTP/1.1 200 OK";
        StringBuilder headers = new StringBuilder();
        headers.append(statusLine).append("\r\n");
        headers.append("Connection: close\r\n");
        headers.append("Access-Control-Allow-Origin: *\r\n");
        headers.append("Accept-Ranges: bytes\r\n");
        String ct = conn.getHeaderField("Content-Type");
        if (ct != null) headers.append("Content-Type: ").append(ct).append("\r\n");
        String cl = conn.getHeaderField("Content-Length");
        if (cl != null) headers.append("Content-Length: ").append(cl).append("\r\n");
        String cr = conn.getHeaderField("Content-Range");
        if (cr != null) headers.append("Content-Range: ").append(cr).append("\r\n");
        headers.append("\r\n");
        out.write(headers.toString().getBytes(StandardCharsets.US_ASCII));

        byte[] buf = new byte[16 * 1024];
        int read;
        while ((read = upstream.read(buf)) >= 0) {
            out.write(buf, 0, read);
            out.flush();
        }
        upstream.close();
        conn.disconnect();
    }

    private void proxyLocalFile(String path, @Nullable String range, OutputStream out) throws IOException {
        File file = new File(path);
        if (!file.isFile() || file.length() <= 0) {
            writeResponse(out, 404, "Not Found", "text/plain", "file missing".getBytes(StandardCharsets.UTF_8));
            return;
        }
        long fileLen = file.length();
        long start = 0;
        long end = fileLen - 1;
        if (range != null && range.startsWith("bytes=")) {
            String spec = range.substring(6).trim();
            int dash = spec.indexOf('-');
            if (dash >= 0) {
                String startPart = spec.substring(0, dash).trim();
                String endPart = spec.substring(dash + 1).trim();
                if (!startPart.isEmpty()) start = Long.parseLong(startPart);
                if (!endPart.isEmpty()) end = Long.parseLong(endPart);
            }
        }
        if (start < 0) start = 0;
        if (end >= fileLen) end = fileLen - 1;
        long contentLen = end - start + 1;
        boolean partial = range != null && !range.isEmpty();
        String statusLine = partial ? "HTTP/1.1 206 Partial Content" : "HTTP/1.1 200 OK";
        StringBuilder headers = new StringBuilder();
        headers.append(statusLine).append("\r\n");
        headers.append("Connection: close\r\n");
        headers.append("Access-Control-Allow-Origin: *\r\n");
        headers.append("Accept-Ranges: bytes\r\n");
        headers.append("Content-Type: audio/mp4\r\n");
        headers.append("Content-Length: ").append(contentLen).append("\r\n");
        if (partial) {
            headers.append("Content-Range: bytes ").append(start).append("-").append(end).append("/").append(fileLen).append("\r\n");
        }
        headers.append("\r\n");
        out.write(headers.toString().getBytes(StandardCharsets.US_ASCII));
        try (FileInputStream in = new FileInputStream(file)) {
            long skipped = in.skip(start);
            if (skipped < start) return;
            byte[] buf = new byte[16 * 1024];
            long remaining = contentLen;
            while (remaining > 0) {
                int toRead = (int) Math.min(buf.length, remaining);
                int read = in.read(buf, 0, toRead);
                if (read < 0) break;
                out.write(buf, 0, read);
                out.flush();
                remaining -= read;
            }
        }
    }

    private static void writeResponse(
        OutputStream out,
        int code,
        String text,
        String contentType,
        byte[] body
    ) throws IOException {
        String status = code + " " + text;
        String header =
            "HTTP/1.1 "
                + status
                + "\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: "
                + contentType
                + "\r\nContent-Length: "
                + body.length
                + "\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.US_ASCII));
        out.write(body);
        out.flush();
    }

    @Nullable
    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int b;
        while ((b = in.read()) >= 0) {
            if (b == '\n') break;
            if (b != '\r') sb.append((char) b);
        }
        if (sb.length() == 0 && b < 0) return null;
        return sb.toString();
    }

    private static void closeQuietly(@Nullable ServerSocket socket) {
        if (socket == null) return;
        try {
            socket.close();
        } catch (IOException ignored) {
        }
    }

    public void shutdown() {
        running.set(false);
        closeQuietly(serverSocket);
        serverSocket = null;
        port = -1;
    }
}
