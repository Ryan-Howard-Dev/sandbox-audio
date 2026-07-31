package rd.sheepskin.sandboxmusic;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * One library folder per kind, inside a directory the user grants once.
 *
 * The Storage Access Framework is the whole point rather than an implementation detail. The
 * alternative, MANAGE_EXTERNAL_STORAGE, reads every file on the device and Play restricts it to
 * file managers -- a media player asking for it is a likely rejection, and it is the same shape of
 * over-permission as reading every notification to see what is playing. A folder grant asks one
 * question, once: point me at your library.
 *
 * The grant is persisted across reboots via takePersistableUriPermission. Nothing here copies or
 * moves a file on its own; it creates the folders and reports what it can see.
 */
@CapacitorPlugin(name = "LibraryFolder")
public class LibraryFolderPlugin extends Plugin {

    private static final String PREFS = "sandbox_library_folder";
    private static final String KEY_TREE_URI = "tree_uri";

    /**
     * Folder names, matching Android's own public directories where they exist so a file manager
     * shows the same structure the app does. Books has no Android equivalent.
     *
     * Kept in step with src/libraryFolders.ts -- that file decides which file belongs where, and
     * this one only creates the destinations.
     */
    private static final String ROOT_DIR = "Sandbox";
    private static final String[] FOLDERS = { "Music", "Podcasts", "Audiobooks", "Books", "Documents" };

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The granted tree, or null when the user has not chosen one or the grant was revoked. */
    private Uri persistedTree() {
        String stored = prefs().getString(KEY_TREE_URI, null);
        if (stored == null) return null;
        Uri uri = Uri.parse(stored);
        // A grant can be revoked from system settings, and the stored string outlives it. Trust the
        // live permission list rather than our own record.
        for (android.content.UriPermission held : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (held.getUri().equals(uri) && held.isWritePermission()) return uri;
        }
        return null;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Uri tree = persistedTree();
        JSObject out = new JSObject();
        out.put("granted", tree != null);
        out.put("treeUri", tree == null ? null : tree.toString());
        if (tree != null) {
            DocumentFile root = DocumentFile.fromTreeUri(getContext(), tree);
            out.put("displayName", root == null ? null : root.getName());
        }
        call.resolve(out);
    }

    /** Open the system folder picker. The result arrives in {@link #onFolderPicked}. */
    @PluginMethod
    public void requestFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "onFolderPicked");
    }

    @ActivityCallback
    private void onFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject out = new JSObject();
            out.put("granted", false);
            out.put("cancelled", true);
            call.resolve(out);
            return;
        }
        Uri tree = result.getData().getData();
        if (tree == null) {
            call.reject("No folder returned by the picker");
            return;
        }
        try {
            // Without this the grant dies with the activity, and the user is asked again next launch.
            getContext()
                .getContentResolver()
                .takePersistableUriPermission(
                    tree,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                );
        } catch (SecurityException e) {
            call.reject("Could not hold on to that folder: " + e.getMessage());
            return;
        }
        prefs().edit().putString(KEY_TREE_URI, tree.toString()).apply();

        JSObject out = new JSObject();
        out.put("granted", true);
        out.put("treeUri", tree.toString());
        call.resolve(out);
    }

    /**
     * Create the five folders under a Sandbox directory inside the granted tree.
     *
     * Idempotent: an existing folder is reported as found rather than duplicated, so this is safe
     * to call on every launch.
     */
    @PluginMethod
    public void ensureFolders(PluginCall call) {
        Uri tree = persistedTree();
        if (tree == null) {
            call.reject("No folder has been granted yet");
            return;
        }
        DocumentFile root = DocumentFile.fromTreeUri(getContext(), tree);
        if (root == null || !root.canWrite()) {
            call.reject("The granted folder is not writable");
            return;
        }
        DocumentFile sandbox = findOrCreateDir(root, ROOT_DIR);
        if (sandbox == null) {
            call.reject("Could not create " + ROOT_DIR + " in the granted folder");
            return;
        }

        JSArray created = new JSArray();
        JSArray existing = new JSArray();
        for (String name : FOLDERS) {
            DocumentFile before = sandbox.findFile(name);
            if (before != null && before.isDirectory()) {
                existing.put(name);
                continue;
            }
            DocumentFile made = sandbox.createDirectory(name);
            if (made != null) created.put(name);
        }

        JSObject out = new JSObject();
        out.put("rootUri", sandbox.getUri().toString());
        out.put("created", created);
        out.put("existing", existing);
        call.resolve(out);
    }

    /**
     * Count what is already inside each folder, so the shelves can say what they hold without the
     * WebView reading every file.
     */
    @PluginMethod
    public void listFolders(PluginCall call) {
        Uri tree = persistedTree();
        if (tree == null) {
            call.reject("No folder has been granted yet");
            return;
        }
        DocumentFile root = DocumentFile.fromTreeUri(getContext(), tree);
        DocumentFile sandbox = root == null ? null : root.findFile(ROOT_DIR);
        JSObject folders = new JSObject();
        if (sandbox != null && sandbox.isDirectory()) {
            for (String name : FOLDERS) {
                DocumentFile dir = sandbox.findFile(name);
                JSObject info = new JSObject();
                boolean present = dir != null && dir.isDirectory();
                info.put("present", present);
                info.put("count", present ? dir.listFiles().length : 0);
                info.put("uri", present ? dir.getUri().toString() : null);
                folders.put(name, info);
            }
        }
        JSObject out = new JSObject();
        out.put("folders", folders);
        call.resolve(out);
    }

    /** Forget the grant. The files stay where they are; only our access to them ends. */
    @PluginMethod
    public void releaseFolder(PluginCall call) {
        Uri tree = persistedTree();
        if (tree != null) {
            try {
                getContext()
                    .getContentResolver()
                    .releasePersistableUriPermission(
                        tree,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    );
            } catch (SecurityException ignored) {
                // Already gone from the system's list; clearing our own record is still correct.
            }
        }
        prefs().edit().remove(KEY_TREE_URI).apply();
        JSObject out = new JSObject();
        out.put("granted", false);
        call.resolve(out);
    }

    private DocumentFile findOrCreateDir(DocumentFile parent, String name) {
        DocumentFile existing = parent.findFile(name);
        if (existing != null && existing.isDirectory()) return existing;
        return parent.createDirectory(name);
    }
}
