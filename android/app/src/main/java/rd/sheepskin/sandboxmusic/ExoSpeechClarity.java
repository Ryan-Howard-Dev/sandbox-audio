package rd.sheepskin.sandboxmusic;

import android.media.audiofx.DynamicsProcessing;
import android.os.Build;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.media3.exoplayer.ExoPlayer;

/**
 * Compression and presence EQ for spoken word, on the ExoPlayer audio session.
 *
 * The WebView speech chain (speechClarity.ts) never runs on Android because playback goes through
 * native Exo, and the only effect attached there is {@link ExoPlaybackLoudness} — flat gain, which
 * raises a whisper and the shout after it by exactly the same amount and so fixes nothing. What a
 * narrator needs is the distance between those two closed, and that takes a compressor.
 *
 * DynamicsProcessing (API 28) gives a real one on the audio session: a multiband EQ ahead of a
 * multiband compressor, with a limiter after. This uses a single compressor band, because speech
 * is one source and splitting it across bands makes a voice sound processed rather than clear.
 *
 * Everything here is best-effort. The effect is optional hardware-backed system audio and vendors
 * do disable it; every failure leaves playback untouched rather than silent.
 */
final class ExoSpeechClarity {

    private static final String TAG = "ExoSpeechClarity";

    /** Bands of the pre-EQ, low to high. Each covers up to its cutoff. */
    private static final int BAND_LOW = 0;
    private static final int BAND_MID = 1;
    private static final int BAND_PRESENCE = 2;
    private static final int BAND_HIGH = 3;
    private static final int PRE_EQ_BANDS = 4;

    /** Presence sits either side of the profile centre — roughly 2–5 kHz, where consonants live. */
    private static final float PRESENCE_LOW_HZ = 2000f;
    private static final float PRESENCE_HIGH_HZ = 5000f;
    private static final float TOP_HZ = 20000f;

    /**
     * Attenuation applied below the high-pass corner.
     *
     * DynamicsProcessing has no high-pass, only a band gain, so this is a deep cut rather than a
     * true filter. -18 dB removes the rumble and the phone-speaker excursion without the abrupt
     * silence a -60 dB band would give, which on room tone is audible as a hole.
     */
    private static final float LOW_CUT_DB = -18f;

    @Nullable private DynamicsProcessing effect;
    private int attachedSessionId = 0;
    @Nullable private Params active;

    /** One profile's worth of tuning, mirroring SpeechClarityProfile on the web side. */
    static final class Params {
        final float highPassHz;
        final float presenceHz;
        final float presenceGainDb;
        final float thresholdDb;
        final float kneeDb;
        final float ratio;
        final float attackMs;
        final float releaseMs;
        final float makeupDb;

        Params(
            float highPassHz,
            float presenceHz,
            float presenceGainDb,
            float thresholdDb,
            float kneeDb,
            float ratio,
            float attackMs,
            float releaseMs,
            float makeupDb
        ) {
            this.highPassHz = highPassHz;
            this.presenceHz = presenceHz;
            this.presenceGainDb = presenceGainDb;
            this.thresholdDb = thresholdDb;
            this.kneeDb = kneeDb;
            this.ratio = ratio;
            this.attackMs = attackMs;
            this.releaseMs = releaseMs;
            this.makeupDb = makeupDb;
        }

        boolean matches(@Nullable Params other) {
            if (other == null) return false;
            return highPassHz == other.highPassHz
                && presenceHz == other.presenceHz
                && presenceGainDb == other.presenceGainDb
                && thresholdDb == other.thresholdDb
                && kneeDb == other.kneeDb
                && ratio == other.ratio
                && attackMs == other.attackMs
                && releaseMs == other.releaseMs
                && makeupDb == other.makeupDb;
        }
    }

