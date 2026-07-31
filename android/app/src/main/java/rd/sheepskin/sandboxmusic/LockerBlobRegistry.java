package rd.sheepskin.sandboxmusic;

import android.content.Context;
import android.net.Uri;
import androidx.annotation.Nullable;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashSet;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory index of locker audio files written to durable app filesDir for ExoPlayer content:// URIs.
 * Must NOT use getCacheDir() — Android may purge cache under storage pressure.
 */
public final class LockerBlobRegistry {

    private static final ConcurrentHashMap<String, File> FILES = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, FileOutputStream> WRITERS =
        new ConcurrentHashMap<>();

    private LockerBlobRegistry() {}

    public static void beginWrite(Context context, String id, String mimeType)
        throws IOException {
        if (id == null || id.trim().isEmpty()) {
            throw new IOException("id required");
        }
        String safeId = sanitizeId(id.trim());
        abortWrite(safeId);

        File dir = lockerDir(context);
        File target = new File(dir, safeId + extensionForMime(mimeType));
        FileOutputStream out = new FileOutputStream(target, false);
        WRITERS.put(safeId, out);
        FILES.put(safeId, target);
    }

    public static void appendChunk(String id, byte[] chunk) throws IOException {
        if (chunk == null || chunk.length == 0) return;
        String safeId = sanitizeId(id.trim());
        FileOutputStream out = WRITERS.get(safeId);
        if (out == null) {
            throw new IOException("no active write for id: " + safeId);
        }
        out.write(chunk);
    }

    public static File finishWrite(String id) throws IOException {
        String safeId = sanitizeId(id.trim());
        FileOutputStream out = WRITERS.remove(safeId);
        if (out != null) {
            out.flush();
            out.close();
        }
        File file = FILES.get(safeId);
        if (file == null || !file.isFile()) {
            throw new IOException("locker blob missing after write: " + safeId);
        }
        return file;
    }

    /**
     * Copy an on-disk download (file:// from yt-dlp) into locker cache without JS/base64 bridge.
     */
    public static File importFromPath(Context context, String id, String sourcePath, @Nullable String mimeType)
        throws IOException {
        if (id == null || id.trim().isEmpty()) {
            throw new IOException("id required");
        }
        if (sourcePath == null || sourcePath.trim().isEmpty()) {
            throw new IOException("sourcePath required");
        }
        String safeId = sanitizeId(id.trim());
        abortWrite(safeId);

        File dir = lockerDir(context);
        File target = new File(dir, safeId + extensionForMime(mimeType));
        copyFromSource(context, sourcePath.trim(), target);
        FILES.put(safeId, target);
        return target;
    }

