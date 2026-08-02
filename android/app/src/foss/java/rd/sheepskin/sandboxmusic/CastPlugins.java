package rd.sheepskin.sandboxmusic;

import com.getcapacitor.BridgeActivity;

/**
 * The foss flavour's Cast registration, which registers nothing.
 *
 * <p>Google Cast needs play-services-cast-framework, which is proprietary and cannot be part of a
 * build F-Droid will accept. Rather than shipping a stub plugin that answers every call with an
 * error, this flavour leaves the plugin out entirely: the web app checks
 * Capacitor.isPluginAvailable('NativeCast'), gets false, and never offers casting in the first
 * place.
 *
 * <p>UPnP and Sonos casting are unaffected. Those go through Sandbox Server over the local network
 * and involve no Google code.
 */
final class CastPlugins {

    private CastPlugins() {}

    static void register(BridgeActivity activity) {
        // Deliberately empty. See the class comment.
    }
}
