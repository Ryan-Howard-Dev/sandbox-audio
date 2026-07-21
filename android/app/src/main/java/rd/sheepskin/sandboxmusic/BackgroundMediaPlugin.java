package rd.sheepskin.sandboxmusic;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "BackgroundMedia",
    permissions = {
        @Permission(strings = { android.Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class BackgroundMediaPlugin extends Plugin {

    private static BackgroundMediaPlugin instance;
    private boolean stayAliveOnMinimize = true;

    @Override
    public void load() {
        instance = this;
        MediaPlaybackForegroundService.attachPlugin(this);
    }

    public static BackgroundMediaPlugin getInstance() {
        return instance;
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        Boolean stayAlive = call.getBoolean("stayAliveOnMinimize");
        if (stayAlive != null) {
            stayAliveOnMinimize = stayAlive;
        }
        call.resolve();
    }

    /**
     * Configure STREAM_MUSIC volume keys, MODE_NORMAL routing, and request audio focus
     * before WebView playback starts. Returns the current OS audio output route.
     */
    @PluginMethod
    public void configureAudioSession(PluginCall call) {
        if (getActivity() != null) {
            AndroidAudioSessionHelper.configureActivityAudio(getActivity());
        }
        boolean focusGranted = AndroidAudioSessionHelper.requestAppAudioFocus(getContext());
        JSObject ret = new JSObject();
        ret.put("route", AndroidAudioSessionHelper.detectOutputRoute(getContext()));
        ret.put("audioFocusGranted", focusGranted);
        call.resolve(ret);
    }

    @PluginMethod
    public void getAudioOutputRoute(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("route", AndroidAudioSessionHelper.detectOutputRoute(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void startAudioRouteWatcher(PluginCall call) {
        AndroidAudioRouteWatcher.getInstance().start(getContext(), this);
        call.resolve();
    }

    @PluginMethod
    public void stopAudioRouteWatcher(PluginCall call) {
        AndroidAudioRouteWatcher.getInstance().stop();
        call.resolve();
    }

    @PluginMethod
    public void setWiredDacStabilityEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", true);
        WiredDacStabilityPrefs.setEnabled(getContext(), Boolean.TRUE.equals(enabled));
        call.resolve();
    }

    @PluginMethod
    public void startForeground(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33) {
            if (!hasPermission("notifications")) {
                bridge.saveCall(call);
                requestPermissionForAlias("notifications", call, "notificationsPermsCallback");
                return;
            }
        }
        startServiceInternal();
        call.resolve();
    }

    @PermissionCallback
    private void notificationsPermsCallback(PluginCall call) {
        startServiceInternal();
        call.resolve();
    }

    private void startServiceInternal() {
        MediaPlaybackForegroundService.ensureServiceRunning(getContext());
    }

    @PluginMethod
    public void stopForeground(PluginCall call) {
        MediaPlaybackForegroundService.requestStop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        Long revision = call.getLong("revision", System.currentTimeMillis());
        MediaPlaybackForegroundService.updateMetadata(
            call.getString("title", ""),
            call.getString("artist", ""),
            call.getString("album", ""),
            call.getString("artworkUrl", null),
            call.getString("envelopeId", null),
            revision != null ? revision : System.currentTimeMillis()
        );
        MediaPlaybackForegroundService.requestRefresh(getContext());
        call.resolve();
    }

    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        Boolean playing = call.getBoolean("isPlaying", false);
        Double positionMs = call.getDouble("positionMs", 0d);
        Double durationMs = call.getDouble("durationMs", 0d);
        Double rate = call.getDouble("playbackRate", 1d);
        Long revision = call.getLong("revision", System.currentTimeMillis());
        MediaPlaybackForegroundService.updatePlaybackState(
            Boolean.TRUE.equals(playing),
            positionMs != null ? positionMs.longValue() : 0L,
            durationMs != null ? durationMs.longValue() : 0L,
            rate != null ? rate.floatValue() : 1f,
            revision != null ? revision : System.currentTimeMillis()
        );
        MediaPlaybackForegroundService.requestRefresh(getContext());
        call.resolve();
    }

    @PluginMethod
    public void setMiniPlayerMode(PluginCall call) {
        String mode = call.getString("mode", "off");
        MainActivity.setMiniPlayerMode(mode);
        call.resolve();
    }

    @PluginMethod
    public void enterPictureInPicture(PluginCall call) {
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).enterPictureInPictureFromPlugin();
        }
        call.resolve();
    }

    @PluginMethod
    public void requestBatteryOptimizationExemption(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        boolean granted = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
        if (!granted && getActivity() != null) {
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);
            } catch (Exception ignored) {
                // Some OEMs block this intent; user can whitelist manually in settings.
            }
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    public void emitMediaAction(String action) {
        emitMediaAction(action, null);
    }

    public void emitMediaAction(String action, @Nullable Long positionMs) {
        if (bridge == null) {
            return;
        }
        JSObject payload = new JSObject();
        payload.put("action", action);
        if (positionMs != null) {
            payload.put("positionMs", positionMs);
        }
        notifyListeners("mediaAction", payload);
    }

    public void emitAudioRouteChange(String route, @Nullable String reason) {
        if (bridge == null) {
            return;
        }
        JSObject payload = new JSObject();
        payload.put("route", route != null ? route : AndroidAudioSessionHelper.ROUTE_UNKNOWN);
        if (reason != null && !reason.isEmpty()) {
            payload.put("reason", reason);
        }
        notifyListeners("audioRouteChange", payload);
    }

    public boolean shouldStayAliveOnMinimize() {
        return stayAliveOnMinimize;
    }
}
