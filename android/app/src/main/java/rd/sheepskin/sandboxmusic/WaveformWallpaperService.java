package rd.sheepskin.sandboxmusic;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.os.Handler;
import android.os.Looper;
import android.service.wallpaper.WallpaperService;
import android.view.SurfaceHolder;

/**
 * The playing waveform, as the wallpaper.
 *
 * This exists because Android does not let an app draw on the lock screen. No app can — the lock
 * screen belongs to the system, and the media card on it is a notification, not a surface we own.
 * A live wallpaper is the one thing that renders full-screen behind that card, so it is the only
 * honest route to "lines of music over the whole lock screen".
 *
 * It reads WaveformTap directly. The tap is static state in this same process, filled by the
 * ExoPlayer audio chain, so the wallpaper needs no bridge, no service binding and no permission —
 * when the app is playing, the numbers are simply there. When it is not, they fall to the floor and
 * this draws a still line, which is the correct thing for a wallpaper to do when nothing is on.
 *
 * Battery is the whole design constraint. A wallpaper that animated constantly would be a
 * catastrophe on a lock screen, so: nothing is drawn while the surface is not visible, the frame
 * rate is modest, and a resting shape stops the loop entirely rather than redrawing a flat line
 * thirty times a second forever.
 */
public class WaveformWallpaperService extends WallpaperService {

    @Override
    public Engine onCreateEngine() {
        return new WaveformEngine();
    }

    private final class WaveformEngine extends Engine {

        /** Modest on purpose. This is ambient motion, not a game. */
        private static final int FRAME_MS = 40;
        /** Mirrors waveformVisual.ts: fast up, slow down, so a transient reads as a transient. */
        private static final float ATTACK = 0.45f;
        private static final float RELEASE = 0.82f;
        private static final float FLOOR = 0.04f;
        /** Stop looping once the shape has settled and there is nothing new arriving. */
        private static final int IDLE_FRAMES_BEFORE_SLEEP = 40;

        private final Handler handler = new Handler(Looper.getMainLooper());
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Path path = new Path();
        private final float[] shape = new float[WaveformTap.SLOTS];
        private boolean visible = false;
        private int idleFrames = 0;

        private final Runnable drawFrame = this::draw;

        WaveformEngine() {
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
            for (int i = 0; i < shape.length; i++) shape[i] = FLOOR;
        }

        @Override
        public void onVisibilityChanged(boolean isVisible) {
            visible = isVisible;
            if (isVisible) {
                idleFrames = 0;
                schedule();
            } else {
                // Not merely paused — unscheduled. An invisible wallpaper that keeps a handler
                // posting frames is a battery drain nobody can see to complain about.
                handler.removeCallbacks(drawFrame);
            }
        }

        @Override
        public void onSurfaceDestroyed(SurfaceHolder holder) {
            visible = false;
            handler.removeCallbacks(drawFrame);
            super.onSurfaceDestroyed(holder);
        }

        @Override
        public void onDestroy() {
            handler.removeCallbacks(drawFrame);
            super.onDestroy();
        }

        private void schedule() {
            handler.removeCallbacks(drawFrame);
            if (visible) handler.postDelayed(drawFrame, FRAME_MS);
        }

        /** Blend the newest reading in, and report whether anything is actually moving. */
        private boolean advance() {
            int[] levels = WaveformTap.snapshot();
            boolean moving = false;
            for (int i = 0; i < shape.length; i++) {
                float target = levels != null && i < levels.length ? levels[i] / 255f : 0f;
                float keep = target > shape[i] ? ATTACK : RELEASE;
                float next = shape[i] * keep + target * (1f - keep);
                if (next < FLOOR) next = FLOOR;
                if (next > 1f) next = 1f;
                if (Math.abs(next - shape[i]) > 0.002f) moving = true;
                shape[i] = next;
                if (next > FLOOR + 0.01f) moving = true;
            }
            return moving;
        }

        private void draw() {
            boolean moving = advance();
            SurfaceHolder holder = getSurfaceHolder();
            Canvas canvas = null;
            try {
                canvas = holder.lockCanvas();
                if (canvas != null) render(canvas);
            } catch (IllegalArgumentException | IllegalStateException ignored) {
                // Surface went away between the visibility check and the lock. Nothing to draw and
                // nothing worth crashing a wallpaper over.
            } finally {
                if (canvas != null) {
                    try {
                        holder.unlockCanvasAndPost(canvas);
                    } catch (IllegalArgumentException | IllegalStateException ignored) {
                        /* same race, same answer */
                    }
                }
            }

            /*
             * Sleep when the picture has stopped changing. Music paused, or the app not running at
             * all, means the shape has settled on the floor and every further frame would redraw an
             * identical still line. The next visibility change wakes it.
             */
            idleFrames = moving ? 0 : idleFrames + 1;
            if (idleFrames < IDLE_FRAMES_BEFORE_SLEEP) schedule();
        }

        private void render(Canvas canvas) {
            int width = canvas.getWidth();
            int height = canvas.getHeight();
            canvas.drawColor(Color.BLACK);
            if (width <= 0 || height <= 0 || shape.length < 2) return;

            /*
             * Three lines, same as the in-app view: a bright middle trace and two dimmer, shorter
             * echoes. One line reads as a diagram; the stack reads as sound.
             */
            drawLine(canvas, width, height, 0f, 1f, 210, width * 0.006f);
            drawLine(canvas, width, height, 0.16f, 0.55f, 90, width * 0.004f);
            drawLine(canvas, width, height, -0.16f, 0.55f, 90, width * 0.004f);
        }

        private void drawLine(
            Canvas canvas,
            int width,
            int height,
            float spread,
            float scale,
            int alpha,
            float strokeWidth
        ) {
            path.reset();
            float step = (float) width / (shape.length - 1);
            float prevX = 0f;
            float prevY = height * (0.5f + spread - shape[0] * 0.5f * scale);
            path.moveTo(prevX, prevY);
            for (int i = 1; i < shape.length; i++) {
                float x = i * step;
                float y = height * (0.5f + spread - shape[i] * 0.5f * scale);
                // Curve through midpoints: straight segments between sixty-four points are visibly
                // faceted at this size, and a bezier anchored on every point loops on a transient.
                path.quadTo(prevX, prevY, (prevX + x) / 2f, (prevY + y) / 2f);
                prevX = x;
                prevY = y;
            }
            path.lineTo(prevX, prevY);

            paint.setStrokeWidth(Math.max(2f, strokeWidth));
            // The app accent. Hard-coded rather than themed: a wallpaper outlives the WebView that
            // knows the theme, and has to draw correctly with the app not running at all.
            paint.setColor(Color.argb(alpha, 0xFF, 0x5B, 0x1E));
            canvas.drawPath(path, paint);
        }
    }
}
