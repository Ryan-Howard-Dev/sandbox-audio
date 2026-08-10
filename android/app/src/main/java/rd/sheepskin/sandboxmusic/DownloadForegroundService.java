package rd.sheepskin.sandboxmusic;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service that keeps the app process alive and shows download progress
 * while locker album/track acquisition runs in the background.
 */
public class DownloadForegroundService extends Service {

    public static final String ACTION_START = "rd.sheepskin.sandboxmusic.action.DOWNLOAD_START";
    public static final String ACTION_UPDATE = "rd.sheepskin.sandboxmusic.action.DOWNLOAD_UPDATE";
    public static final String ACTION_STOP = "rd.sheepskin.sandboxmusic.action.DOWNLOAD_STOP";

    private static final String CHANNEL_ID = "sovereign_downloads";
    private static final int NOTIFICATION_ID = 88002;
    /** Its own id, so the notice outlives the progress notification it replaces. */
    private static final int TIMEOUT_NOTIFICATION_ID = 88003;

    private static volatile DownloadForegroundService runningInstance;
    private static volatile boolean serviceStartInFlight = false;

    private static volatile String title = "";
    private static volatile int completedTracks = 0;
    private static volatile int totalTracks = 0;
    private static volatile int queueCount = 0;

    private static final long WEBVIEW_KEEPALIVE_MS = 2500L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private boolean foregroundStarted = false;
    private boolean stopping = false;
    private final Runnable webViewKeepAliveRunnable =
        new Runnable() {
            @Override
            public void run() {
                if (stopping || !foregroundStarted) {
                    return;
                }
                MainActivity.keepWebViewAliveForDownloads();
                mainHandler.postDelayed(this, WEBVIEW_KEEPALIVE_MS);
            }
        };

    public static boolean isActive() {
        return runningInstance != null && runningInstance.foregroundStarted && !runningInstance.stopping;
    }

    public static void updateProgress(String nextTitle, int completed, int total, int queuedJobs) {
        title = nextTitle != null ? nextTitle : "";
        completedTracks = Math.max(0, completed);
        totalTracks = Math.max(0, total);
        queueCount = Math.max(0, queuedJobs);
        DownloadForegroundService instance = runningInstance;
        if (instance != null && instance.foregroundStarted && !instance.stopping) {
            instance.mainHandler.post(instance::refreshNotification);
        }
    }

