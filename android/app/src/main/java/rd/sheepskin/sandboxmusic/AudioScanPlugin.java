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
     * Measure one audio frame in four.
     *
     * Chosen to make a thirty hour book scannable rather than for any acoustic reason: the first
     * version measured every sample and ran at 8x realtime, which is nearly four hours for that
     * book. A tenth-of-a-second RMS is the same number to well under a decibel whether it averages
     * every sample or a quarter of them, and the decision it feeds sits at -45 dB with twenty
     * decibels of headroom either side.
     */
    private static final int SAMPLE_STRIDE = 4;

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
                    /** Samples actually included in the current frame's RMS. */
                    int measured = 0;
                    /** Position in the decimation cycle, carried across decoder buffers. */
                    int measurePhase = 0;
                    /** Reused so a scan does not allocate a buffer per decoded chunk. */
                    short[] scratch = null;
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

                            /*
                             * Bulk read rather than a call per sample. The first version pulled
                             * every sample through ShortBuffer.get() with a float divide each
                             * time, and on the device that measured 8x realtime — which is three
                             * hours and forty minutes for a thirty hour book, on battery, to find
                             * chapter marks. Correct and useless.
                             */
                            int remaining = pcm.remaining();
                            if (scratch == null || scratch.length < remaining) {
                                scratch = new short[Math.max(remaining, 8192)];
                            }
                            pcm.get(scratch, 0, remaining);

                            for (int i = 0; i + channels <= remaining; i += channels) {
                                /*
                                 * Only every SAMPLE_STRIDE-th audio frame is measured.
                                 *
                                 * This is an energy measurement feeding a decision taken at -45 dB.
                                 * Root mean square over a tenth of a second is the same number
                                 * whether it averages four thousand eight hundred samples or twelve
                                 * hundred of them — the difference is far below a decibel, and the
                                 * decision has twenty decibels of headroom either side. What would
                                 * genuinely need every sample is the keyword spotter, and that
                                 * reads its audio through decodeRange, which does not decimate.
                                 *
                                 * Timing is unaffected: filled counts every frame that went past,
                                 * not every frame that was measured, so a frame boundary still
                                 * lands where it always did.
                                 */
                                if (measurePhase == 0) {
                                    /*
                                     * Channels summed to mono, as integers. A pause is silent on
                                     * every channel, and measuring them apart would need a rule for
                                     * what to do when they disagree — which only happens for
                                     * material that is not a pause.
                                     */
                                    int sum = 0;
                                    for (int c = 0; c < channels; c++) sum += scratch[i + c];
                                    double mixed = sum / (channels * 32768.0);
                                    sumOfSquares += mixed * mixed;
                                    measured++;
                                }
                                if (++measurePhase >= SAMPLE_STRIDE) measurePhase = 0;

                                filled++;
                                samplesDone++;

                                if (filled >= frameSamples) {
                                    frames.write(frameDb(sumOfSquares, measured));
                                    sumOfSquares = 0;
                                    filled = 0;
                                    measured = 0;
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
                    if (filled > 0) frames.write(frameDb(sumOfSquares, measured));

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

    /**
     * Where a keyword-spotting model would live if one were installed.
     *
     * Not bundled. The English zipformer spotter is about fourteen megabytes, against an APK that
     * already carries twenty for the Piper voice, so it is a download rather than ballast in every
     * install — including for the many people whose books already carry a chapter table and who
     * would never need it.
     */
    private java.io.File keywordModelDir() {
        return new java.io.File(getContext().getFilesDir(), "kws");
    }

    /** A model is present only if every file the spotter needs is there. */
    private boolean hasKeywordModel() {
        java.io.File dir = keywordModelDir();
        return new java.io.File(dir, "encoder.onnx").exists()
            && new java.io.File(dir, "decoder.onnx").exists()
            && new java.io.File(dir, "joiner.onnx").exists()
            && new java.io.File(dir, "tokens.txt").exists();
    }

    /** Whether chapter detection can run at all on this device today. */
    @PluginMethod
    public void keywordModelStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("installed", hasKeywordModel());
        ret.put("path", keywordModelDir().getAbsolutePath());
        call.resolve(ret);
    }

    /**
     * Listen for the announcing words, only where the pauses said to look.
     *
     * The saving that makes this affordable happens before we get here: silenceScan proposes a few
     * hundred short windows, so the spotter hears perhaps twenty minutes of a thirty hour book.
     *
     * No resampler. sherpa's acceptWaveform takes the source rate and converts internally, which
     * is the second time this feature has avoided writing the component most likely to be subtly
     * wrong — the loudness scan did not need one either, because RMS is rate-independent.
     *
     * Rejects with "no-model" rather than returning an empty list when nothing is installed. Those
     * mean opposite things to the caller: one is "this book announces no chapters", the other is
     * "nothing was listened to". Collapsing them is the mistake that let a read-byte-zero bug
     * masquerade as a book without chapters for months. See bookChapterScan.ts.
     */
    @PluginMethod
    public void spotKeywords(PluginCall call) {
        final String rawUri = call.getString("uri");
        final com.getcapacitor.JSArray windows = call.getArray("windows");
        final String keywords = call.getString("keywords", "");
        if (rawUri == null || rawUri.trim().isEmpty()) {
            call.reject("uri required");
            return;
        }
        if (windows == null || windows.length() == 0) {
            call.reject("windows required");
            return;
        }
        if (!hasKeywordModel()) {
            call.reject("no-model");
            return;
        }
        final String uriText = rawUri.trim();
        final String keywordList = keywords == null ? "" : keywords;

        scanExecutor.execute(
            () -> {
                com.k2fsa.sherpa.onnx.KeywordSpotter spotter = null;
                try {
                    java.io.File dir = keywordModelDir();
                    com.k2fsa.sherpa.onnx.OnlineModelConfig model =
                        new com.k2fsa.sherpa.onnx.OnlineModelConfig();
                    com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig transducer =
                        new com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig();
                    transducer.setEncoder(new java.io.File(dir, "encoder.onnx").getAbsolutePath());
                    transducer.setDecoder(new java.io.File(dir, "decoder.onnx").getAbsolutePath());
                    transducer.setJoiner(new java.io.File(dir, "joiner.onnx").getAbsolutePath());
                    model.setTransducer(transducer);
                    model.setTokens(new java.io.File(dir, "tokens.txt").getAbsolutePath());

                    com.k2fsa.sherpa.onnx.KeywordSpotterConfig config =
                        new com.k2fsa.sherpa.onnx.KeywordSpotterConfig();
                    config.setModelConfig(model);
                    spotter = new com.k2fsa.sherpa.onnx.KeywordSpotter(null, config);

                    com.getcapacitor.JSArray hits = new com.getcapacitor.JSArray();
                    for (int w = 0; w < windows.length(); w++) {
                        org.json.JSONObject window = windows.getJSONObject(w);
                        double from = window.optDouble("startSeconds", 0);
                        double to = window.optDouble("endSeconds", 0);
                        if (!(to > from)) continue;

                        DecodedRange range = decodeRange(uriText, from, to);
                        if (range == null || range.samples.length == 0) continue;

                        com.k2fsa.sherpa.onnx.OnlineStream stream = spotter.createStream(keywordList);
                        stream.acceptWaveform(range.samples, range.sampleRate);
                        stream.inputFinished();
                        while (spotter.isReady(stream)) {
                            spotter.decode(stream);
                            com.k2fsa.sherpa.onnx.KeywordSpotterResult result =
                                spotter.getResult(stream);
                            String word = result.getKeyword();
                            if (word == null || word.trim().isEmpty()) continue;
                            float[] stamps = result.getTimestamps();
                            /*
                             * Timestamps are relative to the window the spotter was given, so the
                             * window's own offset is added back. Without that every chapter in the
                             * book would be reported in the first few seconds.
                             */
                            double at = from + (stamps != null && stamps.length > 0 ? stamps[0] : 0);
                            JSObject hit = new JSObject();
                            hit.put("atSeconds", at);
                            hit.put("keyword", word.trim().toLowerCase(java.util.Locale.ROOT));
                            // The binding exposes no per-hit confidence, so a spotted word is
                            // reported at full score; the threshold that matters is the spotter's
                            // own keywordsThreshold, applied before it ever says anything.
                            hit.put("score", 1.0);
                            hits.put(hit);
                        }
                        stream.release();
                    }

                    JSObject ret = new JSObject();
                    ret.put("hits", hits);
                    mainHandler.post(() -> call.resolve(ret));
                } catch (Throwable t) {
                    rejectOnMain(call, t.getMessage() != null ? t.getMessage() : "spot failed");
                } finally {
                    if (spotter != null) {
                        try {
                            spotter.release();
                        } catch (Throwable ignored) {
                            /* already gone */
                        }
                    }
                }
            });
    }

    /** Mono float samples for one time range, at the file's own rate. */
    private static final class DecodedRange {
        final float[] samples;
        final int sampleRate;

        DecodedRange(float[] samples, int sampleRate) {
            this.samples = samples;
            this.sampleRate = sampleRate;
        }
    }

    /**
     * Decode just the seconds asked for.
     *
     * seekTo with SEEK_TO_PREVIOUS_SYNC, because a decoder started at an arbitrary offset produces
     * noise until the next sync point. Landing early and discarding the run-up costs a fraction of
     * a second and gives the spotter clean audio.
     */
    private DecodedRange decodeRange(String uriText, double fromSeconds, double toSeconds) {
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
            if (track < 0 || format == null) return null;
            extractor.selectTrack(track);
            extractor.seekTo((long) (fromSeconds * 1_000_000L), MediaExtractor.SEEK_TO_PREVIOUS_SYNC);

            int sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
            int channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
            if (sampleRate <= 0 || channels <= 0) return null;

            codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
            codec.configure(format, null, null, 0);
            codec.start();

            int wanted = (int) Math.ceil((toSeconds - fromSeconds) * sampleRate);
            if (wanted <= 0) return null;
            float[] out = new float[wanted];
            int written = 0;
            boolean sawInputEnd = false;
            int stalls = 0;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

            while (written < wanted) {
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
                            codec.queueInputBuffer(inIndex, 0, size, extractor.getSampleTime(), 0);
                            extractor.advance();
                        }
                    }
                }
                int outIndex = codec.dequeueOutputBuffer(info, DEQUEUE_TIMEOUT_US);
                if (outIndex < 0) {
                    if (++stalls > MAX_CONSECUTIVE_STALLS) break;
                    if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
                    continue;
                }
                stalls = 0;
                ByteBuffer buf = codec.getOutputBuffer(outIndex);
                if (buf != null && info.size > 0) {
                    // Discard anything before the window: the sync point lands early by design.
                    double bufferStart = info.presentationTimeUs / 1_000_000.0;
                    buf.order(ByteOrder.nativeOrder());
                    buf.position(info.offset);
                    buf.limit(info.offset + info.size);
                    ShortBuffer pcm = buf.asShortBuffer();
                    int frameIndex = 0;
                    while (pcm.hasRemaining() && written < wanted) {
                        double mixed = 0;
                        int taken = 0;
                        for (int c = 0; c < channels && pcm.hasRemaining(); c++) {
                            mixed += pcm.get() / 32768.0;
                            taken++;
                        }
                        if (taken == 0) break;
                        double at = bufferStart + (double) frameIndex / sampleRate;
                        frameIndex++;
                        if (at < fromSeconds) continue;
                        out[written++] = (float) (mixed / taken);
                    }
                }
                codec.releaseOutputBuffer(outIndex, false);
                if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
            }
            if (written == 0) return null;
            return new DecodedRange(written == wanted ? out : java.util.Arrays.copyOf(out, written), sampleRate);
        } catch (Exception e) {
            return null;
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
