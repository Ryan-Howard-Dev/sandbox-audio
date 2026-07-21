/**
 * Sandbox Music — Tier 3 & 4 Extraction Backend
 * Default: http://localhost:3001
 */
import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import {
  acousticFingerprint,
  fetchAudioSample,
  sonicDnaVector,
  spectralEntropyFromBuffer,
  qmHash,
} from './lib/utils.js';
import { identifyAudioBuffer, isFpcalcAvailable, lookupAcoustId } from './lib/acoustid.js';
import { readBlob } from './lib/lockerStorage.js';
import { searchProxyTier, searchDebridTier } from './lib/search.js';
import { resolveProxyCandidates, proxyStreamUpstream, ytdlpAvailable } from './lib/proxyResolve.js';
import {
  fetchYoutubePodcastFeed,
  isYoutubePodcastListUrl,
} from './lib/podcastYoutube.js';
import {
  fetchTrendingPodcastShows,
  searchPodcastCatalogEpisodes,
  searchPodcastCatalogShows,
} from './lib/podcastCatalog.js';
import {
  fetchAudiobookCatalogChapters,
  searchAudiobookCatalog,
} from './lib/audiobookCatalog.js';
import { fetchPodcastFeedXml, podcastFeedUrlAllowed } from './lib/podcastFeedProxy.js';
import { fetchPodcastEpisodeMeta } from './lib/podcastEpisodeMeta.js';
import {
  resolveDebridCandidates,
  testProwlarrConnection,
  testRealDebridConnection,
} from './lib/debridResolve.js';
import { isAllowedProxyStreamUrl, isAllowedRadioStreamUrl } from './lib/urlValidation.js';
import {
  buildFeed,
  buildMixes,
  buildVideos,
  dhtResolve,
} from './lib/pipelines.js';
import {
  resolveAudiusAddon,
  resolveIpfsAddon,
  resolveRadioBrowserAddon,
  resolveSoundCloudAddon,
  resolveWebTorrentAddon,
} from './lib/addonResolve.js';
import {
  isSoulseekConfigured,
  parseSoulseekStreamQuery,
  readSoulseekDownloadBuffer,
  resolveSoulseekAddon,
  slskdReachable,
} from './lib/soulseek.js';
import {
  completeOAuthCallback,
  fetchProviderPlaylists,
  getOAuthAuthorizeUrl,
} from './lib/oauth.js';
import { createAcquireJob, getAcquireJob, initJobWorker, kickJobWorker } from './lib/acquireWorker.js';
import {
  blobExists,
  loadMasterManifest,
  mergeManifest,
  quarantineCorruptBlob,
  saveBlob,
  sha256HexFile,
  type LockerSyncManifest,
} from './lib/lockerStorage.js';
import { blobPathForHash, LOCKER_BLOBS_DIR, LOCKER_STORAGE_ROOT } from './lib/lockerPaths.js';
import { createReadStream } from 'node:fs';
import { backfillFromManifest, getGraphStats, getSourcesForEnvelope } from './lib/mediaGraph.js';
import { enqueueHealBlobJob } from './lib/jobQueue.js';
import { meilisearchAvailable, reindexTracks, searchTracks } from './lib/meilisearchIndexer.js';
import {
  bootIngestionWatcher,
  getWatchStatus,
  loadWatchConfig,
  setWatchConfig,
} from './lib/ingestionWatcher.js';
import { initIngestPump } from './lib/ingestFileWorker.js';
import { registerCastRoutes } from './routes/cast.js';
import { registerStreamFullRoutes } from './routes/streamFull.js';
import { registerCacheStageRoutes } from './routes/cacheStage.js';
import { registerDlnaRoutes } from './routes/dlna.js';
import { registerSubsonicRoutes } from './routes/subsonic.js';
import { registerLibraryRoutes } from './routes/library.js';
import { registerStemsRoutes } from './routes/stems.js';
import { registerPlatformRoutes } from './routes/platform.js';
import { registerPodcastMirrorRoutes } from './routes/podcastMirror.js';
import { registerPodcastTranscriptRoutes } from './routes/podcastTranscript.js';
import { registerPodcastRulesRoutes } from './routes/podcastRules.js';
import { initPodcastMirrorScheduler } from './lib/podcastMirrorScheduler.js';
import { initPodcastTranscriptScheduler } from './lib/podcastTranscriptScheduler.js';
import { loadTasteShareManifest, storeTasteShareManifest } from './lib/tasteShareStorage.js';
import {
  loadPlaylistShare,
  publicPlaylistShareRow,
  storePlaylistShareManifest,
  updatePlaylistShareManifest,
  type SharedPlaylistManifest,
} from './lib/playlistShareStorage.js';
import {
  bootDefenseProtocol,
  getDefenseProtocolStatus,
  isDefenseProtocolEnabled,
  setDefenseProtocolOptions,
  type InterminableTideMode,
} from './lib/defenseProtocol.js';
import { maybeApplyInterminableTide, registerInterminableTideRoutes } from './lib/interminableTide.js';
import { resolveBestReadPath } from './lib/tmpfsStageCache.js';
import {
  getIndexerStatus,
  loadIndexerConfig,
  saveIndexerConfig,
  searchSandboxIndexer,
  type TorznabEndpoint,
} from './lib/sandboxIndexer.js';
import {
  getDeviceSecretsPayload,
  mergeDeviceSecrets,
  verifyDeviceSyncAuth,
} from './lib/deviceSecrets.js';

dotenv.config();
bootDefenseProtocol();

const PORT = Number(process.env.TIER34_PORT) || 3001;
const CORS_ORIGIN = process.env.TIER34_CORS_ORIGIN ?? 'http://localhost:3002';
const app = express();
app.use(express.json({ limit: '2mb' }));

app.use((_req, res, next) => {
  const origin = _req.headers.origin;
  if (!isDefenseProtocolEnabled()) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin === CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Sandbox-Token, X-Sandbox-Client, X-Tier34-Device-Sync',
  );
  next();
});

app.options('*', (_req, res) => res.sendStatus(204));

