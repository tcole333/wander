// The Tambora walk on the border steps, from the production build's lobby (dist/ under vite
// preview, on the fixture's data server through ?data=, whose release names the steps; ?hooks=1
// serves the page's readiness as window.__wanderView): the lobby preloads the walk's first border
// step, the 1815 step of its first beat, before any plaque is chosen, and the Credits panel names
// Cliopatria; the dive lands on beat 1, whose page counts as ready only with that step drawn under
// the walk's plate, fetched once. With the step held back (on the GPU only: a held fetch gives up
// after its retries, about 50 s on, sooner than CI's software renderer settles the beat), the beat
// lands, its tiles settle, and it still waits, plate down, until the step arrives. Nothing logs an
// error, and the images are the media stage's test image.
import { expect as playwrightExpect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Release } from '../src/data/release';
import { test } from './idle';
import { DATA_URL, PREVIEW_URL } from './servers';

const TIMEOUT = 90_000;
const expect = playwrightExpect.configure({ timeout: TIMEOUT });

const JPEG = readFileSync(
  new URL('../../pipeline/tests/data/media/quadrants.jpg', import.meta.url),
);
/** The walk's plate, while it shows the borders drawn. */
const PLATE = '.wu-story .wu-borders.is-shown';

// CI's software renderer needs fewer pixels per frame.
test.use({ viewport: { width: 640, height: 400 } });

async function phase(page: Page, name: string): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-lobby', name);
}

/** The fixture's first border step, which Tambora's first beat, 1 April 1815, draws. */
async function firstStep(page: Page): Promise<string> {
  const release = (await (
    await page.request.get(`${DATA_URL.fixture}/release.json`)
  ).json()) as Release;
  const steps = release.borderSteps;
  if (!steps) throw new Error("the fixture's release names no border steps");
  expect(steps.years[0]).toBe(1815);
  return `${release.dataHost}/${steps.keys[0]}`;
}

/** Errors the page logs, and the border steps it asks for; its images are the test image. */
async function watch(page: Page): Promise<{ errors: string[]; steps: string[] }> {
  const errors: string[] = [];
  const steps: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (request.url().includes('/fd/borders/s/')) steps.push(request.url());
  });
  await page.route(`${DATA_URL.fixture}/img/**`, (route) =>
    route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: 'image/jpeg',
      body: JPEG,
    }),
  );
  return { errors, steps };
}

/** Whether the page counts as ready, and the plate it shows at that moment. */
async function readiness(page: Page): Promise<{ ready: boolean; plate: string | null }> {
  return page.evaluate((plate) => {
    return {
      ready: window.__wanderView?.ready() ?? false,
      plate: document.querySelector(plate)?.textContent ?? null,
    };
  }, PLATE);
}

/** Waits for the page to count as ready, and returns the plate it shows as it first does. */
async function whenReady(page: Page): Promise<string | null> {
  let seen: { ready: boolean; plate: string | null } = { ready: false, plate: null };
  await expect
    .poll(async () => (seen = await readiness(page)).ready, { intervals: [100] })
    .toBe(true);
  return seen.plate;
}

/** Opens the lobby with its opening run through. */
async function lobby(page: Page, query: string): Promise<void> {
  await page.goto(`${PREVIEW_URL}/?data=${DATA_URL.fixture}&hooks=1${query}`);
  await expect(page.locator('#room')).toBeHidden();
  await page.keyboard.press('Shift');
  await phase(page, 'idle');
}

test("preloads the walk's first border step in the lobby, and is ready on its beat with it drawn", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const step = await firstStep(page);
  const { errors, steps } = await watch(page);
  await lobby(page, '');
  // The lobby asks for the step before any plaque is chosen.
  await expect.poll(() => steps).toContain(step);

  const panel = page.getByRole('dialog', { name: 'Credits' });
  await page.locator('.lobby-credits').click();
  await expect(panel.getByRole('link', { name: 'Cliopatria' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  await page.locator('.lobby-plaque[data-story="tambora"]').click();
  await phase(page, 'gone');
  expect(await whenReady(page)).toBe('Borders · 1815');
  expect(steps.filter((url) => url === step)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test(
  'holds its first border beat until the step arrives, then is ready with it drawn',
  { tag: ['@gpu'] },
  async ({ page }) => {
    test.setTimeout(600_000);
    const step = await firstStep(page);
    const { errors, steps } = await watch(page);
    let release = () => {};
    const released = new Promise<void>((done) => (release = done));
    await page.route(`${DATA_URL.fixture}/fd/borders/s/**`, async (route) => {
      await released;
      // A fetch that stalled out meanwhile has its request aborted; its retry comes through.
      await route.continue().catch(() => {});
    });
    await lobby(page, '&memory=1');
    await expect.poll(() => steps).toContain(step);
    await page.locator('.lobby-plaque[data-story="tambora"]').click();
    await phase(page, 'gone');

    // The streamer idle for two seconds: the tiles alone would count the page ready by now.
    let idleSince: number | null = null;
    await expect
      .poll(
        async () => {
          if (!(await streamerIdle(page))) idleSince = null;
          else idleSince ??= Date.now();
          return idleSince !== null && Date.now() - idleSince >= 2000;
        },
        { intervals: [250] },
      )
      .toBe(true);
    expect(await readiness(page)).toEqual({ ready: false, plate: null });

    release();
    expect(await whenReady(page)).toBe('Borders · 1815');
    expect(errors).toEqual([]);
  },
);

/** Whether the streamer has nothing fetching, decoding or uploading, from the memory hook. */
async function streamerIdle(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const account = (window as { __wanderMemory?: () => unknown }).__wanderMemory?.() as
      | { details: { streamer?: { inFlight: number; decoding: number; uploading: number } } }
      | undefined;
    const stats = account?.details.streamer;
    return stats !== undefined && stats.inFlight + stats.decoding + stats.uploading === 0;
  });
}
