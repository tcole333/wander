import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  // shared/ sits outside app/, so the dev server must be allowed to read the repo root.
  server: { fs: { allow: [repoRoot] } },
  // The pool smoke test's page (e2e/gpu-pool.html) imports three on the dev server. Bundling it
  // at startup keeps a cold server from re-optimizing and reloading that page mid-test.
  optimizeDeps: { include: ['three'] },
  // The app ships as one entry bundle with no lazy chunks (streaming design, section 2), so
  // Vite's code-splitting hint does not apply; section 6 budgets the entry at 500 KB compressed.
  build: { chunkSizeWarningLimit: 1500 },
  test: { include: ['src/**/*.test.ts'] },
});