app.get('/health', async (_req, res) => {
  const [meilisearch, ytdlp, fpcalc] = await Promise.all([
    meilisearchAvailable(),
    ytdlpAvailable(),
    isFpcalcAvailable(),
  ]);
  res.json({
    ok: true,
    service: 'sandbox-tier34',
    version: '1.0.0',
    meilisearch,
    ytdlp,
    acoustid: {
      fpcalc,
      apiKeyConfigured: Boolean(process.env.ACOUSTID_API_KEY?.trim()),
    },
    features: [
      'spectral-entropy',
      'acoustic-fingerprint',
      'stem-failover',
      'stem-analyze',
      'sonic-dna',
      'dht-resolve',
      'dead-source-heal',
      'oauth-bridges',
      'proxy-search',
      'proxy-resolve',
      'proxy-stream',
      'podcast-youtube',
      'podcast-catalog',
      'podcast-feed',
      'podcast-mirror-lan',
      'podcast-transcripts-local',
      'podcast-rules-lan',
      'debrid-search',
      'debrid-resolve',
      'sandbox-indexer',
      'addon-soundcloud',
      'addon-webtorrent',
      'addon-ipfs',
      'addon-radio-browser',
      'addon-audius',
      'addon-soulseek',
      'proxy-piped',
      'feed-pipeline',
      'mixes-pipeline',
      'videos-pipeline',
      'peer-sync-ws',
      'locker-manifest',
      'locker-blobs',
      'acquire-worker',
      'media-graph',
      'job-queue',
      'blob-integrity',
      'heal-blob',
      'meilisearch',
      'ingestion-watcher',
      'opensubsonic-api',
      'library-proxy',
      'taste-share-lan',
      'playlist-share-lan',
      'cast-discover',
      'cast-stream',
      'stream-full',
      'tmpfs-stage-cache',
      'sonos-cast',
      'dlna-mediaserver',
      'interminable-tide',
      'device-secrets-sync',
    ],
  });
});

registerPodcastMirrorRoutes(app);
registerPodcastTranscriptRoutes(app);
registerPodcastRulesRoutes(app);
registerCastRoutes(app);
registerStreamFullRoutes(app);
registerCacheStageRoutes(app);
registerInterminableTideRoutes(app);
const dlnaEnabled = registerDlnaRoutes(app, PORT);
const subsonicEnabled = registerSubsonicRoutes(app, PORT);
registerLibraryRoutes(app);
registerStemsRoutes(app);
registerPlatformRoutes(app);

app.get('/api/ingestion/watch', (_req, res) => {
  try {
    res.json(loadWatchConfig());
  } catch (e) {
    console.error('[tier34] ingestion watch get', e);
    res.status(500).json({ error: 'watch config read failed' });
  }
});

app.post('/api/ingestion/watch', (req, res) => {
  const enabled = req.body?.enabled;
  const watchPath = req.body?.path;
  try {
    const status = setWatchConfig({
      ...(typeof enabled === 'boolean' ? { enabled } : {}),
      ...(typeof watchPath === 'string' ? { path: watchPath } : {}),
    });
    res.json(status);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[tier34] ingestion watch set', e);
    res.status(400).json({ error: msg });
  }
});

app.get('/api/security/defense-protocol', (_req, res) => {
  try {
    res.json(getDefenseProtocolStatus());
  } catch (e) {
    console.error('[tier34] defense protocol get', e);
    res.status(500).json({ error: 'defense protocol read failed' });
  }
});

/** Cross-device API key sync — stored on tier34 host (self-hosted trust model). */
app.get('/api/device/secrets', (req, res) => {
  const auth = verifyDeviceSyncAuth(req);
  if (auth.ok === false) return res.status(auth.status).json({ error: auth.error });
  try {
    res.json(getDeviceSecretsPayload());
  } catch (e) {
    console.error('[tier34] device secrets get', e);
    res.status(500).json({ error: 'device secrets read failed' });
  }
});

app.put('/api/device/secrets', (req, res) => {
  const auth = verifyDeviceSyncAuth(req);
  if (auth.ok === false) return res.status(auth.status).json({ error: auth.error });
  const incoming = req.body?.secrets;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ error: 'expected { secrets: { key: { value, updatedAt } } }' });
  }
  try {
    const merged = mergeDeviceSecrets(incoming);
    res.json({ ok: true, updatedAt: merged.updatedAt, secrets: merged.secrets });
  } catch (e) {
    console.error('[tier34] device secrets put', e);
    res.status(500).json({ error: 'device secrets merge failed' });
  }
});

app.patch('/api/security/defense-protocol', (req, res) => {
  const enabled = req.body?.enabled;
  const interminableTide = req.body?.interminableTide;
  const defenseStrict = req.body?.defenseStrict;
  if (
    enabled !== undefined &&
    typeof enabled !== 'boolean'
  ) {
    return res.status(400).json({ error: 'enabled must be boolean when provided' });
  }
  const tideModes: InterminableTideMode[] = ['off', 'chaff', 'jitter', 'both'];
  if (
    interminableTide !== undefined &&
    !tideModes.includes(interminableTide)
  ) {
    return res.status(400).json({ error: 'interminableTide must be off|chaff|jitter|both' });
  }
  if (defenseStrict !== undefined && typeof defenseStrict !== 'boolean') {
    return res.status(400).json({ error: 'defenseStrict must be boolean when provided' });
  }
  if (
    enabled === undefined &&
    interminableTide === undefined &&
    defenseStrict === undefined
  ) {
    return res.status(400).json({ error: 'expected at least one of enabled, interminableTide, defenseStrict' });
  }
  try {
    const row = setDefenseProtocolOptions({
      ...(typeof enabled === 'boolean' ? { enabled } : {}),
      ...(tideModes.includes(interminableTide as InterminableTideMode)
        ? { interminableTide: interminableTide as InterminableTideMode }
        : {}),
      ...(typeof defenseStrict === 'boolean' ? { defenseStrict } : {}),
    });
    res.json({ ...getDefenseProtocolStatus(), updatedAt: row.updatedAt });
  } catch (e) {
    console.error('[tier34] defense protocol set', e);
    res.status(500).json({ error: 'defense protocol update failed' });
  }
});

