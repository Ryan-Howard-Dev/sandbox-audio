package rd.sheepskin.sandboxmusic;

import android.net.Uri;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.mediarouter.app.MediaRouteChooserDialog;
import androidx.mediarouter.media.MediaRouteSelector;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaQueueItem;
import com.google.android.gms.cast.MediaStatus;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManager;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.images.WebImage;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

@CapacitorPlugin(name = "NativeCast")
public class NativeCastPlugin extends Plugin {

    private static final String TAG = "NativeCastPlugin";

    private boolean sessionListenerBound = false;
    private String lastLoadedStreamUrl = "";
    private Boolean lastPlayState = null;
    private double lastSeekSeconds = -1;
    private int lastQueueIndex = -1;

    private final SessionManagerListener<CastSession> sessionListener =
        new SessionManagerListener<CastSession>() {
            @Override
            public void onSessionStarting(CastSession session) {
                emitSessionState("STARTING", null);
            }

            @Override
            public void onSessionStarted(CastSession session, String sessionId) {
                lastLoadedStreamUrl = "";
                lastPlayState = null;
                lastSeekSeconds = -1;
                lastQueueIndex = -1;
                emitSessionState("STARTED", session);
            }

            @Override
            public void onSessionStartFailed(CastSession session, int error) {
                emitSessionState("START_FAILED", session);
            }

            @Override
            public void onSessionEnding(CastSession session) {
                emitSessionState("ENDING", session);
            }

            @Override
            public void onSessionEnded(CastSession session, int error) {
                lastLoadedStreamUrl = "";
                lastPlayState = null;
                lastSeekSeconds = -1;
                lastQueueIndex = -1;
                emitSessionState("ENDED", null);
            }

            @Override
            public void onSessionResuming(CastSession session, String sessionId) {
                emitSessionState("RESUMING", session);
            }

            @Override
            public void onSessionResumed(CastSession session, boolean wasSuspended) {
                emitSessionState("RESUMED", session);
            }

            @Override
            public void onSessionResumeFailed(CastSession session, int error) {
                emitSessionState("RESUME_FAILED", session);
            }

            @Override
            public void onSessionSuspended(CastSession session, int reason) {
                emitSessionState("SUSPENDED", session);
            }
        };

    @Override
    public void load() {
        try {
            CastContext.getSharedInstance(getContext());
            bindSessionListener();
        } catch (Exception e) {
            Log.w(TAG, "CastContext unavailable — Google Play services required", e);
        }
    }

