package rd.sheepskin.sandboxmusic;

import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "DownloadForeground",
    permissions = {
        @Permission(strings = { android.Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class DownloadForegroundPlugin extends Plugin {

    @PluginMethod
    public void setActive(PluginCall call) {
        Boolean active = call.getBoolean("active", false);
        if (!Boolean.TRUE.equals(active)) {
            DownloadForegroundService.requestStop(getContext());
            call.resolve();
            return;
        }
        if (Build.VERSION.SDK_INT >= 33) {
            if (!hasPermission("notifications")) {
                bridge.saveCall(call);
                requestPermissionForAlias("notifications", call, "notificationsPermsCallback");
                return;
            }
        }
        startInternal(call);
    }

    @PermissionCallback
    private void notificationsPermsCallback(PluginCall call) {
        startInternal(call);
    }

    private void startInternal(PluginCall call) {
        String title = call.getString("title", "");
        Integer completed = call.getInt("completedTracks", 0);
        Integer total = call.getInt("totalTracks", 0);
        Integer queueCount = call.getInt("queueCount", 0);
        DownloadForegroundService.updateProgress(
            title,
            completed != null ? completed : 0,
            total != null ? total : 0,
            queueCount != null ? queueCount : 0
        );
        DownloadForegroundService.requestStart(getContext());
        call.resolve();
    }

    @PluginMethod
    public void updateProgress(PluginCall call) {
        String title = call.getString("title", "");
        Integer completed = call.getInt("completedTracks", 0);
        Integer total = call.getInt("totalTracks", 0);
        Integer queueCount = call.getInt("queueCount", 0);
        DownloadForegroundService.updateProgress(
            title,
            completed != null ? completed : 0,
            total != null ? total : 0,
            queueCount != null ? queueCount : 0
        );
        if (DownloadForegroundService.isActive()) {
            DownloadForegroundService.requestStart(getContext());
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        DownloadForegroundService.requestStop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void isActive(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("active", DownloadForegroundService.isActive());
        call.resolve(ret);
    }
}