    public static void abortWrite(String id) {
        String safeId = sanitizeId(id.trim());
        FileOutputStream out = WRITERS.remove(safeId);
        if (out != null) {
            try {
                out.close();
            } catch (IOException ignored) {
                // Best-effort cleanup.
            }
        }
        File file = FILES.remove(safeId);
        if (file != null && file.isFile()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    /**
     * Rebuild in-memory index from durable files dir (survives process restart).
     * Also migrates any leftover blobs out of getCacheDir() — Android may purge cache
     * under storage pressure, which previously wiped the offline library.
     */
    public static void warmFromDisk(Context context) {
        if (context == null) return;
        migrateCacheBlobsToFilesDir(context);
        migrateYtdlpLockerCacheToFiles(context);
        File dir = new File(context.getFilesDir(), "locker_blobs");
        if (!dir.isDirectory()) return;
        File[] entries = dir.listFiles();
        if (entries == null) return;
        for (File file : entries) {
            if (!file.isFile()) continue;
            String name = file.getName();
            int dot = name.lastIndexOf('.');
            String id = dot > 0 ? name.substring(0, dot) : name;
            FILES.putIfAbsent(id, file);
        }
    }

    @Nullable
    public static File getFile(String id) {
        if (id == null) return null;
        String safeId = sanitizeId(id.trim());
        File file = FILES.get(safeId);
        if (file != null && file.isFile()) return file;
        return null;
    }

    @Nullable
    public static File getFile(Context context, String id) {
        if (id == null) return null;
        warmFromDisk(context);
        return getFile(id);
    }

    public static String contentUriFor(String id) {
        return "content://" + LockerBlobContentProvider.AUTHORITY + "/locker/" + sanitizeId(id.trim());
    }

    private static File lockerDir(Context context) throws IOException {
        // HARD RULE: never store locker audio in getCacheDir() — the OS may delete it.
        File dir = new File(context.getFilesDir(), "locker_blobs");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("failed to create locker files dir");
        }
        return dir;
    }

    /**
     * Move surviving blobs from legacy cache/locker_blobs into durable files/locker_blobs.
     * Never deletes a source file unless the destination exists with equal size after move/copy.
     */
    private static void migrateCacheBlobsToFilesDir(Context context) {
        File legacy = new File(context.getCacheDir(), "locker_blobs");
        if (!legacy.isDirectory()) return;
        File durable;
        try {
            durable = lockerDir(context);
        } catch (IOException e) {
            return;
        }
        File[] entries = legacy.listFiles();
        if (entries == null || entries.length == 0) return;
        for (File src : entries) {
            if (!src.isFile() || src.length() <= 0) continue;
            File dest = new File(durable, src.getName());
            if (dest.isFile() && dest.length() == src.length()) {
                // Duplicate already safe in filesDir — remove only the cache copy.
                //noinspection ResultOfMethodCallIgnored
                src.delete();
                continue;
            }
            if (dest.exists()) continue; // do not overwrite or delete
            boolean renamed = src.renameTo(dest);
            if (!renamed) {
                try {
                    copyFile(src, dest);
                    if (dest.isFile() && dest.length() == src.length()) {
                        //noinspection ResultOfMethodCallIgnored
                        src.delete();
                    }
                } catch (IOException ignored) {
                    // Leave source in cache; better duplicate than lose audio.
                }
            }
        }
    }

    /**
     * Audit durable vs cache storage — runs migration first so counts reflect post-heal state.
     */
    @Nullable
    public static JSObject auditStorage(@Nullable Context context) {
        if (context == null) return null;
        File legacyBlobs = new File(context.getCacheDir(), "locker_blobs");
        File legacyYtdlp = new File(context.getCacheDir(), "ytdlp-locker");
        boolean hadLegacy =
            dirHasFiles(legacyBlobs) || dirHasFiles(legacyYtdlp);
        migrateCacheBlobsToFilesDir(context);
        migrateYtdlpLockerCacheToFiles(context);
        warmFromDisk(context);

        File durableBlobs = new File(context.getFilesDir(), "locker_blobs");
        File durableYtdlp = new File(context.getFilesDir(), "ytdlp-locker");

        JSObject ret = new JSObject();
        ret.put("migrationRan", hadLegacy);
        putDirStats(ret, "durableBlob", durableBlobs);
        putDirStats(ret, "durableYtdlp", durableYtdlp);
        putDirStats(ret, "cacheBlob", legacyBlobs);
        putDirStats(ret, "cacheYtdlp", legacyYtdlp);
        return ret;
    }

    /**
     * Garbage-collect durable locker_blobs whose basename (track id) is referenced
     * by no current locker entry. {@code keepIdsRaw} are raw track ids from the JS
     * locker index; they are sanitised here to match on-disk filenames.
     *
     * HARD SAFETY RULE: if the keep-set is empty we refuse to delete anything (an
     * empty index almost always means "not loaded yet", not "wipe everything").
     * Callers must pass {@code dryRun=true} to preview freed bytes without deleting.
     */
    public static JSObject pruneOrphanBlobs(
        @Nullable Context context,
        @Nullable JSArray keepIdsRaw,
        boolean dryRun
    ) {
        JSObject ret = new JSObject();
        int deleted = 0;
        int kept = 0;
        int total = 0;
        long freed = 0;

        HashSet<String> keep = new HashSet<>();
        if (keepIdsRaw != null) {
            for (int i = 0; i < keepIdsRaw.length(); i++) {
                String raw = keepIdsRaw.optString(i, null);
                if (raw != null && !raw.trim().isEmpty()) {
                    keep.add(sanitizeId(raw.trim()));
                }
            }
        }

        boolean refusedEmptyKeep = false;
        if (context != null) {
            File dir = new File(context.getFilesDir(), "locker_blobs");
            File[] entries = dir.isDirectory() ? dir.listFiles() : null;
            if (entries != null) {
                for (File f : entries) {
                    if (!f.isFile()) continue;
                    total += 1;
                    String name = f.getName();
                    int dot = name.lastIndexOf('.');
                    String id = dot > 0 ? name.substring(0, dot) : name;
                    if (keep.contains(id)) {
                        kept += 1;
                        continue;
                    }
                    long len = f.length();
                    if (dryRun) {
                        deleted += 1;
                        freed += len;
                        continue;
                    }
                    // Live delete — blocked entirely when the keep-set is empty.
                    if (keep.isEmpty()) {
                        refusedEmptyKeep = true;
                        continue;
                    }
                    if (f.delete()) {
                        deleted += 1;
                        freed += len;
                        FILES.remove(id);
                    }
                }
            }
        }

        ret.put("deletedCount", deleted);
        ret.put("freedBytes", freed);
        ret.put("keptCount", kept);
        ret.put("totalCount", total);
        ret.put("dryRun", dryRun);
        ret.put("refusedEmptyKeep", refusedEmptyKeep);
        return ret;
    }

    /** Basenames (sanitised ids) of every durable locker blob file on disk. */
    public static JSArray listBlobIds(@Nullable Context context) {
        JSArray arr = new JSArray();
        if (context == null) return arr;
        File dir = new File(context.getFilesDir(), "locker_blobs");
        File[] entries = dir.isDirectory() ? dir.listFiles() : null;
        if (entries != null) {
            for (File f : entries) {
                if (!f.isFile() || f.length() <= 0) continue;
                String name = f.getName();
                int dot = name.lastIndexOf('.');
                arr.put(dot > 0 ? name.substring(0, dot) : name);
            }
        }
        return arr;
    }

    private static boolean dirHasFiles(File dir) {
        if (!dir.isDirectory()) return false;
        File[] entries = dir.listFiles();
        if (entries == null) return false;
        for (File f : entries) {
            if (f.isFile() && f.length() > 0) return true;
        }
        return false;
    }

    private static void putDirStats(JSObject ret, String prefix, File dir) {
        int count = 0;
        long bytes = 0;
        if (dir.isDirectory()) {
            File[] entries = dir.listFiles();
            if (entries != null) {
                for (File f : entries) {
                    if (!f.isFile() || f.length() <= 0) continue;
                    count += 1;
                    bytes += f.length();
                }
            }
        }
        ret.put(prefix + "Count", count);
        ret.put(prefix + "Bytes", bytes);
    }

    /** Move legacy cache/ytdlp-locker into durable files/ytdlp-locker. */
    private static void migrateYtdlpLockerCacheToFiles(Context context) {
        File legacy = new File(context.getCacheDir(), "ytdlp-locker");
        if (!legacy.isDirectory()) return;
        File durable = new File(context.getFilesDir(), "ytdlp-locker");
        if (!durable.exists() && !durable.mkdirs()) return;
        File[] entries = legacy.listFiles();
        if (entries == null || entries.length == 0) return;
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
                try {
                    copyFile(src, dest);
                    if (dest.isFile() && dest.length() == src.length()) {
                        //noinspection ResultOfMethodCallIgnored
                        src.delete();
                    }
                } catch (IOException ignored) {
                    // Leave source in cache; better duplicate than lose audio.
                }
            }
        }
    }

    private static File resolveSourceFile(String sourcePath) {
        if (sourcePath.startsWith("file://")) {
            String path = Uri.parse(sourcePath).getPath();
            if (path != null) {
                return new File(path);
            }
        }
        return new File(sourcePath);
    }

    private static void copyFromSource(Context context, String sourcePath, File target) throws IOException {
        if (sourcePath.startsWith("content://")) {
            Uri uri = Uri.parse(sourcePath);
            try (InputStream in = context.getContentResolver().openInputStream(uri);
                FileOutputStream out = new FileOutputStream(target, false)) {
                if (in == null) {
                    throw new IOException("cannot open content uri: " + sourcePath);
                }
                byte[] buf = new byte[64 * 1024];
                int read;
                while ((read = in.read(buf)) >= 0) {
                    if (read > 0) {
                        out.write(buf, 0, read);
                    }
                }
                out.flush();
            }
            return;
        }

        File source = resolveSourceFile(sourcePath);
        if (!source.isFile()) {
            throw new IOException("source file missing: " + source.getAbsolutePath());
        }
        copyFile(source, target);
    }

    private static void copyFile(File source, File target) throws IOException {
        try (FileInputStream in = new FileInputStream(source);
            FileOutputStream out = new FileOutputStream(target, false)) {
            byte[] buf = new byte[64 * 1024];
            int read;
            while ((read = in.read(buf)) >= 0) {
                if (read > 0) {
                    out.write(buf, 0, read);
                }
            }
            out.flush();
        }
    }

    private static String sanitizeId(String id) {
        return id.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private static String extensionForMime(@Nullable String mimeType) {
        if (mimeType == null) return ".audio";
        String lower = mimeType.toLowerCase();
        if (lower.contains("mpeg") || lower.contains("mp3")) return ".mp3";
        if (lower.contains("flac")) return ".flac";
        if (lower.contains("ogg")) return ".ogg";
        if (lower.contains("wav")) return ".wav";
        if (lower.contains("aac") || lower.contains("mp4")) return ".m4a";
        if (lower.contains("webm")) return ".webm";
        if (lower.contains("opus")) return ".opus";
        return ".audio";
    }
}
