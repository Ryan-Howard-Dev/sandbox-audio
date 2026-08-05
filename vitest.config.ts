import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts', 'tier34-server/**/*.test.ts'],
    /*
     * Twenty seconds, not the default five.
     *
     * A handful of tests call `await import(...)` inside the test body rather than at the top of
     * the file, which is deliberate — it lets them observe module state from a fresh evaluation.
     * The cost is that the whole dependency graph is transformed on the clock, inside the timeout.
     *
     * Splitting sandboxLayer3 into three dozen modules grew that graph past five seconds and three
     * unrelated tests started failing: backgroundMedia, downloadQueueRunner, audiobookScrapeClient.
     * Nothing was wrong with any of them. They looked exactly like the load flakiness seen earlier
     * in the day, right down to failing under a full run and passing alone, until the transform
     * figure gave it away — 8.8 seconds of transforming against a 5 second limit.
     *
     * A timeout is meant to catch a hang, and this raises it to a length no correct test here
     * approaches while still failing a genuinely stuck one in a reasonable time.
     */
    testTimeout: 20_000,
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
