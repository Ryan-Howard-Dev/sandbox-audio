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
import java.lang.reflect.Method;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * A neural voice, on the device.
 *
 * The platform engine works and sounds like a machine reading a phone number, which is the
 * complaint this project began with. Piper is a small VITS model that sounds like a person,
 * generates about ten times faster than it speaks on an ARM CPU, and never touches the network.
 *
 * Three decisions here are the difference between working and not.
 *
 * Streaming, not static. AudioTrack in MODE_STREAM takes audio as it is generated. MODE_STATIC
 * would need a whole chapter synthesised into one buffer before a word could be heard: a long
 * silence, and an out-of-memory crash on anything book-length.
 *
 * Sentence at a time. Feeding a whole chapter to the model at once scales memory with the square
 * of the token count and produces the drifting, whispering output that long-form VITS is known
 * for. A full stop resets the duration predictor and keeps the peak footprint to one sentence,
 * whatever the length of the book.
 *
 * Reflection over a hard dependency. The engine is compiled by scripts/build-sherpa-onnx.mjs and
 * is absent from a checkout that has not run it. Referencing OfflineTts directly would mean the
 * app failing to compile without a 60 MB build step, so it is bound by name at runtime and simply
 * reports itself unavailable when missing. The port already falls back to the platform engine.
 */
@CapacitorPlugin(name = "PiperTts")
public class PiperTtsPlugin extends Plugin {

    private static final String TAG = "PiperTts";
    /** Matches VOICE_ID in scripts/build-sherpa-onnx.mjs. */
    private static final String VOICE_DIR = "vits-piper-en_GB-alan-medium";
    private static final String MODEL_FILE = "en_GB-alan-medium.onnx";
    /** Piper medium voices are 22.05 kHz mono. Confirmed from the generated audio at runtime. */
    private static final int DEFAULT_SAMPLE_RATE = 22050;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicReference<String> speakingId = new AtomicReference<>(null);
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private AudioTrack track;
    private int trackSampleRate = 0;
    /** com.k2fsa.sherpa.onnx.OfflineTts, held as Object so this compiles without it. */
    private Object tts;

    private boolean voiceInstalled() {
        try {
            AssetManager assets = getContext().getAssets();
            String[] files = assets.list(VOICE_DIR);
            if (files == null) return false;
            boolean model = false;
            boolean tokens = false;
            for (String file : files) {
                if (file.equals(MODEL_FILE)) model = true;
                if (file.equals("tokens.txt")) tokens = true;
            }
            // Both, not either: a model without its tokens loads and then cannot pronounce anything.
            return model && tokens;
        } catch (Exception e) {
            return false;
        }
    }

    private boolean engineClassPresent() {
        try {
            Class.forName("com.k2fsa.sherpa.onnx.OfflineTts");
            return true;
        } catch (ClassNotFoundException e) {
            // Expected on a checkout that has not built the engine. Not worth surfacing.
            Log.i(TAG, "sherpa-onnx not built into this APK");
            return false;
        }
    }