/** LAN relay for Last.fm when the client is air-gapped but tier34 has WAN. */
app.post('/api/scrobble/relay', async (req, res) => {
  const method = String(req.body?.method ?? '').trim();
  const params = req.body?.params;
  const apiKey = String(req.body?.apiKey ?? '').trim();
  const sessionKey = String(req.body?.sessionKey ?? '').trim();
  if (!method || typeof params !== 'object' || !apiKey || !sessionKey) {
    return res.status(400).json({ error: 'method, params, apiKey, sessionKey required' });
  }
  const body = new URLSearchParams({
    method,
    api_key: apiKey,
    sk: sessionKey,
    format: 'json',
    ...Object.fromEntries(
      Object.entries(params as Record<string, string>).map(([k, v]) => [k, String(v)]),
    ),
  });
  try {
    const upstream = await fetch('https://ws.audioscrobbler.com/2.0/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await upstream.json();
    res.status(upstream.ok ? 200 : upstream.status).json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[tier34] scrobble relay', e);
    res.status(502).json({ error: msg });
  }
});

app.get('/api/media-graph/stats', (_req, res) => {
  try {
    res.json(getGraphStats());
  } catch (e) {
    console.error('[tier34] media graph stats', e);
    res.status(500).json({ error: 'media graph stats failed' });
  }
});

app.get('/api/media-graph/envelope/:id/sources', (req, res) => {
  const envelopeId = String(req.params.id ?? '').trim();
  if (!envelopeId) return res.status(400).json({ error: 'envelope id required' });
  try {
    const sources = getSourcesForEnvelope(envelopeId);
    res.json({ envelopeId, sources });
  } catch (e) {
    console.error('[tier34] envelope sources', e);
    res.status(500).json({ error: 'envelope sources failed' });
  }
});

app.get('/api/locker/storage-info', (_req, res) => {
  res.json({
    storageRoot: LOCKER_STORAGE_ROOT,
    blobsDir: LOCKER_BLOBS_DIR,
    configurableViaEnv: 'TIER34_STORAGE_PATH',
  });
});

app.get('/api/locker/manifest', (_req, res) => {
  try {
    res.json(loadMasterManifest());
  } catch (e) {
    console.error('[tier34] locker manifest get', e);
    res.status(500).json({ error: 'manifest read failed' });
  }
});

app.post('/api/locker/manifest', (req, res) => {
  const incoming = req.body as LockerSyncManifest;
  if (!incoming || !Array.isArray(incoming.entries)) {
    return res.status(400).json({ error: 'expected LockerSyncManifest { entries: [...] }' });
  }
  try {
    const merged = mergeManifest(incoming);
    res.json(merged);
  } catch (e) {
    console.error('[tier34] locker manifest merge', e);
    res.status(500).json({ error: 'manifest merge failed' });
  }
});

/** LAN-only taste recipe share — signed manifest JSON, no audio blobs. */
app.post('/api/taste/share', (req, res) => {
  const manifest = req.body?.manifest;
  if (!manifest || typeof manifest !== 'object') {
    return res.status(400).json({ error: 'expected { manifest: SignedTasteManifest }' });
  }
  try {
    const row = storeTasteShareManifest(manifest);
    res.json(row);
  } catch (e) {
    console.error('[tier34] taste share store', e);
    res.status(500).json({ error: 'taste share store failed' });
  }
});

app.get('/api/taste/:id', (req, res) => {
  const id = String(req.params.id ?? '').trim();
  try {
    const row = loadTasteShareManifest(id);
    if (!row) return res.status(404).json({ error: 'taste share not found' });
    res.json(row);
  } catch (e) {
    console.error('[tier34] taste share get', e);
    res.status(500).json({ error: 'taste share read failed' });
  }
});

/** LAN collaborative playlist share — JSON manifest + edit token (no audio). */
app.post('/api/playlists/share', (req, res) => {
  const manifest = req.body?.manifest as SharedPlaylistManifest | undefined;
  if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.name !== 'string') {
    return res.status(400).json({ error: 'expected { manifest: SharedPlaylistManifest }' });
  }
  try {
    const row = storePlaylistShareManifest(manifest);
    res.json({
      ...publicPlaylistShareRow(row),
      editToken: row.editToken,
    });
  } catch (e) {
    console.error('[tier34] playlist share store', e);
    res.status(500).json({ error: 'playlist share store failed' });
  }
});

app.get('/api/playlists/share/:id', (req, res) => {
  const id = String(req.params.id ?? '').trim();
  try {
    const row = loadPlaylistShare(id);
    if (!row) return res.status(404).json({ error: 'playlist share not found' });
    res.json(publicPlaylistShareRow(row));
  } catch (e) {
    console.error('[tier34] playlist share get', e);
    res.status(500).json({ error: 'playlist share read failed' });
  }
});

app.put('/api/playlists/share/:id', (req, res) => {
  const id = String(req.params.id ?? '').trim();
  const editToken = String(req.headers['x-playlist-edit-token'] ?? req.body?.editToken ?? '').trim();
  const manifest = req.body?.manifest as SharedPlaylistManifest | undefined;
  if (!editToken) {
    return res.status(401).json({ error: 'missing edit token' });
  }
  if (!manifest || manifest.schemaVersion !== 1) {
    return res.status(400).json({ error: 'expected { manifest: SharedPlaylistManifest }' });
  }
  try {
    const result = updatePlaylistShareManifest(id, editToken, manifest);
    if (result === 'forbidden') return res.status(403).json({ error: 'invalid edit token' });
    if (!result) return res.status(404).json({ error: 'playlist share not found' });
    res.json(publicPlaylistShareRow(result));
  } catch (e) {
    console.error('[tier34] playlist share update', e);
    res.status(500).json({ error: 'playlist share update failed' });
  }
});

app.put('/api/locker/blob/:hash', express.raw({ type: '*/*', limit: '512mb' }), (req, res) => {
  const hash = String(req.params.hash ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'hash must be SHA-256 hex (64 chars)' });
  }
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '');
  if (body.length === 0) {
    return res.status(400).json({ error: 'empty blob body' });
  }
  try {
    const saved = saveBlob(hash, body);
    res.json({ ok: true, hash: saved.hash, bytes: saved.bytes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes('Hash mismatch') ? 400 : 500;
    console.error('[tier34] locker blob put', e);
    res.status(status).json({ error: msg });
  }
});

app.get('/api/locker/blob/:hash', async (req, res) => {
  const hash = String(req.params.hash ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'invalid hash' });
  }

  const tideHandled = await maybeApplyInterminableTide(req, res, {
    pathKind: 'api_stream',
    filePath: blobExists(hash)
      ? resolveBestReadPath(hash)?.path ?? blobPathForHash(hash)
      : undefined,
  });
  if (tideHandled) return;

  if (!blobExists(hash)) {
    return res.status(404).json({ error: 'blob not found' });
  }

  const resolved = resolveBestReadPath(hash);
  const filePath = resolved?.path ?? blobPathForHash(hash);

  try {
    const actualHash = await sha256HexFile(filePath);

    if (actualHash !== hash) {
      quarantineCorruptBlob(hash);
      const manifest = loadMasterManifest();
      const entry = manifest.entries.find((e) => e.contentHash === hash);
      enqueueHealBlobJob({
        hash,
        expectedHash: hash,
        actualHash,
        envelopeId: entry?.id,
      });
      kickJobWorker();
      return res.status(409).json({
        error: 'corrupted',
        expectedHash: hash,
        actualHash,
      });
    }
  } catch (e) {
    console.error('[tier34] blob integrity check', e);
    return res.status(500).json({ error: 'integrity check failed' });
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-Content-Hash', hash);
  if (resolved?.source === 'tmpfs') {
    res.setHeader('X-Sandbox-Tmpfs-Cache', '1');
  }
  createReadStream(filePath).pipe(res);
});

app.post('/api/acquire', (req, res) => {
  const tracks = req.body?.tracks;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ error: 'tracks array required' });
  }
  const tier = req.body?.tier;
  if (tier !== 'best' && tier !== 'proxy' && tier !== 'debrid') {
    return res.status(400).json({ error: 'tier must be best | proxy | debrid' });
  }
  try {
    const job = createAcquireJob({
      tracks,
      tier,
      mode: req.body?.mode === 'album' ? 'album' : 'tracks',
      albumTitle: req.body?.albumTitle,
      albumArtist: req.body?.albumArtist,
      releaseYear: req.body?.releaseYear,
      artworkUrl: req.body?.artworkUrl,
      prowlarrUrl: req.body?.prowlarrUrl,
      prowlarrApiKey: req.body?.prowlarrApiKey,
      realDebridApiKey: req.body?.realDebridApiKey,
    });
    res.json({ jobId: job.id });
  } catch (e) {
    console.error('[tier34] acquire enqueue', e);
    res.status(500).json({ error: 'acquire enqueue failed' });
  }
});

