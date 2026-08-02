package rd.sheepskin.sandboxmusic;

import android.content.ComponentName;
import android.content.pm.PackageManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Changing which launcher icon the app wears.
 *
 * <p>Android has no API for setting an app icon. The only mechanism is to declare one
 * activity-alias per icon in the manifest and enable exactly one of them, which is what this does.
 * The aliases all point at MainActivity, so whichever is enabled launches the same app.
 *
 * <p>Two things follow from that and neither is avoidable. Switching force-stops the app, because
 * changing component enablement is what Android does to a package it is reconfiguring. And for a
 * moment during the switch there can be no enabled launcher component at all, which on some
 * launchers makes the icon vanish until the home screen redraws. Enabling the new alias before
 * disabling the old one keeps that window as short as possible.
 */
@CapacitorPlugin(name = "AppIcon")
public class AppIconPlugin extends Plugin {

    /** The default icon is MainActivity itself rather than an alias, so it is named separately. */
    private static final String DEFAULT_KEY = "default";

    /**
     * Icon key to the component that carries it.
     *
     * <p>Must match the aliases in AndroidManifest.xml and the keys in src/appIcon.ts. Three copies
     * of one list is two too many, but the manifest cannot read TypeScript and Android will not
     * accept a component name it was not told about at install time.
     */
    private static String componentFor(String key) {
        switch (key) {
            case "bloodorange":
                return ".IconAliasBloodorange";
            case "graphite":
                return ".IconAliasGraphite";
            case "terminal":
                return ".IconAliasTerminal";
            case DEFAULT_KEY:
                return ".MainActivity";
            default:
                return null;
        }
    }

    private static final String[] ALL_KEYS = { DEFAULT_KEY, "bloodorange", "graphite", "terminal" };

    private ComponentName component(String key) {
        String suffix = componentFor(key);
        if (suffix == null) return null;
        return new ComponentName(getContext().getPackageName(), getContext().getPackageName() + suffix);
    }

    private boolean isEnabled(String key) {
        ComponentName name = component(key);
        if (name == null) return false;
        int state = getContext().getPackageManager().getComponentEnabledSetting(name);
        if (state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED) return true;
        // The default alias is MainActivity, which ships enabled and therefore reports DEFAULT.
        return state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && DEFAULT_KEY.equals(key);
    }

    @PluginMethod
    public void getIcons(PluginCall call) {
        JSArray icons = new JSArray();
        String active = DEFAULT_KEY;
        for (String key : ALL_KEYS) {
            icons.put(key);
            if (isEnabled(key)) active = key;
        }
        JSObject result = new JSObject();
        result.put("icons", icons);
        result.put("active", active);
        call.resolve(result);
    }

    @PluginMethod
    public void setIcon(PluginCall call) {
        String key = call.getString("key", DEFAULT_KEY);
        ComponentName target = component(key);
        if (target == null) {
            call.reject("unknown icon: " + key);
            return;
        }

        PackageManager pm = getContext().getPackageManager();
        try {
            /*
             * On before off. There is a moment mid-switch where the launcher re-reads this package,
             * and if nothing is enabled then it has no icon to draw. Turning the new one on first
             * means that window never contains zero enabled components.
             *
             * DONT_KILL_APP is passed and is a request, not a guarantee: Android usually restarts
             * the process anyway. The UI warns about that rather than pretending otherwise.
             */
            pm.setComponentEnabledSetting(
                target,
                PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                PackageManager.DONT_KILL_APP
            );

            for (String other : ALL_KEYS) {
                if (other.equals(key)) continue;
                ComponentName name = component(other);
                if (name == null) continue;
                pm.setComponentEnabledSetting(
                    name,
                    PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                    PackageManager.DONT_KILL_APP
                );
            }

            JSObject result = new JSObject();
            result.put("active", key);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("could not change the icon: " + e.getMessage());
        }
    }
}
