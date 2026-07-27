package rd.sheepskin.sandboxmusic;

import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

/**
 * Android's own TextToSpeech engine, exposed for document narration.
 *
 * The Web Speech API is the obvious way to do this and it is not available here: Chrome for
 * Android implements speechSynthesis, the Android System WebView does not, so `'speechSynthesis'
 * in window` is false inside this app. Confirmed on a device — the reader reported no voices
 * available. Desktop and the PWA keep using Web Speech; Android needs the platform engine.
 *
 * Written in-repo rather than pulled from a community package: this project already hand-writes
 * its nine Capacitor plugins, and it ships on F-Droid, where every added dependency is scrutiny
 * someone has to pay for.
 */
@CapacitorPlugin(name = "NativeTextToSpeech")
public class NativeTextToSpeechPlugin extends Plugin {

    private TextToSpeech tts;
    private boolean ready = false;

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), status -> {
            ready = status == TextToSpeech.SUCCESS;
            if (!ready) return;
            try {
                tts.setLanguage(Locale.getDefault());
            } catch (Exception ignored) {
                // A missing locale is not fatal — the engine falls back to its default voice.
            }
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {}

            @Override
            public void onDone(String utteranceId) {
                notifyUtterance("ttsDone", utteranceId);
            }

            @Override
            public void onError(String utteranceId) {
                notifyUtterance("ttsError", utteranceId);
            }

            @Override
            public void onError(String utteranceId, int errorCode) {
                notifyUtterance("ttsError", utteranceId);
            }
        });
    }

    private void notifyUtterance(String event, String utteranceId) {
        JSObject data = new JSObject();
        data.put("utteranceId", utteranceId == null ? "" : utteranceId);
        notifyListeners(event, data);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", ready && tts != null);
        call.resolve(ret);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        String utteranceId = call.getString("utteranceId", "");
        Float rate = call.getFloat("rate", 1f);
        if (tts == null || !ready) {
            call.reject("Text-to-speech engine not ready");
            return;
        }
        if (text == null || text.trim().isEmpty()) {
            // An empty chunk must still report completion, or the reader waits forever on it.
            notifyUtterance("ttsDone", utteranceId);
            call.resolve();
            return;
        }
        try {
            tts.setSpeechRate(rate == null || rate <= 0 ? 1f : rate);
            Bundle params = new Bundle();
            // QUEUE_FLUSH, not QUEUE_ADD: the JS reader owns sequencing and already waits for
            // each chunk. Queueing here as well would let the two run ahead of each other.
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
            call.resolve();
        } catch (Exception e) {
            call.reject("speak failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        ready = false;
        super.handleOnDestroy();
    }
}