app.get('/api/acquire/status/:jobId', (req, res) => {
  const job = getAcquireJob(String(req.params.jobId ?? ''));
  if (!job) return res.status(404).json({ error: 'job not found' });
  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    currentTrack: job.currentTrack,
    tracks: job.tracks,
    error: job.error,
    tier: job.tier,
    mode: job.mode,
  });
});

app.post('/api/proxy/resolve', async (req, res) => {
  const query = String(req.body?.query ?? '').trim();
  if (!query) return res.status(400).json({ error: 'query required', results: [] });
  try {
    const results = await resolveProxyCandidates(query);
    res.json({ results });
  } catch (e) {
    console.error('[tier34] proxy resolve', e);
    res.status(502).json({ error: 'proxy resolve failed', results: [] });
  }
});

/** YouTube channel/playlist → pseudo-podcast episode list (audio via /api/proxy/stream). */
app.get('/api/podcast/youtube', async (req, res) => {
  const target = String(req.query.url ?? '').trim();
  if (!target) return res.status(400).json({ error: 'url query param required' });
  if (!isYoutubePodcastListUrl(target)) {
    return res.status(400).json({ error: 'YouTube channel or playlist URL required' });
  }
  try {
    const feed = await fetchYoutubePodcastFeed(target);
    res.json(feed);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'youtube podcast feed failed';
    console.error('[tier34] podcast/youtube', e);
    res.status(502).json({ error: msg });
  }
});

/** Global podcast discovery — iTunes + Podcast Index (set PODCAST_INDEX_KEY/SECRET for episodes). */
app.get('/api/podcast/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '25'), 10) || 25));
  if (q.length < 2) return res.json({ shows: [], episodes: [] });
  try {
    const [shows, episodes] = await Promise.all([
      searchPodcastCatalogShows(q, limit),
      searchPodcastCatalogEpisodes(q, Math.min(limit, 20)),
    ]);
    res.json({ shows, episodes });
  } catch (e) {
    console.error('[tier34] podcast/search', e);
    res.status(502).json({ shows: [], episodes: [], error: 'podcast search failed' });
  }
});

app.get('/api/podcast/trending', async (req, res) => {
  const max = Math.min(50, Math.max(1, parseInt(String(req.query.max ?? '20'), 10) || 20));
  try {
    const shows = await fetchTrendingPodcastShows(max);
    res.json({ shows });
  } catch (e) {
    console.error('[tier34] podcast/trending', e);
    res.status(502).json({ shows: [], error: 'podcast trending failed' });
  }
});

/** Free audiobook discovery — LibriVox + Internet Archive. */
app.get('/api/audiobook/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '25'), 10) || 25));
  if (q.length < 2) return res.json({ books: [] });
  try {
    const books = await searchAudiobookCatalog(q, limit);
    res.json({ books });
  } catch (e) {
    console.error('[tier34] audiobook/search', e);
    res.status(502).json({ books: [], error: 'audiobook search failed' });
  }
});

app.get('/api/audiobook/chapters', async (req, res) => {
  const source = String(req.query.source ?? '').trim();
  const id = String(req.query.id ?? '').trim();
  if (!id || (source !== 'librivox' && source !== 'archive')) {
    return res.status(400).json({ error: 'source (librivox|archive) and id required' });
  }
  try {
    const chapters = await fetchAudiobookCatalogChapters(source, id);
    res.json({ chapters });
  } catch (e) {
    console.error('[tier34] audiobook/chapters', e);
    res.status(502).json({ chapters: [], error: 'audiobook chapters failed' });
  }
});

/** RSS/Atom feed proxy for mobile / production (mirrors Vite dev proxy). */
app.get('/api/podcast-feed', async (req, res) => {
  const target = String(req.query.url ?? '').trim();
  if (!target || !podcastFeedUrlAllowed(target)) {
    return res.status(400).send('Bad feed url');
  }
  try {
    const { status, body, contentType } = await fetchPodcastFeedXml(target);
    res.status(status).set('Content-Type', contentType).send(body);
  } catch (e) {
    console.error('[tier34] podcast-feed', e);
    res.status(502).send('Podcast feed proxy unavailable');
  }
});

/** Podcast Index chaptersUrl + soundbites when RSS omits chapter markers. */
app.get('/api/podcast-episode-meta', async (req, res) => {
  const feedUrl = String(req.query.feedUrl ?? '').trim();
  const guid = String(req.query.guid ?? '').trim();
  const enclosureUrl = String(req.query.enclosureUrl ?? '').trim();
  if (!guid && !enclosureUrl) {
    return res.status(400).json({ error: 'guid or enclosureUrl required' });
  }
  try {
    const meta = await fetchPodcastEpisodeMeta({ feedUrl, guid, enclosureUrl });
    res.json(meta);
  } catch (e) {
    console.error('[tier34] podcast-episode-meta', e);
    res.status(502).json({ chaptersUrl: undefined, soundbites: [] });
  }
});

app.get('/api/proxy/stream', async (req, res) => {
  const target = String(req.query.url ?? '').trim();
  if (!target.startsWith('http')) {
    return res.status(400).send('url query param required');
  }

  const tideHandled = await maybeApplyInterminableTide(req, res, {
    pathKind: 'proxy_stream',
  });
  if (tideHandled) return;

  if (isDefenseProtocolEnabled() && !isAllowedProxyStreamUrl(target)) {
    return res.status(403).send('proxy target not allowed');
  }
  try {
    const clientHeaders: Record<string, string> = {};
    const range = req.headers.range;
    if (typeof range === 'string') clientHeaders.Range = range;
    const ifRange = req.headers['if-range'];
    if (typeof ifRange === 'string') clientHeaders['If-Range'] = ifRange;

    const upstream = await proxyStreamUpstream(target, clientHeaders);
    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 502).send('upstream stream failed');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') ?? 'bytes');
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);
    const cr = upstream.headers.get('content-range');
    if (cr) res.setHeader('Content-Range', cr);
    if (upstream.status === 206) res.status(206);
    const reader = upstream.body.getReader();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      res.write(Buffer.from(value));
      return pump();
    };
    await pump();
  } catch (e) {
    console.error('[tier34] proxy stream', e);
    if (!res.headersSent) res.status(502).send('proxy stream error');
  }
});

