package rd.sheepskin.sandboxmusic;

import android.app.Activity;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import androidx.annotation.Nullable;

/**
 * Configures Android audio routing for WebView media playback: STREAM_MUSIC volume keys,
 * MODE_NORMAL (built-in speaker / BT / wired — not earpiece), media usage attributes,
 * and output-route detection for the settings UI.
 */
public final class AndroidAudioSessionHelper {

    public static final String ROUTE_SPEAKER = "speaker";
    public static final String ROUTE_BLUETOOTH = "bluetooth";
    public static final String ROUTE_WIRED = "wired";
    public static final String ROUTE_UNKNOWN = "unknown";

    private static AudioFocusRequest appAudioFocusRequest;
    private static boolean appHasAudioFocus = false;

    private AndroidAudioSessionHelper() {}

    /** Activity-level setup: media volume keys and normal routing (not earpiece). */
    public static void configureActivityAudio(Activity activity) {
        if (activity == null) {
            return;
        }
        activity.setVolumeControlStream(AudioManager.STREAM_MUSIC);
        AudioManager audioManager = (AudioManager) activity.getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null) {
            return;
        }
        if (audioManager.getMode() != AudioManager.MODE_NORMAL) {
            audioManager.setMode(AudioManager.MODE_NORMAL);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            audioManager.setSpeakerphoneOn(false);
        }
    }

    /**
     * Request audio focus before WebView playback so Chromium routes through STREAM_MUSIC
     * and respects duck/pause from calls and other media apps.
     */
    public static boolean requestAppAudioFocus(Context context) {
        AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null || appHasAudioFocus) {
            return appHasAudioFocus;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes attrs = buildMediaAttributes();
            appAudioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setAcceptsDelayedFocusGain(true)
                .setOnAudioFocusChangeListener(focusChange -> {
                    if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
                        appHasAudioFocus = true;
                    } else if (
                        focusChange == AudioManager.AUDIOFOCUS_LOSS
                            || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
                            || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK
                    ) {
                        appHasAudioFocus = false;
                    }
                })
                .build();
            int result = audioManager.requestAudioFocus(appAudioFocusRequest);
            appHasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } else {
            int result = audioManager.requestAudioFocus(
                focusChange -> {
                    if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
                        appHasAudioFocus = true;
                    } else {
                        appHasAudioFocus = false;
                    }
                },
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            );
            appHasAudioFocus = result == AudioManager.AUDIOFOCUS_GAIN;
        }
        return appHasAudioFocus;
    }

    public static AudioAttributes buildMediaAttributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build();
    }

    /** Detect the active playback output (OS routing; WebView follows the same path). */
    public static String detectOutputRoute(Context context) {
        AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null) {
            return ROUTE_UNKNOWN;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            AudioDeviceInfo[] devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            boolean hasSpeaker = false;
            for (AudioDeviceInfo device : devices) {
                if (!device.isSink()) {
                    continue;
                }
                int type = device.getType();
                if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
                    || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                    || type == AudioDeviceInfo.TYPE_BLE_HEADSET
                    || type == AudioDeviceInfo.TYPE_BLE_SPEAKER) {
                    return ROUTE_BLUETOOTH;
                }
                if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET
                    || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                    || type == AudioDeviceInfo.TYPE_USB_HEADSET
                    || type == AudioDeviceInfo.TYPE_USB_DEVICE) {
                    return ROUTE_WIRED;
                }
                if (type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                    || type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
                    hasSpeaker = true;
                }
            }
            if (hasSpeaker) {
                return ROUTE_SPEAKER;
            }
        }

        if (audioManager.isBluetoothA2dpOn() || audioManager.isBluetoothScoOn()) {
            return ROUTE_BLUETOOTH;
        }
        if (audioManager.isWiredHeadsetOn()) {
            return ROUTE_WIRED;
        }
        return ROUTE_SPEAKER;
    }

  /**
   * Prefer USB DAC / headset over 3.5 mm when multiple wired sinks are present.
   * Returns null when no wired output device is connected.
   */
    @Nullable
    public static AudioDeviceInfo findWiredOutputDevice(Context context) {
        AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return null;
        }
        AudioDeviceInfo[] devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
        AudioDeviceInfo wiredFallback = null;
        for (AudioDeviceInfo device : devices) {
            if (!device.isSink()) {
                continue;
            }
            int type = device.getType();
            if (type == AudioDeviceInfo.TYPE_USB_DEVICE
                || type == AudioDeviceInfo.TYPE_USB_HEADSET) {
                return device;
            }
            if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET
                || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES) {
                wiredFallback = device;
            }
        }
        return wiredFallback;
    }

    public static void emitPauseFromBecomingNoisy(@Nullable Context context) {
        NativeExoPlaybackPlugin.pauseFromBecomingNoisy();
        BackgroundMediaPlugin plugin = BackgroundMediaPlugin.getInstance();
        if (plugin != null) {
            plugin.emitMediaAction("pause");
            return;
        }
        if (context != null) {
            MediaPlaybackForegroundService.dispatchExternalAction(context, "pause");
        }
    }
}
