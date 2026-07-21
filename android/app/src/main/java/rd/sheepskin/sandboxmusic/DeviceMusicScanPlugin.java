package rd.sheepskin.sandboxmusic;

import android.Manifest;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

/**
 * Read-only MediaStore scan for on-device music — used by Locker upload UX on Android.
 */
@CapacitorPlugin(
    name = "DeviceMusicScan",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_AUDIO }, alias = "audio"),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "storage")
    }
)
public class DeviceMusicScanPlugin extends Plugin {

    private static final String TAG = "DeviceMusicScan";

    private static final Pattern MUSIC_EXT =
        Pattern.compile("\\.(mp3|flac|ogg|wav|m4a|opus|webm|aac)$", Pattern.CASE_INSENSITIVE);
    private static final Pattern AUDIOBOOK_EXT =
        Pattern.compile("\\.(m4b|aa|aax)$", Pattern.CASE_INSENSITIVE);

    // Music vs audiobook/voice-memo classification runs in lockerUploadFilter.ts when
    // scan results are shown — native returns all music-extension rows for the "other" bucket.

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasAudioReadPermission());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (hasAudioReadPermission()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestAudioPermission(call, "audioPermsCallback");
    }

    @PermissionCallback
    private void audioPermsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasAudioReadPermission());
        call.resolve(ret);
    }

    @PluginMethod
    public void scan(PluginCall call) {
        if (!hasAudioReadPermission()) {
            requestAudioPermission(call, "scanPermsCallback");
            return;
        }
        runScan(call, false);
    }

    @PluginMethod
    public void scanAudiobooks(PluginCall call) {
        if (!hasAudioReadPermission()) {
            requestAudioPermission(call, "scanAudiobooksPermsCallback");
            return;
        }
        runScan(call, true);
    }

    @PermissionCallback
    private void scanPermsCallback(PluginCall call) {
        if (!hasAudioReadPermission()) {
            call.reject("Audio read permission denied");
            return;
        }
        runScan(call, false);
    }

    @PermissionCallback
    private void scanAudiobooksPermsCallback(PluginCall call) {
        if (!hasAudioReadPermission()) {
            call.reject("Audio read permission denied");
            return;
        }
        runScan(call, true);
    }

    private void runScan(PluginCall call, boolean audiobooksOnly) {
        executor.execute(
            () -> {
                try {
                    JSArray tracks = audiobooksOnly ? queryAudiobookTracks(call) : queryMusicTracks(call);
                    JSObject ret = new JSObject();
                    ret.put("tracks", tracks);
                    ret.put("count", tracks.length());
                    mainHandler.post(() -> call.resolve(ret));
                } catch (Exception e) {
                    Log.e(TAG, audiobooksOnly ? "scanAudiobooks failed" : "scan failed", e);
                    String msg = e.getMessage() != null ? e.getMessage() : "scan failed";
                    mainHandler.post(() -> call.reject(msg));
                }
            });
    }

    private JSArray queryMusicTracks(PluginCall call) throws Exception {
        JSArray out = new JSArray();
        Uri collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        String[] projection =
            new String[] {
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.DATA,
                MediaStore.Audio.Media.RELATIVE_PATH,
            };

        String selection = MediaStore.Audio.Media.IS_MUSIC + " != 0";
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            selection +=
                " AND "
                    + MediaStore.Audio.Media.IS_PODCAST
                    + " = 0 AND "
                    + MediaStore.Audio.Media.IS_NOTIFICATION
                    + " = 0 AND "
                    + MediaStore.Audio.Media.IS_ALARM
                    + " = 0";
        }

        // COLLATE LOCALIZED is rejected by some OEM MediaStore providers (OnePlus/OxygenOS).
        String sort = MediaStore.Audio.Media.TITLE + " ASC";

        int scanned = 0;
        try (Cursor cursor =
            getContext()
                .getContentResolver()
                .query(collection, projection, selection, null, sort)) {
            if (cursor == null) {
                return out;
            }
            int idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
            int titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
            int artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
            int albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
            int displayCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
            int durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
            int sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);
            int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
            int dataCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATA);
            int relCol = cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH);

            while (cursor.moveToNext()) {
                scanned += 1;
                if (scanned % 200 == 0) {
                    JSObject progress = new JSObject();
                    progress.put("scanned", scanned);
                    notifyListeners("scanProgress", progress);
                }

                long id = cursor.getLong(idCol);
                String displayName = safe(cursor.getString(displayCol));
                if (displayName.isEmpty()) continue;
                if (AUDIOBOOK_EXT.matcher(displayName).find()) continue;
                if (!MUSIC_EXT.matcher(displayName).find()) continue;

                String dataPath = dataCol >= 0 ? safe(cursor.getString(dataCol)) : "";
                String relativePath = relCol >= 0 ? safe(cursor.getString(relCol)) : "";
                String folder = folderFromPaths(relativePath, dataPath, displayName);
                String pathHint = !relativePath.isEmpty() ? relativePath + displayName : dataPath;

                Uri contentUri =
                    ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);

                JSObject row = new JSObject();
                row.put("id", String.valueOf(id));
                row.put("contentUri", contentUri.toString());
                row.put("title", safe(cursor.getString(titleCol)));
                row.put("artist", safe(cursor.getString(artistCol)));
                row.put("album", safe(cursor.getString(albumCol)));
                row.put("displayName", displayName);
                row.put("folder", folder);
                row.put("path", pathHint);
                row.put("size", cursor.getLong(sizeCol));
                row.put("durationMs", cursor.getLong(durationCol));
                row.put("mimeType", safe(cursor.getString(mimeCol)));
                out.put(row);
            }
        }

        JSObject done = new JSObject();
        done.put("scanned", scanned);
        done.put("matched", out.length());
        notifyListeners("scanProgress", done);
        return out;
    }

    /**
     * Read-only MediaStore scan for audiobooks — does NOT write, move, or delete
     * files. Separate from music IS_MUSIC scan; includes .m4b and Books/Audiobooks paths.
     */
    private JSArray queryAudiobookTracks(PluginCall call) throws Exception {
        JSArray out = new JSArray();
        Uri collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        String[] projection =
            new String[] {
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.DISPLAY_NAME,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.DATA,
                MediaStore.Audio.Media.RELATIVE_PATH,
            };

        // Broad audio row set — JS applies Books/Audiobooks heuristics; exclude ringtones/alarms.
        String selection = null;
        String[] selectionArgs = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            selection =
                MediaStore.Audio.Media.IS_NOTIFICATION
                    + " = 0 AND "
                    + MediaStore.Audio.Media.IS_ALARM
                    + " = 0 AND "
                    + MediaStore.Audio.Media.IS_RINGTONE
                    + " = 0";
        }

        String sort = MediaStore.Audio.Media.TITLE + " ASC";

        int scanned = 0;
        try (Cursor cursor =
            getContext()
                .getContentResolver()
                .query(collection, projection, selection, selectionArgs, sort)) {
            if (cursor == null) {
                return out;
            }
            int idCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
            int titleCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
            int artistCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
            int albumCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
            int displayCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
            int durationCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
            int sizeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);
            int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
            int dataCol = cursor.getColumnIndex(MediaStore.Audio.Media.DATA);
            int relCol = cursor.getColumnIndex(MediaStore.Audio.Media.RELATIVE_PATH);

            while (cursor.moveToNext()) {
                scanned += 1;
                if (scanned % 200 == 0) {
                    JSObject progress = new JSObject();
                    progress.put("scanned", scanned);
                    notifyListeners("scanProgress", progress);
                }

                long id = cursor.getLong(idCol);
                String displayName = safe(cursor.getString(displayCol));
                if (displayName.isEmpty()) continue;

                boolean audiobookExt = AUDIOBOOK_EXT.matcher(displayName).find();
                boolean musicExt = MUSIC_EXT.matcher(displayName).find();
                if (!audiobookExt && !musicExt) continue;

                String dataPath = dataCol >= 0 ? safe(cursor.getString(dataCol)) : "";
                String relativePath = relCol >= 0 ? safe(cursor.getString(relCol)) : "";
                String folder = folderFromPaths(relativePath, dataPath, displayName);
                String pathHint = !relativePath.isEmpty() ? relativePath + displayName : dataPath;

                // Keep clearly book-shaped rows; JS layer re-filters for safety.
                String hay =
                    (relativePath + " " + folder + " " + displayName + " " + safe(cursor.getString(titleCol)))
                        .toLowerCase();
                boolean bookFolder =
                    hay.contains("audiobook")
                        || hay.contains("audio book")
                        || hay.contains("/books/")
                        || hay.contains("\\books\\")
                        || folder.equalsIgnoreCase("books")
                        || folder.equalsIgnoreCase("audiobooks")
                        || folder.equalsIgnoreCase("audiobook");
                long durationMs = cursor.getLong(durationCol);
                if (!audiobookExt && !bookFolder && durationMs < 20L * 60L * 1000L) {
                    continue;
                }

                Uri contentUri =
                    ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);

                JSObject row = new JSObject();
                row.put("id", String.valueOf(id));
                row.put("contentUri", contentUri.toString());
                row.put("title", safe(cursor.getString(titleCol)));
                row.put("artist", safe(cursor.getString(artistCol)));
                row.put("album", safe(cursor.getString(albumCol)));
                row.put("displayName", displayName);
                row.put("folder", folder);
                row.put("path", pathHint);
                row.put("size", cursor.getLong(sizeCol));
                row.put("durationMs", durationMs);
                row.put("mimeType", safe(cursor.getString(mimeCol)));
                out.put(row);
            }
        }

        JSObject done = new JSObject();
        done.put("scanned", scanned);
        done.put("matched", out.length());
        notifyListeners("scanProgress", done);
        return out;
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private static String folderFromPaths(String relativePath, String dataPath, String displayName) {
        if (!relativePath.isEmpty()) {
            String trimmed = relativePath.replace('\\', '/');
            if (trimmed.endsWith("/")) {
                trimmed = trimmed.substring(0, trimmed.length() - 1);
            }
            int slash = trimmed.lastIndexOf('/');
            return slash >= 0 ? trimmed.substring(slash + 1) : trimmed;
        }
        if (!dataPath.isEmpty()) {
            String trimmed = dataPath.replace('\\', '/');
            int slash = trimmed.lastIndexOf('/');
            if (slash > 0) {
                String parent = trimmed.substring(0, slash);
                int parentSlash = parent.lastIndexOf('/');
                return parentSlash >= 0 ? parent.substring(parentSlash + 1) : parent;
            }
        }
        int dot = displayName.lastIndexOf('.');
        return dot > 0 ? displayName.substring(0, dot) : displayName;
    }

    private boolean hasAudioReadPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return getPermissionState("audio") == PermissionState.GRANTED;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return getPermissionState("storage") == PermissionState.GRANTED;
        }
        return true;
    }

    private void requestAudioPermission(PluginCall call, String callback) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissionForAlias("audio", call, callback);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestPermissionForAlias("storage", call, callback);
        }
    }
}
