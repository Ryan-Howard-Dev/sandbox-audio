package rd.sheepskin.sandboxmusic;

import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.BroadcastReceiver;
import android.content.Context;
import androidx.core.content.ContextCompat;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Rational;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.TextView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import java.lang.ref.WeakReference;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {

    private static volatile String miniPlayerMode = "off";
    private static volatile boolean downloadForegroundActive = false;
    private static WeakReference<MainActivity> instanceRef;

    private View pipOverlayRoot;
    private ImageView pipArtwork;
    private TextView pipTitle;
    private TextView pipArtist;
    private ImageButton pipPrev;
    private ImageButton pipPlayPause;
    private ImageButton pipNext;
    private boolean inPictureInPictureMode = false;
    private boolean becomingNoisyReceiverRegistered = false;
    private boolean screenLockReceiverRegistered = false;
    private boolean lastKeyboardVisible = false;
    private String pendingShareText;
    private String pendingShareSubject;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private final BroadcastReceiver becomingNoisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                return;
            }
            if (WiredDacStabilityPrefs.isEnabled(context)) {
                mainHandler.removeCallbacks(becomingNoisyPauseRunnable);
                String routeNow = AndroidAudioSessionHelper.detectOutputRoute(context);
                if (!AndroidAudioSessionHelper.ROUTE_WIRED.equals(routeNow)) {
                    AndroidAudioSessionHelper.emitPauseFromBecomingNoisy(context);
                    return;
                }
                mainHandler.postDelayed(becomingNoisyPauseRunnable, 380);
                return;
            }
            AndroidAudioSessionHelper.emitPauseFromBecomingNoisy(context);
        }
    };

    private final Runnable becomingNoisyPauseRunnable =
        new Runnable() {
            @Override
            public void run() {
                Context context = getApplicationContext();
                String route = AndroidAudioSessionHelper.detectOutputRoute(context);
                if (AndroidAudioSessionHelper.ROUTE_WIRED.equals(route)) {
                    BackgroundMediaPlugin plugin = BackgroundMediaPlugin.getInstance();
                    if (plugin != null) {
                        plugin.emitAudioRouteChange(route, "becomingNoisyRecovered");
                    }
                    return;
                }
                AndroidAudioSessionHelper.emitPauseFromBecomingNoisy(context);
            }
        };

    private final BroadcastReceiver screenLockReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null) {
                return;
            }
            String action = intent.getAction();
            if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                NativeExoPlaybackPlugin.onScreenOff();
            } else if (
                Intent.ACTION_SCREEN_ON.equals(action) || Intent.ACTION_USER_PRESENT.equals(action)
            ) {
                NativeExoPlaybackPlugin.onScreenOn();
            }
        }
    };

    public static void setMiniPlayerMode(String mode) {
        if (mode == null || mode.isEmpty()) {
            miniPlayerMode = "off";
        } else {
            miniPlayerMode = mode;
        }
        MediaPlaybackForegroundService.setMiniPlayerMode(miniPlayerMode);
    }

    public static String getMiniPlayerMode() {
        return miniPlayerMode;
    }

    public static void setDownloadForegroundActive(boolean active) {
        downloadForegroundActive = active;
        if (active) {
            keepWebViewAliveForDownloads();
        }
    }

    /**
     * While DownloadForegroundService is active, keep the Capacitor WebView scheduling
     * JS (queue drain / yt-dlp handoff / locker writes) even when another app is on top.
     * OnePlus/Chromium otherwise freezes the renderer after Activity.onPause.
     */
    public static void keepWebViewAliveForDownloads() {
        if (!downloadForegroundActive) {
            return;
        }
        MainActivity activity = instanceRef != null ? instanceRef.get() : null;
        if (activity == null) {
            return;
        }
        activity.mainHandler.post(() -> {
            if (MediaPlaybackForegroundService.isPlaying()) {
                activity.dispatchDownloadKeepaliveJs();
            } else {
                activity.keepWebViewTimersRunning();
            }
        });
    }

    /** JS-only keepalive — safe while USB DAC playback (no WebView onResume / resumeTimers). */
    public static void dispatchDownloadKeepaliveJs() {
        if (!downloadForegroundActive) {
            return;
        }
        MainActivity activity = instanceRef != null ? instanceRef.get() : null;
        if (activity == null) {
            return;
        }
        activity.mainHandler.post(activity::dispatchDownloadKeepaliveJsInternal);
    }

    public static void refreshPipParamsIfNeeded() {
        MainActivity activity = instanceRef != null ? instanceRef.get() : null;
        if (activity != null) {
            activity.updatePictureInPictureParams();
            if (activity.inPictureInPictureMode) {
                activity.updatePipOverlay();
            }
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundMediaPlugin.class);
        registerPlugin(AndroidAutoPlugin.class);
        registerPlugin(NativeCastPlugin.class);
        registerPlugin(NativeExoPlaybackPlugin.class);
        registerPlugin(WakeAlarmPlugin.class);
        registerPlugin(FollowedReleasePlugin.class);
        registerPlugin(YtDlpMobilePlugin.class);
        registerPlugin(LockerMirrorPlugin.class);
        registerPlugin(DeviceMusicScanPlugin.class);
        registerPlugin(DownloadForegroundPlugin.class);
        super.onCreate(savedInstanceState);
        instanceRef = new WeakReference<>(this);
        registerScreenLockReceiver();
        attachLeanbackBridge();
        AndroidAudioSessionHelper.configureActivityAudio(this);
        bindPipOverlayViews();
        handleWakeAlarmIntent(getIntent());
        handleFollowedReleaseIntent(getIntent());
        handlePlaylistImportIntent(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        AndroidAudioSessionHelper.configureActivityAudio(this);
        registerBecomingNoisyReceiver();
        registerScreenLockReceiver();
        applyWebViewContainerInsets();
        deliverPendingPlaylistImportToWeb();
    }

    @Override
    public void onPause() {
        mainHandler.removeCallbacks(becomingNoisyPauseRunnable);
        unregisterBecomingNoisyReceiver();
        super.onPause();
        if (downloadForegroundActive) {
            keepWebViewTimersRunning();
            // Capacitor/OEM may re-pause the renderer shortly after onPause — nudge again.
            mainHandler.postDelayed(this::keepWebViewTimersRunning, 250);
            mainHandler.postDelayed(this::keepWebViewTimersRunning, 1000);
            mainHandler.postDelayed(this::keepWebViewTimersRunning, 2500);
        }
    }

    private void keepWebViewTimersRunning() {
        if (bridge == null) {
            return;
        }
        WebView webView = bridge.getWebView();
        if (webView == null) {
            return;
        }
        webView.onResume();
        webView.resumeTimers();
        dispatchDownloadKeepaliveJsInternal();
    }

    private void dispatchDownloadKeepaliveJsInternal() {
        if (bridge == null) {
            return;
        }
        WebView webView = bridge.getWebView();
        if (webView == null) {
            return;
        }
        // Nudge JS download queue — timers alone are not enough when Chromium freezes the page.
        webView.evaluateJavascript(
            "(function(){try{window.dispatchEvent(new Event('sandbox-download-keepalive'));}catch(e){}})();",
            null
        );
    }

    private void registerBecomingNoisyReceiver() {
        if (becomingNoisyReceiverRegistered) {
            return;
        }
        IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.registerReceiver(
                this,
                becomingNoisyReceiver,
                filter,
                ContextCompat.RECEIVER_NOT_EXPORTED
            );
        } else {
            registerReceiver(becomingNoisyReceiver, filter);
        }
        becomingNoisyReceiverRegistered = true;
    }

    private void unregisterBecomingNoisyReceiver() {
        if (!becomingNoisyReceiverRegistered) {
            return;
        }
        try {
            unregisterReceiver(becomingNoisyReceiver);
        } catch (IllegalArgumentException ignored) {
            // Receiver already unregistered.
        }
        becomingNoisyReceiverRegistered = false;
    }

    private void registerScreenLockReceiver() {
        if (screenLockReceiverRegistered) {
            return;
        }
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_USER_PRESENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.registerReceiver(
                this,
                screenLockReceiver,
                filter,
                ContextCompat.RECEIVER_NOT_EXPORTED
            );
        } else {
            registerReceiver(screenLockReceiver, filter);
        }
        screenLockReceiverRegistered = true;
    }

    private void unregisterScreenLockReceiver() {
        if (!screenLockReceiverRegistered) {
            return;
        }
        try {
            unregisterReceiver(screenLockReceiver);
        } catch (IllegalArgumentException ignored) {
            // Receiver already unregistered.
        }
        screenLockReceiverRegistered = false;
    }

    private void attachLeanbackBridge() {
        if (getBridge() == null) {
            return;
        }
        WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }
        webView.addJavascriptInterface(new LeanbackBridge(this), "SandboxNative");
        configureWebViewForIme(webView);
        applyWebViewContainerInsets();
    }

    /** Gboard / IME: predictive text, autofill hints, and voice dictation in WebView fields. */
    private void configureWebViewForIme(WebView webView) {
        if (webView == null) {
            return;
        }
        android.webkit.WebSettings settings = webView.getSettings();
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptEnabled(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
        }
        webView.setLongClickable(true);
        webView.setHapticFeedbackEnabled(true);
        webView.setFocusableInTouchMode(true);
    }

    private static final class LeanbackBridge {
        private final Context context;

        LeanbackBridge(Context context) {
            this.context = context;
        }

        @JavascriptInterface
        public boolean isLeanbackTv() {
            return context.getPackageManager().hasSystemFeature(PackageManager.FEATURE_LEANBACK);
        }

        /** `sw600dp` tablets (Fire HD 10, etc.) — not leanback TV despite WebView UA without "Mobile". */
        @JavascriptInterface
        public boolean isTabletFormFactor() {
            return context.getResources().getConfiguration().smallestScreenWidthDp >= 600;
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        attachLeanbackBridge();
        clearWebViewCacheAfterUpdate();
        applyWebViewContainerInsets();
    }

    /**
     * Shrink WebView layout above system nav (3-button / gesture bar) via margins.
     * Capacitor SystemBars insetsHandling is disabled — we own inset layout here.
     */
    private void applyWebViewContainerInsets() {
        if (getBridge() == null) {
            return;
        }
        WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }
        View root = findViewById(android.R.id.content);
        View insetHost = root != null ? root : (View) webView.getParent();
        if (insetHost == null) {
            return;
        }

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        ViewCompat.setOnApplyWindowInsetsListener(insetHost, (v, windowInsets) -> {
            applyWebViewInsetGeometry(webView, windowInsets);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(insetHost);

        WindowInsetsCompat current = ViewCompat.getRootWindowInsets(insetHost);
        if (current != null) {
            applyWebViewInsetGeometry(webView, current);
        }

        insetHost.postDelayed(this::refreshWebViewContainerInsets, 400);
        insetHost.postDelayed(this::refreshWebViewContainerInsets, 1200);
    }

    private void applyWebViewInsetGeometry(WebView webView, WindowInsetsCompat windowInsets) {
        if (webView == null) {
            return;
        }
        Insets bars = windowInsets.getInsets(
            WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
        );
        Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
        boolean keyboardVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());
        int systemBottomPx = Math.max(bars.bottom, dpToPx(48));
        // Shrink WebView above IME, but never push IME height into CSS insets (double-counts).
        int webViewBottomMargin = keyboardVisible ? ime.bottom : systemBottomPx;

        ViewGroup.LayoutParams raw = webView.getLayoutParams();
        if (raw instanceof ViewGroup.MarginLayoutParams) {
            ViewGroup.MarginLayoutParams lp = (ViewGroup.MarginLayoutParams) raw;
            lp.leftMargin = bars.left;
            lp.topMargin = bars.top;
            lp.rightMargin = bars.right;
            lp.bottomMargin = webViewBottomMargin;
            webView.setLayoutParams(lp);
        }

        View parent = (View) webView.getParent();
        if (parent != null) {
            parent.setPadding(0, 0, 0, 0);
        }

        // OxygenOS sometimes reports a stale IME inset for a frame or two after the keyboard
        // hides, leaving the WebView (and its bottom tab bar) shrunk. Re-apply geometry shortly
        // after the keyboard closes so the tab bar drops back to the real bottom.
        if (lastKeyboardVisible && !keyboardVisible) {
            webView.postDelayed(this::refreshWebViewContainerInsets, 120);
            webView.postDelayed(this::refreshWebViewContainerInsets, 320);
            webView.postDelayed(this::refreshWebViewContainerInsets, 650);
        }
        lastKeyboardVisible = keyboardVisible;

        // WebView layout margins already clear system bars — CSS must not pad again (OnePlus/OEM black bar).
        pushSafeAreaInsetsToWeb(0, 0, 0, 0);
    }

    private void refreshWebViewContainerInsets() {
        if (getBridge() == null) {
            return;
        }
        WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }
        View root = findViewById(android.R.id.content);
        View insetHost = root != null ? root : (View) webView.getParent();
        if (insetHost == null) {
            return;
        }
        ViewCompat.requestApplyInsets(insetHost);
    }

    private int dpToPx(int dp) {
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) {
            density = 1f;
        }
        return Math.round(dp * density);
    }

    private void pushSafeAreaInsetsToWeb(int topPx, int rightPx, int bottomPx, int leftPx) {
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0f) {
            density = 1f;
        }
        final int top = Math.round(topPx / density);
        final int right = Math.round(rightPx / density);
        final int bottom = Math.round(bottomPx / density);
        final int left = Math.round(leftPx / density);
        final String js =
            "(function(){"
                + "if(window.__sandboxApplySafeAreaInsets){"
                + "window.__sandboxApplySafeAreaInsets("
                + top
                + ","
                + right
                + ","
                + bottom
                + ","
                + left
                + ");"
                + "return;"
                + "}"
                + "var r=document.documentElement;"
                + "r.style.setProperty('--sandbox-inset-top','"
                + top
                + "px');"
                + "r.style.setProperty('--sandbox-inset-right','"
                + right
                + "px');"
                + "r.style.setProperty('--sandbox-inset-bottom','"
                + bottom
                + "px');"
                + "r.style.setProperty('--sandbox-inset-left','"
                + left
                + "px');"
                + "r.dataset.insetsReady='true';"
                + "window.dispatchEvent(new Event('sandbox-safe-area-inset'));"
                + "})();";
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        getBridge().getWebView().post(() -> {
            if (getBridge() == null || getBridge().getWebView() == null) {
                return;
            }
            getBridge().getWebView().evaluateJavascript(js, null);
        });
    }

    /**
     * Overlay installs (adb install -r) keep WebView HTTP cache across updates.
     * Clear HTTP cache only when the APK last-update time changes so bundled assets refresh.
     * Do not wipe WebStorage/localStorage — that resets onboarding, settings, and queue state.
     */
    private void clearWebViewCacheAfterUpdate() {
        if (getBridge() == null) {
            return;
        }
        WebView webView = getBridge().getWebView();
        if (webView == null) {
            return;
        }
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            long lastUpdate = info.lastUpdateTime;
            SharedPreferences prefs = getSharedPreferences("sandbox_web_cache", MODE_PRIVATE);
            long cachedUpdate = prefs.getLong("last_update", 0L);
            if (lastUpdate != cachedUpdate) {
                webView.clearCache(true);
                prefs.edit().putLong("last_update", lastUpdate).apply();
            }
        } catch (PackageManager.NameNotFoundException ignored) {
            // Package metadata unavailable; skip cache bust.
        }
    }

    private void bindPipOverlayViews() {
        pipOverlayRoot = findViewById(R.id.pip_overlay_root);
        pipArtwork = findViewById(R.id.pip_artwork);
        pipTitle = findViewById(R.id.pip_title);
        pipArtist = findViewById(R.id.pip_artist);
        pipPrev = findViewById(R.id.pip_prev);
        pipPlayPause = findViewById(R.id.pip_play_pause);
        pipNext = findViewById(R.id.pip_next);
        if (pipPrev != null) {
            pipPrev.setOnClickListener((v) -> dispatchPipMediaAction("previous"));
        }
        if (pipPlayPause != null) {
            pipPlayPause.setOnClickListener((v) -> dispatchPipMediaAction("playPause"));
        }
        if (pipNext != null) {
            pipNext.setOnClickListener((v) -> dispatchPipMediaAction("next"));
        }
    }

    private void dispatchPipMediaAction(String action) {
        try {
            MediaNotificationReceiver.pendingIntent(this, action).send();
        } catch (PendingIntent.CanceledException ignored) {
            // Receiver unavailable while activity is tearing down.
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleWakeAlarmIntent(intent);
        handleFollowedReleaseIntent(intent);
        handlePlaylistImportIntent(intent);
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        maybeEnterPictureInPicture(false);
    }

    public void enterPictureInPictureFromPlugin() {
        maybeEnterPictureInPicture(true);
    }

    private void maybeEnterPictureInPicture(boolean force) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        if (!force && !"pip".equals(miniPlayerMode)) {
            return;
        }
        if (!MediaPlaybackForegroundService.isPlaying()) {
            return;
        }
        if (isInPictureInPictureMode()) {
            return;
        }
        if (!getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
            return;
        }
        try {
            updatePictureInPictureParams();
            enterPictureInPictureMode(buildPictureInPictureParams());
        } catch (IllegalStateException ignored) {
            // Activity not in resumed state; PiP entry rejected.
        }
    }

    private PictureInPictureParams buildPictureInPictureParams() {
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
            .setAspectRatio(new Rational(1, 1));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setActions(buildPipRemoteActions());
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled("pip".equals(miniPlayerMode));
            builder.setSeamlessResizeEnabled(true);
        }
        return builder.build();
    }

    private ArrayList<RemoteAction> buildPipRemoteActions() {
        ArrayList<RemoteAction> actions = new ArrayList<>();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return actions;
        }
        actions.add(
            new RemoteAction(
                Icon.createWithResource(this, android.R.drawable.ic_media_previous),
                getString(R.string.pip_action_previous),
                getString(R.string.pip_action_previous),
                MediaNotificationReceiver.pendingIntent(this, "previous")
            )
        );
        int playPauseIcon = MediaPlaybackForegroundService.isPlaying()
            ? android.R.drawable.ic_media_pause
            : android.R.drawable.ic_media_play;
        String playPauseLabel = MediaPlaybackForegroundService.isPlaying()
            ? getString(R.string.pip_action_pause)
            : getString(R.string.pip_action_play);
        actions.add(
            new RemoteAction(
                Icon.createWithResource(this, playPauseIcon),
                playPauseLabel,
                playPauseLabel,
                MediaNotificationReceiver.pendingIntent(this, "playPause")
            )
        );
        actions.add(
            new RemoteAction(
                Icon.createWithResource(this, android.R.drawable.ic_media_next),
                getString(R.string.pip_action_next),
                getString(R.string.pip_action_next),
                MediaNotificationReceiver.pendingIntent(this, "next")
            )
        );
        return actions;
    }

    void updatePictureInPictureParams() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        if (!isInPictureInPictureMode() && !"pip".equals(miniPlayerMode)) {
            return;
        }
        try {
            setPictureInPictureParams(buildPictureInPictureParams());
        } catch (IllegalStateException ignored) {
            // Activity not ready for PiP params update.
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        inPictureInPictureMode = isInPictureInPictureMode;
        applyPipUi(isInPictureInPictureMode);
    }

    private void applyPipUi(boolean pipActive) {
        if (pipOverlayRoot == null) {
            bindPipOverlayViews();
        }
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (pipActive) {
            updatePipOverlay();
            if (pipOverlayRoot != null) {
                pipOverlayRoot.setVisibility(View.VISIBLE);
            }
            if (webView != null) {
                webView.setVisibility(View.INVISIBLE);
            }
        } else {
            if (pipOverlayRoot != null) {
                pipOverlayRoot.setVisibility(View.GONE);
            }
            if (webView != null) {
                webView.setVisibility(View.VISIBLE);
            }
        }
    }

    private void updatePipOverlay() {
        if (pipTitle != null) {
            String title = MediaPlaybackForegroundService.getTitle();
            pipTitle.setText(title == null || title.isEmpty() ? "Now playing" : title);
        }
        if (pipArtist != null) {
            String artist = MediaPlaybackForegroundService.getArtist();
            pipArtist.setText(artist == null ? "" : artist);
        }
        if (pipArtwork != null) {
            Bitmap art = MediaPlaybackForegroundService.getArtworkBitmap();
            if (art != null) {
                pipArtwork.setImageBitmap(art);
            } else {
                pipArtwork.setImageResource(R.drawable.ic_stat_music);
            }
        }
        if (pipPlayPause != null) {
            int icon = MediaPlaybackForegroundService.isPlaying()
                ? android.R.drawable.ic_media_pause
                : android.R.drawable.ic_media_play;
            String label = MediaPlaybackForegroundService.isPlaying()
                ? getString(R.string.pip_action_pause)
                : getString(R.string.pip_action_play);
            pipPlayPause.setImageResource(icon);
            pipPlayPause.setContentDescription(label);
        }
    }

    private void handleWakeAlarmIntent(Intent intent) {
        if (intent == null || !WakeAlarmReceiver.ACTION_WAKE_ALARM.equals(intent.getAction())) {
            return;
        }
        String trackJson = intent.getStringExtra(WakeAlarmReceiver.EXTRA_TRACK_JSON);
        WakeAlarmPlugin.deliverFromIntent(trackJson);
    }

    private void handleFollowedReleaseIntent(Intent intent) {
        if (intent == null || !FollowedReleaseScheduler.ACTION.equals(intent.getAction())) {
            return;
        }
        dispatchFollowedReleaseBackgroundCheck();
    }

    private void dispatchFollowedReleaseBackgroundCheck() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        getBridge().getWebView().post(() -> {
            if (getBridge() == null || getBridge().getWebView() == null) {
                return;
            }
            getBridge().getWebView().evaluateJavascript(
                "(function(){"
                    + "window.dispatchEvent(new Event('sandbox-followed-release-background-check'));"
                    + "window.dispatchEvent(new Event('sandbox-podcast-background-check'));"
                    + "})();",
                null
            );
        });
    }

    private void handlePlaylistImportIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action)) {
            String type = intent.getType();
            if (type == null || !type.startsWith("text/")) {
                return;
            }
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text == null || text.trim().isEmpty()) {
                return;
            }
            pendingShareText = text.trim();
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            pendingShareSubject = subject != null && !subject.trim().isEmpty() ? subject.trim() : null;
            deliverPendingPlaylistImportToWeb();
            return;
        }
        if (!Intent.ACTION_VIEW.equals(action)) {
            return;
        }
        Uri data = intent.getData();
        if (data == null || !"sandboxmusic".equals(data.getScheme()) || !"import".equals(data.getHost())) {
            return;
        }
        String text = data.getQueryParameter("text");
        if (text == null || text.trim().isEmpty()) {
            text = data.getQueryParameter("url");
        }
        if (text == null || text.trim().isEmpty()) {
            return;
        }
        pendingShareText = text.trim();
        String name = data.getQueryParameter("name");
        pendingShareSubject = name != null && !name.trim().isEmpty() ? name.trim() : null;
        deliverPendingPlaylistImportToWeb();
    }

    private void deliverPendingPlaylistImportToWeb() {
        if (pendingShareText == null || pendingShareText.trim().isEmpty()) {
            return;
        }
        final String text = pendingShareText;
        final String subject = pendingShareSubject;
        pendingShareText = null;
        pendingShareSubject = null;
        Runnable deliver = () -> {
            if (getBridge() == null || getBridge().getWebView() == null) {
                pendingShareText = text;
                pendingShareSubject = subject;
                return;
            }
            try {
                org.json.JSONObject detail = new org.json.JSONObject();
                detail.put("text", text);
                if (subject != null) {
                    detail.put("name", subject);
                }
                String js =
                    "window.dispatchEvent(new CustomEvent('sandbox-playlist-import-share',{detail:"
                        + detail.toString()
                        + "}))";
                getBridge().getWebView().evaluateJavascript(js, null);
            } catch (org.json.JSONException ignored) {
                // Malformed share payload — skip.
            }
        };
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().post(deliver);
        } else {
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(deliver, 400);
        }
    }

    @Override
    public void onDestroy() {
        unregisterScreenLockReceiver();
        if (instanceRef != null && instanceRef.get() == this) {
            instanceRef = null;
        }
        super.onDestroy();
    }
}
