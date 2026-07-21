import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  // E2E bridge is opt-in only (SANDBOX_ANDROID_E2E=true). Never on release/user APKs.
  const androidDebugE2e = process.env.SANDBOX_ANDROID_E2E === 'true';
  return {
    define: {
      __SANDBOX_ANDROID_E2E__: androidDebugE2e,
      'import.meta.env.VITE_E2E_BRIDGE': JSON.stringify(androidDebugE2e ? 'true' : ''),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
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
                  ),
              ),
              warnings: [],
            }),
          ],
          navigateFallback: 'index.html',
          runtimeCaching: [
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
      port: 3002,
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
