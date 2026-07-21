package rd.sheepskin.sandboxmusic;

import android.os.Bundle;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import androidx.annotation.Nullable;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * In-memory browse tree for Android Auto / Automotive media browsers.
 * Populated from the Capacitor WebView via {@link AndroidAutoPlugin}.
 */
public final class AndroidAutoBridge {

    public static final String ROOT_ID = "sandbox_root";
    public static final String QUEUE_ID = "sandbox_queue";
    public static final String ALBUMS_ID = "sandbox_albums";
    public static final String PLAYLISTS_ID = "sandbox_playlists";
    public static final String SEARCH_ID = "sandbox_search";
    public static final String ALBUM_PREFIX = "sandbox_album:";
    public static final String PLAYLIST_PREFIX = "sandbox_playlist:";

    public static final class BrowseItem {
        public final String mediaId;
        public final String title;
        public final String artist;
        @Nullable public final String album;

        public BrowseItem(String mediaId, String title, String artist, @Nullable String album) {
            this.mediaId = mediaId != null ? mediaId : "";
            this.title = title != null ? title : "";
            this.artist = artist != null ? artist : "";
            this.album = album;
        }
    }

    public static final class FolderNode {
        public final String id;
        public final String title;
        public final String subtitle;

        public FolderNode(String id, String title, String subtitle) {
            this.id = id != null ? id : "";
            this.title = title != null ? title : "";
            this.subtitle = subtitle != null ? subtitle : "";
        }
    }

    public interface PlayRequestListener {
        void onPlayFromMediaId(String mediaId);
    }

    public interface SearchRequestListener {
        void onSearchQuery(String query);
    }

    private static final CopyOnWriteArrayList<BrowseItem> queueItems = new CopyOnWriteArrayList<>();
    private static final CopyOnWriteArrayList<FolderNode> albumFolders = new CopyOnWriteArrayList<>();
    private static final CopyOnWriteArrayList<FolderNode> playlistFolders = new CopyOnWriteArrayList<>();
    private static final Map<String, List<BrowseItem>> albumTracks = new LinkedHashMap<>();
    private static final Map<String, List<BrowseItem>> playlistTracks = new LinkedHashMap<>();
    private static final CopyOnWriteArrayList<BrowseItem> searchItems = new CopyOnWriteArrayList<>();
    private static volatile PlayRequestListener playRequestListener;
    private static volatile SearchRequestListener searchRequestListener;
    private static volatile String pendingSearchQuery;

    private AndroidAutoBridge() {}

    public static void setQueueItems(List<BrowseItem> items) {
        queueItems.clear();
        if (items != null) {
            queueItems.addAll(items);
        }
        notifyBrowseChanged(ROOT_ID);
        notifyBrowseChanged(QUEUE_ID);
    }

    public static void setLibraryBrowse(
        List<FolderNode> albums,
        Map<String, List<BrowseItem>> albumTrackMap,
        List<FolderNode> playlists,
        Map<String, List<BrowseItem>> playlistTrackMap
    ) {
        albumFolders.clear();
        albumTracks.clear();
        playlistFolders.clear();
        playlistTracks.clear();
        if (albums != null) {
            albumFolders.addAll(albums);
        }
        if (albumTrackMap != null) {
            albumTracks.putAll(albumTrackMap);
        }
        if (playlists != null) {
            playlistFolders.addAll(playlists);
        }
        if (playlistTrackMap != null) {
            playlistTracks.putAll(playlistTrackMap);
        }
        notifyBrowseChanged(ROOT_ID);
        notifyBrowseChanged(ALBUMS_ID);
        for (FolderNode node : albumFolders) {
            notifyBrowseChanged(node.id);
        }
        notifyBrowseChanged(PLAYLISTS_ID);
        for (FolderNode node : playlistFolders) {
            notifyBrowseChanged(node.id);
        }
    }

    public static void setSearchResults(List<BrowseItem> items) {
        searchItems.clear();
        if (items != null) {
            searchItems.addAll(items);
        }
        notifyBrowseChanged(ROOT_ID);
        notifyBrowseChanged(SEARCH_ID);
    }

    public static List<BrowseItem> getQueueItems() {
        return Collections.unmodifiableList(new ArrayList<>(queueItems));
    }

    public static void setPlayRequestListener(@Nullable PlayRequestListener listener) {
        playRequestListener = listener;
    }

    public static void setSearchRequestListener(@Nullable SearchRequestListener listener) {
        searchRequestListener = listener;
    }

    public static void requestPlay(String mediaId) {
        if (mediaId == null || mediaId.isEmpty()) {
            return;
        }
        PlayRequestListener listener = playRequestListener;
        if (listener != null) {
            listener.onPlayFromMediaId(mediaId);
        }
    }

    public static void requestSearch(String query) {
        if (query == null || query.trim().isEmpty()) {
            return;
        }
        pendingSearchQuery = query.trim();
        SearchRequestListener listener = searchRequestListener;
        if (listener != null) {
            listener.onSearchQuery(pendingSearchQuery);
        }
    }

