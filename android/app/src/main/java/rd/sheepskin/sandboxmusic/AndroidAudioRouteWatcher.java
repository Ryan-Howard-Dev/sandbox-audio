package rd.sheepskin.sandboxmusic;

import android.content.Context;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.annotation.Nullable;

/**
 * Emits debounced audio output route changes when USB/wired devices connect or disconnect.
 * Used to recover playback after brief USB-C DAC glitches.
 */
public final class AndroidAudioRouteWatcher {

    private static final long DEBOUNCE_MS = 300L;

    @Nullable
    private static AndroidAudioRouteWatcher instance;

    @Nullable
    private BackgroundMediaPlugin plugin;

    @Nullable
    private AudioManager audioManager;

    @Nullable
    private AudioDeviceCallback deviceCallback;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String lastEmittedRoute = "";
    private boolean started = false;

    @Nullable
    private final Runnable debouncedEmit =
        new Runnable() {
            @Override
            public void run() {
                emitCurrentRoute("deviceChange");
            }
        };

    private AndroidAudioRouteWatcher() {}

    public static synchronized AndroidAudioRouteWatcher getInstance() {
        if (instance == null) {
            instance = new AndroidAudioRouteWatcher();
        }
        return instance;
    }

    public synchronized void start(Context context, BackgroundMediaPlugin plugin) {
        if (context == null || plugin == null || started) {
            return;
        }
        this.plugin = plugin;
        audioManager = (AudioManager) context.getApplicationContext().getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return;
        }

        deviceCallback =
            new AudioDeviceCallback() {
                @Override
                public void onAudioDevicesAdded(AudioDeviceInfo[] addedDevices) {
                    scheduleEmit();
                }

                @Override
                public void onAudioDevicesRemoved(AudioDeviceInfo[] removedDevices) {
                    scheduleEmit();
                }
            };
        audioManager.registerAudioDeviceCallback(deviceCallback, mainHandler);
        started = true;
        lastEmittedRoute = "";
        emitCurrentRoute("start");
    }

    public synchronized void stop() {
        if (!started) {
            return;
        }
        mainHandler.removeCallbacks(debouncedEmit);
        if (audioManager != null && deviceCallback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                audioManager.unregisterAudioDeviceCallback(deviceCallback);
            } catch (Exception ignored) {
                // Already unregistered.
            }
        }
        deviceCallback = null;
        audioManager = null;
        plugin = null;
        started = false;
        lastEmittedRoute = "";
    }

    private void scheduleEmit() {
        mainHandler.removeCallbacks(debouncedEmit);
        mainHandler.postDelayed(debouncedEmit, DEBOUNCE_MS);
    }

    private void emitCurrentRoute(String reason) {
        BackgroundMediaPlugin target = plugin;
        if (target == null) {
            return;
        }
        Context ctx = target.getContext();
        if (ctx == null) {
            return;
        }
        String route = AndroidAudioSessionHelper.detectOutputRoute(ctx);
        if (route.equals(lastEmittedRoute)) {
            return;
        }
        lastEmittedRoute = route;
        target.emitAudioRouteChange(route, reason);
    }
}
