// The production build (dist/ under vite preview) opens on the lobby and plays the walk: pointed
// at the fixture's data server with ?data=, which the page honors because it is served from
// loopback. The room opens onto a drawn instrument and a key runs the rest of the opening; the
// Credits panel opens from the lobby and closes; the Tambora plaque dives into beat 1, whose title
// shows with its image from the data host, and the Right arrow brings beat 2's; M mutes; the
// card's Credits link opens the panel too; the credits page still loads on its own; nothing logs
// an error; no request goes to Wikimedia: the images are the media stage's, on the data host; and
// once the room opens, nothing more is fetched from the app's own host: every face and worker came
// with the boot.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseStory } from '../src/story/story';
import { DATA_URL, PREVIEW_URL } from './servers';

declare global {
  interface Window {
    /** When #room took is-open, on the page's clock. */
    roomOpenedAt?: number;
  }
}

const story = parseStory(
  readFileSync(new URL('../../stories/tambora/story.md', import.meta.url), 'utf8'),
);

/** The media stage's committed test image, standing in for the story's images. */
const JPEG = readFileSync(
  new URL('../../pipeline/tests/data/media/quadrants.jpg', import.meta.url),
);

/**
 * The fixture bakes no story images, so the data host's img/ keys answer with the test image, as
 * R2 would answer with the baked ones.
 */
async function serveImages(page: Page): Promise<void> {
  await page.route(`${DATA_URL.fixture}/img/**`, (route) =>
    route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: 'image/jpeg',
      body: JPEG,
    }),
  );
}

/**
 * The share of the canvas lit brighter than the room's lamp pool can reach (#160d06 at its
 * brightest): the globe and the instrument, drawn. The walk's DOM layers and the poster's mark,
 * which glides over the canvas as the room opens, are hidden for the shot, and the browser decodes
 * it, so the test needs no PNG library.
 */
async function litFraction(page: Page): Promise<number> {
  const hide = await page.addStyleTag({
    content: '.wu, .walk-labels, .room-mark { visibility: hidden !important; }',
  });
  // A page shot clipped to the canvas, not an element shot: an element shot first waits for two
  // steady frames, and CI's software renderer draws the walk seconds apart.
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('the canvas has no box');
  const png = await page.screenshot({ clip: box });
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

/**
 * Marks the moment the room opens on the page's own clock, which a poll from the test would see
 * late, and keeps every resource entry from then on.
 */
async function markOpening(page: Page): Promise<void> {
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(100_000);
    const watch = new MutationObserver(() => {
      if (!document.getElementById('room')?.classList.contains('is-open')) return;
      window.roomOpenedAt = performance.now();
      watch.disconnect();
    });
    watch.observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
}

/** What the page has fetched from `origin` since the room opened. */
function fetchedSinceOpening(page: Page, origin: string): Promise<string[]> {
  return page.evaluate((from) => {
    const opened = window.roomOpenedAt;
    if (opened === undefined) throw new Error('the room never opened');
    return performance
      .getEntriesByType('resource')
      .filter((entry) => entry.startTime >= opened && new URL(entry.name).origin === from)
      .map((entry) => entry.name);
  }, origin);
}

// Small, so CI's software renderer, which draws the walk seconds apart on its few cores, fills
// fewer pixels a frame.
test.use({ viewport: { width: 640, height: 400 } });

test('enters the Tambora walk from the lobby and opens its credits', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  await serveImages(page);
  await markOpening(page);

  await page.goto(`/?data=${DATA_URL.fixture}`);
  // The room is the poster until the lobby's opening starts, then fades out of the way. Any key
  // runs the rest of the opening, which CI's software renderer would otherwise draw many slow
  // frames of.
  await expect(page.locator('#room')).toBeHidden({ timeout: 60_000 });
  await page.keyboard.press('Shift');
  await expect.poll(() => litFraction(page), { timeout: 90_000 }).toBeGreaterThan(0.05);

  const panel = page.getByRole('dialog', { name: 'Credits' });
  // The sheet's heading, so a sheet hidden inside a shown dialog fails.
  const sheet = panel.getByRole('heading', { name: 'Credits', exact: true });
  await page.locator('.lobby-credits').click({ timeout: 60_000 });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  // The panel fades out over a few frames, which CI's software renderer draws seconds apart.
  await expect(panel).toBeHidden({ timeout: 30_000 });

  await page.locator('.lobby-plaque').click();
  // The walk's card, not the Credits panel's sheet in the same frame.
  const title = page.locator('.wu .wu-card .wu-title');
  await expect(title).toHaveText(story.beats[0]?.title ?? '', { timeout: 30_000 });
  await expect(page.locator('.wu-frame img.is-loaded').first()).toBeAttached();
  await page.keyboard.press('ArrowRight');
  await expect(title).toHaveText(story.beats[1]?.title ?? '', { timeout: 30_000 });
  // M mutes, and the sound knob shows so.
  const sound = page.locator('.wu-sound');
  await expect(sound).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('m');
  await expect(sound).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });

  // The card stays veiled until the walk lands, which CI's renderer reaches only after many slow
  // frames, so its Credits link is pressed as the keyboard would press it, without waiting.
  await page.locator('.wu-card-credits').dispatchEvent('click');
  await expect(sheet).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden({ timeout: 30_000 });
  const fromApp = await fetchedSinceOpening(page, PREVIEW_URL);

  const credits = await page.goto('/credits');
  expect(credits?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Credits');

  expect(errors).toEqual([]);
  expect(requested.filter((url) => url.startsWith(`${DATA_URL.fixture}/img/`))).not.toEqual([]);
  const wikimedia = requested.filter((url) => /(^|\.)wikimedia\.org$/.test(new URL(url).hostname));
  expect(wikimedia).toEqual([]);
  expect(fromApp).toEqual([]);
});
