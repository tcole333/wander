// E1's uniform-branch check (streaming.md 8.2): with a layer's uniform off, the driver skips its
// block instead of flattening the branch. It runs in Chromium on Metal (the lab project's browser)
// and in the installed Safari and Firefox. The ANGLE D3D11 check waits for the Windows laptop in the
// pre-launch rerun. Each run leaves build/lab/uniform-branches-<browser>.json.
import { expect, test } from '@playwright/test';
import { FAMILIES, type UniformBranchReport } from '../../src/lab/uniformBranches';
import { DEV_URL } from '../servers';
import { EXTERNAL_BROWSERS, runInBrowser } from './external';

// Skipped measures near 0 and flattened near 1; a quarter leaves room for timer resolution.
const SKIPPED = 0.25;
const TIMEOUT = 3 * 60_000;

function expectSkipped(report: UniformBranchReport): void {
  expect(report.glError).toBe(0);
  for (const family of FAMILIES) {
    expect(report.paidWhenOff[family], family).toBeLessThan(SKIPPED);
  }
}

test('Chromium on Metal skips blocks behind uniforms that are off', async ({ page }) => {
  test.setTimeout(TIMEOUT);
  await page.goto(`${DEV_URL}/e2e/lab/uniform-branches.html?report=chromium`);
  const report = await page.evaluate(() => window.uniformBranches);
  if (!report) throw new Error('e2e/lab/uniform-branches.html did not start the probe');
  expect(report.renderer).toMatch(/Metal/);
  expect(report.timerQuery).toBe(true);
  expectSkipped(report);
});

for (const browser of EXTERNAL_BROWSERS) {
  test(`${browser.name} skips blocks behind uniforms that are off`, async () => {
    test.setTimeout(TIMEOUT);
    const report = await runInBrowser<UniformBranchReport>(
      browser,
      'e2e/lab/uniform-branches.html',
      'uniform-branches',
      TIMEOUT - 10_000,
    );
    expect(report.renderer).toMatch(browser.renderer);
    expectSkipped(report);
  });
}
