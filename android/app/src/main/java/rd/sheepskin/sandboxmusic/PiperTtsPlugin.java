package rd.sheepskin.sandboxmusic;

import android.content.res.AssetManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * A neural voice, on the device.
 *
 * The platform engine sounds like a machine reading a phone number, which is the complaint this
 * project began with. Piper is a small VITS model that sounds like a person, generates about ten
 * times faster than it speaks on an ARM CPU, and never touches the network.
 *
 * Two decisions here are worth stating, because both were the difference between working and not.
 *
 * Streaming, not static. AudioTrack in MODE_STREAM takes audio as it is generated. MODE_STATIC
 * would need a whole chapter synthesised into one buffer before a word could be heard, which is
 * both a long silence and an out-of-memory crash on anything book-length.
 *
 * Sentence at a time. Feeding a whole chapter to the model at once scales memory with the square
 * of the token count and produces the drifting, whispering output that long-form VITS is known
 * for. Splitting on sentences resets the duration predictor and keeps the peak footprint to one
 * sentence, whatever the length of the book.
 *
 * Native memory is not the garbage collector's to reclaim. Everything allocated across the JNI
 * boundary is released explicitly in {@link #releaseEngine()}, or hours of narration accumulate
 * orphaned allocations until the process dies somewhere unrelated.
 */
@CapacitorPlugin(name = "PiperTts")
public class PiperTtsPlugin extends Plugin {

    private static final String TAG = "PiperTts";
    /** Where build-sherpa-onnx.mjs puts the voice. */
    private static final String ASSET_DIR = "piper";
    private static final String VOICE_ID = "en_GB-alan-medium";
    /** Piper medium voices are 22.05 kHz mono. */
    private static final int SAMPLE_RATE = 22050;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicReference<String> speakingId = new AtomicReference<>(null);
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private AudioTrack track;
    /** Native handle, owned here and released explicitly. 0 when nothing is loaded. */
    private long engine = 0;

    private boolean assetsPresent() {
        try {
            AssetManager assets = getContext().getAssets();
            String[] files = assets.list(ASSET_DIR);
            if (files == null) return false;
            boolean model = false;
            for (String file : files) {
                if (file.equals(VOICE_ID + ".onnx")) model = true;
            }
            return model;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Available means the library loaded and a voice is installed.
     *
     * Two separate failures with one symptom: a build without the native library, and a build with
     * it but no voice. Reporting either as available means the app tries to speak and produces
     * silence, which is indistinguishable from broken.
     */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject out = new JSObject();
        out.put("available", nativeLibraryLoaded() && assetsPresent());
        call.resolve(out);
    }

    private boolean nativeLibraryLoaded() {
        try {
            System.loadLibrary("sherpa-onnx-jni");
            return true;
        } catch (UnsatisfiedLinkError e) {
            // Expected on a build without the engine. Not an error worth surfacing.
            Log.i(TAG, "sherpa-onnx not present in this build");
            return false;
        }
    }

    @PluginMethod
    public void listVoices(PluginCall call) {
        JSArray voices = new JSArray();
        if (assetsPresent()) {
            JSObject voice = new JSObject();
            voice.put("id", VOICE_ID);
            voice.put("displayName", "Alan (British English)");
            voice.put("installed", true);
            voices.put(voice);
        }
        JSObject out = new JSObject();
        out.put("voices", voices);
        call.resolve(out);
    }

    /**
     * Speak, off the main thread.
     *
     * Matrix multiplication on the UI thread would freeze the WebView for as long as the sentence
     * takes to generate, which Android reports to the user as the app having stopped responding.
     */
    @PluginMethod
    public void speak(PluginCall call) {
        final String text = call.getString("text", "");
        final String utteranceId = call.getString("utteranceId", "");
        final float rate = call.getFloat("rate", 1f);
        if (text == null || text.isEmpty() || utteranceId == null || utteranceId.isEmpty()) {
            call.reject("text and utteranceId are required");
            return;
        }
        cancelled.set(false);
        speakingId.set(utteranceId);
        call.resolve();

        worker.execute(() -> {
            try {
                ensureEngine();
                ensureTrack();
                /*
                 * Sentence at a time. See the class comment: this is what keeps peak memory flat
                 * and stops the model drifting over a long chapter.
                 */
                for (String sentence : splitSentences(text)) {
                    if (cancelled.get() || !utteranceId.equals(speakingId.get())) return;
                    float[] samples = synthesize(sentence, rate);
                    if (samples == null || samples.length == 0) continue;
                    writeSamples(samples);
                }
                if (!cancelled.get() && utteranceId.equals(speakingId.get())) {
                    emit("piperDone", utteranceId);
                }
            } catch (Throwable t) {
                Log.w(TAG, "synthesis failed", t);
                emit("piperError", utteranceId);
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        cancelled.set(true);
        speakingId.set(null);
        if (track != null) {
            try {
                track.pause();
                track.flush();
            } catch (IllegalStateException ignored) {
                // Already stopped; nothing to undo.
            }
        }
        call.resolve();
    }

    private void emit(String event, String utteranceId) {
        JSObject data = new JSObject();
        data.put("utteranceId", utteranceId);
        notifyListeners(event, data);
    }

    /**
     * Split on sentence ends, keeping the punctuation.
     *
     * The punctuation matters to the model: it is what produces the falling intonation and the
     * pause at a full stop. Stripping it makes every sentence run into the next.
     */
    private static String[] splitSentences(String text) {
        String[] parts = text.split("(?<=[.!?])\\s+");
        return parts.length == 0 ? new String[] { text } : parts;
    }

    /**
     * Buffer sized for roughly a third of a second.
     *
     * Small enough that the first word arrives promptly, large enough to survive the operating
     * system pausing this thread mid-sentence. Too small and the buffer empties faster than the
     * model fills it, which the listener hears as stuttering.
     */
    private void ensureTrack() {
        if (track != null) return;
        int minBytes = AudioTrack.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_FLOAT
        );
        int target = Math.max(minBytes, SAMPLE_RATE / 3 * 4);
        track = new AudioTrack.Builder()
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(target)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build();
        track.play();
    }

    private void writeSamples(float[] samples) {
        int offset = 0;
        while (offset < samples.length && !cancelled.get()) {
            int written = track.write(samples, offset, samples.length - offset, AudioTrack.WRITE_BLOCKING);
            if (written <= 0) break;
            offset += written;
        }
    }

    /*
     * The engine itself is loaded once and kept. Initialisation reads a 63 MB graph off disk and
     * takes a second or two; doing that per sentence would make the pauses between sentences
     * longer than the sentences.
     *
     * These two are the seam onto sherpa-onnx's JNI wrapper, which build-sherpa-onnx.mjs compiles
     * and installs. They are deliberately the only place this class knows anything about it.
     */
    private void ensureEngine() {
        if (engine != 0) return;
        File model = new File(getContext().getFilesDir(), ASSET_DIR + "/" + VOICE_ID + ".onnx");
        engine = nativeCreate(model.getAbsolutePath(), Runtime.getRuntime().availableProcessors());
    }

    private float[] synthesize(String sentence, float rate) {
        if (engine == 0) return null;
        return nativeSynthesize(engine, sentence, rate);
    }

    /** Explicit, because native allocations are invisible to the garbage collector. */
    private void releaseEngine() {
        if (engine != 0) {
            nativeDestroy(engine);
            engine = 0;
        }
        if (track != null) {
            track.release();
            track = null;
        }
    }

    @Override
    protected void handleOnDestroy() {
        cancelled.set(true);
        worker.shutdownNow();
        releaseEngine();
        super.handleOnDestroy();
    }

    private static native long nativeCreate(String modelPath, int threads);

    private static native float[] nativeSynthesize(long handle, String text, float rate);

    private static native void nativeDestroy(long handle);
}
