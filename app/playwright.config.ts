import { defineConfig, devices, type Project } from '@playwright/test';
import type { Profile } from './scripts/dataServer';
import { DATA_URL, DEV_PORT, DEV_URL, PREVIEW_PORT, PREVIEW_URL } from './e2e/servers';

// CI's software renderer. SwiftShader screenshots misrepresent the look and timing, so this
// project only proves that a frame renders and that the GPU pools behave.
const swiftshader: Project = {
  name: 'swiftshader',
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

// vite preview serves the production build for the smoke test; the lab needs only the dev server
// and the region bake.
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
// A build served as R2 serves it: the fixture for every run (CI builds it first), the region bake
// for lab runs.
const data = (profile: Profile) => ({
  command: `node scripts/dataServer.ts --profile ${profile}`,
  url: `${DATA_URL[profile]}/release.json`,
  reuseExistingServer: !process.env.CI,
});

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: PREVIEW_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: process.env.CI ? [swiftshader] : LAB ? [lab] : [swiftshader, gpuChromium],
  webServer: LAB ? [dev, data('region')] : [preview, dev, data('fixture')],
});
