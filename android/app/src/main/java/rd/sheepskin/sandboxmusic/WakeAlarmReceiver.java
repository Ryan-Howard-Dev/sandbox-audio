package rd.sheepskin.sandboxmusic;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/**
 * Delivers the Sandbox wake alarm: notification + app launch + pending payload for JS playback.
 */
public class WakeAlarmReceiver extends BroadcastReceiver {

    public static final String ACTION_WAKE_ALARM = "rd.sheepskin.sandboxmusic.action.WAKE_ALARM";
    public static final String EXTRA_TRACK_JSON = "track_json";

    private static final String CHANNEL_ID = "sovereign_wake_alarm";
    private static final int NOTIFICATION_ID = 99002;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_WAKE_ALARM.equals(intent.getAction())) {
            return;
        }

        Context app = context.getApplicationContext();
        String trackJson = WakeAlarmScheduler.getScheduledTrackJson(app);
        if (trackJson == null || trackJson.isEmpty()) {
            trackJson = intent.getStringExtra(EXTRA_TRACK_JSON);
        }
        if (trackJson == null || trackJson.isEmpty()) {
            return;
        }

        WakeAlarmScheduler.markPending(app, trackJson);
        WakeAlarmScheduler.cancel(app);

        showNotification(app, trackJson);
        launchMainActivity(app, trackJson);
        WakeAlarmPlugin.notifyWakeAlarmFired(trackJson);
    }

    private void showNotification(Context context, String trackJson) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.wake_alarm_notification_channel),
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription(context.getString(R.string.wake_alarm_notification_channel_desc));
            manager.createNotificationChannel(channel);
        }

        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.setAction(ACTION_WAKE_ALARM);
        launchIntent.putExtra(EXTRA_TRACK_JSON, trackJson);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent contentIntent = PendingIntent.getActivity(
            context,
            NOTIFICATION_ID,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String title = context.getString(R.string.wake_alarm_notification_title);
        String body = context.getString(R.string.wake_alarm_notification_body);
        try {
            org.json.JSONObject track = new org.json.JSONObject(trackJson);
            String trackTitle = track.optString("title", "");
            String artist = track.optString("artist", "");
            if (!trackTitle.isEmpty()) {
                body = artist.isEmpty() ? trackTitle : trackTitle + " — " + artist;
            }
        } catch (Exception ignored) {
            // Keep generic body.
        }

        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();

        manager.notify(NOTIFICATION_ID, notification);
    }

    private void launchMainActivity(Context context, String trackJson) {
        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.setAction(ACTION_WAKE_ALARM);
        launchIntent.putExtra(EXTRA_TRACK_JSON, trackJson);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        context.startActivity(launchIntent);
    }
}
