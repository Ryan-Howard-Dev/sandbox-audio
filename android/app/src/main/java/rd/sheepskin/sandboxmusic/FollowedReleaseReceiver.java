package rd.sheepskin.sandboxmusic;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Alarm tick: notify JS bridge or wake MainActivity for a followed-release check. */
public class FollowedReleaseReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !FollowedReleaseScheduler.ACTION.equals(intent.getAction())) {
            return;
        }
        FollowedReleasePlugin.emitBackgroundCheck(context.getApplicationContext());
    }
}
