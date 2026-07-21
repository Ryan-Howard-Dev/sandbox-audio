package rd.sheepskin.sandboxmusic;

import android.media.audiofx.LoudnessEnhancer;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.media3.exoplayer.ExoPlayer;

/** Software gain above ExoPlayer unity (1.0) — for phones with low max speaker output. */
final class ExoPlaybackLoudness {

    private static final String TAG = "ExoPlaybackLoudness";

    @Nullable private LoudnessEnhancer enhancer;
    private int attachedSessionId = 0;

    void ensureAttached(ExoPlayer player) {
        if (player == null) return;
        int sessionId = player.getAudioSessionId();
        if (sessionId == 0 || sessionId == attachedSessionId) return;
        release();
        try {
            enhancer = new LoudnessEnhancer(sessionId);
            enhancer.setEnabled(true);
            attachedSessionId = sessionId;
        } catch (Exception e) {
            Log.w(TAG, "LoudnessEnhancer unavailable: " + e.getMessage());
            enhancer = null;
            attachedSessionId = 0;
        }
    }

    void setBoostMillibels(int millibels) {
        if (enhancer == null) return;
        try {
            int clamped = Math.max(0, Math.min(1000, millibels));
            enhancer.setTargetGain(clamped);
        } catch (Exception e) {
            Log.w(TAG, "setTargetGain failed: " + e.getMessage());
        }
    }

    void release() {
        if (enhancer != null) {
            try {
                enhancer.setEnabled(false);
                enhancer.release();
            } catch (Exception ignored) {
                /* best-effort */
            }
            enhancer = null;
        }
        attachedSessionId = 0;
    }

    /** Extra gain above unity: combined linear > 1 → millibels for LoudnessEnhancer. */
    static int linearExtraToMillibels(float combinedLinear) {
        if (combinedLinear <= 1f) return 0;
        double mb = 2000.0 * Math.log10(combinedLinear);
        return (int) Math.min(1000, Math.max(0, Math.round(mb)));
    }
}
