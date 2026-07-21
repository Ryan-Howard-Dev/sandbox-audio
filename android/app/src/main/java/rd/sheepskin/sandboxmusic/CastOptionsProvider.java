package rd.sheepskin.sandboxmusic;

import android.content.Context;
import com.google.android.gms.cast.framework.CastOptions;
import com.google.android.gms.cast.framework.OptionsProvider;
import com.google.android.gms.cast.framework.SessionProvider;
import com.google.android.gms.cast.framework.media.CastMediaOptions;
import com.google.android.gms.cast.framework.media.NotificationOptions;
import com.google.android.gms.cast.CastMediaControlIntent;
import java.util.List;

/**
 * Google Cast framework options — receiver App ID may be overridden via NativeCast.initialize().
 */
public class CastOptionsProvider implements OptionsProvider {

    private static final String PREFS = "native_cast";
    private static final String KEY_RECEIVER = "receiver_app_id";

    static String receiverAppId(Context context) {
        return context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_RECEIVER, CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID);
    }

    static void saveReceiverAppId(Context context, String appId) {
        if (appId == null || appId.isEmpty()) return;
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_RECEIVER, appId)
            .apply();
    }

    @Override
    public CastOptions getCastOptions(Context appContext) {
        NotificationOptions notificationOptions = new NotificationOptions.Builder()
            .setTargetActivityClassName(MainActivity.class.getName())
            .build();

        CastMediaOptions mediaOptions = new CastMediaOptions.Builder()
            .setNotificationOptions(notificationOptions)
            .build();

        return new CastOptions.Builder()
            .setReceiverApplicationId(receiverAppId(appContext))
            .setResumeSavedSession(true)
            .setEnableReconnectionService(true)
            .setCastMediaOptions(mediaOptions)
            .build();
    }

    @Override
    public List<SessionProvider> getAdditionalSessionProviders(Context appContext) {
        return null;
    }
}
