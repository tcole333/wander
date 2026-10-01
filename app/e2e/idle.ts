// A page that draws the globe on SwiftShader runs frames ahead of the GPU process, which on CI's
// four cores rasterizes them seconds apart. Closed while drawing, it left those frames queued: the
// close, or the browser's next command, waited until they were drawn, and on CI the next spec's
// browser context took 25 to 40 s to set up, past its 30 s. So such a page closes through
// closeIdle, and the next test starts on an idle browser.
import { test as base, type Page } from '@playwright/test';

/**
 * Closes `page`, which may still be drawing, once the GPU process has finished the frames it
 * queued: a blank page in its context reads a pixel back from a fresh WebGL context, which the GPU
 * process answers only once the work queued before it is done.
 */
export async function closeIdle(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await base.step(
    'close the page once the GPU process is idle',
    async () => {
      const blank = await page.context().newPage();
      await page.close();
      await blank.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return;
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      });
      await blank.close();
    },
    { box: true },
  );
}

/** Playwright's `test`, for specs whose page draws the globe: the page closes through closeIdle. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await use(page);
    await closeIdle(page);
  },
});
