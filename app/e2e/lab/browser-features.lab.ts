// What Chromium on Metal and the installed Safari and Firefox offer (streaming.md 5.1, 5.8,
// 8.2 E1), recorded in build/lab/browser-features-<browser>.json. It asserts only what the
// surface path cannot run without: gzip DecompressionStream for tiles (3.1) and the texture limits
// the pools and the surface program assume (5.5, 5.8). The rest is recorded for the E1 decisions.
import { expect, test } from '@playwright/test';
import type { BrowserFeatures } from '../../src/lab/browserFeatures';
import { DEV_URL } from '../servers';
import { EXTERNAL_BROWSERS, runInBrowser } from './external';

function expectSurfacePath(features: BrowserFeatures): void {
  expect(features.decompression.gzip).toBe(true);
  expect(features.webgl2).not.toBeNull();
  const limits = features.webgl2?.limits;
  // 16 fragment samplers is the budget the surface program is planned against (5.8).
  expect(limits?.MAX_TEXTURE_IMAGE_UNITS).toBeGreaterThanOrEqual(16);
  // The surface pools hold up to 256 slots (5.5) of 264² textures.
  expect(limits?.MAX_ARRAY_TEXTURE_LAYERS).toBeGreaterThanOrEqual(256);
}

test('Chromium on Metal', async ({ page }) => {
  await page.goto(`${DEV_URL}/e2e/lab/browser-features.html?report=chromium`);
  const features = await page.evaluate(() => window.browserFeatures);
  if (!features) throw new Error('e2e/lab/browser-features.html did not run');
  expect(features.webgl2?.renderer).toMatch(/Metal/);
  expectSurfacePath(features);
});

for (const browser of EXTERNAL_BROWSERS) {
  test(browser.name, async () => {
    const features = await runInBrowser<BrowserFeatures>(
      browser,
      'e2e/lab/browser-features.html',
      'browser-features',
      60_000,
    );
    expect(features.webgl2?.renderer).toMatch(browser.renderer);
    expectSurfacePath(features);
  });
}
