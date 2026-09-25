import { defineConfig, devices, type Project } from '@playwright/test';
import { DEV_PORT, DEV_URL, PREVIEW_PORT, PREVIEW_URL } from './e2e/servers';

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

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: PREVIEW_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [swiftshader],
  webServer: [
    {
      command: `npm run preview -- --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
      url: PREVIEW_URL,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${DEV_PORT} --strictPort`,
      url: DEV_URL,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
