package rd.sheepskin.sandboxmusic;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.net.Uri;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground media service that mirrors WebView playback state into Android MediaSession,
 * notification controls, lock-screen metadata, and headset media keys.
 */
public class MediaPlaybackForegroundService extends Service implements AudioManager.OnAudioFocusChangeListener {

    public static final String ACTION_START = "rd.sheepskin.sandboxmusic.action.MEDIA_START";
    public static final String ACTION_STOP = "rd.sheepskin.sandboxmusic.action.MEDIA_STOP";
    public static final String ACTION_UPDATE = "rd.sheepskin.sandboxmusic.action.MEDIA_UPDATE";

    private static final String CHANNEL_ID = "sovereign_playback";
    private static final String CHANNEL_ID_TOP = "sovereign_playback_top";
    private static final int NOTIFICATION_ID = 88001;

    private static final long SUPPORTED_ACTIONS =
        PlaybackStateCompat.ACTION_PLAY
            | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            | PlaybackStateCompat.ACTION_SEEK_TO
            | PlaybackStateCompat.ACTION_FAST_FORWARD
            | PlaybackStateCompat.ACTION_REWIND;

    /** After pause, keep notification/FGS this long, then tear down to save battery. */
    private static final long PAUSE_FOREGROUND_GRACE_MS = 15L * 60L * 1000L;

    private static BackgroundMediaPlugin pluginRef;
    private static MediaPlaybackForegroundService runningInstance;
    private static volatile String title = "";
    private static volatile String artist = "";
    private static volatile String album = "";
    private static volatile String artworkUrl = null;
    private static volatile boolean isPlaying = false;
    private static volatile long positionMs = 0L;
    private static volatile long durationMs = 0L;
    private static volatile float playbackRate = 1f;
    private static volatile Bitmap artworkBitmap = null;
    private static volatile String lastLoadedArtworkUrl = null;
    private static volatile String miniPlayerMode = "off";
    private static volatile long appliedMetadataRevision = 0L;
    private static volatile String activeEnvelopeId = "";

    public static boolean applyMetadataRevision(long revision, @Nullable String envelopeId) {
        if (revision <= 0L) {
            return true;
        }
        synchronized (MediaPlaybackForegroundService.class) {
            // Strict monotonic revision — stale async bridge calls must not rewind title/art.
            if (revision < appliedMetadataRevision) {
                return false;
            }
            appliedMetadataRevision = revision;
            return true;
        }
    }

    /** Native-initiated metadata (Exo media-item transition) — always strictly increases. */
    public static long allocateMetadataRevision() {
        synchronized (MediaPlaybackForegroundService.class) {
            long next = System.currentTimeMillis();
            if (next <= appliedMetadataRevision) {
                next = appliedMetadataRevision + 1L;
            }
            appliedMetadataRevision = next;
            return next;
        }
    }

    public static boolean applyMetadataRevision(long revision) {
        return applyMetadataRevision(revision, null);
    }

    public static void updateMetadata(
        String nextTitle,
        String nextArtist,
        String nextAlbum,
        String nextArtworkUrl,
        @Nullable String envelopeId,
        long revision
    ) {
        if (!applyMetadataRevision(revision, envelopeId)) {
            return;
        }
        if (envelopeId != null && !envelopeId.isEmpty()) {
            activeEnvelopeId = envelopeId;
        }
        android.util.Log.d(
            "MediaPlaybackFGS",
            "metadata rev=" + revision + " env=" + (envelopeId != null ? envelopeId : "") +
                " title=" + (nextTitle != null ? nextTitle : "")
        );
        title = nextTitle != null ? nextTitle : "";
        artist = nextArtist != null ? nextArtist : "";
        album = nextAlbum != null ? nextAlbum : "";
        if (nextArtworkUrl == null || !nextArtworkUrl.equals(artworkUrl)) {
            artworkBitmap = null;
            lastLoadedArtworkUrl = null;
        }
        if (nextArtworkUrl != null && nextArtworkUrl.startsWith("blob:")) {
            android.util.Log.w(
                "MediaPlaybackFGS",
                "rejecting blob artwork URL — native cannot decode WebView blobs"
            );
            artworkUrl = null;
        } else {
            artworkUrl = nextArtworkUrl;
        }
    }

