import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  // E2E bridge is opt-in only (SANDBOX_ANDROID_E2E=true). Never on release/user APKs.
  const androidDebugE2e = process.env.SANDBOX_ANDROID_E2E === 'true';
  // App-level Last.fm API key baked in at build time so every user gets similar-artist radio
  // with zero setup. Read-only endpoints (getSimilar) need only a key — no user OAuth. Set
  // SANDBOX_LASTFM_API_KEY=<key> when building; leave empty to require a per-user key instead.
  const lastfmAppApiKey = process.env.SANDBOX_LASTFM_API_KEY?.trim() ?? '';
  /*
   * No service worker inside a packaged app.
   *
   * A worker exists to serve a web page offline. Android and the desktop already carry every asset
   * locally, so it caches files that were never going to be fetched and gains nothing — while
   * costing something real: the desktop app was found serving a bundle that no longer existed on
   * disk, so a rebuilt app showed the previous version's interface and every change looked like it
   * had silently failed to ship.
   */
  const packaged =
    process.env.SANDBOX_BUILD_TARGET === 'android' ||
    process.env.SANDBOX_BUILD_TARGET === 'tauri';
  return {
    define: {
      __SANDBOX_ANDROID_E2E__: androidDebugE2e,
      'import.meta.env.VITE_E2E_BRIDGE': JSON.stringify(androidDebugE2e ? 'true' : ''),
      __LASTFM_APP_API_KEY__: JSON.stringify(lastfmAppApiKey),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        /*
         * Self-destroying rather than absent, because absent cannot reach the installs that
         * already have one.
         *
         * A registered worker outlives the build that registered it and keeps serving its cache,
         * including the index.html that would have loaded the code to remove it. Simply not
         * shipping a worker leaves those installs stuck on whatever they cached, permanently.
         * This ships a worker whose only job is to unregister itself and drop its caches, which is
         * the one thing the old worker will accept as an update.
         */
        selfDestroying: packaged,
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
        manifest: {
          name: 'Sovereign Music Console',
          short_name: 'Sovereign',
          description: 'Self-hosted music console and locker',
          theme_color: '#07080c',
          background_color: '#07080c',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: '/icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
          ],
        },
        workbox: {
          // Main bundle exceeds default 2 MiB precache limit after station growth.
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
          manifestTransforms: [
            (entries) => ({
              manifest: entries.filter(
                (entry) =>
                  !/\/(?:zh|es|pt|ar|ru|de|fr|ja|ko|hi|id|tr|it|nl|pl|vi|th|bn)-[A-Za-z0-9_-]+\.js$/.test(
                    entry.url,
                  ) &&
                  // pdfExtract is pdfjs-dist, the single largest chunk in the build at ~537 kB.
                  // It is only reached when someone opens a PDF, so precaching it charged every
                  // install for a feature most users never touch — and it is what pushed the
                  // precache over its 3.5 MiB budget. Cached on first use below instead, so
                  // offline PDF reading still works once the feature has been opened once.
                  !/\/pdfExtract-[A-Za-z0-9_-]+\.js$/.test(entry.url),
              ),
              warnings: [],
            }),
          ],
          navigateFallback: 'index.html',
          runtimeCaching: [
            {
              // CacheFirst, not StaleWhileRevalidate: the filename is content-hashed, so a given
              // URL never changes contents and revalidating it only costs a request. A new build
              // produces a new hash and misses the cache on its own.
              urlPattern: /\/pdfExtract-[A-Za-z0-9_-]+\.js$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'pdf-extract-cache',
                expiration: {maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 30},
                cacheableResponse: {statuses: [0, 200]},
              },
            },
            {
              urlPattern: /\/(?:zh|es|pt|ar|ru|de|fr|ja|ko|hi|id|tr|it|nl|pl|vi|th|bn)-[A-Za-z0-9_-]+\.js$/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'locale-cache',
                expiration: {maxEntries: 19, maxAgeSeconds: 60 * 60 * 24 * 7},
                cacheableResponse: {statuses: [0, 200]},
              },
            },
            {
              urlPattern: /^https:\/\/itunes\.apple\.com\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'catalog-cache',
                expiration: {maxEntries: 64, maxAgeSeconds: 86_400},
              },
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              if (id.includes('/src/e2eDevAction')) return 'e2e-bridge';
              if (id.includes('/src/i18n/locales/')) return undefined;
              if (id.includes('/src/i18n/') || id.includes('/src/languageSettings')) {
                return 'i18n';
              }
              if (id.includes('/src/stations/FeedView')) return 'discover-feed';
              if (id.includes('/src/stations/ExploreView')) return 'discover-explore';
              if (id.includes('/src/stations/PlaylistsView')) return 'discover-playlists';
              if (id.includes('/src/stations/MobileDiscoverView')) return 'discover-mobile';
              if (id.includes('/src/stations/DiscoverStationView')) return 'discover-shell';
              if (id.includes('/src/stations/SettingsView')) return 'station-settings';
              if (id.includes('/src/stations/SearchResultsView')) return 'station-search';
              if (id.includes('/src/stations/CollectionView')) return 'station-locker';
              if (id.includes('/src/stations/DJStationView')) return 'station-dj';
              if (id.includes('/src/stations/PodcastsView')) return 'station-podcasts';
              if (id.includes('/src/stations/AudiobooksView')) return 'station-audiobooks';
              if (
                id.includes('/src/audiobookScrapeClient') ||
                id.includes('/tier34-server/lib/audiobookScrapeCore')
              ) {
                return 'audiobook-scrape';
              }
              if (id.includes('/src/stations/ArtistDetailView')) return 'station-artist';
              if (id.includes('/src/stations/SonicLockerStationView')) return 'station-sonic';
              if (id.includes('/src/stations/ListeningStatsView')) return 'station-insights';
              if (id.includes('/src/tier34/')) return 'tier34-client';
              return undefined;
            }
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
              return 'vendor-react';
            }
            if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
            if (id.includes('node_modules/motion')) return 'vendor-motion';
            return undefined;
          },
        },
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/musicbrainz': {
          target: 'https://musicbrainz.org',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/musicbrainz/, ''),
        },
        '/coverart': {
          target: 'https://coverartarchive.org',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/coverart/, ''),
        },
      },
    },
  };
});
