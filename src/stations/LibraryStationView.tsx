import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Album,
  ChevronLeft,
  Loader2,
  Music2,
  Plus,
  Radio,
  Search,
  Server,
  Trash2,
} from 'lucide-react';
import OfflineStatusBanner from '../components/OfflineStatusBanner';
import { useTranslation } from '../i18n';
import { pingLibraryServer } from '../library/libraryApi';
import {
  fetchLibraryAlbums,
  fetchLibraryAlbumTracks,
  fetchLibraryPlaylists,
  fetchLibraryPlaylistTracks,
  libraryTrackToEnvelope,
  libraryTracksToEnvelopes,
  searchLibrary,
  type LibraryAlbum,
  type LibraryPlaylist,
  type LibraryTrack,
} from '../library/libraryBrowse';
import {
  loadLibraryServers,
  removeLibraryServer,
  subscribeLibraryServers,
  upsertLibraryServer,
  type LibraryServerConfig,
  type LibraryServerType,
} from '../library/libraryServerSettings';
import type { MediaEnvelope } from '../sandboxLayer1';
import { seedGradient } from '../seedGradient';
import { tier34HealthOk } from '../tier34/client';

export interface LibraryStationViewProps {
  onPlay: (env: MediaEnvelope) => void;
  onPlayAlbum: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
}

type LibraryView = 'home' | 'album' | 'playlist' | 'search';

function ServerBadge({ type }: { type: LibraryServerType }) {
  const label = type === 'jellyfin' ? 'Jellyfin' : 'Navidrome';
  return (
    <span className="font-mono text-[9px] uppercase tracking-widest px-2 py-0.5 rounded border border-[var(--border)] text-[var(--text-mid)]">
      {label}
    </span>
  );
}

function AlbumCard({
  album,
  onOpen,
}: {
  album: LibraryAlbum;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-elevated)] hover:border-accent/40 transition-colors touch-manipulation"
    >
      <div
        className="aspect-square w-full"
        style={{ background: seedGradient(`${album.artist}-${album.title}`) }}
      />
      <div className="p-3 space-y-0.5">
        <p className="text-sm font-semibold truncate">{album.title}</p>
        <p className="text-xs text-[var(--text-mid)] truncate">{album.artist}</p>
      </div>
    </button>
  );
}

