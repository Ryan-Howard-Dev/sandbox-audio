package rd.sheepskin.sandboxmusic;

import android.Manifest;
import android.os.Build;
import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "WakeAlarm",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class WakeAlarmPlugin extends Plugin {

    private static WakeAlarmPlugin instance;
    @Nullable
    private static String pendingTrackJsonForBridge;

    @Override
    public void load() {
        instance = this;
        String pending = WakeAlarmScheduler.consumePending(getContext());
        if (pending != null) {
            pendingTrackJsonForBridge = pending;
            if (getActivity() != null) {
                getActivity().runOnUiThread(this::emitPendingIfReady);
            }
        }
    }

    public static void notifyWakeAlarmFired(String trackJson) {
        pendingTrackJsonForBridge = trackJson;
        if (instance != null && instance.getActivity() != null) {
            instance.getActivity().runOnUiThread(instance::emitPendingIfReady);
        }
    }

    public static void deliverFromIntent(@Nullable String trackJson) {
        if (trackJson == null || trackJson.isEmpty()) {
            return;
        }
        pendingTrackJsonForBridge = trackJson;
        if (instance != null && instance.getActivity() != null) {
            instance.getActivity().runOnUiThread(instance::emitPendingIfReady);
        }
    }

    private void emitPendingIfReady() {
        if (bridge == null || pendingTrackJsonForBridge == null) {
            return;
        }
        JSObject payload = trackJsonToJSObject(pendingTrackJsonForBridge);
        if (payload != null) {
            notifyListeners("wakeAlarmFired", payload);
        }
        pendingTrackJsonForBridge = null;
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        Long fireAtMs = call.getLong("fireAtMs");
        JSObject track = call.getObject("track");
        if (fireAtMs == null || fireAtMs <= 0 || track == null) {
            call.reject("fireAtMs and track are required");
            return;
        }

        if (Build.VERSION.SDK_INT >= 33 && !hasPermission("notifications")) {
            bridge.saveCall(call);
            requestPermissionForAlias("notifications", call, "notificationsPermsCallback");
            return;
        }

        scheduleInternal(call, fireAtMs, track);
    }

    @PermissionCallback
    private void notificationsPermsCallback(PluginCall call) {
        Long fireAtMs = call.getLong("fireAtMs");
        JSObject track = call.getObject("track");
        if (fireAtMs == null || fireAtMs <= 0 || track == null) {
            call.reject("fireAtMs and track are required");
            return;
        }
        scheduleInternal(call, fireAtMs, track);
    }

    private void scheduleInternal(PluginCall call, long fireAtMs, JSObject track) {
        try {
            JSONObject json = new JSONObject(track.toString());
            if (!json.has("envelopeId")) {
                call.reject("track.envelopeId is required");
                return;
            }
            WakeAlarmScheduler.schedule(getContext(), fireAtMs, json.toString());
            JSObject ret = new JSObject();
            ret.put("scheduled", true);
            ret.put("fireAtMs", fireAtMs);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to schedule wake alarm", e);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        WakeAlarmScheduler.cancel(getContext());
        pendingTrackJsonForBridge = null;
        JSObject ret = new JSObject();
        ret.put("scheduled", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void isScheduled(PluginCall call) {
        boolean scheduled = WakeAlarmScheduler.isScheduled(getContext());
        JSObject ret = new JSObject();
        ret.put("scheduled", scheduled);
        if (scheduled) {
            Long fireAt = WakeAlarmScheduler.getScheduledFireAt(getContext());
            if (fireAt != null) {
                ret.put("fireAtMs", fireAt);
            }
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void consumePending(PluginCall call) {
        String pending = WakeAlarmScheduler.consumePending(getContext());
        if (pending == null && pendingTrackJsonForBridge != null) {
            pending = pendingTrackJsonForBridge;
            pendingTrackJsonForBridge = null;
        }
        JSObject ret = new JSObject();
        if (pending != null) {
            JSObject track = trackJsonToJSObject(pending);
            if (track != null) {
                ret.put("pending", true);
                ret.put("track", track);
                call.resolve(ret);
                return;
            }
        }
        ret.put("pending", false);
        call.resolve(ret);
    }

    @Nullable
    private static JSObject trackJsonToJSObject(String trackJson) {
        try {
            JSONObject json = new JSONObject(trackJson);
            JSObject out = new JSObject();
            out.put("envelopeId", json.optString("envelopeId", ""));
            out.put("title", json.optString("title", ""));
            out.put("artist", json.optString("artist", ""));
            if (json.has("url") && !json.isNull("url")) {
                out.put("url", json.optString("url", ""));
            }
            if (json.has("artworkUrl") && !json.isNull("artworkUrl")) {
                out.put("artworkUrl", json.optString("artworkUrl", ""));
            }
            if (json.has("provider") && !json.isNull("provider")) {
                out.put("provider", json.optString("provider", ""));
            }
            if (json.has("sourceId") && !json.isNull("sourceId")) {
                out.put("sourceId", json.optString("sourceId", ""));
            }
            if (json.has("durationSeconds") && !json.isNull("durationSeconds")) {
                out.put("durationSeconds", json.optDouble("durationSeconds", 0d));
            }
            if (json.has("transport") && !json.isNull("transport")) {
                out.put("transport", json.optString("transport", ""));
            }
            if (json.has("album") && !json.isNull("album")) {
                out.put("album", json.optString("album", ""));
            }
            return out;
        } catch (Exception e) {
            return null;
        }
    }
}
