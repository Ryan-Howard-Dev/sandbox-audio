package rd.sheepskin.sandboxmusic;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import androidx.annotation.Nullable;

/**
 * Persists wake-alarm schedule and registers it with {@link AlarmManager#setAlarmClock}.
 */
public final class WakeAlarmScheduler {

    static final String PREFS_NAME = "sovereign_wake_alarm";
    static final String KEY_FIRE_AT = "fire_at";
    static final String KEY_TRACK_JSON = "track_json";
    static final String KEY_PENDING = "pending_track_json";

    private static final int REQUEST_CODE_ALARM = 99001;

    private WakeAlarmScheduler() {}

    public static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static void schedule(Context context, long fireAtMs, String trackJson) {
        Context app = context.getApplicationContext();
        prefs(app).edit()
            .putLong(KEY_FIRE_AT, fireAtMs)
            .putString(KEY_TRACK_JSON, trackJson)
            .remove(KEY_PENDING)
            .apply();

        AlarmManager alarmManager = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            return;
        }

        PendingIntent pendingIntent = alarmPendingIntent(app);
        long triggerAt = Math.max(fireAtMs, System.currentTimeMillis() + 1_000L);

        AlarmManager.AlarmClockInfo clockInfo = new AlarmManager.AlarmClockInfo(
            triggerAt,
            launchPendingIntent(app)
        );
        alarmManager.setAlarmClock(clockInfo, pendingIntent);
    }

    public static void cancel(Context context) {
        Context app = context.getApplicationContext();
        AlarmManager alarmManager = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pendingIntent = alarmPendingIntent(app);
        if (alarmManager != null) {
            alarmManager.cancel(pendingIntent);
        }
        pendingIntent.cancel();
        prefs(app).edit()
            .remove(KEY_FIRE_AT)
            .remove(KEY_TRACK_JSON)
            .remove(KEY_PENDING)
            .apply();
    }

    public static boolean isScheduled(Context context) {
        return prefs(context).contains(KEY_FIRE_AT) && prefs(context).contains(KEY_TRACK_JSON);
    }

    @Nullable
    public static Long getScheduledFireAt(Context context) {
        if (!isScheduled(context)) {
            return null;
        }
        return prefs(context).getLong(KEY_FIRE_AT, 0L);
    }

    @Nullable
    public static String getScheduledTrackJson(Context context) {
        if (!isScheduled(context)) {
            return null;
        }
        return prefs(context).getString(KEY_TRACK_JSON, null);
    }

    public static void rescheduleIfNeeded(Context context) {
        Long fireAt = getScheduledFireAt(context);
        String trackJson = getScheduledTrackJson(context);
        if (fireAt == null || trackJson == null) {
            return;
        }
        if (fireAt <= System.currentTimeMillis()) {
            markPending(context, trackJson);
            prefs(context).edit().remove(KEY_FIRE_AT).remove(KEY_TRACK_JSON).apply();
            return;
        }
        schedule(context, fireAt, trackJson);
    }

    public static void markPending(Context context, String trackJson) {
        prefs(context).edit()
            .putString(KEY_PENDING, trackJson)
            .remove(KEY_FIRE_AT)
            .remove(KEY_TRACK_JSON)
            .apply();
    }

    @Nullable
    public static String consumePending(Context context) {
        SharedPreferences prefs = prefs(context);
        String pending = prefs.getString(KEY_PENDING, null);
        if (pending != null) {
            prefs.edit().remove(KEY_PENDING).apply();
        }
        return pending;
    }

    @Nullable
    public static String peekPending(Context context) {
        return prefs(context).getString(KEY_PENDING, null);
    }

    private static PendingIntent alarmPendingIntent(Context context) {
        Intent intent = new Intent(context, WakeAlarmReceiver.class);
        intent.setAction(WakeAlarmReceiver.ACTION_WAKE_ALARM);
        return PendingIntent.getBroadcast(
            context,
            REQUEST_CODE_ALARM,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static PendingIntent launchPendingIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(WakeAlarmReceiver.ACTION_WAKE_ALARM);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            context,
            REQUEST_CODE_ALARM + 1,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