    private void bindSessionListener() {
        if (sessionListenerBound) return;
        try {
            SessionManager manager = CastContext.getSharedInstance(getContext()).getSessionManager();
            manager.addSessionManagerListener(sessionListener, CastSession.class);
            sessionListenerBound = true;
            CastSession current = manager.getCurrentCastSession();
            if (current != null && current.isConnected()) {
                emitSessionState("RESUMED", current);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to bind session listener", e);
        }
    }

    private void emitSessionState(String state, @Nullable CastSession session) {
        if (bridge == null) return;
        JSObject payload = new JSObject();
        boolean connected =
            session != null &&
            session.isConnected() &&
            !"ENDED".equals(state) &&
            !"START_FAILED".equals(state) &&
            !"RESUME_FAILED".equals(state);
        payload.put("connected", connected);
        payload.put("sessionState", state);
        if (session != null && session.getCastDevice() != null) {
            payload.put("deviceName", session.getCastDevice().getFriendlyName());
        } else {
            payload.put("deviceName", JSONObject.NULL);
        }
        notifyListeners("sessionStateChanged", payload);
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        String appId = call.getString("receiverApplicationId");
        if (appId != null && !appId.isEmpty()) {
            CastOptionsProvider.saveReceiverAppId(getContext(), appId);
        }
        try {
            CastContext.getSharedInstance(getContext());
            bindSessionListener();
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("error", "Google Cast unavailable. Install or update Google Play services.");
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            CastContext.getSharedInstance(getContext());
            ret.put("available", true);
        } catch (Exception e) {
            ret.put("available", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void showDevicePicker(PluginCall call) {
        if (getActivity() == null) {
            call.reject("Activity unavailable");
            return;
        }
        getActivity()
            .runOnUiThread(() -> {
                try {
                    MediaRouteSelector selector = CastContext.getSharedInstance(getContext()).getMergedSelector();
                    MediaRouteChooserDialog dialog = new MediaRouteChooserDialog(getContext());
                    dialog.setRouteSelector(selector);
                    dialog.show();
                    call.resolve();
                } catch (Exception e) {
                    call.reject(e.getMessage() != null ? e.getMessage() : "Cast picker failed");
                }
            });
    }

    @PluginMethod
    public void requestSession(PluginCall call) {
        if (getActivity() == null) {
            call.reject("Activity unavailable");
            return;
        }
        getActivity()
            .runOnUiThread(() -> {
                try {
                    SessionManager manager = CastContext.getSharedInstance(getContext()).getSessionManager();
                    CastSession current = manager.getCurrentCastSession();
                    if (current != null && current.isConnected()) {
                        resolveSessionOk(call, current);
                        return;
                    }
                    MediaRouteSelector selector = CastContext.getSharedInstance(getContext()).getMergedSelector();
                    MediaRouteChooserDialog dialog = new MediaRouteChooserDialog(getContext());
                    dialog.setRouteSelector(selector);
                    dialog.setOnDismissListener(d -> {
                        CastSession session = manager.getCurrentCastSession();
                        if (session != null && session.isConnected()) {
                            resolveSessionOk(call, session);
                        } else {
                            JSObject ret = new JSObject();
                            ret.put("ok", false);
                            ret.put("code", "cancelled");
                            ret.put("error", "Cast picker cancelled — no device selected.");
                            call.resolve(ret);
                        }
                    });
                    dialog.show();
                } catch (Exception e) {
                    JSObject ret = new JSObject();
                    ret.put("ok", false);
                    ret.put("code", "request_failed");
                    ret.put(
                        "error",
                        e.getMessage() != null
                            ? e.getMessage()
                            : "Could not open the Cast device picker."
                    );
                    call.resolve(ret);
                }
            });
    }

    private void resolveSessionOk(PluginCall call, CastSession session) {
        JSObject ret = new JSObject();
        ret.put("ok", true);
        ret.put(
            "deviceName",
            session.getCastDevice() != null ? session.getCastDevice().getFriendlyName() : "Cast device"
        );
        call.resolve(ret);
    }

    @PluginMethod
    public void endSession(PluginCall call) {
        try {
            CastContext.getSharedInstance(getContext()).getSessionManager().endCurrentSession(true);
        } catch (Exception ignored) {
            /* already ended */
        }
        lastLoadedStreamUrl = "";
        lastPlayState = null;
        lastSeekSeconds = -1;
        lastQueueIndex = -1;
        call.resolve();
    }

    @PluginMethod
    public void syncPlayback(PluginCall call) {
        try {
            CastSession session = CastContext.getSharedInstance(getContext()).getSessionManager().getCurrentCastSession();
            if (session == null || !session.isConnected()) {
                call.resolve();
                return;
            }
            RemoteMediaClient client = session.getRemoteMediaClient();
            if (client == null) {
                call.resolve();
                return;
            }

            String streamUrl = call.getString("streamUrl", "").trim();
            boolean isPlaying = Boolean.TRUE.equals(call.getBoolean("isPlaying", false));
            double currentTime = call.getDouble("currentTimeSeconds", 0d);
            double duration = call.getDouble("durationSeconds", 0d);
            String title = call.getString("title", "");
            String artist = call.getString("artist", "");
            String album = call.getString("album", "");
            String artworkUrl = call.getString("artworkUrl", "");
            Integer queueIndex = call.getInt("queueIndex");
            JSArray queueArray = call.getArray("queue");

            List<MediaQueueItem> queueItems = parseQueue(queueArray);
            boolean hasQueue = queueItems.size() > 1;
            int startIndex = queueIndex != null ? Math.max(0, queueIndex) : 0;
            if (startIndex >= queueItems.size()) startIndex = 0;

            if (hasQueue && (lastQueueIndex != startIndex || !streamUrl.equals(lastLoadedStreamUrl))) {
                client.queueLoad(
                    queueItems.toArray(new MediaQueueItem[0]),
                    startIndex,
                    MediaStatus.REPEAT_MODE_REPEAT_OFF,
                    (long) (currentTime * 1000),
                    null
                );
                lastLoadedStreamUrl = streamUrl;
                lastPlayState = isPlaying;
                lastSeekSeconds = currentTime;
                lastQueueIndex = startIndex;
                call.resolve();
                return;
            }

            if (!streamUrl.isEmpty() && !streamUrl.equals(lastLoadedStreamUrl)) {
                MediaInfo mediaInfo = buildMediaInfo(streamUrl, title, artist, album, artworkUrl, duration);
                client.load(
                    mediaInfo,
                    isPlaying,
                    (long) (currentTime * 1000),
                    null
                );
                lastLoadedStreamUrl = streamUrl;
                lastPlayState = isPlaying;
                lastSeekSeconds = currentTime;
                call.resolve();
                return;
            }

            if (streamUrl.isEmpty()) {
                call.resolve();
                return;
            }

            if (isPlaying != lastPlayState) {
                if (isPlaying) client.play();
                else client.pause();
                lastPlayState = isPlaying;
            }

            double seekDelta = Math.abs(currentTime - lastSeekSeconds);
            if (seekDelta > 2 && duration > 0) {
                client.seek((long) (currentTime * 1000));
                lastSeekSeconds = currentTime;
            }

            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "syncPlayback failed", e);
            call.resolve();
        }
    }

    private List<MediaQueueItem> parseQueue(@Nullable JSArray queueArray) {
        List<MediaQueueItem> items = new ArrayList<>();
        if (queueArray == null) return items;
        for (int i = 0; i < queueArray.length(); i++) {
            try {
                JSObject row = JSObject.fromJSONObject(queueArray.getJSONObject(i));
                if (row == null) continue;
                String url = row.getString("streamUrl", "").trim();
                if (url.isEmpty()) continue;
                String title = row.getString("title", "");
                String artist = row.getString("artist", "");
                String album = row.getString("album", "");
                String art = row.getString("artworkUrl", "");
                double dur = row.optDouble("durationSeconds", 0d);
                items.add(buildQueueItem(url, title, artist, album, art, dur));
            } catch (Exception ignored) {
                /* skip bad row */
            }
        }
        return items;
    }

    private MediaQueueItem buildQueueItem(
        String streamUrl,
        String title,
        String artist,
        String album,
        String artworkUrl,
        double duration
    ) {
        MediaInfo info = buildMediaInfo(streamUrl, title, artist, album, artworkUrl, duration);
        return new MediaQueueItem.Builder(info).build();
    }

    private MediaInfo buildMediaInfo(
        String streamUrl,
        String title,
        String artist,
        String album,
        String artworkUrl,
        double duration
    ) {
        MediaMetadata metadata = new MediaMetadata(MediaMetadata.MEDIA_TYPE_MUSIC_TRACK);
        metadata.putString(MediaMetadata.KEY_TITLE, title);
        metadata.putString(MediaMetadata.KEY_ARTIST, artist);
        if (album != null && !album.isEmpty()) {
            metadata.putString(MediaMetadata.KEY_ALBUM_TITLE, album);
        }
        if (artworkUrl != null && !artworkUrl.isEmpty()) {
            metadata.addImage(new WebImage(Uri.parse(artworkUrl)));
        }

        MediaInfo.Builder builder = new MediaInfo.Builder(streamUrl)
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setContentType(guessContentType(streamUrl))
            .setMetadata(metadata);
        if (duration > 0) {
            builder.setStreamDuration((long) (duration * 1000));
        }
        return builder.build();
    }

    private String guessContentType(String url) {
        String lower = url.split("\\?")[0].toLowerCase();
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
        if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".flac")) return "audio/flac";
        if (lower.endsWith(".aac")) return "audio/aac";
        return "audio/mpeg";
    }
}
