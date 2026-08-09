import type { SettingsCategoryId } from './SettingsMobileRoot';
import { SETTINGS_SEARCH_ANCHORS } from './settingsSearchAnchors';

export type SettingsSearchItem = {
  id: string;
  categoryId: SettingsCategoryId;
  categoryLabel: string;
  sectionLabel?: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  /** DOM scroll target via data-settings-anchor */
  anchorId?: string;
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

function categoryLabels(t: Translate): Record<SettingsCategoryId, string> {
  return {
    // Station IA (shells — panels migrate onto these)
    music: t('settings.categories.music'),
    podcasts: t('settings.categories.podcasts'),
    audiobooks: t('settings.categories.audiobooks'),
    documents: t('settings.categories.documents'),
    everything: t('settings.categories.everything'),
    // Legacy subsystem tabs
    fidelity: t('settings.categories.fidelity'),
    playback: t('settings.categories.playback'),
    vault: t('settings.categories.vault'),
    architect: t('settings.categories.architect'),
    vinyl: t('settings.categories.vinyl'),
    addons: t('settings.categories.addons'),
    telemetry: t('settings.categories.telemetry'),
    diagnostics: t('settings.categories.diagnostics'),
    security: t('settings.categories.security'),
    about: t('settings.categories.about'),
  };
}

/** Flat index of searchable settings entries across all categories. */
export function buildSettingsSearchIndex(t: Translate): SettingsSearchItem[] {
  const cats = categoryLabels(t);
  const item = (
    categoryId: SettingsCategoryId,
    id: string,
    title: string,
    opts?: {
      subtitle?: string;
      sectionLabel?: string;
      keywords?: string[];
      anchorId?: string;
    },
  ): SettingsSearchItem => ({
    id,
    categoryId,
    categoryLabel: cats[categoryId],
    title,
    subtitle: opts?.subtitle,
    sectionLabel: opts?.sectionLabel,
    keywords: opts?.keywords,
    anchorId: opts?.anchorId,
  });

  return [
    // Categories (drill-down entry points)
    // Station categories
    item('music', 'cat-music', cats.music, {
      subtitle: t('settings.categories.musicDesc'),
      keywords: ['audio', 'quality', 'fidelity', 'vinyl', 'playback'],
    }),
    item('podcasts', 'cat-podcasts', cats.podcasts, {
      subtitle: t('settings.categories.podcastsDesc'),
      keywords: ['podcast', 'rss', 'skip', 'wifi'],
    }),
    item('audiobooks', 'cat-audiobooks', cats.audiobooks, {
      subtitle: t('settings.categories.audiobooksDesc'),
      keywords: ['audiobook', 'acquire', 'books'],
    }),
    item('documents', 'cat-documents', cats.documents, {
      subtitle: t('settings.categories.documentsDesc'),
      keywords: ['documents', 'files', 'library folder'],
    }),
    item('everything', 'cat-everything', cats.everything, {
      subtitle: t('settings.categories.everythingDesc'),
      keywords: ['storage', 'server', 'theme', 'security', 'sleep', 'car', 'connect'],
    }),

    // Audio fidelity
    item('music', 'fidelity-standard', t('settings.fidelity.standard'), {
      sectionLabel: t('settings.fidelity.title'),
      subtitle: t('settings.fidelity.standardDesc'),
      keywords: ['1411', 'kbps', 'standard'],
      anchorId: SETTINGS_SEARCH_ANCHORS.fidelityQuality,
    }),
    item('music', 'fidelity-high', t('settings.fidelity.high'), {
      sectionLabel: t('settings.fidelity.title'),
      subtitle: t('settings.fidelity.highDesc'),
      keywords: ['24-bit', 'flac', 'high'],
      anchorId: SETTINGS_SEARCH_ANCHORS.fidelityQuality,
    }),
    item('music', 'fidelity-lossless', t('settings.fidelity.lossless'), {
      sectionLabel: t('settings.fidelity.title'),
      subtitle: t('settings.fidelity.losslessDesc'),
      keywords: ['lossless', 'studio'],
      anchorId: SETTINGS_SEARCH_ANCHORS.fidelityQuality,
    }),
    item('music', 'fidelity-cast', 'Sandbox Cast', {
      sectionLabel: t('settings.fidelity.castTitle'),
      subtitle: 'Cast audio to a receiver or show the visualizer on TV',
      keywords: ['chromecast', 'cast', 'tv', 'receiver'],
      anchorId: SETTINGS_SEARCH_ANCHORS.fidelityCast,
    }),
    item('music', 'fidelity-network-speakers', t('settings.fidelity.networkSpeakersTitle'), {
      sectionLabel: t('settings.fidelity.castTitle'),
      subtitle: t('settings.fidelity.networkSpeakersHint'),
      keywords: ['dlna', 'speakers', 'network', 'scan'],
      anchorId: SETTINGS_SEARCH_ANCHORS.fidelityCast,
    }),
    item('music', 'fidelity-auto-cast', 'Auto-cast on open', {
      sectionLabel: t('settings.fidelity.networkSpeakersTitle'),
      subtitle: 'Cast to the default Sandbox Cast device when a track is loaded',
      keywords: ['auto', 'cast', 'default device'],
      anchorId: SETTINGS_SEARCH_ANCHORS.fidelityCast,
    }),

    // Playback
    item('music', 'playback-gapless', t('settings.playback.gaplessLabel'), {
      sectionLabel: t('settings.playback.title'),
      subtitle: t('settings.playback.gaplessDesc'),
      keywords: ['gapless', 'continuous'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackMain,
    }),
    item('music', 'playback-crossfade', t('settings.playback.crossfadeLabel'), {
      sectionLabel: t('settings.playback.title'),
      subtitle: t('settings.playback.crossfadeDesc'),
      keywords: ['crossfade', 'blend', '2.5'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackMain,
    }),
    item('music', 'playback-sandbox-sonic', t('settings.playback.sonicTitle'), {
      sectionLabel: t('settings.playback.title'),
      subtitle: t('settings.playback.sonicHint'),
      keywords: ['sonic', 'eq', 'enhanced audio', 'loudness', 'ear safe', 'dsp', 'speaker', 'headphones', 'line out', 'override'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackSonic,
    }),
    item('music', 'playback-ear-safe', t('settings.playback.sonicEarSafeLabel'), {
      sectionLabel: t('settings.playback.sonicTitle'),
      subtitle: t('settings.playback.sonicEarSafeDesc'),
      keywords: ['ear', 'hearing', 'volume', 'safe'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackSonic,
    }),
    item('music', 'playback-spatial', t('settings.playback.spatialEnableLabel'), {
      sectionLabel: t('settings.playback.sonicTitle'),
      subtitle: t('settings.playback.spatialEnableDesc'),
      keywords: ['spatial', 'widener', 'binaural', 'headphone', 'immersive', 'stereo'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackSonic,
    }),
    item('music', 'playback-peq', t('settings.playback.peqPresetLabel'), {
      sectionLabel: t('settings.playback.sonicTitle'),
      subtitle: t('settings.playback.peqPresetHint'),
      keywords: ['peq', 'parametric', 'eq', 'preset', 'bass', 'treble', 'autoeq'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackSonic,
    }),
    item('everything', 'playback-multi-device', t('settings.playback.multiDeviceLabel'), {
      sectionLabel: t('settings.playback.title'),
      subtitle: t('settings.playback.multiDeviceDesc'),
      keywords: ['connect', 'sync', 'host', 'remote', 'multi-device'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackConnect,
    }),
    item('everything', 'playback-connect-role', t('settings.playback.roleLabel'), {
      sectionLabel: t('settings.playback.multiDeviceTitle'),
      subtitle: t('settings.playback.roleHint'),
      keywords: ['role', 'host', 'remote', 'auto'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackConnect,
    }),
    item('everything', 'playback-connect-setup', t('settings.playback.setupMultiDevice'), {
      sectionLabel: t('settings.playback.multiDeviceTitle'),
      subtitle: t('settings.playback.multiDeviceSetupHint'),
      keywords: ['wizard', 'connect', 'setup'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackConnect,
    }),
    item('music', 'playback-audiophile', 'Audiophile playback (desktop)', {
      sectionLabel: t('settings.playback.title'),
      subtitle: 'Bit-perfect native output via WASAPI exclusive on Windows',
      keywords: ['wasapi', 'exclusive', 'flac', 'tauri', 'bit-perfect'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackAudiophile,
    }),
    item('everything', 'playback-sleep-timer', 'Sleep timer', {
      sectionLabel: t('settings.playback.title'),
      subtitle: 'Pause playback after a preset duration or when the queue finishes',
      keywords: ['sleep', 'timer', 'alarm'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackSleep,
    }),
    item('everything', 'playback-car-mode', 'Car mode', {
      sectionLabel: t('settings.playback.title'),
      subtitle: 'Large touch targets and locked navigation for in-vehicle playback',
      keywords: ['car', 'driving', 'android', 'vehicle'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackCar,
    }),
    item('everything', 'playback-mini-player', t('settings.playback.miniPlayerLabel'), {
      sectionLabel: t('settings.playback.title'),
      subtitle: t('settings.playback.miniPlayerHint'),
      keywords: ['pip', 'picture in picture', 'notification', 'android', 'background'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackMini,
    }),
    item('music', 'playback-resolution', t('settings.playback.resolutionTitle'), {
      sectionLabel: t('settings.playback.title'),
      subtitle: t('settings.playback.resolutionHint'),
      keywords: ['resolution', 'hybrid', 'server', 'mobile', 'cache', 'locker', 'preview'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackResolution,
    }),
    item('music', 'playback-listening', 'Your listening', {
      sectionLabel: t('settings.playback.title'),
      subtitle: 'Local Wrapped and listening stats',
      keywords: ['wrapped', 'stats', 'insights'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackListening,
    }),

    // Storage / vault
    item('everything', 'vault-capacity', t('settings.vault.title'), {
      subtitle: t('settings.vault.hint'),
      keywords: ['capacity', 'allocated', 'space', 'storage'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vaultCapacity,
    }),
    item('everything', 'vault-sandbox-server', t('settings.vault.sandboxServerTitle'), {
      sectionLabel: t('settings.vault.title'),
      subtitle: t('settings.vault.sandboxServerHint'),
      keywords: ['sandbox server', 'anchor', 'remote node', 'downloads', 'local server'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vaultSandboxServer,
    }),
    item('everything', 'vault-stream-cache', 'Stream cache', {
      sectionLabel: t('settings.vault.title'),
      subtitle: 'Temporary local audio for replay without re-resolving server URLs',
      keywords: ['stream', 'cache', 'temporary', 'aggressive', 'offline', 'prefetch', 'cellular'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vaultStreamCache,
    }),
    item('everything', 'vault-locker-sync', t('settings.vault.syncTitle'), {
      sectionLabel: t('settings.vault.title'),
      subtitle: t('settings.vault.syncHint'),
      keywords: ['sync', 'webdav', 'cloud', 'cross-device', 'locker'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vaultLockerSync,
    }),
    item('music', 'vault-network-speakers', t('settings.vault.networkSpeakersBrowse'), {
      sectionLabel: t('settings.vault.networkSpeakersSection'),
      subtitle: t('settings.vault.networkSpeakersHint'),
      keywords: ['dlna', 'share', 'browse', 'home network'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vaultNetworkSpeakers,
    }),
    item('music', 'vault-watch-folder', 'Watch folder ingestion', {
      sectionLabel: t('settings.vault.title'),
      subtitle: t('settings.vault.watchFolderHint'),
      keywords: ['import', 'folder', 'ingestion', 'watch'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vaultWatchFolder,
    }),
    /*
     * The anchor for this existed, was rendered, and was pointed at by a jump elsewhere in
     * settings — and it was the one anchor in the file that nothing ever indexed, so the section
     * could be linked to but never found by name. It is also the single most consequential choice
     * in the app: where everything you own lives.
     */
    item('everything', 'vault-library-folder', t('settings.libraryFolder.title'), {
      sectionLabel: t('settings.vault.title'),
      subtitle: t('settings.libraryFolder.subtitle'),
      keywords: ['library', 'folder', 'root', 'storage', 'location', 'path', 'saf'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vaultLibraryFolder,
    }),
    item('music', 'vault-metadata-repair', 'Metadata repair', {
      sectionLabel: t('settings.vault.title'),
      subtitle: 'Fix missing or incorrect track metadata in your locker',
      keywords: ['metadata', 'repair', 'tags'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vaultMetadata,
    }),
    item('music', 'vault-locker-repair', 'Repair locker', {
      sectionLabel: t('settings.vault.title'),
      subtitle: 'Scan locker audio, recover orphaned blobs, and clean metadata-only rows',
      keywords: [
        'repair locker',
        'locker repair',
        'recover blobs',
        'recover',
        'scan',
        'orphaned',
        'metadata-only',
        'audio repair',
        'hollow',
        'blob',
      ],
      anchorId: SETTINGS_SEARCH_ANCHORS.vaultLockerRepair,
    }),

    // Theme & display
    item('everything', 'architect-presets', t('settings.architect.panelTitle'), {
      subtitle: t('settings.architect.panelHint'),
      keywords: ['preset', 'theme', 'midnight', 'terminal', 'ocean', 'blood moon'],
      anchorId: SETTINGS_SEARCH_ANCHORS.architectPresets,
    }),
    item('everything', 'architect-typography', t('settings.architect.readability'), {
      subtitle: t('settings.architect.readabilityHint'),
      keywords: ['font', 'typography', 'text size', 'mono'],
      anchorId: SETTINGS_SEARCH_ANCHORS.architectTypography,
    }),
    item('everything', 'architect-language', t('settings.language.interfaceLabel'), {
      sectionLabel: t('settings.language.title'),
      subtitle: t('settings.language.hint'),
      keywords: ['language', 'locale', 'i18n', 'interface'],
      anchorId: SETTINGS_SEARCH_ANCHORS.architectLanguage,
    }),
    item('everything', 'architect-engine-theme', t('settings.architect.engineTheming'), {
      subtitle: t('settings.architect.engineHint'),
      keywords: ['hue', 'accent', 'intensity', 'color'],
      anchorId: SETTINGS_SEARCH_ANCHORS.architectEngine,
    }),
    item('everything', 'architect-border-radius', t('settings.architect.borderRadius'), {
      sectionLabel: t('settings.architect.engineTheming'),
      keywords: ['radius', 'rounded', 'corners'],
      anchorId: SETTINGS_SEARCH_ANCHORS.architectEngine,
    }),
    item('music', 'architect-hero-display', t('settings.architect.heroDisplayTitle'), {
      subtitle: t('settings.architect.heroDisplayHint'),
      keywords: ['vinyl', 'album cover', 'home', 'hero'],
      anchorId: SETTINGS_SEARCH_ANCHORS.architectHero,
    }),
    /*
     * Shares the hero anchor, because it is the same section and the same decision: what the full
     * player looks like behind the controls. Indexed rather than left out — a setting that exists
     * and cannot be found by name is one nobody knows they have.
     */
    item('music', 'addons-collection-station', t('settings.addons.collectionStation'), {
      sectionLabel: t('settings.categories.addons'),
      subtitle: t('settings.addons.collectionStationHint'),
      keywords: ['collection', 'physical', 'vinyl', 'cd', 'records', 'barcode', 'scan', 'shelf'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsBuiltin,
    }),
    item('music', 'architect-waveform-visual', t('settings.architect.waveformVisual'), {
      subtitle: t('settings.architect.waveformVisualHint'),
      keywords: ['waveform', 'visualiser', 'visualizer', 'lines', 'spectrum', 'animation'],
      anchorId: SETTINGS_SEARCH_ANCHORS.architectHero,
    }),
    item('music', 'architect-card-scale', t('settings.architect.albumCardSize'), {
      subtitle: t('settings.architect.albumCardHint'),
      keywords: ['card', 'album', 'scale', 'size'],
      anchorId: SETTINGS_SEARCH_ANCHORS.architectCardScale,
    }),
    item('everything', 'architect-shortcuts', t('settings.architect.shortcutsTitle'), {
      sectionLabel: t('settings.architect.controlsTitle'),
      subtitle: t('settings.architect.shortcutsHint'),
      keywords: ['keyboard', 'shortcuts', 'hotkeys'],
      anchorId: SETTINGS_SEARCH_ANCHORS.architectShortcuts,
    }),
    item('everything', 'architect-search-sort', t('settings.architect.searchSortTitle'), {
      sectionLabel: t('settings.architect.controlsTitle'),
      subtitle: t('settings.architect.searchSortHint'),
      keywords: ['search', 'sort', 'order', 'results'],
      anchorId: SETTINGS_SEARCH_ANCHORS.architectSearchSort,
    }),

    // Vinyl / record player
    item('music', 'vinyl-display-mode', t('settings.vinyl.displayModeTitle'), {
      sectionLabel: t('settings.tabs.vinyl'),
      subtitle: t('settings.vinyl.hint'),
      keywords: ['manual', 'follow genre', 'auto', 'genre theme'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vinylDisplay,
    }),
    item('music', 'vinyl-official-presets', t('settings.vinyl.officialPresetsTitle'), {
      sectionLabel: t('settings.tabs.vinyl'),
      subtitle: t('settings.vinyl.officialPresetsHint'),
      keywords: ['classic void', 'neon', 'warmth', 'official preset'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vinylOfficial,
    }),
    item('music', 'vinyl-genre-mapping', t('settings.vinyl.genreMappingTitle'), {
      sectionLabel: t('settings.tabs.vinyl'),
      subtitle: t('settings.vinyl.genreMappingHint'),
      keywords: ['hip hop', 'electronic', 'rock', 'jazz', 'pop', 'r&b', 'genre'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vinylGenre,
    }),
    item('music', 'vinyl-visual-sliders', t('settings.vinyl.visualSlidersTitle'), {
      sectionLabel: t('settings.tabs.vinyl'),
      subtitle: t('settings.vinyl.visualSlidersHint'),
      keywords: ['psychedelic', 'visuals', 'hue', 'warp', 'trip', 'universe', 'sliders'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vinylVisuals,
    }),
    item('music', 'vinyl-community-packs', t('settings.vinyl.communityPacksTitle'), {
      sectionLabel: t('settings.tabs.vinyl'),
      subtitle: t('settings.vinyl.communityPacksHint'),
      keywords: ['record player', 'addon', 'community', 'visual pack', 'install url'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vinylCommunity,
    }),

    // Add-ons
    item('music', 'addons-dj-console', 'DJ Console', {
      sectionLabel: t('settings.addons.builtinStationsTitle'),
      subtitle: 'Show the visual DJ mixer in the station menu',
      keywords: ['dj', 'mixer', 'pro audio', 'deck'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsBuiltin,
    }),
    item('podcasts', 'addons-podcasts', 'Podcasts station', {
      sectionLabel: t('settings.addons.builtinStationsTitle'),
      subtitle: 'Subscribe to RSS feeds and stream episodes',
      keywords: ['podcast', 'rss', 'episodes'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsBuiltin,
    }),
    item('audiobooks', 'addons-audiobook-acquire', t('audiobooks.acquirePluginsTitle'), {
      sectionLabel: t('settings.addons.builtinStationsTitle'),
      subtitle: t('audiobooks.acquirePluginsHint'),
      keywords: ['audiobook', 'torrent', 'magnet', 'search plugin', 'acquire', 'debrid'],
      anchorId: SETTINGS_SEARCH_ANCHORS.audiobookAcquirePlugins,
    }),
    item('podcasts', 'addons-podcast-wifi', 'Podcast auto-save Wi-Fi only', {
      sectionLabel: t('settings.addons.builtinStationsTitle'),
      subtitle: 'Default Wi-Fi guard for per-show offline auto-save',
      keywords: ['podcast', 'wifi', 'offline', 'auto-save', 'cellular'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsBuiltin,
    }),
    item('podcasts', 'addons-podcast-seek', 'Podcast skip interval', {
      sectionLabel: t('settings.addons.builtinStationsTitle'),
      subtitle: 'Forward and back jump seconds in the podcast player',
      keywords: ['podcast', 'seek', 'skip', 'interval', '15', '30', '45', '60'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsBuiltin,
    }),
    item('music', 'addons-discover', t('settings.addons.discoverStation'), {
      sectionLabel: t('settings.addons.builtinStationsTitle'),
      subtitle: t('settings.addons.discoverStationHint'),
      keywords: ['discover', 'feed', 'explore', 'playlists'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsBuiltin,
    }),
    item('music', 'addons-locker-follow', t('settings.addons.lockerAutoFollow'), {
      sectionLabel: t('settings.addons.builtinStationsTitle'),
      subtitle: t('settings.addons.lockerAutoFollowHint'),
      keywords: ['follow', 'artists', 'library', 'feed'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsBuiltin,
    }),
    item('everything', 'addons-server-url', t('settings.addons.serverUrlLabel'), {
      sectionLabel: t('settings.addons.acquisitionTitle'),
      subtitle: t('settings.addons.serverUrlOptionalHint'),
      keywords: ['sandbox server', 'backend', 'tier34', 'url', 'localhost'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsAcquisition,
    }),
    item('everything', 'addons-acquisition-tier', t('settings.addons.acquisitionTierTitle'), {
      sectionLabel: t('settings.addons.acquisitionTitle'),
      subtitle: t('settings.addons.acquisitionTierHint'),
      keywords: ['tier 3', 'tier 4', 'proxy', 'debrid', 'best available', 'acquisition', 'download source'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsAcquisition,
    }),
    item('everything', 'addons-sandbox-indexer', 'Sandbox Indexer', {
      sectionLabel: t('settings.addons.acquisitionTitle'),
      subtitle: t('settings.addons.sandboxIndexerHint'),
      keywords: ['indexer', 'search', 'yt-dlp', 'archive', 'prowlarr', 'jackett', 'torznab'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsAcquisition,
    }),
    item('everything', 'addons-podcast-indexer', t('settings.addons.externalIndexerUrl'), {
      sectionLabel: t('settings.addons.acquisitionTitle'),
      subtitle: t('settings.addons.externalIndexerHint'),
      keywords: ['prowlarr', 'indexer', 'external', 'advanced'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsAcquisition,
    }),
    item('everything', 'addons-premium-downloads', t('settings.addons.premiumDownloadsKey'), {
      sectionLabel: t('settings.addons.acquisitionTitle'),
      subtitle: 'API key for premium download service',
      keywords: ['real debrid', 'premium', 'downloads'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsAcquisition,
    }),
    item('music', 'addons-discogs-token', t('settings.addons.discogsApiToken'), {
      sectionLabel: t('settings.addons.acquisitionTitle'),
      subtitle: t('settings.addons.discogsApiTokenHint'),
      keywords: ['discogs', 'cover art', 'album art', 'mixtape', 'bootleg'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsAcquisition,
    }),
    item('music', 'addons-locker-search', t('settings.addons.lockerSearchTitle'), {
      sectionLabel: t('settings.addons.acquisitionTitle'),
      subtitle: t('settings.addons.lockerSearchFootnote'),
      keywords: ['meilisearch', 'full-text', 'locker search', 'reindex'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsAcquisition,
    }),
    item('everything', 'addons-experimental', 'Show experimental integrations', {
      sectionLabel: t('settings.addons.experimentalTitle'),
      subtitle: t('settings.addons.experimentalHint'),
      keywords: ['soundcloud', 'webtorrent', 'ipfs', 'stub'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsExperimental,
    }),

    // Security
    item('everything', 'security-air-gap', 'Air-gap mode', {
      sectionLabel: t('settings.security.title'),
      subtitle: t('settings.security.airGapHint'),
      keywords: ['offline', 'internet', 'block', 'air gap'],
      anchorId: SETTINGS_SEARCH_ANCHORS.securityMain,
    }),
    item('everything', 'security-ephemeral', 'Ephemeral chamber', {
      sectionLabel: t('settings.security.title'),
      subtitle: t('settings.security.ephemeralChamberHint'),
      keywords: ['session', 'keys', 'temporary'],
      anchorId: SETTINGS_SEARCH_ANCHORS.securityMain,
    }),
    item('everything', 'security-ghost', 'Ghost protocol', {
      sectionLabel: t('settings.security.title'),
      subtitle: t('settings.security.ghostProtocolHint'),
      keywords: ['sign out', 'tokens', 'api keys'],
      anchorId: SETTINGS_SEARCH_ANCHORS.securityMain,
    }),
    item('everything', 'security-defense', 'Defense protocol (server)', {
      sectionLabel: t('settings.security.title'),
      subtitle: t('settings.security.defenseProtocolHint'),
      keywords: ['tier34', 'proxy', 'server'],
      anchorId: SETTINGS_SEARCH_ANCHORS.securityMain,
    }),
    item('everything', 'security-persistence', 'Data persistence', {
      sectionLabel: t('settings.security.title'),
      subtitle: t('settings.security.dataPersistenceHint'),
      keywords: ['preferences', 'local storage', 'persist'],
      anchorId: SETTINGS_SEARCH_ANCHORS.securityMain,
    }),
    item('everything', 'security-server-keys', t('settings.security.serverKeysTitle'), {
      sectionLabel: t('settings.security.title'),
      subtitle: t('settings.security.serverKeysHint'),
      keywords: ['server', 'keys', 'environment'],
      anchorId: SETTINGS_SEARCH_ANCHORS.securityMain,
    }),

    // Diagnostics
    item('everything', 'diagnostics-sovereign', t('settings.diagnostics.sovereignStatusTitle'), {
      sectionLabel: t('settings.diagnostics.title'),
      subtitle: t('settings.diagnostics.sovereignStatusHint'),
      keywords: ['system status', 'health', 'services'],
      anchorId: SETTINGS_SEARCH_ANCHORS.diagnosticsMain,
    }),
    item('everything', 'diagnostics-validation', t('settings.diagnostics.validationSuiteTitle'), {
      sectionLabel: t('settings.diagnostics.title'),
      subtitle: t('settings.diagnostics.validationIdleHint'),
      keywords: ['validation', 'suite', 'tier34'],
      anchorId: SETTINGS_SEARCH_ANCHORS.diagnosticsMain,
    }),
    item('everything', 'diagnostics-clear-cache', t('settings.diagnostics.clearCacheTitle'), {
      sectionLabel: t('settings.diagnostics.title'),
      subtitle: t('settings.diagnostics.clearCacheHint'),
      keywords: ['cache', 'feed', 'charts', 'lyrics', 'clear'],
      anchorId: SETTINGS_SEARCH_ANCHORS.diagnosticsMain,
    }),

    // Telemetry
    item('everything', 'telemetry-cache', t('settings.telemetry.title'), {
      subtitle: t('settings.telemetry.hint'),
      keywords: ['lru', 'cache', 'search cache'],
      anchorId: SETTINGS_SEARCH_ANCHORS.telemetryMain,
    }),
    item('everything', 'telemetry-source-log', t('settings.telemetry.sourceResolutionLog'), {
      sectionLabel: t('settings.telemetry.title'),
      subtitle: 'Tier resolution outcomes from playback',
      keywords: ['source', 'resolution', 'tier', 'log'],
      anchorId: SETTINGS_SEARCH_ANCHORS.telemetryMain,
    }),
    item('everything', 'telemetry-collection', t('settings.telemetry.collectionTitle'), {
      sectionLabel: t('settings.telemetry.title'),
      subtitle: t('settings.telemetry.collectionHealHint'),
      keywords: ['library', 'catalog', 'graph', 'dedup'],
      anchorId: SETTINGS_SEARCH_ANCHORS.telemetryMain,
    }),

    // About & Help
    item('everything', 'about-app', t('settings.about.title'), {
      subtitle: t('settings.about.hint'),
      keywords: ['about', 'help', 'guide', 'version', 'app'],
      anchorId: SETTINGS_SEARCH_ANCHORS.aboutMain,
    }),
    item('everything', 'about-addon-guide', t('settings.about.addonGuideTitle'), {
      subtitle: t('settings.about.addonGuideHint'),
      keywords: ['addon', 'manifest', 'install', 'community'],
      anchorId: SETTINGS_SEARCH_ANCHORS.aboutMain,
    }),
    item('everything', 'about-connect', t('settings.about.connectTitle'), {
      subtitle: t('settings.about.connectHint'),
      keywords: ['connect', 'role', 'host', 'remote', 'multi-device'],
      anchorId: SETTINGS_SEARCH_ANCHORS.aboutMain,
    }),

    
    item('music', 'playback-scrobble', t('settings.playback.scrobbleTitle'), {
      sectionLabel: t('settings.playback.title'),
      subtitle: t('settings.playback.scrobbleHint'),
      keywords: ['scrobble', 'lastfm', 'listenbrainz'],
      anchorId: SETTINGS_SEARCH_ANCHORS.playbackMain,
    }),
    item('music', 'addons-dj-routing', t('settings.addons.djAudioRoutingTitle'), {
      sectionLabel: t('settings.addons.builtinStationsTitle'),
      subtitle: t('settings.addons.djAudioRoutingDesc'),
      keywords: ['dj', 'routing', 'stems'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsBuiltin,
    }),
    item('audiobooks', 'addons-audiobooks-station', 'Audiobooks station', {
      sectionLabel: t('settings.categories.audiobooks'),
      subtitle: t('settings.categories.audiobooksDesc'),
      keywords: ['audiobooks', 'station', 'enable'],
    }),
    item('music', 'addons-sonic-locker', t('settings.addons.sonicLockerStation'), {
      sectionLabel: t('settings.addons.builtinStationsTitle'),
      subtitle: t('settings.addons.sonicLockerStationHint'),
      keywords: ['sonic locker', 'station'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsBuiltin,
    }),
    item('music', 'addons-library-station', t('settings.addons.libraryStation'), {
      sectionLabel: t('settings.addons.builtinStationsTitle'),
      subtitle: t('settings.addons.libraryStationHint'),
      keywords: ['library', 'station'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsBuiltin,
    }),
    item('music', 'addons-followed-release', t('settings.addons.followedReleaseNotif'), {
      sectionLabel: t('settings.addons.builtinStationsTitle'),
      subtitle: t('settings.addons.followedReleaseNotifHint'),
      keywords: ['follow', 'release', 'notification'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsBuiltin,
    }),
    item('everything', 'security-lan-party', 'LAN party', {
      sectionLabel: t('settings.security.title'),
      keywords: ['lan', 'party', 'local network'],
      anchorId: SETTINGS_SEARCH_ANCHORS.securityMain,
    }),
    item('everything', 'security-key-sync', 'Sync keys via Sandbox Server', {
      sectionLabel: t('settings.security.title'),
      keywords: ['key sync', 'device secret', 'keys'],
      anchorId: SETTINGS_SEARCH_ANCHORS.securityMain,
    }),
    item('everything', 'vault-storage-reclaim', 'Storage reclaim', {
      sectionLabel: t('settings.vault.title'),
      subtitle: 'Free reclaimable cache and temporary files',
      keywords: ['reclaim', 'free space', 'cache', 'temp'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vaultCapacity,
    }),
    item('everything', 'architect-nav-pins', t('settings.navPins.title'), {
      sectionLabel: t('settings.everything.appearance'),
      subtitle: t('settings.navPins.hint'),
      keywords: ['nav', 'pins', 'tabs', 'bottom bar'],
      anchorId: SETTINGS_SEARCH_ANCHORS.architectPresets,
    }),
    item('everything', 'vault-aggressive-cache', 'Aggressive offline cache', {
      sectionLabel: t('settings.vault.title'),
      keywords: ['aggressive', 'offline', 'prefetch', 'cache'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vaultStreamCache,
    }),
    item('music', 'vault-taste-recipes', 'Taste recipes', {
      sectionLabel: t('settings.categories.music'),
      keywords: ['taste', 'recipe', 'station'],
      anchorId: SETTINGS_SEARCH_ANCHORS.vaultTasteRecipes,
    }),
    item('everything', 'addons-mobile-resolvers', 'Mobile resolvers', {
      sectionLabel: t('settings.everything.serverAcquisition'),
      keywords: ['mobile', 'resolver', 'on-device'],
      anchorId: SETTINGS_SEARCH_ANCHORS.addonsMobileResolvers,
    }),
    item('podcasts', 'podcast-index-creds', 'Podcast Index', {
      sectionLabel: t('settings.categories.podcasts'),
      keywords: ['podcast index', 'api key', 'secret'],
    }),
    item('everything', 'diagnostics-runtime', 'Runtime platform', {
      sectionLabel: t('settings.diagnostics.title'),
      keywords: ['runtime', 'platform', 'capacitor', 'tauri'],
      anchorId: SETTINGS_SEARCH_ANCHORS.diagnosticsMain,
    }),
    item('everything', 'telemetry-provider', 'Provider reliability', {
      sectionLabel: t('settings.telemetry.title'),
      keywords: ['provider', 'reliability', 'scores'],
      anchorId: SETTINGS_SEARCH_ANCHORS.telemetryMain,
    }),

    // Profile (always visible at bottom)
    item('everything', 'profile-sign-out', t('settings.signOut'), {
      subtitle: t('settings.profile'),
      keywords: ['logout', 'account', 'profile'],
      anchorId: SETTINGS_SEARCH_ANCHORS.profileSignOut,
    }),
  ];
}

export function filterSettingsSearch(
  items: SettingsSearchItem[],
  query: string,
): SettingsSearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return items.filter((item) => {
    const haystack = [
      item.title,
      item.subtitle,
      item.sectionLabel,
      item.categoryLabel,
      ...(item.keywords ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });
}
