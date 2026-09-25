// The pool smoke test (streaming.md 5.5, 7.3). e2e/gpu-pool.html runs src/gpu/gpuPoolProbe.ts on
// the Vite dev server: three surface pools with 8 slots, a warm() of each, writes of single mips
// (mip 2 of slot 5 above all), and a textureLod readback of what was written and what was not.
// The assertions live in gpuPoolTests.ts, shared with the Safari and Firefox lab runs.
import { test } from '@playwright/test';
import type { ProbeReport } from '../src/gpu/gpuPoolProbe';
import { definePoolTests } from './gpuPoolTests';
import { DEV_URL } from './servers';

const RENDERER: Record<string, RegExp> = {
  swiftshader: /SwiftShader/,
  'gpu-chromium': /Metal/,
};

let report: ProbeReport;
const problems: string[] = [];

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (/INVALID_|GL_OUT_OF_MEMORY/.test(message.text())) problems.push(message.text());
  });
  await page.goto(`${DEV_URL}/e2e/gpu-pool.html`);
  const probe = await page.evaluate(() => window.gpuPoolProbe);
  if (!probe) throw new Error('e2e/gpu-pool.html did not start the probe');
  report = probe;
  await page.close();
});

definePoolTests(() => ({
  report,
  renderer: RENDERER[test.info().project.name] ?? /^$/,
  problems,
}));