    public static void updateMetadata(String nextTitle, String nextArtist, String nextAlbum, String nextArtworkUrl) {
        updateMetadata(nextTitle, nextArtist, nextAlbum, nextArtworkUrl, null, System.currentTimeMillis());
    }

    private final IBinder binder = new LocalBinder();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();

    private MediaSessionCompat mediaSession;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private PowerManager.WakeLock wakeLock;
    private boolean foregroundStarted = false;
    private boolean hasAudioFocus = false;
    private boolean pausedByTransientFocusLoss = false;
    private boolean stopping = false;

    private final Runnable pauseGraceStopRunnable = () -> {
        pauseGraceScheduled = false;
        if (!isPlaying && foregroundStarted) {
            stopForegroundService();
        }
    };
    private boolean pauseGraceScheduled = false;
    /** Guards concurrent startForegroundService() before onCreate finishes. */
    private static volatile boolean serviceStartInFlight = false;
    /** Restart after an in-progress teardown instead of racing startForegroundService vs stopSelf. */
    private static volatile boolean pendingStartAfterDestroy = false;
    private static volatile Context appContextForRestart = null;

    public class LocalBinder extends Binder {
        MediaPlaybackForegroundService getService() {
            return MediaPlaybackForegroundService.this;
        }
    }

    public static void attachPlugin(BackgroundMediaPlugin plugin) {
        pluginRef = plugin;
    }

    public static void setMiniPlayerMode(String mode) {
        miniPlayerMode = mode != null ? mode : "off";
        if (runningInstance != null) {
            runningInstance.ensureNotificationChannel();
            runningInstance.refreshNotification();
        }
    }

    public static boolean isPlaying() {
        return isPlaying;
    }

    public static String getTitle() {
        return title;
    }

    public static String getArtist() {
        return artist;
    }

    @Nullable
    public static MediaSessionCompat.Token getMediaSessionToken() {
        if (runningInstance != null && runningInstance.mediaSession != null) {
            return runningInstance.mediaSession.getSessionToken();
        }
        return null;
    }

    @Nullable
    public static Bitmap getArtworkBitmap() {
        return artworkBitmap;
    }

    public static void updatePlaybackState(
        boolean playing,
        long position,
        long duration,
        float rate,
        long revision
    ) {
        if (revision > 0L && revision < appliedMetadataRevision) {
            return;
        }
        isPlaying = playing;
        positionMs = position;
        durationMs = duration;
        playbackRate = rate > 0 ? rate : 1f;
    }

    public static void updatePlaybackState(
        boolean playing,
        long position,
        long duration,
        float rate
    ) {
        updatePlaybackState(playing, position, duration, rate, System.currentTimeMillis());
    }

    public static void requestStop(@Nullable Context context) {
        synchronized (MediaPlaybackForegroundService.class) {
            pendingStartAfterDestroy = false;
        }
        MediaPlaybackForegroundService instance = runningInstance;
        if (instance != null) {
            instance.stopForegroundService();
            return;
        }
        if (context == null) {
            return;
        }
        try {
            Intent intent = new Intent(context, MediaPlaybackForegroundService.class);
            intent.setAction(ACTION_STOP);
            context.startService(intent);
        } catch (IllegalStateException ignored) {
            // Cannot start a service from background when no instance is running — nothing to stop.
        }
    }

