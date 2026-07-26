import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'tier34-server/**/*.test.ts'],
    server: {
      // Vitest caches node_modules per worker, so @capacitor/core's plugin registry outlived each
      // test file and every later file logged "already registered". Inlining it gives each file a
      // fresh registry, which is what the app actually has.
      deps: { inline: ['@capacitor/core'] },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
