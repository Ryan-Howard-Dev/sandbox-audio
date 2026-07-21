package rd.sheepskin.sandboxmusic;

import android.os.Bundle;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.session.MediaSessionCompat;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.media.MediaBrowserServiceCompat;
import androidx.media.utils.MediaConstants;
import java.util.ArrayList;
import java.util.List;

/**
 * Android Auto / Automotive browse entry point.
 *
 * Exposes locker albums, playlists, play queue, and voice search results as a
 * browsable media tree. Selecting a track forwards the media id to
 * {@link AndroidAutoPlugin} → JS playback engine.
 */
public class SandboxMediaBrowserService extends MediaBrowserServiceCompat {

    private static volatile SandboxMediaBrowserService runningInstance;

    private static boolean isAllowedMediaBrowserClient(String clientPackageName) {
        if (clientPackageName == null || clientPackageName.isEmpty()) {
            return false;
        }
        return clientPackageName.equals("com.google.android.projection.gearhead")
            || clientPackageName.equals("com.google.android.gms")
            || clientPackageName.startsWith("com.android.car")
            || clientPackageName.equals("rd.sheepskin.sandboxmusic");
    }

    @Nullable private MediaSessionCompat fallbackSession;

    public static void notifyBrowseChildrenChanged(String parentId) {
        SandboxMediaBrowserService instance = runningInstance;
        if (instance != null) {
            instance.notifyChildrenChanged(parentId);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        runningInstance = this;
        MediaSessionCompat.Token token = MediaPlaybackForegroundService.getMediaSessionToken();
        if (token != null) {
            setSessionToken(token);
            return;
        }
        fallbackSession = new MediaSessionCompat(this, "SandboxMusicAutoBrowse");
        fallbackSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        fallbackSession.setCallback(
            new MediaSessionCompat.Callback() {
                @Override
                public void onPlayFromMediaId(String mediaId, Bundle extras) {
                    AndroidAutoBridge.requestPlay(mediaId);
                }

                @Override
                public void onPlayFromSearch(String query, Bundle extras) {
                    AndroidAutoBridge.requestSearch(query);
                }
            }
        );
        fallbackSession.setActive(true);
        setSessionToken(fallbackSession.getSessionToken());
    }

    @Override
    public void onDestroy() {
        if (runningInstance == this) {
            runningInstance = null;
        }
        if (fallbackSession != null) {
            fallbackSession.setActive(false);
            fallbackSession.release();
            fallbackSession = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public BrowserRoot onGetRoot(
        @NonNull String clientPackageName,
        int clientUid,
        @Nullable Bundle rootHints
    ) {
        if (!isAllowedMediaBrowserClient(clientPackageName)) {
            return null;
        }
        Bundle extras = new Bundle();
        extras.putBoolean(MediaConstants.BROWSER_SERVICE_EXTRAS_KEY_SEARCH_SUPPORTED, true);
        return new BrowserRoot(AndroidAutoBridge.ROOT_ID, extras);
    }

    @Override
    public void onLoadChildren(
        @NonNull String parentId,
        @NonNull Result<List<MediaBrowserCompat.MediaItem>> result
    ) {
        if (AndroidAutoBridge.ROOT_ID.equals(parentId)) {
            result.sendResult(AndroidAutoBridge.buildRootChildren());
            return;
        }
        if (AndroidAutoBridge.QUEUE_ID.equals(parentId)) {
            result.sendResult(AndroidAutoBridge.buildQueueChildren());
            return;
        }
        if (AndroidAutoBridge.ALBUMS_ID.equals(parentId)) {
            result.sendResult(AndroidAutoBridge.buildAlbumsChildren());
            return;
        }
        if (AndroidAutoBridge.PLAYLISTS_ID.equals(parentId)) {
            result.sendResult(AndroidAutoBridge.buildPlaylistsChildren());
            return;
        }
        if (AndroidAutoBridge.SEARCH_ID.equals(parentId)) {
            result.sendResult(AndroidAutoBridge.buildSearchChildren());
            return;
        }
        List<AndroidAutoBridge.BrowseItem> tracks = AndroidAutoBridge.tracksForParent(parentId);
        if (tracks != null) {
            List<MediaBrowserCompat.MediaItem> children = new ArrayList<>();
            for (AndroidAutoBridge.BrowseItem item : tracks) {
                if (item.mediaId.isEmpty()) {
                    continue;
                }
                android.support.v4.media.MediaDescriptionCompat description =
                    new android.support.v4.media.MediaDescriptionCompat.Builder()
                        .setMediaId(item.mediaId)
                        .setTitle(item.title.isEmpty() ? "Unknown title" : item.title)
                        .setSubtitle(item.artist)
                        .setDescription(item.album)
                        .build();
                children.add(
                    new MediaBrowserCompat.MediaItem(
                        description,
                        MediaBrowserCompat.MediaItem.FLAG_PLAYABLE
                    )
                );
            }
            result.sendResult(children);
            return;
        }
        result.sendResult(new ArrayList<>());
    }

    @Override
    public void onSearch(
        @NonNull String query,
        @Nullable Bundle extras,
        @NonNull Result<List<MediaBrowserCompat.MediaItem>> result
    ) {
        result.detach();
        AndroidAutoBridge.requestSearch(query);
        List<MediaBrowserCompat.MediaItem> cached = AndroidAutoBridge.buildSearchChildren();
        if (!cached.isEmpty()) {
            result.sendResult(cached);
            return;
        }
        result.sendResult(new ArrayList<>());
    }

    @Override
    public void onLoadItem(String itemId, @NonNull Result<MediaBrowserCompat.MediaItem> result) {
        AndroidAutoBridge.BrowseItem item = AndroidAutoBridge.findBrowseItem(itemId);
        if (item == null) {
            result.sendResult(null);
            return;
        }
        android.support.v4.media.MediaDescriptionCompat description =
            new android.support.v4.media.MediaDescriptionCompat.Builder()
                .setMediaId(item.mediaId)
                .setTitle(item.title.isEmpty() ? "Unknown title" : item.title)
                .setSubtitle(item.artist)
                .setDescription(item.album)
                .build();
        result.sendResult(
            new MediaBrowserCompat.MediaItem(
                description,
                MediaBrowserCompat.MediaItem.FLAG_PLAYABLE
            )
        );
    }
}