    /**
     * Single entry for starting the foreground service. Prevents duplicate
     * startForegroundService() calls that trigger ForegroundServiceDidNotStartInTimeException.
     * Never start while an instance is mid-create or mid-teardown (OnePlus: "Bringing down
     * service while still waiting for start foreground" → immediate process death).
     */
    public static void ensureServiceRunning(@Nullable Context context) {
        if (context == null) {
            return;
        }
        Context appCtx = context.getApplicationContext();
        synchronized (MediaPlaybackForegroundService.class) {
            MediaPlaybackForegroundService instance = runningInstance;
            // Live instance (including mid-onCreate before foregroundStarted): do not re-start.
            if (instance != null && !instance.stopping) {
                if (instance.foregroundStarted) {
                    instance.refreshSession();
                }
                return;
            }
            if (serviceStartInFlight) {
                return;
            }
            // Teardown in progress — restart from onDestroy instead of racing stopSelf.
            if (instance != null && instance.stopping) {
                pendingStartAfterDestroy = true;
                appContextForRestart = appCtx;
                return;
            }
            serviceStartInFlight = true;
            pendingStartAfterDestroy = false;
            appContextForRestart = appCtx;
        }
        try {
            Intent intent = new Intent(appCtx, MediaPlaybackForegroundService.class);
            intent.setAction(ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                appCtx.startForegroundService(intent);
            } else {
                appCtx.startService(intent);
            }
        } catch (RuntimeException e) {
            synchronized (MediaPlaybackForegroundService.class) {
                serviceStartInFlight = false;
            }
            android.util.Log.e(
                "MediaPlaybackFGS",
                "ensureServiceRunning startForegroundService failed",
                e
            );
        }
    }

    public static void requestRefresh(@Nullable Context context) {
        MediaPlaybackForegroundService instance = runningInstance;
        if (instance != null && !instance.stopping) {
            if (instance.foregroundStarted && instance.mediaSession != null) {
                instance.refreshSession();
            }
            return;
        }
        // Do not start FGS solely to publish a paused/idle refresh — that races with JS
        // stopForeground/startForeground and caused OnePlus ForegroundServiceDidNotStartInTimeException.
        if (!isPlaying) {
            return;
        }
        ensureServiceRunning(context);
    }

    public static void dispatchExternalAction(Context context, String action) {
        requestRefresh(context);
        if (runningInstance != null) {
            runningInstance.handleExternalAction(action);
            return;
        }
        BackgroundMediaPlugin plugin = pluginRef != null ? pluginRef : BackgroundMediaPlugin.getInstance();
        if (plugin != null) {
            plugin.emitMediaAction(mapExternalAction(action), null);
        }
    }

    private static String mapExternalAction(String action) {
        if ("playPause".equals(action)) {
            return isPlaying ? "pause" : "play";
        }
        if ("next".equals(action)) {
            return "next";
        }
        if ("previous".equals(action)) {
            return "previous";
        }
        if ("seekForward".equals(action)) {
            return "seekForward";
        }
        if ("seekBackward".equals(action)) {
            return "seekBackward";
        }
        if ("pause".equals(action)) {
            return "pause";
        }
        return "play";
    }

