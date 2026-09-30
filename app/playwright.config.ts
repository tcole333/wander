import { defineConfig, devices, type Project } from '@playwright/test';
import type { Profile } from './scripts/release';
import { DATA_URL, DEV_PORT, DEV_URL, PREVIEW_PORT, PREVIEW_URL } from './e2e/servers';

// CI runs the browser tests as parallel jobs, one per shard named here plus 'rest' (ci.yml's e2e
// matrix lists every one), so the slowest shard sets how long CI takes. Each named shard runs the
// specs it lists, grouped by their times on CI; 'rest' runs every spec no shard names, so a new
// spec lands there. WANDER_E2E_SHARD picks one; unset, as in every local run, every spec runs.
const NAMED_SHARDS = new Map<string, string[]>([
  ['magellan', ['story-selection.spec.ts']],
  ['lobby', ['lobby-round-trip.spec.ts', 'globe-mesh.spec.ts']],
  ['explore', ['explore-entry.spec.ts', 'marks.spec.ts']],
]);

function shardSpecs(shard: string | undefined): Pick<Project, 'testMatch' | 'testIgnore'> {
  if (!shard) return {};
  if (shard === 'rest') return { testIgnore: [...NAMED_SHARDS.values()].flat() };
  const specs = NAMED_SHARDS.get(shard);
  if (!specs) {
    const known = [...NAMED_SHARDS.keys(), 'rest'].join(', ');
    throw new Error(`WANDER_E2E_SHARD=${shard} names no shard; the shards are ${known}.`);
  }
  return { testMatch: specs };
}

const shard = shardSpecs(process.env.WANDER_E2E_SHARD);

// CI's software renderer. SwiftShader screenshots misrepresent the look and timing, so this
// project only proves that a frame renders and that the GPU pools behave. It never lists tests
// tagged @gpu, walks too long for CI's four cores: a test skipped from inside its body still sets
// up a browser context first, and under that load the setup can pass its 30 s.
const swiftshader: Project = {
  name: 'swiftshader',
  ...shard,
  grepInvert: /@gpu\b/,
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 960, height: 600 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
};

// This Mac's GPU (`npm run e2e:gpu`), the first project of the GPU matrix in streaming.md 7.3.
// CI runners have no GPU, so CI never lists it.
const gpuChromium: Project = {
  name: 'gpu-chromium',
  ...shard,
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--use-angle=metal'] },
  },
};

// Lab runs on this Mac (`npm run lab`, which sets WANDER_LAB): measurements and cross-browser
// checks, in *.lab.ts files that no other project matches. Chromium runs on this GPU through
// Playwright, as itself on a Retina display rather than an emulated desktop, so the reports record
// what it really is; the installed Safari and Firefox open lab pages that post their reports to the
// dev server (e2e/lab/external.ts). One test at a time, so runs never share the GPU. Never in CI,
// and never in a run that did not ask for it, since it opens windows in both browsers.
const lab: Project = {
  name: 'lab',
  testMatch: '**/*.lab.ts',
  timeout: 5 * 60_000,
  workers: 1,
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    launchOptions: { args: ['--use-angle=metal'] },
  },
};

const LAB = !!process.env.WANDER_LAB;

// vite preview serves the production build for the smoke test; the lab needs only the dev server.
// Lab specs that read the region bake start its data server themselves.
const preview = {
  command: `npm run preview -- --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
  url: PREVIEW_URL,
  reuseExistingServer: !process.env.CI,
};
const dev = {
  command: `npm run dev -- --host 127.0.0.1 --port ${DEV_PORT} --strictPort`,
  url: DEV_URL,
  reuseExistingServer: !process.env.CI,
};
// The fixture served as R2 serves it, for every run but the lab's (CI builds it first).
const data = (profile: Profile) => ({
  command: `node scripts/dataServer.ts --profile ${profile}`,
  url: `${DATA_URL[profile]}/release.json`,
  reuseExistingServer: !process.env.CI,
});

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  // CI's four-core runner cannot hold two SwiftShader walks at once: sharing it, each drew a frame
  // every two to five seconds, and a browser context's setup and a lobby dive both ran past their
  // limits. One test at a time gives each walk the whole runner; CI's parallelism is the shards,
  // each on a runner of its own.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: PREVIEW_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: process.env.CI ? [swiftshader] : LAB ? [lab] : [swiftshader, gpuChromium],
  webServer: LAB ? [dev] : [preview, dev, data('fixture')],
});
