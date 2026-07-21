package rd.sheepskin.sandboxmusic;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.webkit.MimeTypeMap;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import java.io.File;
import java.io.FileNotFoundException;

/**
 * Serves locker cache files to ExoPlayer via content:// URIs (offline IndexedDB bridge).
 */
public class LockerBlobContentProvider extends ContentProvider {

    public static final String AUTHORITY = BuildConfig.APPLICATION_ID + ".locker";

    @Override
    public boolean onCreate() {
        if (getContext() != null) {
            LockerBlobRegistry.warmFromDisk(getContext());
        }
        return true;
    }

    @Nullable
    @Override
    public Cursor query(
        @NonNull Uri uri,
        @Nullable String[] projection,
        @Nullable String selection,
        @Nullable String[] selectionArgs,
        @Nullable String sortOrder
    ) {
        return null;
    }

    @Nullable
    @Override
    public String getType(@NonNull Uri uri) {
        File file = resolveFile(uri);
        if (file == null) return "application/octet-stream";
        String ext = MimeTypeMap.getFileExtensionFromUrl(file.getName());
        if (ext != null) {
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (mime != null) return mime;
        }
        return "application/octet-stream";
    }

    @Nullable
    @Override
    public Uri insert(@NonNull Uri uri, @Nullable ContentValues values) {
        return null;
    }

    @Override
    public int delete(
        @NonNull Uri uri,
        @Nullable String selection,
        @Nullable String[] selectionArgs
    ) {
        return 0;
    }

    @Override
    public int update(
        @NonNull Uri uri,
        @Nullable ContentValues values,
        @Nullable String selection,
        @Nullable String[] selectionArgs
    ) {
        return 0;
    }

    @Nullable
    @Override
    public ParcelFileDescriptor openFile(@NonNull Uri uri, @NonNull String mode)
        throws FileNotFoundException {
        File file = resolveFile(uri);
        if (file == null || !file.isFile()) {
            throw new FileNotFoundException("locker blob not found: " + uri);
        }
        int pfdMode = ParcelFileDescriptor.MODE_READ_ONLY;
        return ParcelFileDescriptor.open(file, pfdMode);
    }

    @Nullable
    private File resolveFile(Uri uri) {
        if (uri == null) return null;
        String path = uri.getPath();
        if (path == null) return null;
        String[] segments = path.split("/");
        if (segments.length < 2) return null;
        String id = segments[segments.length - 1];
        Context ctx = getContext();
        if (ctx != null) {
            return LockerBlobRegistry.getFile(ctx, id);
        }
        return LockerBlobRegistry.getFile(id);
    }
}
