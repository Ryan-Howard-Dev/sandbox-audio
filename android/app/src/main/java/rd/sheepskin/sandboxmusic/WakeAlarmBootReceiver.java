package rd.sheepskin.sandboxmusic;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Re-registers wake alarms after device reboot. */
public class WakeAlarmBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) {
            return;
        }
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            || Intent.ACTION_TIME_CHANGED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            WakeAlarmScheduler.rescheduleIfNeeded(context.getApplicationContext());
        }
    }
}
