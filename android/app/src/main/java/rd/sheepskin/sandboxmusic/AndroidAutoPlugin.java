package rd.sheepskin.sandboxmusic;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import androidx.annotation.Nullable;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "AndroidAuto")
public class AndroidAutoPlugin extends Plugin {

    private static AndroidAutoPlugin instance;

    @Override
    public void load() {
        instance = this;
        AndroidAutoBridge.setPlayRequestListener(
            mediaId -> {
                if (bridge == null) {
                    return;
                }
                JSObject payload = new JSObject();
                payload.put("mediaId", mediaId);
                notifyListeners("playFromMediaId", payload);
            }
        );
        AndroidAutoBridge.setSearchRequestListener(
            query -> {
                if (bridge == null) {
                    return;
                }
                JSObject payload = new JSObject();
                payload.put("query", query);
                notifyListeners("searchQuery", payload);
            }
        );
    }

    public static AndroidAutoPlugin getInstance() {
        return instance;
    }

    @PluginMethod
    public void setBrowseQueue(PluginCall call) {
        JSArray itemsArray = call.getArray("items");
        AndroidAutoBridge.setQueueItems(parseBrowseItems(itemsArray));
        call.resolve();
    }

    @PluginMethod
    public void setBrowseLibrary(PluginCall call) {
        JSArray albumsArray = call.getArray("albums");
        JSArray playlistsArray = call.getArray("playlists");

        List<AndroidAutoBridge.FolderNode> albumFolders = new ArrayList<>();
        Map<String, List<AndroidAutoBridge.BrowseItem>> albumTrackMap = new HashMap<>();
        if (albumsArray != null) {
            for (int i = 0; i < albumsArray.length(); i++) {
                JSObject row = jsObjectAt(albumsArray, i);
                if (row == null) {
                    continue;
                }
                String id = row.getString("id", "");
                if (id == null || id.isEmpty()) {
                    continue;
                }
                String mediaId = AndroidAutoBridge.ALBUM_PREFIX + id;
                String title = row.getString("title", "");
                String artist = row.getString("artist", "");
                albumFolders.add(new AndroidAutoBridge.FolderNode(mediaId, title, artist));
                albumTrackMap.put(mediaId, parseBrowseItems(optJSONArray(row, "tracks")));
            }
        }

        List<AndroidAutoBridge.FolderNode> playlistFolders = new ArrayList<>();
        Map<String, List<AndroidAutoBridge.BrowseItem>> playlistTrackMap = new HashMap<>();
        if (playlistsArray != null) {
            for (int i = 0; i < playlistsArray.length(); i++) {
                JSObject row = jsObjectAt(playlistsArray, i);
                if (row == null) {
                    continue;
                }
                String id = row.getString("id", "");
                if (id == null || id.isEmpty()) {
                    continue;
                }
                String mediaId = AndroidAutoBridge.PLAYLIST_PREFIX + id;
                String title = row.getString("title", "");
                playlistFolders.add(new AndroidAutoBridge.FolderNode(mediaId, title, ""));
                playlistTrackMap.put(mediaId, parseBrowseItems(optJSONArray(row, "tracks")));
            }
        }

        AndroidAutoBridge.setLibraryBrowse(
            albumFolders,
            albumTrackMap,
            playlistFolders,
            playlistTrackMap
        );
        call.resolve();
    }

    @PluginMethod
    public void setBrowseSearchResults(PluginCall call) {
        JSArray itemsArray = call.getArray("items");
        AndroidAutoBridge.setSearchResults(parseBrowseItems(itemsArray));
        call.resolve();
    }


    
    @Nullable
    private static JSONArray optJSONArray(JSObject row, String key) {
        try {
            return row.getJSONArray(key);
        } catch (JSONException ignored) {
            return null;
        }
    }
@Nullable
    private static JSObject jsObjectAt(JSONArray array, int index) {
        try {
            Object raw = array.get(index);
            if (raw instanceof JSONObject obj) {
                return JSObject.fromJSONObject(obj);
            }
        } catch (JSONException ignored) {}
        return null;
    }
    private static List<AndroidAutoBridge.BrowseItem> parseBrowseItems(JSONArray itemsArray) {
        List<AndroidAutoBridge.BrowseItem> items = new ArrayList<>();
        if (itemsArray == null) {
            return items;
        }
        for (int i = 0; i < itemsArray.length(); i++) {
            JSObject row = jsObjectAt(itemsArray, i);
            if (row == null) {
                continue;
            }
            String mediaId = row.getString("mediaId", "");
            String title = row.getString("title", "");
            String artist = row.getString("artist", "");
            String album = row.getString("album", null);
            if (mediaId == null || mediaId.isEmpty()) {
                continue;
            }
            items.add(new AndroidAutoBridge.BrowseItem(mediaId, title, artist, album));
        }
        return items;
    }
}
