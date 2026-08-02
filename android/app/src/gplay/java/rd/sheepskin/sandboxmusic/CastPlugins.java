package rd.sheepskin.sandboxmusic;

import com.getcapacitor.BridgeActivity;

/**
 * Registers Google Cast for the gplay flavour.
 *
 * <p>Cast lives behind this seam because play-services-cast-framework is proprietary, and F-Droid
 * builds only from free software. The foss flavour has a version of this class that registers
 * nothing, so MainActivity can call it unconditionally and neither flavour needs a build flag.
 *
 * <p>The web app notices the difference on its own: with no NativeCast plugin registered,
 * Capacitor.isPluginAvailable('NativeCast') is false and the UI hides casting. That is a plain
 * synchronous answer rather than a probe that has to resolve before the first paint.
 */
final class CastPlugins {

    private CastPlugins() {}

    static void register(BridgeActivity activity) {
        activity.registerPlugin(NativeCastPlugin.class);
    }
}
