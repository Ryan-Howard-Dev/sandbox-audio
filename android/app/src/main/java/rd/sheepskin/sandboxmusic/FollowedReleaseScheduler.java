package rd.sheepskin.sandboxmusic;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * Schedules periodic followed-artist release checks (default 12 hours).
 */
public final class FollowedReleaseScheduler {

    public static final String ACTION = "rd.sheepskin.sandboxmusic.action.FOLLOWED_RELEASE_CHECK";
    private static final String PREFS_NAME = "sovereign_followed_release_alarm";
    private static final String KEY_INTERVAL_MS = "interval_ms";
    private static final int REQUEST_CODE = 99003;
    private static final long DEFAULT_INTERVAL_MS = 12L * 60L * 60L * 1000L;

    private FollowedReleaseScheduler() {}

    public static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static void schedule(Context context, long intervalMs) {
        Context app = context.getApplicationContext();
        long interval = intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
        prefs(app).edit().putLong(KEY_INTERVAL_MS, interval).apply();

        AlarmManager alarmManager = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            return;
        }

        PendingIntent pendingIntent = alarmPendingIntent(app);
        long triggerAt = System.currentTimeMillis() + interval;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setInexactRepeating(
                AlarmManager.RTC_WAKEUP,
                triggerAt,
                interval,
                pendingIntent
            );
        } else {
            alarmManager.setInexactRepeating(
                AlarmManager.RTC_WAKEUP,
                triggerAt,
                interval,
                pendingIntent
            );
        }
    }

    public static void cancel(Context context) {
        Context app = context.getApplicationContext();
        AlarmManager alarmManager = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pendingIntent = alarmPendingIntent(app);
        if (alarmManager != null) {
            alarmManager.cancel(pendingIntent);
        }
        pendingIntent.cancel();
    }

    public static long getIntervalMs(Context context) {
        return prefs(context).getLong(KEY_INTERVAL_MS, DEFAULT_INTERVAL_MS);
    }

    private static PendingIntent alarmPendingIntent(Context context) {
        Intent intent = new Intent(context, FollowedReleaseReceiver.class);
        intent.setAction(ACTION);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags);
    }
}
