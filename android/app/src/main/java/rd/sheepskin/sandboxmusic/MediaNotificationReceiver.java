package rd.sheepskin.sandboxmusic;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.app.PendingIntent;

public class MediaNotificationReceiver extends BroadcastReceiver {

    public static final String EXTRA_ACTION = "media_action";

    public static PendingIntent pendingIntent(Context context, String action) {
        Intent intent = new Intent(context, MediaNotificationReceiver.class);
        intent.setAction("rd.sheepskin.sandboxmusic.NOTIFICATION_" + action);
        intent.putExtra(EXTRA_ACTION, action);
        int requestCode = action.hashCode();
        return PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) {
            return;
        }
        String action = intent.getStringExtra(EXTRA_ACTION);
        if (action == null) {
            return;
        }
        MediaPlaybackForegroundService.dispatchExternalAction(context, action);
    }
}
