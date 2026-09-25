// `npm run verify:bake`: the checks on the region bake in build/region (src/**/*.verify.ts), kept
// apart from `npm test` because the bake needs the raw data, so they run only locally.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.verify.ts'],
    // Decoding and cross-checking every tile of the bake takes a while.
    hookTimeout: 600_000,
    testTimeout: 60_000,
  },
});
