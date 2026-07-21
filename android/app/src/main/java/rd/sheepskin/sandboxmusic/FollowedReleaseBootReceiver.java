package rd.sheepskin.sandboxmusic;

import android.content.Context;
import android.content.Intent;
import android.content.BroadcastReceiver;

/** Re-schedule followed-release alarm after device reboot. */
public class FollowedReleaseBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }
        long interval = FollowedReleaseScheduler.getIntervalMs(context);
        FollowedReleaseScheduler.schedule(context, interval);
    }
}