    @Nullable
    public static String consumePendingSearchQuery() {
        String query = pendingSearchQuery;
        pendingSearchQuery = null;
        return query;
    }

    private static void notifyBrowseChanged(String parentId) {
        SandboxMediaBrowserService.notifyBrowseChildrenChanged(parentId);
    }

    public static List<MediaBrowserCompat.MediaItem> buildRootChildren() {
        List<MediaBrowserCompat.MediaItem> children = new ArrayList<>();
        if (!queueItems.isEmpty()) {
            children.add(buildBrowsable(QUEUE_ID, "Play Queue", queueItems.size() + " tracks"));
        }
        if (!albumFolders.isEmpty()) {
            children.add(
                buildBrowsable(ALBUMS_ID, "Locker Albums", albumFolders.size() + " albums")
            );
        }
        if (!playlistFolders.isEmpty()) {
            children.add(
                buildBrowsable(PLAYLISTS_ID, "Playlists", playlistFolders.size() + " playlists")
            );
        }
        if (!searchItems.isEmpty()) {
            children.add(
                buildBrowsable(SEARCH_ID, "Search Results", searchItems.size() + " tracks")
            );
        }
        return children;
    }

    public static List<MediaBrowserCompat.MediaItem> buildQueueChildren() {
        return buildPlayableItems(queueItems);
    }

    public static List<MediaBrowserCompat.MediaItem> buildAlbumsChildren() {
        List<MediaBrowserCompat.MediaItem> children = new ArrayList<>();
        for (FolderNode folder : albumFolders) {
            if (folder.id.isEmpty()) {
                continue;
            }
            List<BrowseItem> tracks = albumTracks.get(folder.id);
            int count = tracks != null ? tracks.size() : 0;
            children.add(buildBrowsable(folder.id, folder.title, folder.subtitle, count));
        }
        return children;
    }

    public static List<MediaBrowserCompat.MediaItem> buildPlaylistsChildren() {
        List<MediaBrowserCompat.MediaItem> children = new ArrayList<>();
        for (FolderNode folder : playlistFolders) {
            if (folder.id.isEmpty()) {
                continue;
            }
            List<BrowseItem> tracks = playlistTracks.get(folder.id);
            int count = tracks != null ? tracks.size() : 0;
            children.add(
                buildBrowsable(folder.id, folder.title, count + " tracks")
            );
        }
        return children;
    }

    public static List<MediaBrowserCompat.MediaItem> buildSearchChildren() {
        return buildPlayableItems(searchItems);
    }

    @Nullable
    public static List<BrowseItem> tracksForParent(String parentId) {
        if (parentId.startsWith(ALBUM_PREFIX)) {
            return albumTracks.get(parentId);
        }
        if (parentId.startsWith(PLAYLIST_PREFIX)) {
            return playlistTracks.get(parentId);
        }
        return null;
    }

    @Nullable
    public static BrowseItem findBrowseItem(String mediaId) {
        for (BrowseItem item : queueItems) {
            if (mediaId.equals(item.mediaId)) {
                return item;
            }
        }
        for (List<BrowseItem> tracks : albumTracks.values()) {
            for (BrowseItem item : tracks) {
                if (mediaId.equals(item.mediaId)) {
                    return item;
                }
            }
        }
        for (List<BrowseItem> tracks : playlistTracks.values()) {
            for (BrowseItem item : tracks) {
                if (mediaId.equals(item.mediaId)) {
                    return item;
                }
            }
        }
        for (BrowseItem item : searchItems) {
            if (mediaId.equals(item.mediaId)) {
                return item;
            }
        }
        return null;
    }

    private static MediaBrowserCompat.MediaItem buildBrowsable(
        String mediaId,
        String title,
        String subtitle
    ) {
        return buildBrowsable(mediaId, title, subtitle, 0);
    }

    private static MediaBrowserCompat.MediaItem buildBrowsable(
        String mediaId,
        String title,
        String subtitle,
        int trackCount
    ) {
        Bundle extras = new Bundle();        if (trackCount > 0) {
            extras.putInt(MediaDescriptionCompat.EXTRA_BT_FOLDER_TYPE, 0);
        }
        MediaDescriptionCompat description = new MediaDescriptionCompat.Builder()
            .setMediaId(mediaId)
            .setTitle(title.isEmpty() ? "Unknown" : title)
            .setSubtitle(subtitle)
            .setExtras(extras)
            .build();
        return new MediaBrowserCompat.MediaItem(
            description,
            MediaBrowserCompat.MediaItem.FLAG_BROWSABLE
        );
    }

    private static List<MediaBrowserCompat.MediaItem> buildPlayableItems(List<BrowseItem> items) {
        List<MediaBrowserCompat.MediaItem> children = new ArrayList<>();
        for (BrowseItem item : items) {
            if (item.mediaId.isEmpty()) {
                continue;
            }
            MediaDescriptionCompat description = new MediaDescriptionCompat.Builder()
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
        return children;
    }
}
