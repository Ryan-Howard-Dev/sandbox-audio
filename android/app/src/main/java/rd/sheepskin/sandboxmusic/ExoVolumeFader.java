package rd.sheepskin.sandboxmusic;

import android.os.Handler;
import androidx.annotation.Nullable;
import androidx.media3.exoplayer.ExoPlayer;

/** Smooth ExoPlayer volume ramps for native crossfade (no WebView Web Audio). */
final class ExoVolumeFader {

    private final Handler handler;
    @Nullable private Runnable activeTick;

    ExoVolumeFader(Handler handler) {
        this.handler = handler;
    }

    void cancel() {
        if (activeTick != null) {
            handler.removeCallbacks(activeTick);
            activeTick = null;
        }
    }

    void fade(
        @Nullable ExoPlayer player,
        float from,
        float to,
        long durationMs,
        @Nullable Runnable onDone
    ) {
        cancel();
        if (player == null) {
            if (onDone != null) onDone.run();
            return;
        }
        if (durationMs <= 0) {
            player.setVolume(to);
            if (onDone != null) onDone.run();
            return;
        }
        final long startMs = System.currentTimeMillis();
        final Runnable tick =
            new Runnable() {
                @Override
                public void run() {
                    ExoPlayer p = player;
                    if (p == null) {
                        activeTick = null;
                        if (onDone != null) onDone.run();
                        return;
                    }
                    float t = Math.min(1f, (System.currentTimeMillis() - startMs) / (float) durationMs);
                    float v = from + (to - from) * t;
                    p.setVolume(v);
                    if (t < 1f) {
                        activeTick = this;
                        handler.postDelayed(this, 16);
                    } else {
                        activeTick = null;
                        if (onDone != null) onDone.run();
                    }
                }
            };
        activeTick = tick;
        handler.post(tick);
    }
}