    /**
     * Available means the engine is compiled in and a voice is installed.
     *
     * Two separate failures with one symptom. Reporting either as available means the app tries to
     * speak and produces silence, which a listener cannot tell from broken.
     */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject out = new JSObject();
        out.put("available", engineClassPresent() && voiceInstalled());
        call.resolve(out);
    }

    @PluginMethod
    public void listVoices(PluginCall call) {
        JSArray voices = new JSArray();
        if (engineClassPresent() && voiceInstalled()) {
            JSObject voice = new JSObject();
            voice.put("id", VOICE_DIR);
            voice.put("displayName", "Alan — British English");
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
     * Matrix multiplication on the UI thread would freeze the WebView for as long as a sentence
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
                for (String sentence : splitSentences(text)) {
                    if (cancelled.get() || !utteranceId.equals(speakingId.get())) return;
                    if (sentence.trim().isEmpty()) continue;
                    Object audio = generate(sentence, rate);
                    if (audio == null) continue;
                    float[] samples = samplesOf(audio);
                    int sampleRate = sampleRateOf(audio);
                    if (samples == null || samples.length == 0) continue;
                    ensureTrack(sampleRate);
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
     * The punctuation is what produces the falling intonation and the pause at a full stop.
     * Stripping it makes every sentence run into the next.
     */
    private static String[] splitSentences(String text) {
        String[] parts = text.split("(?<=[.!?])\\s+");
        return parts.length == 0 ? new String[] { text } : parts;
    }

    /*
     * Bound by name rather than by import, so this file compiles in a checkout that has not built
     * the engine. Everything below is the seam onto sherpa-onnx, and deliberately the only place
     * this class knows anything about it.
     */
    private void ensureEngine() throws Exception {
        if (tts != null) return;
        Class<?> ttsClass = Class.forName("com.k2fsa.sherpa.onnx.OfflineTts");
        Class<?> configClass = Class.forName("com.k2fsa.sherpa.onnx.OfflineTtsConfig");
        Class<?> modelConfigClass = Class.forName("com.k2fsa.sherpa.onnx.OfflineTtsModelConfig");
        Class<?> vitsClass = Class.forName("com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig");

        Object vits = vitsClass.getDeclaredConstructor().newInstance();
        set(vits, "setModel", String.class, VOICE_DIR + "/" + MODEL_FILE);
        set(vits, "setTokens", String.class, VOICE_DIR + "/tokens.txt");
        // espeak-ng's phoneme data. Without it the model loads and pronounces nothing.
        set(vits, "setDataDir", String.class, VOICE_DIR + "/espeak-ng-data");

        Object model = modelConfigClass.getDeclaredConstructor().newInstance();
        set(model, "setVits", vitsClass, vits);
        // Two threads: enough to keep ahead of playback, few enough to leave the phone cool.
        set(model, "setNumThreads", int.class, 2);
        set(model, "setDebug", boolean.class, false);
        set(model, "setProvider", String.class, "cpu");

        Object config = configClass.getDeclaredConstructor().newInstance();
        set(config, "setModel", modelConfigClass, model);

        // Reading from assets rather than unpacking to disk keeps a second copy off the device.
        tts = ttsClass
            .getDeclaredConstructor(AssetManager.class, configClass)
            .newInstance(getContext().getAssets(), config);
    }

    private static void set(Object target, String setter, Class<?> type, Object value)
        throws Exception {
        Method method = target.getClass().getMethod(setter, type);
        method.invoke(target, value);
    }

    private Object generate(String sentence, float rate) throws Exception {
        if (tts == null) return null;
        Method generate = tts.getClass().getMethod("generate", String.class, int.class, float.class);
        return generate.invoke(tts, sentence, 0, rate);
    }

    private static float[] samplesOf(Object audio) throws Exception {
        return (float[]) audio.getClass().getMethod("getSamples").invoke(audio);
    }

    private static int sampleRateOf(Object audio) {
        try {
            Object rate = audio.getClass().getMethod("getSampleRate").invoke(audio);
            return rate instanceof Integer ? (Integer) rate : DEFAULT_SAMPLE_RATE;
        } catch (Exception e) {
            return DEFAULT_SAMPLE_RATE;
        }
    }

    /**
     * Buffer sized for roughly a third of a second.
     *
     * Small enough that the first word arrives promptly, large enough to survive the operating
     * system pausing this thread mid-sentence. Too small and the buffer empties faster than the
     * model fills it, which a listener hears as stuttering.
     *
     * Built from the rate the engine actually returned rather than an assumed one: a voice at a
     * different rate would otherwise play at the wrong pitch.
     */
    private void ensureTrack(int sampleRate) {
        if (track != null && trackSampleRate == sampleRate) return;
        releaseTrack();
        int minBytes = AudioTrack.getMinBufferSize(
            sampleRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_FLOAT
        );
        int target = Math.max(minBytes, sampleRate / 3 * 4);
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
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(target)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build();
        trackSampleRate = sampleRate;
        track.play();
    }

    private void writeSamples(float[] samples) {
        int offset = 0;
        while (offset < samples.length && !cancelled.get()) {
            int written = track.write(
                samples, offset, samples.length - offset, AudioTrack.WRITE_BLOCKING
            );
            if (written <= 0) break;
            offset += written;
        }
    }

    private void releaseTrack() {
        if (track == null) return;
        try {
            track.stop();
        } catch (IllegalStateException ignored) {
            // Never started; nothing to stop.
        }
        track.release();
        track = null;
        trackSampleRate = 0;
    }

    /**
     * Release the engine explicitly.
     *
     * Its allocations live in native memory, which the garbage collector cannot see. Hours of
     * narration would otherwise accumulate orphaned memory until the process died somewhere
     * unrelated to the cause.
     */
    private void releaseEngine() {
        if (tts != null) {
            try {
                tts.getClass().getMethod("release").invoke(tts);
            } catch (Exception e) {
                Log.w(TAG, "engine release failed", e);
            }
            tts = null;
        }
        releaseTrack();
    }

    @Override
    protected void handleOnDestroy() {
        cancelled.set(true);
        worker.shutdownNow();
        releaseEngine();
        super.handleOnDestroy();
    }
}