app.post('/api/debrid/resolve', async (req, res) => {
  const query = String(req.body?.query ?? '').trim();
  if (!query) return res.status(400).json({ error: 'query required', results: [] });
  try {
    const results = await resolveDebridCandidates({
      query,
      prowlarrUrl: String(req.body?.prowlarrUrl ?? process.env.PROWLARR_URL ?? ''),
      prowlarrApiKey: String(process.env.PROWLARR_API_KEY ?? req.body?.prowlarrApiKey ?? ''),
      realDebridApiKey: String(process.env.REALDEBRID_API_KEY ?? req.body?.realDebridApiKey ?? ''),
    });
    res.json({ results });
  } catch (e) {
    console.error('[tier34] debrid resolve', e);
    res.status(502).json({ error: 'debrid resolve failed', results: [] });
  }
});

/** Dev-test addon resolve — SoundCloud (API or yt-dlp scsearch). */
app.post('/api/addon/soundcloud/resolve', async (req, res) => {
  const query = String(req.body?.query ?? '').trim();
  if (!query) return res.status(400).json({ error: 'query required', results: [] });
  try {
    const clientId = String(req.body?.clientId ?? req.body?.client_id ?? '');
    const results = await resolveSoundCloudAddon(query, clientId);
    res.json({ results });
  } catch (e) {
    console.error('[tier34] addon soundcloud', e);
    res.status(502).json({ error: 'soundcloud resolve failed', results: [] });
  }
});

/** Dev-test addon resolve — WebTorrent / magnet via RD or archive P2P fallback. */
app.post('/api/addon/webtorrent/resolve', async (req, res) => {
  const query = String(req.body?.query ?? '').trim();
  if (!query) return res.status(400).json({ error: 'query required', results: [] });
  try {
    const results = await resolveWebTorrentAddon(query, {
      prowlarrUrl: String(req.body?.prowlarrUrl ?? process.env.PROWLARR_URL ?? ''),
      prowlarrApiKey: String(process.env.PROWLARR_API_KEY ?? req.body?.prowlarrApiKey ?? ''),
      realDebridApiKey: String(process.env.REALDEBRID_API_KEY ?? req.body?.realDebridApiKey ?? ''),
    });
    res.json({ results });
  } catch (e) {
    console.error('[tier34] addon webtorrent', e);
    res.status(502).json({ error: 'webtorrent resolve failed', results: [] });
  }
});

/** Dev-test addon resolve — IPFS / mesh via archive content-addressable sources. */
app.post('/api/addon/ipfs/resolve', async (req, res) => {
  const query = String(req.body?.query ?? '').trim();
  if (!query) return res.status(400).json({ error: 'query required', results: [] });
  try {
    const results = await resolveIpfsAddon(query);
    res.json({ results });
  } catch (e) {
    console.error('[tier34] addon ipfs', e);
    res.status(502).json({ error: 'ipfs resolve failed', results: [] });
  }
});

/** Radio Browser — live station search (play-only; not per-track download). */
app.post('/api/addon/radio-browser/search', async (req, res) => {
  const query = String(req.body?.query ?? '').trim();
  if (!query) return res.status(400).json({ error: 'query required', results: [] });
  try {
    const results = await resolveRadioBrowserAddon(query);
    res.json({ results });
  } catch (e) {
    console.error('[tier34] addon radio-browser search', e);
    res.status(502).json({ error: 'radio-browser search failed', results: [] });
  }
});

/** Radio Browser — proxy live stream (many unique upstream hosts). */
app.get('/api/addon/radio-browser/stream', async (req, res) => {
  const target = String(req.query.url ?? '').trim();
  if (!target.startsWith('http')) {
    return res.status(400).send('url query param required');
  }
  if (isDefenseProtocolEnabled() && !isAllowedRadioStreamUrl(target)) {
    return res.status(403).send('radio stream target not allowed');
  }
  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'SandboxTier34/1.0',
        Accept: 'audio/*,*/*',
        'Icy-MetaData': '1',
      },
      redirect: 'follow',
    });
    if (!upstream.ok || !upstream.body) {
      return res.status(upstream.status || 502).send('radio upstream failed');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);
    const reader = upstream.body.getReader();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      res.write(Buffer.from(value));
      return pump();
    };
    await pump();
  } catch (e) {
    console.error('[tier34] radio-browser stream', e);
    if (!res.headersSent) res.status(502).send('radio stream error');
  }
});

/** Audius — decentralized track search + full CDN streams. */
app.post('/api/addon/audius/resolve', async (req, res) => {
  const query = String(req.body?.query ?? '').trim();
  if (!query) return res.status(400).json({ error: 'query required', results: [] });
  try {
    const results = await resolveAudiusAddon(query, {
      apiKey: String(req.body?.apiKey ?? req.body?.api_key ?? ''),
      appName: String(req.body?.appName ?? req.body?.app_name ?? ''),
    });
    res.json({ results });
  } catch (e) {
    console.error('[tier34] addon audius', e);
    res.status(502).json({ error: 'audius resolve failed', results: [] });
  }
});

/** Soulseek — slskd search (headless Soulseek network; no external API keys). */
app.post('/api/addon/soulseek/resolve', async (req, res) => {
  const query = String(req.body?.query ?? '').trim();
  if (!query) return res.status(400).json({ error: 'query required', results: [] });
  if (!isSoulseekConfigured()) {
    return res.json({ results: [], configured: false, error: 'slskd not configured' });
  }
  try {
    const results = await resolveSoulseekAddon(query);
    res.json({ results, configured: true, reachable: await slskdReachable() });
  } catch (e) {
    console.error('[tier34] addon soulseek', e);
    res.status(502).json({ error: 'soulseek search failed', results: [] });
  }
});

/** Soulseek — download via slskd then stream file (playback). */
app.get('/api/addon/soulseek/stream', async (req, res) => {
  const ref = parseSoulseekStreamQuery(req.query as Record<string, unknown>);
  if (!ref) return res.status(400).send('username, filename, and size required');
  if (!isSoulseekConfigured()) return res.status(503).send('slskd not configured');
  try {
    const buf = await readSoulseekDownloadBuffer(ref);
    res.setHeader('Access-Control-Allow-Origin', '*');
    const lower = ref.filename.toLowerCase();
    const ct = lower.endsWith('.flac')
      ? 'audio/flac'
      : lower.endsWith('.ogg')
        ? 'audio/ogg'
        : lower.endsWith('.m4a') || lower.endsWith('.aac')
          ? 'audio/mp4'
          : 'audio/mpeg';
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Length', String(buf.length));
    res.send(buf);
  } catch (e) {
    console.error('[tier34] soulseek stream', e);
    if (!res.headersSent) res.status(502).send('soulseek stream failed');
  }
});

app.post('/api/debrid/test/prowlarr', async (req, res) => {
  const result = await testProwlarrConnection(
    String(req.body?.prowlarrUrl ?? process.env.PROWLARR_URL ?? ''),
    String(req.body?.prowlarrApiKey ?? process.env.PROWLARR_API_KEY ?? ''),
  );
  res.json(result);
});

