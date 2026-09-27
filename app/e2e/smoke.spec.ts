// The production build (dist/ under vite preview) plays the walk: pointed at the fixture's data
// server with ?data=, which the page honors because it is served from loopback, and with
// Wikimedia Commons stubbed so no run depends on it. The room opens onto a drawn globe, beat 1's
// title shows, the Right arrow brings beat 2's, the credits page loads, and nothing logs an error.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseStory } from '../src/story/story';
import { DATA_URL } from './servers';

const story = parseStory(
  readFileSync(new URL('../../stories/tambora/story.md', import.meta.url), 'utf8'),
);

/** A 1×1 PNG for every image Commons would serve. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

/** Commons' API answers every file with the stub image, and its thumbnails are the stub. */
async function stubCommons(page: Page): Promise<void> {
  const thumb = 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Stub.png/960px-Stub.png';
  await page.route('https://commons.wikimedia.org/**', (route) =>
    route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      json: {
        query: {
          pages: {
            '1': {
              imageinfo: [
                {
                  url: thumb,
                  thumburl: thumb,
                  width: 1400,
                  height: 1000,
                  descriptionurl: 'https://commons.wikimedia.org/wiki/File:Stub.png',
                  extmetadata: {
                    Artist: { value: 'A mapmaker' },
                    LicenseShortName: { value: 'Public domain' },
                  },
                },
              ],
            },
          },
        },
      },
    }),
  );
  await page.route('https://upload.wikimedia.org/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PNG }),
  );
}

/**
 * The share of the canvas lit brighter than the room's lamp pool can reach (#160d06 at its
 * brightest): the globe and the instrument, drawn. The walk's DOM layers are hidden for the shot,
 * and the browser decodes it, so the test needs no PNG library.
 */
async function litFraction(page: Page): Promise<number> {
  const hide = await page.addStyleTag({
    content: '.wu, .walk-labels { visibility: hidden !important; }',
  });
  const png = await page.locator('canvas').screenshot();
  await hide.evaluate((style) => style.parentNode?.removeChild(style));
  return page.evaluate(async (b64) => {
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
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 120) lit++;
    }
    return lit / (data.length / 4);
  }, png.toString('base64'));
}

test('plays the Tambora walk from the fixture and links its credits', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await stubCommons(page);

  await page.goto(`/?data=${DATA_URL.fixture}`);
  // The room is the poster until the first live frame, then fades out of the way.
  await expect(page.locator('#room')).toBeHidden({ timeout: 60_000 });
  await expect.poll(() => litFraction(page), { timeout: 20_000 }).toBeGreaterThan(0.05);

  const title = page.locator('.wu-card .wu-title');
  await expect(title).toHaveText(story.beats[0]?.title ?? '');
  await page.keyboard.press('ArrowRight');
  await expect(title).toHaveText(story.beats[1]?.title ?? '');

  const href = await page.locator('.wu-card-credits').getAttribute('href');
  const credits = await page.goto(href ?? '');
  expect(credits?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Credits');

  expect(errors).toEqual([]);
});
