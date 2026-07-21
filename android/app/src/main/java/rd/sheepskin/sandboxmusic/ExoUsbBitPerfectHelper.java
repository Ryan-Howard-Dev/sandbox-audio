package rd.sheepskin.sandboxmusic;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.AudioMixerAttributes;
import android.os.Build;
import androidx.annotation.Nullable;
import java.util.List;

/** Phase 2a probe — MIXER_BEHAVIOR_BIT_PERFECT on wired USB DAC (API 34+). */
final class ExoUsbBitPerfectHelper {

    private ExoUsbBitPerfectHelper() {}

    static boolean isUsbDacRoute(Context context) {
        AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            AudioDeviceInfo[] devices = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            for (AudioDeviceInfo device : devices) {
                if (!device.isSink()) continue;
                int type = device.getType();
                if (type == AudioDeviceInfo.TYPE_USB_DEVICE
                    || type == AudioDeviceInfo.TYPE_USB_HEADSET) {
                    return true;
                }
            }
        }
        String route = AndroidAudioSessionHelper.detectOutputRoute(context);
        return AndroidAudioSessionHelper.ROUTE_WIRED.equals(route);
    }

    static boolean isBitPerfectMixerAvailable(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            return false;
        }
        AudioManager am = context.getSystemService(AudioManager.class);
        if (am == null) return false;
        AudioDeviceInfo usbDevice = findUsbOutputDevice(am);
        if (usbDevice == null) return false;
        List<AudioMixerAttributes> supported = am.getSupportedMixerAttributes(usbDevice);
        if (supported == null || supported.isEmpty()) return false;
        for (AudioMixerAttributes mixer : supported) {
            if (mixer.getMixerBehavior() == AudioMixerAttributes.MIXER_BEHAVIOR_BIT_PERFECT) {
                return true;
            }
        }
        return false;
    }

    @Nullable
    private static AudioDeviceInfo findUsbOutputDevice(AudioManager am) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null;
        AudioDeviceInfo[] devices = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
        for (AudioDeviceInfo device : devices) {
            if (!device.isSink()) continue;
            int type = device.getType();
            if (type == AudioDeviceInfo.TYPE_USB_DEVICE
                || type == AudioDeviceInfo.TYPE_USB_HEADSET) {
                return device;
            }
        }
        return null;
    }

    static boolean shouldBypassAppVolume(Context context, boolean userEnabled) {
        return userEnabled && isUsbDacRoute(context) && isBitPerfectMixerAvailable(context);
    }

    static JSObjectProbe probe(Context context) {
        JSObjectProbe ret = new JSObjectProbe();
        ret.available = isBitPerfectMixerAvailable(context);
        ret.usbDacConnected = isUsbDacRoute(context);
        ret.active = shouldBypassAppVolume(context, false);
        return ret;
    }

    static final class JSObjectProbe {
        boolean available;
        boolean usbDacConnected;
        boolean active;
    }
}