app.post('/api/debrid/test/realdebrid', async (req, res) => {
  const result = await testRealDebridConnection(
    String(req.body?.realDebridApiKey ?? process.env.REALDEBRID_API_KEY ?? ''),
  );
  res.json(result);
});

/** Sandbox Indexer — built-in search (yt-dlp + archive + optional Torznab/Prowlarr). */
app.get('/api/indexer/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'q required', results: [] });
  try {
    const results = await searchSandboxIndexer({
      query: q,
      prowlarrUrl: String(req.query.prowlarrUrl ?? process.env.PROWLARR_URL ?? ''),
      prowlarrApiKey: String(process.env.PROWLARR_API_KEY ?? req.query.prowlarrApiKey ?? ''),
      includeProxy: req.query.includeProxy !== '0',
      losslessBias: req.query.lossless === '1',
    });
    res.json({ results, source: 'sandbox-indexer' });
  } catch (e) {
    console.error('[tier34] indexer search', e);
    res.status(502).json({ error: 'indexer search failed', results: [] });
  }
});

app.get('/api/indexer/status', async (_req, res) => {
  try {
    const status = await getIndexerStatus();
    const config = loadIndexerConfig();
    res.json({ ok: true, ...status, torznabEndpoints: config.torznabEndpoints.map((e) => ({
      name: e.name,
      url: e.url,
      hasApiKey: Boolean(e.apiKey?.trim()),
    })) });
  } catch (e) {
    console.error('[tier34] indexer status', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/indexer/configure', (req, res) => {
  const endpoints = req.body?.torznabEndpoints;
  if (endpoints !== undefined && !Array.isArray(endpoints)) {
    return res.status(400).json({ error: 'torznabEndpoints must be an array' });
  }
  try {
    const normalized: TorznabEndpoint[] = Array.isArray(endpoints)
      ? endpoints
          .map((e: { name?: string; url?: string; apiKey?: string }) => ({
            name: String(e?.name ?? 'Indexer').trim().slice(0, 64) || 'Indexer',
            url: String(e?.url ?? '').trim(),
            apiKey: e?.apiKey ? String(e.apiKey).trim() : undefined,
          }))
          .filter((e) => e.url.length > 0)
          .slice(0, 8)
      : undefined;
    const saved = saveIndexerConfig(
      normalized !== undefined ? { torznabEndpoints: normalized } : {},
    );
    res.json({ ok: true, torznabEndpoints: saved.torznabEndpoints.length });
  } catch (e) {
    console.error('[tier34] indexer configure', e);
    res.status(500).json({ error: 'indexer configure failed' });
  }
});

/** Direct magnet or torrent URL → Real-Debrid unrestrict (when RD key configured). */
app.post('/api/indexer/resolve-link', async (req, res) => {
  const link = String(req.body?.link ?? req.body?.query ?? '').trim();
  if (!link) return res.status(400).json({ error: 'link required', results: [] });
  try {
    const results = await resolveDebridCandidates({
      query: link,
      prowlarrUrl: String(req.body?.prowlarrUrl ?? process.env.PROWLARR_URL ?? ''),
      prowlarrApiKey: String(process.env.PROWLARR_API_KEY ?? req.body?.prowlarrApiKey ?? ''),
      realDebridApiKey: String(process.env.REALDEBRID_API_KEY ?? req.body?.realDebridApiKey ?? ''),
    });
    res.json({ results });
  } catch (e) {
    console.error('[tier34] indexer resolve-link', e);
    res.status(502).json({ error: 'resolve-link failed', results: [] });
  }
});

app.get('/api/search/proxy', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const results = await searchProxyTier(q);
    res.json({ results });
  } catch (e) {
    console.error('[tier34] proxy search', e);
    res.status(502).json({ error: 'proxy search failed', results: [] });
  }
});

app.get('/api/search/debrid', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const results = await searchDebridTier(q);
    res.json({ results });
  } catch (e) {
    console.error('[tier34] debrid search', e);
    res.status(502).json({ error: 'debrid search failed', results: [] });
  }
});

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'q required', hits: [] });
  try {
    const losslessRaw = String(req.query.lossless ?? '').trim().toLowerCase();
    const lossless =
      losslessRaw === 'true' || losslessRaw === '1'
        ? true
        : losslessRaw === 'false' || losslessRaw === '0'
          ? false
          : undefined;
    const facetsRaw = String(req.query.facets ?? '').trim();
    const facets = facetsRaw
      ? facetsRaw.split(',').map((f) => f.trim()).filter(Boolean)
      : undefined;
    const result = await searchTracks(q, {
      limit: Number(req.query.limit) || 40,
      filters: {
        artist: String(req.query.artist ?? '').trim() || undefined,
        genre: String(req.query.genre ?? '').trim() || undefined,
        year: String(req.query.year ?? '').trim() || undefined,
        source: String(req.query.source ?? '').trim() || undefined,
        releaseGroupId:
          String(req.query.releaseGroupId ?? req.query.releaseGroup ?? '').trim() || undefined,
        lossless,
      },
      facets,
    });
    res.json({
      hits: result.hits,
      ok: result.ok,
      source: result.ok ? 'meilisearch' : 'offline',
      facetDistribution: result.facetDistribution,
      estimatedTotalHits: result.estimatedTotalHits,
    });
  } catch (e) {
    console.error('[tier34] meilisearch search', e);
    res.json({ hits: [], ok: false, source: 'offline' });
  }
});

app.post('/api/search/reindex', async (_req, res) => {
  try {
    const available = await meilisearchAvailable();
    if (!available) {
      return res.status(503).json({ ok: false, error: 'Meilisearch offline — start meilisearch on port 7700' });
    }
    const result = await reindexTracks();
    if (!result.ok) {
      return res.status(502).json(result);
    }
    res.json(result);
  } catch (e) {
    console.error('[tier34] meilisearch reindex', e);
    res.status(500).json({ ok: false, error: 'reindex failed' });
  }
});

app.post('/api/analyze/spectral', async (req, res) => {
  const { url, title, artist, sampleBase64 } = req.body ?? {};
  try {
    let buf: Buffer;
    if (typeof sampleBase64 === 'string' && sampleBase64.length > 0) {
      buf = Buffer.from(sampleBase64, 'base64');
    } else if (typeof url === 'string' && url.startsWith('http')) {
      if (isDefenseProtocolEnabled() && !isAllowedProxyStreamUrl(url)) {
        return res.status(403).json({ error: 'analyze url not allowed' });
      }
      buf = await fetchAudioSample(url);
    } else {
      const synthetic = Buffer.from(`${title ?? ''}${artist ?? ''}`, 'utf8');
      buf = synthetic.length > 64 ? synthetic : Buffer.alloc(256, synthetic);
    }
    const entropy = spectralEntropyFromBuffer(buf);
    const accepted = entropy >= 0.35;
    res.json({
      entropy,
      accepted,
      rejectionReason: accepted ? null : 'Low spectral entropy — likely corrupt or silent source',
      analyzedBytes: buf.length,
    });
  } catch (e) {
    res.json({
      entropy: 0.5,
      accepted: true,
      rejectionReason: null,
      analyzedBytes: 0,
      fallback: String(e),
    });
  }
});

