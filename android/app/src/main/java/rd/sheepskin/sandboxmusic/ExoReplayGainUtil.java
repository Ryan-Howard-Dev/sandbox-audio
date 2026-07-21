package rd.sheepskin.sandboxmusic;

import androidx.annotation.Nullable;

/** Mirrors src/replayGainPlayback.ts — EBU R128 proxy at playback time. */
final class ExoReplayGainUtil {

    /** Applied when track metadata has no ReplayGain tag (0 dB placeholder). */
    static final float FALLBACK_LUFS_GAIN_DB = -4f;

    private ExoReplayGainUtil() {}

    static float computePlaybackGainDb(@Nullable Double replayGainDb) {
        if (replayGainDb != null && replayGainDb != 0.0) {
            return replayGainDb.floatValue();
        }
        return FALLBACK_LUFS_GAIN_DB;
    }

    static float linearGainFromDb(float replayGainDb) {
        float linear = (float) Math.pow(10.0, replayGainDb / 20.0);
        return Math.max(0.05f, Math.min(4f, linear));
    }

    static float linearGainFromNullableDb(@Nullable Double replayGainDb) {
        return linearGainFromDb(computePlaybackGainDb(replayGainDb));
    }
}