    /** True when this device can run the effect at all. */
    static boolean isSupported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;
    }

    /**
     * Apply a profile, or pass null to leave the signal alone.
     *
     * Called on every track change, so the common case is the same params arriving again; that is
     * detected and skipped rather than rebuilding the effect and interrupting audio.
     */
    void apply(@Nullable ExoPlayer player, @Nullable Params params) {
        if (player == null) return;
        if (params == null) {
            release();
            return;
        }
        if (!isSupported()) return;

        int sessionId = player.getAudioSessionId();
        if (sessionId == 0) return;

        if (effect != null && sessionId == attachedSessionId && params.matches(active)) {
            return;
        }
        if (sessionId != attachedSessionId) {
            release();
        }

        try {
            if (effect == null) {
                effect = new DynamicsProcessing(0, sessionId, buildConfig());
                attachedSessionId = sessionId;
            }
            configure(effect, params);
            effect.setEnabled(true);
            active = params;
        } catch (Exception e) {
            // Vendors do ship devices where this throws. Music must keep playing.
            Log.w(TAG, "DynamicsProcessing unavailable: " + e.getMessage());
            release();
        }
    }

    private static DynamicsProcessing.Config buildConfig() {
        return new DynamicsProcessing.Config.Builder(
                DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
                /* channelCount= */ 2,
                /* preEqInUse= */ true,
                /* preEqBandCount= */ PRE_EQ_BANDS,
                /* mbcInUse= */ true,
                /* mbcBandCount= */ 1,
                /* postEqInUse= */ false,
                /* postEqBandCount= */ 0,
                /* limiterInUse= */ true)
            .build();
    }

    private static void configure(DynamicsProcessing dp, Params p) {
        int channels = dp.getChannelCount();
        for (int ch = 0; ch < channels; ch++) {
            applyPreEq(dp, ch, p);
            applyCompressor(dp, ch, p);
            applyLimiter(dp, ch, p);
        }
    }

    private static void applyPreEq(DynamicsProcessing dp, int channel, Params p) {
        // Bands are cumulative: each covers from the previous cutoff up to its own. The presence
        // band is fixed either side of the profile centre so a nudge to presenceHz does not
        // silently widen or invert the band edges.
        float presenceLow = Math.max(p.highPassHz + 1f, PRESENCE_LOW_HZ);
        float presenceHigh = Math.max(presenceLow + 1f, PRESENCE_HIGH_HZ);

        setBand(dp, channel, BAND_LOW, p.highPassHz, LOW_CUT_DB);
        setBand(dp, channel, BAND_MID, presenceLow, 0f);
        setBand(dp, channel, BAND_PRESENCE, presenceHigh, p.presenceGainDb);
        setBand(dp, channel, BAND_HIGH, TOP_HZ, 0f);
    }

    private static void setBand(
        DynamicsProcessing dp,
        int channel,
        int band,
        float cutoffHz,
        float gainDb
    ) {
        DynamicsProcessing.EqBand eq = new DynamicsProcessing.EqBand(true, cutoffHz, gainDb);
        dp.setPreEqBandByChannelIndex(channel, band, eq);
    }

    private static void applyCompressor(DynamicsProcessing dp, int channel, Params p) {
        DynamicsProcessing.MbcBand band = new DynamicsProcessing.MbcBand(
            /* enabled= */ true,
            /* cutoffFrequency= */ TOP_HZ,
            /* attackTime= */ p.attackMs,
            /* releaseTime= */ p.releaseMs,
            /* ratio= */ p.ratio,
            /* threshold= */ p.thresholdDb,
            /* kneeWidth= */ p.kneeDb,
            // No gating: silence between sentences is part of a reading, and a gate chewing the
            // start of quiet words is worse than the room tone it removes.
            /* noiseGateThreshold= */ -100f,
            /* expanderRatio= */ 1f,
            /* preGain= */ 0f,
            /* postGain= */ p.makeupDb);
        dp.setMbcBandByChannelIndex(channel, 0, band);
    }

    private static void applyLimiter(DynamicsProcessing dp, int channel, Params p) {
        // Makeup gain is applied after compression, so a passage the compressor barely touched can
        // arrive above full scale. The limiter is what stops that becoming clipping.
        DynamicsProcessing.Limiter limiter = new DynamicsProcessing.Limiter(
            /* inUse= */ true,
            /* enabled= */ true,
            /* linkGroup= */ 0,
            /* attackTime= */ 1f,
            /* releaseTime= */ 60f,
            /* ratio= */ 10f,
            /* threshold= */ -1f,
            /* postGain= */ 0f);
        dp.setLimiterByChannelIndex(channel, limiter);
    }

    void release() {
        if (effect != null) {
            try {
                effect.setEnabled(false);
                effect.release();
            } catch (Exception ignored) {
                /* best-effort */
            }
            effect = null;
        }
        attachedSessionId = 0;
        active = null;
    }
}
