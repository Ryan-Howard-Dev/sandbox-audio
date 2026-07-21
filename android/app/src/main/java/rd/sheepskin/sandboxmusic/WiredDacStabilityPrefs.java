package rd.sheepskin.sandboxmusic;

import android.content.Context;
import android.content.SharedPreferences;

/** Wired USB-C DAC stability mode — synced from JS Settings. */
public final class WiredDacStabilityPrefs {

    private static final String PREFS = "sandbox_wired_dac";
    private static final String KEY_ENABLED = "stability_enabled";

    private WiredDacStabilityPrefs() {}

    public static boolean isEnabled(Context context) {
        if (context == null) return true;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.contains(KEY_ENABLED)) {
            return true;
        }
        return prefs.getBoolean(KEY_ENABLED, true);
    }

    public static void setEnabled(Context context, boolean enabled) {
        if (context == null) return;
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_ENABLED, enabled)
            .apply();
    }
}