    public static void requestStart(@Nullable Context context) {
        if (context == null) {
            return;
        }
        DownloadForegroundService instance = runningInstance;
        if (instance != null && instance.foregroundStarted && !instance.stopping) {
            instance.refreshNotification();
            return;
        }
        if (serviceStartInFlight) {
            return;
        }
        serviceStartInFlight = true;
        MainActivity.setDownloadForegroundActive(true);
        Intent intent = new Intent(context, DownloadForegroundService.class);
        intent.setAction(ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void requestStop(@Nullable Context context) {
        MainActivity.setDownloadForegroundActive(false);
        DownloadForegroundService instance = runningInstance;
        if (instance != null) {
            instance.stopForegroundService();
            return;
        }
        if (context == null) {
            return;
        }
        try {
            Intent intent = new Intent(context, DownloadForegroundService.class);
            intent.setAction(ACTION_STOP);
            context.startService(intent);
        } catch (IllegalStateException ignored) {
            // Background start restriction when no instance is running.
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        runningInstance = this;
        stopping = false;
        createNotificationChannel();
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SovereignMusicConsole:Download");
            wakeLock.setReferenceCounted(false);
        }
        Notification bootstrap = buildNotification();
        startForeground(NOTIFICATION_ID, bootstrap);
        foregroundStarted = true;
        serviceStartInFlight = false;
        acquireWakeLock();
        startWebViewKeepAlive();
    }

    /**
     * The OS calling time on a long download.
     *
     * A dataSync foreground service gets a cumulative six hours out of every twenty four from
     * Android 15 onwards, and this app targets well past that. When the budget runs out the system
     * calls here and gives a few seconds to stand down; an app that does not is killed with
     * ForegroundServiceDidNotStopInTimeException, which is a crash rather than a stop.
     *
     * That is not a hypothetical for this app. The wake lock below asks for twelve hours, which is
     * exactly twice the budget, and a first sync of a large locker has taken hours in practice. So
     * this ends the run deliberately, and leaves a notification saying so -- a download queue that
     * silently stops at some unpredictable point looks identical to one that is broken, and there
     * would be nothing on screen to explain why the phone stopped part way.
     *
     * Whatever is left in the queue resumes the next time the app is opened; the queue itself is
     * persisted, and this only ends the process that was working through it.
     */
    @Override
    public void onTimeout(int startId, int fgsType) {
        postTimeoutNotice();
        stopForegroundService();
    }

    /** Older signature, kept because API 35 shipped it before the two-argument form. */
    @Override
    public void onTimeout(int startId) {
        onTimeout(startId, 0);
    }

    /**
     * Replace the progress notification with one that explains the stop.
     *
     * Posted after stopForeground has released the progress notification, under its own id, so it
     * survives the service ending rather than being torn down with it.
     */
    private void postTimeoutNotice() {
        try {
            PendingIntent contentIntent = PendingIntent.getActivity(
                this,
                4,
                new Intent(this, MainActivity.class)
                    .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            Notification notice = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(getString(R.string.download_timeout_title))
                .setContentText(getString(R.string.download_timeout_text))
                .setStyle(new NotificationCompat.BigTextStyle()
                    .bigText(getString(R.string.download_timeout_text)))
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setOnlyAlertOnce(true)
                .build();
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(TIMEOUT_NOTIFICATION_ID, notice);
            }
        } catch (Exception ignored) {
            // A missing notice must never be the thing that stops the service standing down.
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_UPDATE;
        if (ACTION_STOP.equals(action)) {
            stopForegroundService();
            return START_NOT_STICKY;
        }
        stopping = false;
        MainActivity.setDownloadForegroundActive(true);
        ensureForeground();
        startWebViewKeepAlive();
        return START_STICKY;
    }

    private void ensureForeground() {
        if (foregroundStarted) {
            refreshNotification();
            acquireWakeLock();
            return;
        }
        startForeground(NOTIFICATION_ID, buildNotification());
        foregroundStarted = true;
        acquireWakeLock();
    }

    private void startWebViewKeepAlive() {
        mainHandler.removeCallbacks(webViewKeepAliveRunnable);
        mainHandler.post(webViewKeepAliveRunnable);
    }

    private void stopWebViewKeepAlive() {
        mainHandler.removeCallbacks(webViewKeepAliveRunnable);
    }

    private Notification buildNotification() {
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            2,
            new Intent(this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String contentTitle = title.isEmpty() ? getString(R.string.download_notification_title) : title;
        String contentText = buildProgressText();

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(contentTitle)
            .setContentText(contentText)
            .setSmallIcon(R.drawable.ic_stat_music)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setProgress(totalTracks > 0 ? totalTracks : 100, completedTracks, totalTracks <= 0)
            .build();
    }

    private String buildProgressText() {
        if (totalTracks > 0) {
            String base = getString(R.string.download_notification_progress, completedTracks, totalTracks);
            if (queueCount > 1) {
                return base + " · " + getString(R.string.download_notification_queue, queueCount);
            }
            return base;
        }
        if (queueCount > 1) {
            return getString(R.string.download_notification_queue, queueCount);
        }
        return getString(R.string.download_notification_active);
    }

    private void refreshNotification() {
        if (!foregroundStarted || stopping) {
            return;
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.download_notification_channel),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.download_notification_channel_desc));
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
    }

    private void acquireWakeLock() {
        if (wakeLock != null && !wakeLock.isHeld()) {
            wakeLock.acquire(12 * 60 * 60 * 1000L);
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    private void stopForegroundService() {
        stopping = true;
        serviceStartInFlight = false;
        stopWebViewKeepAlive();
        MainActivity.setDownloadForegroundActive(false);
        releaseWakeLock();
        stopForeground(true);
        stopSelf();
        foregroundStarted = false;
        title = "";
        completedTracks = 0;
        totalTracks = 0;
        queueCount = 0;
    }

    @Override
    public void onDestroy() {
        serviceStartInFlight = false;
        stopWebViewKeepAlive();
        if (runningInstance == this) {
            runningInstance = null;
        }
        stopping = true;
        MainActivity.setDownloadForegroundActive(false);
        releaseWakeLock();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
