package rd.sheepskin.sandboxmusic;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;

@CapacitorPlugin(name = "LockerMirror")
public class LockerMirrorPlugin extends Plugin {

    private LockerMirrorDatabase db;

    @Override
    public void load() {
        db = new LockerMirrorDatabase(getContext());
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void upsertTracks(PluginCall call) {
        JSArray tracks = call.getArray("tracks");
        if (tracks == null) {
            call.reject("tracks required");
            return;
        }
        JSONArray json = tracks;
        int count = db.upsertTracks(json);
        JSObject ret = new JSObject();
        ret.put("count", count);
        call.resolve(ret);
    }

    @PluginMethod
    public void search(PluginCall call) {
        String query = call.getString("query", "");
        Integer limit = call.getInt("limit", 50);
        JSONArray hits = db.search(query, limit == null ? 50 : limit);
        JSArray jsHits = JSArray.from(hits);
        if (jsHits == null) {
            jsHits = new JSArray();
        }
        JSObject ret = new JSObject();
        ret.put("hits", jsHits);
        call.resolve(ret);
    }

    @PluginMethod
    public void getCount(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("count", db.getCount());
        call.resolve(ret);
    }

    @PluginMethod
    public void listAllTracks(PluginCall call) {
        Integer limit = call.getInt("limit", 500);
        JSONArray hits = db.listAll(limit == null ? 500 : limit);
        JSArray jsHits = JSArray.from(hits);
        if (jsHits == null) {
            jsHits = new JSArray();
        }
        JSObject ret = new JSObject();
        ret.put("hits", jsHits);
        call.resolve(ret);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        db.clearAll();
        call.resolve();
    }
}
