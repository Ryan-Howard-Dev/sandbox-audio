package rd.sheepskin.sandboxmusic;

import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.ShortBuffer;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.os.Handler;
import android.os.Looper;

/**
 * Measure a recording's loudness over time, without sending it anywhere.
 *
 * Chapter detection needs to know where the long pauses are. The obvious shape — decode the file
 * and hand the samples to JavaScript — does not survive contact with the material: a thirty hour
 * audiobook at 16 kHz mono float is about seven gigabytes. It cannot cross the Capacitor bridge
 * and it cannot be resident.
 *
 * So the decoding and the measuring happen here, and only the measurement travels. One byte per
 * frame of dBFS: at a tenth of a second that is roughly a megabyte for a thirty hour book, and a
 * byte covers -128 to 0 dB at one decibel resolution, which is far finer than a decision taken at
 * -45 dB needs.
 *
 * Deliberately no resampling. Loudness is a ratio, so root mean square over a frame means the same
 * thing at 44.1 kHz as at 16 kHz — the frame is simply a different number of samples. A resampler
 * is the component most likely to be subtly wrong, and for this measurement it would earn nothing.
 * The keyword spotter will need real 16 kHz audio later; that is a different method and a
 * different problem.
 *
 * What this deliberately does NOT decide: where the threshold sits, how long a run of quiet frames
 * has to be, or what any of it means. Those are in silenceScan.ts, where they can be tested
 * without a phone.
 */
@CapacitorPlugin(name = "AudioScan")
public class AudioScanPlugin extends Plugin {

    private final ExecutorService scanExecutor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    /** Silence floor of the byte encoding. Nothing quieter is distinguishable, or needs to be. */
    private static final int MIN_DB = -128;
    /** A frame shorter than this measures noise; longer than this and a short pause is missed. */
    private static final double MIN_FRAME_SECONDS = 0.005;
    private static final double MAX_FRAME_SECONDS = 1.0;
    /** Codecs stall occasionally; without a bound a corrupt file scans forever. */
    private static final long DEQUEUE_TIMEOUT_US = 10_000;
    private static final int MAX_CONSECUTIVE_STALLS = 500;

    /**
     * A frame size from JavaScript.
     *
     * getDouble, never getLong or getFloat. JavaScript has one number type and Capacitor
     * deserialises it as a Double; asking for anything else finds nothing where it looks and
     * silently returns the default. That exact mistake made every ranged read in this app return
     * byte zero for months, and it looked like "this book has no chapters" rather than like a bug.
     */
    private static double frameSecondsArg(PluginCall call) {
        Double raw = call.getDouble("frameSeconds");
        if (raw == null || raw.isNaN()) return 0.1;
        return Math.max(MIN_FRAME_SECONDS, Math.min(MAX_FRAME_SECONDS, raw));
    }

