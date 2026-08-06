package rd.sheepskin.sandboxmusic;

import androidx.media3.common.C;
import androidx.media3.exoplayer.audio.TeeAudioProcessor;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * The loudness of what is playing, right now, for the visualiser to draw.
 *
 * Taps PCM out of our own ExoPlayer audio chain rather than through android.media.audiofx.Visualizer.
 * That API is the usual way to do this and it requires RECORD_AUDIO — a microphone permission prompt,
 * in an app whose whole premise is that it does not listen to you. This sees only audio the app is
 * already decoding for playback, needs no permission, and nothing it produces leaves the device.
 *
 * TeeAudioProcessor forwards each buffer here and passes the audio through untouched, so nothing in
 * this file can change what you hear. It runs on the audio thread: a slow frame here is a dropout,
 * which is why the work per buffer is one pass of arithmetic over decimated samples and a single
 * array write, with no allocation.
 *
 * The shape it keeps is a ring of recent levels, not a snapshot of one buffer. A buffer is a few
 * milliseconds and drawing it directly gives noise; a second of history scrolling past is what reads
 * as music moving across a screen.
 */
public final class WaveformTap implements TeeAudioProcessor.AudioBufferSink {

    /** One second or so of history at typical buffer sizes, and a convenient width to draw. */
    public static final int SLOTS = 64;

    /**
     * Every fourth sample.
     *
     * Amplitude envelope is what is being measured, not waveform detail, and it survives decimation
     * intact. Reading every sample of stereo 48k on the audio thread is work that buys nothing.
     */
    private static final int SAMPLE_STRIDE = 4;

    /*
     * Written on the audio thread, read on the main thread. A byte array of levels is naturally
     * atomic enough for this: a reader can catch a half-updated ring and the worst case is one
     * frame of the animation blending two moments, which is invisible at 30fps and cheaper than
     * locking the audio thread.
     */
    private static final byte[] levels = new byte[SLOTS];
    private static volatile int writeIndex = 0;
    private static volatile boolean active = false;

    private int channelCount = 2;
    private int encoding = C.ENCODING_PCM_16BIT;

    @Override
    public void flush(int sampleRateHz, int channelCount, int encoding) {
        this.channelCount = Math.max(1, channelCount);
        this.encoding = encoding;
        // A flush is a seek, a format change or a stop. Whatever was on screen describes audio that
        // is no longer playing, so let it fall to silence rather than freeze mid-gesture.
        java.util.Arrays.fill(levels, (byte) 0);
        writeIndex = 0;
    }

    @Override
    public void handleBuffer(ByteBuffer buffer) {
        if (buffer == null || !buffer.hasRemaining()) return;
        double sumSquares = 0.0;
        int counted = 0;

        // Duplicate rather than consume: the same buffer continues down the chain to the speakers.
        ByteBuffer view = buffer.duplicate();
        view.order(ByteOrder.nativeOrder());

        if (encoding == C.ENCODING_PCM_FLOAT) {
            int floats = view.remaining() / 4;
            for (int i = 0; i < floats; i += SAMPLE_STRIDE) {
                float v = view.getFloat(view.position() + i * 4);
                if (Float.isNaN(v) || Float.isInfinite(v)) continue;
                sumSquares += (double) v * v;
                counted++;
            }
        } else {
            int shorts = view.remaining() / 2;
            for (int i = 0; i < shorts; i += SAMPLE_STRIDE) {
                double v = view.getShort(view.position() + i * 2) / 32768.0;
                sumSquares += v * v;
                counted++;
            }
        }

        if (counted == 0) return;
        double rms = Math.sqrt(sumSquares / counted);

        /*
         * Square root of the linear level before drawing.
         *
         * Loudness is perceptual and a linear RMS trace of real music sits squashed against the
         * floor with occasional spikes — technically correct and visually dead. This is a cheap
         * stand-in for a decibel curve that keeps quiet passages visible without a log per buffer
         * on the audio thread.
         */
        int level = (int) Math.round(Math.sqrt(Math.min(1.0, rms)) * 255.0);
        levels[writeIndex % SLOTS] = (byte) Math.max(0, Math.min(255, level));
        writeIndex = (writeIndex + 1) % SLOTS;
        active = true;
    }

    /**
     * The recent levels, oldest first, as values from 0 to 255.
     *
     * Unrolled from the ring so the caller draws left to right without knowing where the write head
     * is. Returns null when nothing has ever been tapped, which the caller shows as a flat line
     * rather than as an error — no audio playing is not a failure.
     */
    public static int[] snapshot() {
        if (!active) return null;
        int start = writeIndex;
        int[] out = new int[SLOTS];
        for (int i = 0; i < SLOTS; i++) {
            out[i] = levels[(start + i) % SLOTS] & 0xFF;
        }
        return out;
    }

    /** Playback stopped: let the drawing settle to a flat line instead of holding the last shape. */
    public static void quiet() {
        java.util.Arrays.fill(levels, (byte) 0);
    }
}
