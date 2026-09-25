import { expect, test, type Page } from '@playwright/test';

const BACKDROP = [0x0d, 0x0b, 0x09];

// Fraction of canvas pixels that differ visibly from the backdrop colour. The browser decodes
// the screenshot, so the test needs no PNG library.
async function drawnFraction(page: Page): Promise<number> {
  const png = await page.locator('canvas').screenshot();
  return page.evaluate(
    async ({ b64, backdrop }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${b64}`;
      await image.decode();
      const scratch = document.createElement('canvas');
      scratch.width = image.width;
      scratch.height = image.height;
      const context = scratch.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      let drawn = 0;
      for (let i = 0; i < data.length; i += 4) {
        const distance =
          Math.abs((data[i] ?? 0) - backdrop[0]!) +
          Math.abs((data[i + 1] ?? 0) - backdrop[1]!) +
          Math.abs((data[i + 2] ?? 0) - backdrop[2]!);
        if (distance > 24) drawn++;
      }
      return drawn / (data.length / 4);
    },
    { b64: png.toString('base64'), backdrop: BACKDROP },
  );
}

test('renders a frame of the instrument', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await expect.poll(() => drawnFraction(page), { timeout: 20_000 }).toBeGreaterThan(0.05);
  expect(errors).toEqual([]);
});