    /**
     * Decode a recording and report its loudness frame by frame.
     *
     * Resolves with the frames as base64 signed bytes, plus what is needed to turn a frame index
     * back into a time. Progress is emitted as it goes, because a thirty hour file takes minutes
     * and a silent progress bar is indistinguishable from a hang.
     */
    @PluginMethod
    public void scanAudioFrames(PluginCall call) {
        final String rawUri = call.getString("uri");
        if (rawUri == null || rawUri.trim().isEmpty()) {
            call.reject("uri required");
            return;
        }
        final String uriText = rawUri.trim();
        final double frameSeconds = frameSecondsArg(call);

        scanExecutor.execute(
            () -> {
                MediaExtractor extractor = new MediaExtractor();
                MediaCodec codec = null;
                try {
                    extractor.setDataSource(getContext(), Uri.parse(uriText), null);

                    int track = -1;
                    MediaFormat format = null;
                    for (int i = 0; i < extractor.getTrackCount(); i++) {
                        MediaFormat candidate = extractor.getTrackFormat(i);
                        String mime = candidate.getString(MediaFormat.KEY_MIME);
                        if (mime != null && mime.startsWith("audio/")) {
                            track = i;
                            format = candidate;
                            break;
                        }
                    }
                    if (track < 0 || format == null) {
                        rejectOnMain(call, "no audio track");
                        return;
                    }
                    extractor.selectTrack(track);

                    final int sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    final int channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    final long durationUs =
                        format.containsKey(MediaFormat.KEY_DURATION)
                            ? format.getLong(MediaFormat.KEY_DURATION)
                            : 0L;
                    if (sampleRate <= 0 || channels <= 0) {
                        rejectOnMain(call, "unusable audio format");
                        return;
                    }

                    final int frameSamples = Math.max(1, (int) Math.round(sampleRate * frameSeconds));

                    codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
                    codec.configure(format, null, null, 0);
                    codec.start();

                    /*
                     * Grown rather than pre-sized. A file whose declared duration is wrong — and
                     * plenty are — would otherwise either truncate the scan or reserve hundreds of
                     * megabytes for audio that is not there.
                     */
                    java.io.ByteArrayOutputStream frames = new java.io.ByteArrayOutputStream();

                    double sumOfSquares = 0;
                    int filled = 0;
                    long samplesDone = 0;
                    int lastProgress = -1;
                    int stalls = 0;
                    boolean sawInputEnd = false;

                    MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

                    while (true) {
                        if (!sawInputEnd) {
                            int inIndex = codec.dequeueInputBuffer(DEQUEUE_TIMEOUT_US);
                            if (inIndex >= 0) {
                                ByteBuffer in = codec.getInputBuffer(inIndex);
                                int size = in == null ? -1 : extractor.readSampleData(in, 0);
                                if (size < 0) {
                                    codec.queueInputBuffer(
                                        inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                    sawInputEnd = true;
                                } else {
                                    codec.queueInputBuffer(
                                        inIndex, 0, size, extractor.getSampleTime(), 0);
                                    extractor.advance();
                                }
                            }
                        }

                        int outIndex = codec.dequeueOutputBuffer(info, DEQUEUE_TIMEOUT_US);
                        if (outIndex < 0) {
                            // INFO_TRY_AGAIN_LATER and friends. Bounded so a wedged codec ends.
                            if (++stalls > MAX_CONSECUTIVE_STALLS) {
                                rejectOnMain(call, "decoder stalled");
                                return;
                            }
                            if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
                            continue;
                        }
                        stalls = 0;

                        ByteBuffer out = codec.getOutputBuffer(outIndex);
                        if (out != null && info.size > 0) {
                            out.order(ByteOrder.nativeOrder());
                            out.position(info.offset);
                            out.limit(info.offset + info.size);
                            ShortBuffer pcm = out.asShortBuffer();

                            while (pcm.hasRemaining()) {
                                /*
                                 * Channels summed to mono. A pause is silent on every channel, and
                                 * measuring them apart would need a rule for what to do when they
                                 * disagree — which only happens for material that is not a pause.
                                 */
                                double mixed = 0;
                                int taken = 0;
                                for (int c = 0; c < channels && pcm.hasRemaining(); c++) {
                                    mixed += pcm.get() / 32768.0;
                                    taken++;
                                }
                                if (taken == 0) break;
                                mixed /= taken;

                                sumOfSquares += mixed * mixed;
                                filled++;
                                samplesDone++;

                                if (filled >= frameSamples) {
                                    frames.write(frameDb(sumOfSquares, filled));
                                    sumOfSquares = 0;
                                    filled = 0;
                                }
                            }
                        }
                        codec.releaseOutputBuffer(outIndex, false);

                        if (durationUs > 0) {
                            long doneUs = (samplesDone * 1_000_000L) / sampleRate;
                            int pct = (int) Math.min(100, (doneUs * 100) / durationUs);
                            if (pct != lastProgress) {
                                lastProgress = pct;
                                JSObject ev = new JSObject();
                                ev.put("percent", pct);
                                notifyListeners("audioScanProgress", ev);
                            }
                        }

                        if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
                    }

                    // A part-filled frame at the end still counts: a book ending in silence ends in
                    // a real one, and it is the span most likely to be the final break.
                    if (filled > 0) frames.write(frameDb(sumOfSquares, filled));

                    byte[] bytes = frames.toByteArray();
                    JSObject ret = new JSObject();
                    ret.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                    ret.put("frameCount", bytes.length);
                    ret.put("frameSeconds", frameSeconds);
                    ret.put("sampleRate", sampleRate);
                    ret.put("channels", channels);
                    ret.put("durationSeconds", durationUs > 0 ? durationUs / 1_000_000.0 : 0);
                    mainHandler.post(() -> call.resolve(ret));
                } catch (SecurityException e) {
                    rejectOnMain(call, "uri not permitted");
                } catch (Exception e) {
                    rejectOnMain(call, e.getMessage() != null ? e.getMessage() : "scan failed");
                } finally {
                    if (codec != null) {
                        try {
                            codec.stop();
                        } catch (Exception ignored) {
                            /* already stopped */
                        }
                        codec.release();
                    }
                    extractor.release();
                }
            });
    }

    /** One frame's loudness, clamped into a signed byte. */
    private static byte frameDb(double sumOfSquares, int count) {
        if (count <= 0) return (byte) MIN_DB;
        double rms = Math.sqrt(sumOfSquares / count);
        if (!(rms > 0)) return (byte) MIN_DB;
        double db = 20 * Math.log10(rms);
        if (Double.isNaN(db)) return (byte) MIN_DB;
        return (byte) Math.max(MIN_DB, Math.min(0, Math.round(db)));
    }

    private void rejectOnMain(PluginCall call, String message) {
        mainHandler.post(() -> call.reject(message));
    }
}