    @Override
    public void onCreate() {
        super.onCreate();
        runningInstance = this;
        stopping = false;
        // Promote to FGS before any other work — OEM deadline is strict; prior channel/session
        // setup delayed startForeground and raced with stopForeground from the WebView.
        createNotificationChannel();
        Notification bootstrap =
            new NotificationCompat.Builder(this, activeChannelId())
                .setContentTitle(getString(R.string.app_name))
                .setSmallIcon(R.drawable.ic_stat_music)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .build();
        startForeground(NOTIFICATION_ID, bootstrap);
        foregroundStarted = true;
        synchronized (MediaPlaybackForegroundService.class) {
            serviceStartInFlight = false;
        }

        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        ensureMediaSession();

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SovereignMusicConsole:Playback");
            wakeLock.setReferenceCounted(false);
        }
    }

    private void ensureMediaSession() {
        if (mediaSession != null) {
            return;
        }
        mediaSession = new MediaSessionCompat(this, "SovereignMusicConsole");
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setCallback(sessionCallback);
        // AudioAttributes are applied via AndroidAudioSessionHelper on audio focus.
        mediaSession.setPlaybackToLocal(AudioManager.STREAM_MUSIC);
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_UPDATE;
        // Every startForegroundService() delivery must call startForeground() before any stop.
        if (!foregroundStarted) {
            ensureMediaSession();
            Notification notification = buildNotification();
            startForeground(NOTIFICATION_ID, notification);
            foregroundStarted = true;
            synchronized (MediaPlaybackForegroundService.class) {
                serviceStartInFlight = false;
            }
        }
        if (ACTION_STOP.equals(action)) {
            stopForegroundService();
            return START_NOT_STICKY;
        }

        if (ACTION_START.equals(action) || ACTION_UPDATE.equals(action) || action == null) {
            stopping = false;
            ensureMediaSession();
            if (foregroundStarted) {
                refreshNotification();
            }
            if (!stopping) {
                refreshSession();
            }
        }
        return START_STICKY;
    }

    private void ensureForeground() {
        ensureMediaSession();
        if (foregroundStarted) {
            refreshNotification();
            return;
        }
        Notification notification = buildNotification();
        startForeground(NOTIFICATION_ID, notification);
        foregroundStarted = true;
        if (isPlaying) {
            acquireWakeLock();
            requestAudioFocus();
        }
    }

    private void refreshSession() {
        if (stopping) {
            return;
        }
        final MediaSessionCompat session = mediaSession;
        if (session == null) {
            return;
        }
        maybeLoadArtwork();
        MediaMetadataCompat.Builder metadataBuilder = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album != null ? album : "");
        if (activeEnvelopeId != null && !activeEnvelopeId.isEmpty()) {
            metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_MEDIA_ID, activeEnvelopeId);
        }
        if (durationMs > 0) {
            metadataBuilder.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs);
        }
        if (artworkUrl != null && !artworkUrl.isEmpty() && isNativeLoadableArtUri(artworkUrl)) {
            metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, artworkUrl);
            metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_ART_URI, artworkUrl);
            metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, artworkUrl);
        }
        if (artworkBitmap != null) {
            metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artworkBitmap);
            metadataBuilder.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, artworkBitmap);
        }
        try {
            session.setMetadata(metadataBuilder.build());

            int state = isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
            PlaybackStateCompat playbackState = new PlaybackStateCompat.Builder()
                .setActions(SUPPORTED_ACTIONS)
                .setState(state, positionMs, playbackRate, System.currentTimeMillis())
                .build();
            session.setPlaybackState(playbackState);

            PendingIntent homeIntent = buildPlayerHomeContentIntent();
            session.setSessionActivity(homeIntent);
        } catch (RuntimeException ignored) {
            // Session may be released mid-refresh on another thread during service teardown.
            return;
        }

        if (isPlaying) {
            acquireWakeLock();
            requestAudioFocus();
        } else {
            releaseWakeLock();
        }
        refreshNotification();
        MainActivity.refreshPipParamsIfNeeded();
        syncPauseGraceTimer();
    }

    /**
     * While paused, keep lock-screen controls for {@link #PAUSE_FOREGROUND_GRACE_MS}, then stop FGS.
     * Timer is reset on resume and cleared on explicit stop.
     */
    private void syncPauseGraceTimer() {
        if (isPlaying || !foregroundStarted) {
            cancelPauseGraceTimer();
            return;
        }
        if (title == null || title.isEmpty()) {
            cancelPauseGraceTimer();
            return;
        }
        if (pauseGraceScheduled) {
            return;
        }
        pauseGraceScheduled = true;
        mainHandler.postDelayed(pauseGraceStopRunnable, PAUSE_FOREGROUND_GRACE_MS);
    }

    private void cancelPauseGraceTimer() {
        mainHandler.removeCallbacks(pauseGraceStopRunnable);
        pauseGraceScheduled = false;
    }

    private void maybeLoadArtwork() {
        if (artworkUrl == null || artworkUrl.isEmpty()) {
            artworkBitmap = null;
            lastLoadedArtworkUrl = null;
            return;
        }
        if (artworkUrl.equals(lastLoadedArtworkUrl)) {
            return;
        }
        final String urlToLoad = artworkUrl;
        artworkExecutor.execute(() -> {
            Bitmap bitmap = fetchBitmap(urlToLoad);
            if (bitmap != null && urlToLoad.equals(artworkUrl)) {
                android.util.Log.d(
                    "MediaPlaybackFGS",
                    "ART loaded " + bitmap.getWidth() + "x" + bitmap.getHeight() +
                        " url=" + summarizeArtUrl(urlToLoad)
                );
                Bitmap prior = artworkBitmap;
                artworkBitmap = bitmap;
                lastLoadedArtworkUrl = urlToLoad;
                if (prior != null && prior != bitmap && !prior.isRecycled()) {
                    prior.recycle();
                }
                mainHandler.post(this::refreshSession);
            } else if (bitmap == null) {
                android.util.Log.w(
                    "MediaPlaybackFGS",
                    "ART load failed url=" + summarizeArtUrl(urlToLoad)
                );
            }
        });
    }

    private static boolean isNativeLoadableArtUri(String url) {
        return url.startsWith("http://")
            || url.startsWith("https://")
            || url.startsWith("content://")
            || url.startsWith("file://")
            || url.startsWith("data:");
    }

    private static String summarizeArtUrl(String url) {
        if (url == null) return "null";
        if (url.startsWith("data:")) {
            int comma = url.indexOf(',');
            return "data:" + (comma > 0 ? url.substring(0, Math.min(comma, 32)) : "") + ",…";
        }
        if (url.length() <= 96) return url;
        return url.substring(0, 96) + "…";
    }

    private static final int ARTWORK_MAX_PX = 512;

    @Nullable
    private Bitmap fetchBitmap(String urlString) {
        if (urlString == null || urlString.isEmpty()) {
            return null;
        }
        if (urlString.startsWith("blob:")) {
            return null;
        }
        if (urlString.startsWith("data:")) {
            return decodeDataUrlBitmap(urlString);
        }
        if (urlString.startsWith("content://")) {
            return decodeContentUriBitmap(Uri.parse(urlString));
        }
        if (urlString.startsWith("file://")) {
            return decodeFileUriBitmap(Uri.parse(urlString));
        }
        HttpURLConnection connection = null;
        try {
            URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setInstanceFollowRedirects(true);
            connection.connect();
            try (InputStream in = connection.getInputStream()) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int read;
                while ((read = in.read(chunk)) != -1) {
                    buffer.write(chunk, 0, read);
                }
                byte[] bytes = buffer.toByteArray();
                if (bytes.length == 0) return null;
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
                int sample = 1;
                int maxDim = Math.max(bounds.outWidth, bounds.outHeight);
                while (maxDim / sample > ARTWORK_MAX_PX) {
                    sample *= 2;
                }
                BitmapFactory.Options decode = new BitmapFactory.Options();
                decode.inSampleSize = sample;
                return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, decode);
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    @Nullable
    private Bitmap decodeDataUrlBitmap(String dataUrl) {
        try {
            int comma = dataUrl.indexOf(',');
            if (comma < 0) return null;
            byte[] bytes = android.util.Base64.decode(dataUrl.substring(comma + 1), android.util.Base64.DEFAULT);
            if (bytes.length == 0) return null;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception ignored) {
            return null;
        }
    }

    @Nullable
    private Bitmap decodeContentUriBitmap(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            return BitmapFactory.decodeStream(in);
        } catch (Exception ignored) {
            return null;
        }
    }

    @Nullable
    private Bitmap decodeFileUriBitmap(Uri uri) {
        try {
            String path = uri.getPath();
            if (path == null || path.isEmpty()) return null;
            return BitmapFactory.decodeFile(path);
        } catch (Exception ignored) {
            return null;
        }
    }

    private PendingIntent buildPlayerHomeContentIntent() {
        Intent launchIntent = new Intent(Intent.ACTION_VIEW);
        launchIntent.setClass(this, MainActivity.class);
        launchIntent.setData(Uri.parse("sandboxmusic://player/home"));
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
            this,
            1,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private Notification buildNotification() {
        PendingIntent contentIntent = buildPlayerHomeContentIntent();

        int playPauseIcon = isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        String playPauseLabel = isPlaying ? "Pause" : "Play";

        PendingIntent playPausePending = MediaNotificationReceiver.pendingIntent(this, "playPause");
        PendingIntent prevPending = MediaNotificationReceiver.pendingIntent(this, "previous");
        PendingIntent nextPending = MediaNotificationReceiver.pendingIntent(this, "next");

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, activeChannelId())
            .setContentTitle(title.isEmpty() ? getString(R.string.app_name) : title)
            .setContentText(artist)
            .setSubText(album)
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(isPlaying)
            .setShowWhen(false)
            .addAction(android.R.drawable.ic_media_previous, "Previous", prevPending)
            .addAction(playPauseIcon, playPauseLabel, playPausePending)
            .addAction(android.R.drawable.ic_media_next, "Next", nextPending);

        if (mediaSession != null) {
            builder.setStyle(
                new MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2)
            );
        }

        if (durationMs > 0) {
            int max = (int) Math.min(Integer.MAX_VALUE, durationMs);
            int progress = (int) Math.min(max, Math.max(0, positionMs));
            builder.setProgress(max, progress, false);
        }

        if ("topBar".equals(miniPlayerMode)) {
            builder.setPriority(NotificationCompat.PRIORITY_DEFAULT);
            builder.setCategory(NotificationCompat.CATEGORY_TRANSPORT);
        }

        if (artworkBitmap != null) {
            builder.setLargeIcon(artworkBitmap);
        }

        return builder.build();
    }

    private void refreshNotification() {
        if (!foregroundStarted) {
            return;
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private String activeChannelId() {
        return "topBar".equals(miniPlayerMode) ? CHANNEL_ID_TOP : CHANNEL_ID;
    }

    private void ensureNotificationChannel() {
        createNotificationChannel();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            return;
        }

        NotificationChannel standard = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.playback_notification_channel),
            NotificationManager.IMPORTANCE_LOW
        );
        standard.setDescription(getString(R.string.playback_notification_channel_desc));
        standard.setShowBadge(false);
        nm.createNotificationChannel(standard);

        NotificationChannel top = new NotificationChannel(
            CHANNEL_ID_TOP,
            getString(R.string.playback_notification_channel_top),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        top.setDescription(getString(R.string.playback_notification_channel_top_desc));
        top.setShowBadge(false);
        nm.createNotificationChannel(top);
    }

    private final MediaSessionCompat.Callback sessionCallback = new MediaSessionCompat.Callback() {
        @Override
        public void onPlay() {
            emitAction("play");
        }

        @Override
        public void onPause() {
            emitAction("pause");
        }

        @Override
        public void onSkipToNext() {
            emitAction("next");
        }

        @Override
        public void onSkipToPrevious() {
            emitAction("previous");
        }

        @Override
        public void onFastForward() {
            emitAction("seekForward");
        }

        @Override
        public void onRewind() {
            emitAction("seekBackward");
        }

        @Override
        public void onSeekTo(long pos) {
            emitAction("seekTo", pos);
        }

        @Override
        public void onPlayFromMediaId(String mediaId, android.os.Bundle extras) {
            AndroidAutoBridge.requestPlay(mediaId);
        }

        @Override
        public void onPlayFromSearch(String query, android.os.Bundle extras) {
            AndroidAutoBridge.requestSearch(query);
        }
    };

    public void handleExternalAction(String action) {
        switch (action) {
            case "playPause":
                emitAction(isPlaying ? "pause" : "play");
                break;
            case "play":
                emitAction("play");
                break;
            case "pause":
                emitAction("pause");
                break;
            case "next":
                emitAction("next");
                break;
            case "previous":
                emitAction("previous");
                break;
            case "seekForward":
                emitAction("seekForward");
                break;
            case "seekBackward":
                emitAction("seekBackward");
                break;
            default:
                break;
        }
    }

    private void emitAction(String action) {
        emitAction(action, null);
    }

    private void emitAction(String action, @Nullable Long positionMsOverride) {
        BackgroundMediaPlugin plugin = pluginRef != null ? pluginRef : BackgroundMediaPlugin.getInstance();
        if (plugin != null) {
            plugin.emitMediaAction(action, positionMsOverride);
        }
    }

    private void requestAudioFocus() {
        if (audioManager == null || hasAudioFocus) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            AudioAttributes attrs = AndroidAudioSessionHelper.buildMediaAttributes();
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setOnAudioFocusChangeListener(this)
                .setAcceptsDelayedFocusGain(true)
                .build();
            int result = audioManager.requestAudioFocus(audioFocusRequest);
            hasAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } else {
            int result = audioManager.requestAudioFocus(
                this,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN
            );
            hasAudioFocus = result == AudioManager.AUDIOFOCUS_GAIN;
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null || !hasAudioFocus) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
        } else {
            audioManager.abandonAudioFocus(this);
        }
        hasAudioFocus = false;
    }

    @Override
    public void onAudioFocusChange(int focusChange) {
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_LOSS:
                if (NativeExoPlaybackPlugin.isScreenLockKeepaliveActive()) {
                    NativeExoPlaybackPlugin.nudgePlaybackOnAudioFocusGain();
                    break;
                }
                pausedByTransientFocusLoss = false;
                NativeExoPlaybackPlugin.pauseFromAudioFocusLoss(false);
                updatePlaybackState(false, positionMs, durationMs, playbackRate, allocateMetadataRevision());
                refreshSession();
                emitAction("pause");
                hasAudioFocus = false;
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                if (NativeExoPlaybackPlugin.isScreenLockKeepaliveActive()) {
                    NativeExoPlaybackPlugin.nudgePlaybackOnAudioFocusGain();
                    break;
                }
                if (isPlaying) {
                    pausedByTransientFocusLoss = true;
                    NativeExoPlaybackPlugin.pauseFromAudioFocusLoss(true);
                    updatePlaybackState(false, positionMs, durationMs, playbackRate, allocateMetadataRevision());
                    refreshSession();
                    emitAction("pause");
                }
                hasAudioFocus = false;
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                hasAudioFocus = false;
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                hasAudioFocus = true;
                if (pausedByTransientFocusLoss) {
                    pausedByTransientFocusLoss = false;
                    NativeExoPlaybackPlugin.resumeFromAudioFocusGain();
                    updatePlaybackState(true, positionMs, durationMs, playbackRate, allocateMetadataRevision());
                    refreshSession();
                    emitAction("play");
                } else {
                    NativeExoPlaybackPlugin.nudgePlaybackOnAudioFocusGain();
                }
                break;
            default:
                break;
        }
    }

    private void acquireWakeLock() {
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(10 * 60 * 60 * 1000L);
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    private void stopForegroundService() {
        // WebView may call stopForeground while native Exo still plays after screen lock.
        if (NativeExoPlaybackPlugin.hasActiveNativePlayback()) {
            android.util.Log.d(
                "MediaPlaybackFGS",
                "defer stopForeground — native Exo still active"
            );
            return;
        }
        // If still under startForegroundService() contract, promote first then tear down.
        if (!foregroundStarted) {
            try {
                createNotificationChannel();
                startForeground(
                    NOTIFICATION_ID,
                    new NotificationCompat.Builder(this, activeChannelId())
                        .setContentTitle(getString(R.string.app_name))
                        .setSmallIcon(R.drawable.ic_stat_music)
                        .setOnlyAlertOnce(true)
                        .setShowWhen(false)
                        .build()
                );
                foregroundStarted = true;
            } catch (RuntimeException ignored) {
                // Best-effort; continue teardown.
            }
        }
        stopping = true;
        synchronized (MediaPlaybackForegroundService.class) {
            serviceStartInFlight = false;
        }
        cancelPauseGraceTimer();
        releaseWakeLock();
        abandonAudioFocus();
        if (mediaSession != null) {
            mediaSession.setActive(false);
        }
        stopForeground(true);
        stopSelf();
        foregroundStarted = false;
        isPlaying = false;
        title = "";
        artist = "";
        album = "";
        artworkUrl = null;
        artworkBitmap = null;
        lastLoadedArtworkUrl = null;
    }

    @Override
    public void onDestroy() {
        final boolean restart;
        final Context restartCtx;
        synchronized (MediaPlaybackForegroundService.class) {
            serviceStartInFlight = false;
            restart = pendingStartAfterDestroy;
            restartCtx = appContextForRestart;
            pendingStartAfterDestroy = false;
            if (runningInstance == this) {
                runningInstance = null;
            }
        }
        stopping = true;
        mainHandler.removeCallbacks(pauseGraceStopRunnable);
        pauseGraceScheduled = false;
        artworkExecutor.shutdownNow();
        releaseWakeLock();
        abandonAudioFocus();
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
        if (restart && restartCtx != null) {
            new Handler(Looper.getMainLooper()).post(() -> ensureServiceRunning(restartCtx));
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }
}