app.post('/api/fingerprint/match', async (req, res) => {
  const { title, artist, durationSeconds, fingerprint, contentHash } = req.body ?? {};
  const duration = Number(durationSeconds) || 0;

  if (typeof fingerprint === 'string' && fingerprint.trim() && duration > 0) {
    try {
      const match = await lookupAcoustId(fingerprint.trim(), duration);
      if (match) {
        return res.json({
          fingerprint: fingerprint.trim(),
          matchScore: match.score,
          matched: match.score >= 0.8,
          musicbrainzRecordingId: match.musicbrainzRecordingId,
          musicbrainzReleaseId: match.musicbrainzReleaseId,
          acoustidId: match.acoustidId,
          matchedTitle: match.title,
          matchedArtist: match.artist,
          source: 'acoustid',
        });
      }
    } catch {
      /* fall through */
    }
  }

  const hash = typeof contentHash === 'string' ? contentHash.trim() : '';
  if (hash) {
    try {
      const buf = readBlob(hash);
      if (buf && buf.length > 0) {
        const identified = await identifyAudioBuffer(buf, duration);
        if (identified.match) {
          const m = identified.match;
          return res.json({
            fingerprint: identified.fingerprint,
            matchScore: m.score,
            matched: m.score >= 0.8,
            musicbrainzRecordingId: m.musicbrainzRecordingId,
            musicbrainzReleaseId: m.musicbrainzReleaseId,
            acoustidId: m.acoustidId,
            matchedTitle: m.title,
            matchedArtist: m.artist,
            source: 'acoustid',
          });
        }
        if (identified.fingerprint) {
          return res.json({
            fingerprint: identified.fingerprint,
            matchScore: 0,
            matched: false,
            musicbrainzRecordingId: '',
            source: 'acoustid',
            reason: identified.reason ?? 'no-match',
          });
        }
      }
    } catch {
      /* fall through */
    }
  }

  const fp = acousticFingerprint(
    String(title ?? ''),
    String(artist ?? ''),
    duration,
  );
  const query = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
  let musicbrainzId = '';
  try {
    const mb = await fetch(
      `https://musicbrainz.org/ws/2/recording?query=${query}&fmt=json&limit=3`,
      { headers: { 'User-Agent': 'SandboxTier34/1.0', Accept: 'application/json' } },
    );
    if (mb.ok) {
      const data = (await mb.json()) as { recordings?: Array<{ id: string }> };
      musicbrainzId = data.recordings?.[0]?.id ?? '';
    }
  } catch {
    /* ignore */
  }
  const inputFp = typeof fingerprint === 'string' ? fingerprint : fp;
  const matchScore = inputFp === fp ? 1 : inputFp.slice(0, 8) === fp.slice(0, 8) ? 0.82 : 0.55;
  res.json({
    fingerprint: fp,
    matchScore,
    matched: matchScore >= 0.8,
    musicbrainzRecordingId: musicbrainzId,
    source: 'text-hash',
  });
});

app.post('/api/stem/failover', async (req, res) => {
  const { sources = [], failedSourceId, title, artist } = req.body ?? {};
  const list = Array.isArray(sources) ? sources : [];
  const remaining = list.filter((s: { id?: string }) => s.id !== failedSourceId);
  let alternates: unknown[] = [];
  if (title && artist) {
    const healed = await searchProxyTier(`${title} ${artist}`);
    alternates = healed.slice(0, 3).map((h, i) => ({
      id: `stem-alt-${i}`,
      priority: 3 + i,
      provider: h.provider,
      transport: h.transport,
      uri: h.url,
      mimeType: h.mimeType,
      metadata: { title: h.title, artist: h.artist, durationSeconds: h.durationSeconds },
      resolveHint: h.resolveHint,
    }));
  }
  res.json({
    activeStem: remaining[0] ?? alternates[0] ?? null,
    sources: [...remaining, ...alternates],
  });
});

app.post('/api/sonic-dna/profile', (req, res) => {
  const { title, artist, genre, durationSeconds } = req.body ?? {};
  const vector = sonicDnaVector(
    String(title ?? ''),
    String(artist ?? ''),
    String(genre ?? ''),
    Number(durationSeconds) || 0,
  );
  res.json({
    profileId: qmHash(String(title ?? ''), String(artist ?? '')),
    vector,
    labels: {
      energy: vector[0],
      tempo: vector[1],
      valence: vector[2],
      danceability: vector[3],
      acousticness: vector[4],
      instrumentalness: vector[5],
      liveness: vector[6],
      speechiness: vector[7],
    },
  });
});

app.post('/api/dht/resolve', async (req, res) => {
  const { hash, title, artist } = req.body ?? {};
  const meta = dhtResolve(String(hash ?? ''), String(title ?? ''), String(artist ?? ''));
  const q = `${title} ${artist}`.trim();
  const proxyRows = q ? await resolveProxyCandidates(q) : [];
  const meshRows = q
    ? [...(await resolveWebTorrentAddon(q)), ...(await resolveIpfsAddon(q))]
    : [];
  const streams = [
    ...proxyRows.map((row) => ({
      envelopeId: row.id,
      title: row.title,
      artist: row.artist,
      url: row.url,
      durationSeconds: row.durationSeconds ?? 0,
      provider: 'dht-swarm' as const,
      transport: 'stream-proxy' as const,
      sourceId: row.sourceId ?? meta.hash,
      artworkUrl: row.artworkUrl,
      resolveHint: row.resolveHint ?? `dht:${meta.hash}`,
    })),
    ...meshRows.map((row) => ({
      envelopeId: row.id,
      title: row.title,
      artist: row.artist,
      url: row.url,
      durationSeconds: row.durationSeconds ?? 0,
      provider: row.provider,
      transport: row.transport,
      sourceId: row.sourceId ?? meta.hash,
      artworkUrl: row.artworkUrl,
      resolveHint: row.resolveHint ?? `dht:${meta.hash}`,
    })),
  ]
    .filter((row) => row.url && !row.url.includes('audio-ssl'))
    .slice(0, 8);
  res.json({
    ...meta,
    streams,
    playbackUrl: streams[0]?.url ?? null,
  });
});

