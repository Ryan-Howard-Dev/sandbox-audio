package rd.sheepskin.sandboxmusic;

import android.content.Context;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FollowedReleaseNative")
public class FollowedReleasePlugin extends Plugin {

    private static FollowedReleasePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    public static void emitBackgroundCheck(Context context) {
        if (instance != null && instance.getBridge() != null) {
            instance.notifyListeners("backgroundCheck", new JSObject());
            return;
        }
        Intent launch = new Intent(context, MainActivity.class);
        launch.setAction(FollowedReleaseScheduler.ACTION);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        context.startActivity(launch);
    }

    @PluginMethod
    public void schedulePeriodicCheck(PluginCall call) {
        Double hours = call.getDouble("intervalHours");
        long intervalMs = hours != null && hours > 0
            ? (long) (hours * 60.0 * 60.0 * 1000.0)
            : FollowedReleaseScheduler.getIntervalMs(getContext());
        FollowedReleaseScheduler.schedule(getContext(), intervalMs);
        call.resolve();
    }

    @PluginMethod
    public void cancelPeriodicCheck(PluginCall call) {
        FollowedReleaseScheduler.cancel(getContext());
        call.resolve();
    }
}