export default function LibraryStationView({ onPlay, onPlayAlbum }: LibraryStationViewProps) {
  const { t } = useTranslation();
  const [servers, setServers] = useState<LibraryServerConfig[]>(() => loadLibraryServers());
  const [activeServerId, setActiveServerId] = useState<string | null>(
    () => loadLibraryServers()[0]?.id ?? null,
  );
  const [view, setView] = useState<LibraryView>('home');
  const [albums, setAlbums] = useState<LibraryAlbum[]>([]);
  const [playlists, setPlaylists] = useState<LibraryPlaylist[]>([]);
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [detailTitle, setDetailTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tier34Up, setTier34Up] = useState<boolean | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{
    albums: LibraryAlbum[];
    tracks: LibraryTrack[];
  } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    type: 'navidrome' as LibraryServerType,
    baseUrl: '',
    username: '',
    password: '',
  });

  const activeServer = useMemo(
    () => servers.find((s) => s.id === activeServerId) ?? servers[0] ?? null,
    [servers, activeServerId],
  );

  useEffect(() => subscribeLibraryServers(() => setServers(loadLibraryServers())), []);

  useEffect(() => {
    void tier34HealthOk().then(setTier34Up);
  }, []);

  const ensureServerAuth = useCallback(async (server: LibraryServerConfig): Promise<LibraryServerConfig> => {
    if (server.type === 'jellyfin' && server.accessToken && server.userId) return server;
    const ping = await pingLibraryServer(server);
    if (ping.accessToken || ping.userId) {
      const updated = upsertLibraryServer({
        ...server,
        accessToken: ping.accessToken ?? server.accessToken,
        userId: ping.userId ?? server.userId,
      });
      return updated;
    }
    return server;
  }, []);

  const loadHome = useCallback(async (server: LibraryServerConfig) => {
    setLoading(true);
    setError(null);
    try {
      const ready = await ensureServerAuth(server);
      const [albumRows, playlistRows] = await Promise.all([
        fetchLibraryAlbums(ready, 48),
        fetchLibraryPlaylists(ready),
      ]);
      setAlbums(albumRows);
      setPlaylists(playlistRows);
      setView('home');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [ensureServerAuth]);

  useEffect(() => {
    if (!activeServer || tier34Up === false) return;
    if (tier34Up === null) return;
    void loadHome(activeServer);
  }, [activeServer, tier34Up, loadHome]);

  const openAlbum = useCallback(
    async (album: LibraryAlbum) => {
      if (!activeServer) return;
      setLoading(true);
      setError(null);
      try {
        const ready = await ensureServerAuth(activeServer);
        const rows = await fetchLibraryAlbumTracks(ready, album.id);
        setTracks(rows);
        setDetailTitle(album.title);
        setView('album');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [activeServer, ensureServerAuth],
  );

  const openPlaylist = useCallback(
    async (playlist: LibraryPlaylist) => {
      if (!activeServer) return;
      setLoading(true);
      setError(null);
      try {
        const ready = await ensureServerAuth(activeServer);
        const rows = await fetchLibraryPlaylistTracks(ready, playlist.id);
        setTracks(rows);
        setDetailTitle(playlist.name);
        setView('playlist');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [activeServer, ensureServerAuth],
  );

  const playTrack = useCallback(
    async (track: LibraryTrack) => {
      if (!activeServer) return;
      const ready = await ensureServerAuth(activeServer);
      const env = await libraryTrackToEnvelope(ready, track);
      onPlay(env);
    },
    [activeServer, ensureServerAuth, onPlay],
  );

  const playAllTracks = useCallback(
    async (shuffle = false) => {
      if (!activeServer || tracks.length === 0) return;
      const ready = await ensureServerAuth(activeServer);
      const envs = await libraryTracksToEnvelopes(ready, tracks);
      onPlayAlbum(envs, shuffle);
    },
    [activeServer, ensureServerAuth, tracks, onPlayAlbum],
  );

  const runSearch = useCallback(async () => {
    if (!activeServer || !searchQuery.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const ready = await ensureServerAuth(activeServer);
      const results = await searchLibrary(ready, searchQuery.trim());
      setSearchResults({ albums: results.albums, tracks: results.tracks });
      setView('search');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeServer, ensureServerAuth, searchQuery]);

  const handleAddServer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const draft = upsertLibraryServer({
        name: form.name || form.baseUrl,
        type: form.type,
        baseUrl: form.baseUrl,
        username: form.username,
        password: form.password,
      });
      const ready = await ensureServerAuth(draft);
      setServers(loadLibraryServers());
      setActiveServerId(ready.id);
      setShowAddForm(false);
      setForm({ name: '', type: 'navidrome', baseUrl: '', username: '', password: '' });
      await loadHome(ready);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [ensureServerAuth, form, loadHome]);

  if (tier34Up === false) {
    return (
      <div className="p-4 space-y-4 max-w-3xl mx-auto">
        <h1 className="font-display text-xl font-black uppercase tracking-wider">{t('library.title')}</h1>
        <OfflineStatusBanner message={t('library.tier34Required')} />
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="p-4 space-y-6 max-w-lg mx-auto">
        <div className="space-y-2">
          <h1 className="font-display text-xl font-black uppercase tracking-wider">{t('library.title')}</h1>
          <p className="text-sm text-[var(--text-mid)]">{t('library.emptyHint')}</p>
        </div>
        {showAddForm ? (
          <div className="space-y-3 border border-[var(--border)] rounded-xl p-4">
            <label className="block space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-mid)]">
                {t('library.serverType')}
              </span>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as LibraryServerType }))}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
              >
                <option value="navidrome">Navidrome (Subsonic)</option>
                <option value="jellyfin">Jellyfin</option>
              </select>
            </label>
            {(['name', 'baseUrl', 'username', 'password'] as const).map((field) => (
              <label key={field} className="block space-y-1">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-mid)]">
                  {t(`library.field.${field}`)}
                </span>
                <input
                  type={field === 'password' ? 'password' : 'text'}
                  value={form[field]}
                  onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                  placeholder={field === 'baseUrl' ? 'http://192.168.1.10:4533' : ''}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
                />
              </label>
            ))}
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleAddServer()}
                className="flex-1 rounded-lg bg-accent text-black font-semibold py-2 text-sm touch-manipulation"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : t('library.connect')}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 rounded-lg border border-[var(--border)] text-sm touch-manipulation"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 rounded-xl border border-dashed border-[var(--border)] px-4 py-3 text-sm w-full touch-manipulation hover:border-accent/50"
          >
            <Plus className="w-4 h-4" />
            {t('library.addServer')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-4 pb-3 border-b border-[var(--border)] space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-black uppercase tracking-wider">{t('library.title')}</h1>
            {activeServer ? (
              <div className="flex items-center gap-2 mt-1">
                <Server className="w-3.5 h-3.5 text-[var(--text-mid)]" />
                <span className="text-sm text-[var(--text-mid)] truncate">{activeServer.name}</span>
                <ServerBadge type={activeServer.type} />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="p-2 rounded-lg border border-[var(--border)] touch-manipulation"
            aria-label={t('library.addServer')}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {servers.length > 1 ? (
          <select
            value={activeServerId ?? ''}
            onChange={(e) => setActiveServerId(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
          >
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.type})
              </option>
            ))}
          </select>
        ) : null}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-mid)]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('library.searchPlaceholder')}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="px-4 rounded-lg border border-[var(--border)] text-sm touch-manipulation"
          >
            {t('library.search')}
          </button>
        </form>

        {showAddForm ? (
          <div className="border border-[var(--border)] rounded-xl p-3 space-y-2">
            <select
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as LibraryServerType }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
            >
              <option value="navidrome">Navidrome</option>
              <option value="jellyfin">Jellyfin</option>
            </select>
            <input
              placeholder={t('library.field.baseUrl')}
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
            />
            <input
              placeholder={t('library.field.username')}
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
            />
            <input
              type="password"
              placeholder={t('library.field.password')}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleAddServer()}
              className="w-full rounded-lg bg-accent text-black font-semibold py-2 text-sm"
            >
              {t('library.connect')}
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="px-4 py-2 text-sm text-red-400 border-b border-[var(--border)]">{error}</div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-y-auto music-scrollbar p-4 space-y-6">
        {view !== 'home' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setView('home');
                setTracks([]);
                setSearchResults(null);
              }}
              className="p-2 rounded-lg border border-[var(--border)] touch-manipulation"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <h2 className="font-semibold truncate">{detailTitle}</h2>
            {(view === 'album' || view === 'playlist') && tracks.length > 0 ? (
              <button
                type="button"
                onClick={() => void playAllTracks(false)}
                className="ml-auto text-xs font-mono uppercase tracking-widest text-accent touch-manipulation"
              >
                {t('library.playAll')}
              </button>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        ) : null}

        {!loading && view === 'home' ? (
          <>
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Album className="w-4 h-4 text-accent" />
                <h2 className="font-mono text-[10px] uppercase tracking-widest">{t('library.recentAlbums')}</h2>
              </div>
              {albums.length === 0 ? (
                <p className="text-sm text-[var(--text-mid)]">{t('library.noAlbums')}</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {albums.map((album) => (
                    <div key={album.id}>
                      <AlbumCard album={album} onOpen={() => void openAlbum(album)} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {playlists.length > 0 ? (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-accent" />
                  <h2 className="font-mono text-[10px] uppercase tracking-widest">{t('library.playlists')}</h2>
                </div>
                <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl overflow-hidden">
                  {playlists.map((pl) => (
                    <li key={pl.id}>
                      <button
                        type="button"
                        onClick={() => void openPlaylist(pl)}
                        className="w-full text-left px-4 py-3 hover:bg-[var(--bg-elevated)] touch-manipulation"
                      >
                        <p className="font-medium truncate">{pl.name}</p>
                        {pl.songCount != null ? (
                          <p className="text-xs text-[var(--text-mid)]">
                            {t('library.trackCount', { count: pl.songCount })}
                          </p>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}

        {!loading && view === 'search' && searchResults ? (
          <div className="space-y-6">
            {searchResults.albums.length > 0 ? (
              <section className="space-y-2">
                <h3 className="font-mono text-[10px] uppercase tracking-widest">{t('library.albums')}</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {searchResults.albums.map((album) => (
                    <div key={album.id}>
                      <AlbumCard album={album} onOpen={() => void openAlbum(album)} />
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {searchResults.tracks.length > 0 ? (
              <section className="space-y-2">
                <h3 className="font-mono text-[10px] uppercase tracking-widest">{t('library.tracks')}</h3>
                <TrackList tracks={searchResults.tracks} onPlay={(track) => void playTrack(track)} />
              </section>
            ) : null}
          </div>
        ) : null}

        {!loading && (view === 'album' || view === 'playlist') ? (
          <TrackList tracks={tracks} onPlay={(track) => void playTrack(track)} />
        ) : null}
      </div>

      {activeServer ? (
        <div className="px-4 py-3 border-t border-[var(--border)]">
          <button
            type="button"
            onClick={() => {
              removeLibraryServer(activeServer.id);
              const next = loadLibraryServers();
              setServers(next);
              setActiveServerId(next[0]?.id ?? null);
            }}
            className="flex items-center gap-2 text-xs text-[var(--text-mid)] hover:text-red-400 touch-manipulation"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('library.removeServer')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TrackList({
  tracks,
  onPlay,
}: {
  tracks: LibraryTrack[];
  onPlay: (track: LibraryTrack) => void;
}) {
  return (
    <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl overflow-hidden">
      {tracks.map((track) => (
        <li key={track.id}>
          <button
            type="button"
            onClick={() => onPlay(track)}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--bg-elevated)] touch-manipulation"
          >
            <Music2 className="w-4 h-4 shrink-0 text-[var(--text-mid)]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{track.title}</p>
              <p className="text-xs text-[var(--text-mid)] truncate">{track.artist}</p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