app.post('/api/heal/dead-source', async (req, res) => {
  const { envelope, candidates = [] } = req.body ?? {};
  const title = envelope?.title ?? '';
  const artist = envelope?.artist ?? '';
  const q = `${title} ${artist}`.trim();
  const [proxy, debrid] = await Promise.all([
    searchProxyTier(q),
    searchDebridTier(q),
  ]);
  const pool = [...proxy, ...debrid];
  const healed = pool[0];
  if (!healed) {
    return res.json({ healed: false, envelope: null, candidates });
  }
  const next = {
    envelopeId: `healed-${Date.now()}`,
    title: healed.title,
    artist: healed.artist,
    url: healed.url,
    durationSeconds: healed.durationSeconds,
    provider: healed.provider,
    transport: healed.transport,
    sourceId: healed.sourceId,
    mimeType: healed.mimeType,
    artworkUrl: healed.artworkUrl,
  };
  res.json({
    healed: true,
    envelope: next,
    candidates: [
      ...candidates,
      {
        id: healed.sourceId,
        priority: 2,
        provider: healed.provider,
        transport: healed.transport,
        uri: healed.url,
        metadata: { title: healed.title, artist: healed.artist },
      },
    ],
  });
});

app.get('/api/oauth/:provider/authorize', (req, res) => {
  const provider = req.params.provider as 'spotify' | 'apple' | 'youtube' | 'soundcloud';
  const redirectUri =
    process.env.OAUTH_REDIRECT_URI ??
    `http://localhost:${PORT}/api/oauth/${provider}/callback`;
  const { url } = getOAuthAuthorizeUrl(provider, redirectUri);
  if (url.startsWith('http')) {
    res.redirect(url);
    return;
  }
  res.redirect(url);
});

app.get('/api/oauth/:provider/callback', async (req, res) => {
  const provider = req.params.provider as 'spotify' | 'apple' | 'youtube' | 'soundcloud';
  const code = String(req.query.code ?? '');
  const state = String(req.query.state ?? '');
  const result = await completeOAuthCallback(provider, code, state);
  if (!result.ok) {
    return res.status(400).send(`OAuth failed: ${result.error}`);
  }
  res.send(
    `<html><body style="background:#07080c;color:#fff;font-family:monospace;padding:2rem"><h1>Sandbox OAuth OK</h1><p>Copy token into app:</p><code>${result.token}</code><script>localStorage.setItem('sandbox_oauth_token','${result.token}')</script></body></html>`,
  );
});

app.get('/api/oauth/playlists', async (req, res) => {
  const token = String(req.headers['x-sandbox-token'] ?? req.query.token ?? '');
  const playlists = await fetchProviderPlaylists(token);
  res.json({ playlists });
});

app.get('/api/feed', async (_req, res) => {
  try {
    const items = await buildFeed();
    res.json({ items });
  } catch (e) {
    res.status(502).json({ items: [], error: String(e) });
  }
});

app.post('/api/mixes', async (req, res) => {
  const titles = (req.body?.lockerTitles as string[]) ?? [];
  try {
    const mixes = await buildMixes(titles);
    res.json({ mixes });
  } catch (e) {
    res.status(502).json({ mixes: [], error: String(e) });
  }
});

app.get('/api/videos', async (req, res) => {
  const q = String(req.query.q ?? 'music video');
  try {
    const videos = await buildVideos(q);
    res.json({ videos });
  } catch (e) {
    res.status(502).json({ videos: [], error: String(e) });
  }
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/peer-sync' });

type ConnectRole = 'host' | 'remote';

type PeerConn = {
  deviceId: string;
  deviceName: string;
  role: ConnectRole;
};

type ConnectRoom = {
  peers: Map<WebSocket, PeerConn>;
  host: WebSocket | null;
};

const connectRooms = new Map<string, ConnectRoom>();

function getConnectRoom(room: string): ConnectRoom {
  let r = connectRooms.get(room);
  if (!r) {
    r = { peers: new Map(), host: null };
    connectRooms.set(room, r);
  }
  return r;
}

function sendJson(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '', `http://localhost:${PORT}`);
  const roomId = url.searchParams.get('room') ?? 'default';
  const room = getConnectRoom(roomId);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        type: string;
        role?: ConnectRole;
        deviceId?: string;
        deviceName?: string;
        command?: unknown;
        payload?: unknown;
        heartbeat?: boolean;
      };

      if (msg.type === 'hello' && msg.role && msg.deviceId) {
        const conn: PeerConn = {
          deviceId: msg.deviceId,
          deviceName: msg.deviceName ?? 'Device',
          role: msg.role,
        };
        room.peers.set(ws, conn);
        if (msg.role === 'host') {
          room.host = ws;
        }
        return;
      }

      const conn = room.peers.get(ws);
      if (!conn) return;

      if (msg.type === 'command' && msg.command && conn.role === 'remote') {
        if (room.host && room.host.readyState === WebSocket.OPEN) {
          sendJson(room.host, {
            type: 'command',
            deviceId: conn.deviceId,
            command: msg.command,
          });
        }
        return;
      }

      if (msg.type === 'sync_state' && msg.payload && conn.role === 'host' && room.host === ws) {
        for (const [peer, peerConn] of room.peers) {
          if (peer !== ws && peerConn.role === 'remote' && peer.readyState === WebSocket.OPEN) {
            sendJson(peer, {
              type: 'sync_state',
              payload: msg.payload,
              ...(msg.heartbeat ? { heartbeat: true } : {}),
            });
          }
        }
      }
    } catch {
      /* ignore */
    }
  });

  ws.on('close', () => {
    if (room.host === ws) room.host = null;
    room.peers.delete(ws);
    if (room.peers.size === 0) connectRooms.delete(roomId);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[tier34] Sandbox Tier 3/4 backend http://localhost:${PORT}`);
  console.log(`[tier34] WebSocket peer sync ws://localhost:${PORT}/peer-sync`);
  if (dlnaEnabled) {
    console.log(`[tier34] DLNA MediaServer enabled — browse locker from TVs/receivers on LAN`);
  }
  if (subsonicEnabled) {
    console.log(`[tier34] OpenSubsonic read-only API at /rest/*`);
  }
  try {
    const reset = initJobWorker();
    if (reset > 0) {
      console.log(`[tier34] job queue recovered ${reset} interrupted job(s)`);
    }
  } catch (e) {
    console.warn('[tier34] job worker init skipped', e);
  }
  try {
    const manifest = loadMasterManifest();
    if (manifest.entries.length > 0) {
      backfillFromManifest(manifest.entries);
      console.log(`[tier34] media graph backfilled ${manifest.entries.length} manifest entries`);
    }
  } catch (e) {
    console.warn('[tier34] media graph backfill skipped', e);
  }
  try {
    initPodcastTranscriptScheduler();
  } catch (e) {
    console.warn('[tier34] podcast whisper scheduler boot skipped', e);
  }
  try {
    initPodcastMirrorScheduler();
  } catch (e) {
    console.warn('[tier34] podcast mirror scheduler boot skipped', e);
  }
  try {
    initIngestPump();
    bootIngestionWatcher();
    const watch = getWatchStatus();
    if (watch.watching) {
      console.log(`[tier34] ingestion watching ${watch.path}`);
    }
  } catch (e) {
    console.warn('[tier34] ingestion watcher boot skipped', e);
  }
});
