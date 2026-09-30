import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { labReports } from './e2e/lab/reports.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  // labReports: the dev server writes what lab pages post to build/lab/ (e2e/lab/reports.ts).
  plugins: [labReports()],
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('../shared', import.meta.url)) },
  },
  // shared/ sits outside app/, so the dev server must be allowed to read the repo root.
  server: { fs: { allow: [repoRoot] } },
  // The dev server scans every page it serves, the app's, the dev pages and the test pages
  // (e2e/*.html), and bundles what they import at startup: a cold server that met a new import
  // mid-test would re-optimize and reload that page, and every CI e2e shard starts a cold one.
  optimizeDeps: { entries: ['*.html', 'e2e/*.html'] },
  build: {
    // The app ships as one entry bundle with no lazy chunks (streaming design, section 2), so
    // Vite's code-splitting hint does not apply; section 6 budgets the entry at 500 KB compressed.
    chunkSizeWarningLimit: 1500,
    // The credits page and Pages' 404 are plain HTML and CSS, sharing the app's hashed fonts.
    rolldownOptions: {
      input: { main: 'index.html', credits: 'credits.html', notFound: '404.html' },
    },
    // The bundled packages' licenses, which the credits page links to.
    license: { fileName: 'licenses.txt' },
  },
  test: { include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'] },
});
