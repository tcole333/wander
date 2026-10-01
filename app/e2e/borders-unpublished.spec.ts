// The production build as the live site stands until publish-data's --border-steps: dist/ under
// vite preview, on the fixture's data server through ?data=, its release routed without its
// borderSteps section. The look then compiles milestone 1's 1815 field in place of the steps'
// arrays; the dive into Explore draws no borders and serves no window.__borders; and Tambora's
// sixth beat, which lists borders, shows no borders plate, since the fixture bakes no 1815 field
// (the walk says why once, as a warning). Nothing logs an error.
import { expect as playwrightExpect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseStory } from '../src/story/story';
import { test } from './idle';
import { DATA_URL, PREVIEW_URL } from './servers';

const TIMEOUT = 90_000;
const expect = playwrightExpect.configure({ timeout: TIMEOUT });

const story = parseStory(
  readFileSync(new URL('../../stories/tambora/story.md', import.meta.url), 'utf8'),
);
/** Tambora's sixth beat, "A Wet, Ungenial Summer": 1 July 1816, its layers listing borders. */
const BEAT = 5;
const JPEG = readFileSync(
  new URL('../../pipeline/tests/data/media/quadrants.jpg', import.meta.url),
);

// CI's software renderer needs fewer pixels per frame.
test.use({ viewport: { width: 640, height: 400 } });
// On CI the browser context itself can take over 30 s to set up after a heavy software-rendered
// spec, so the whole test, fixtures included, takes the long budget.
test.describe.configure({ timeout: 600_000 });

async function phase(page: Page, name: string): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-lobby', name);
}

test('draws no border steps in Explore or the Tambora walk where the release names none', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  expect(story.beats[BEAT]?.layers).toContain('borders');
  await page.route(`${DATA_URL.fixture}/release.json`, async (route) => {
    const response = await route.fetch();
    const release = (await response.json()) as Record<string, unknown>;
    expect(release.borderSteps).toBeDefined();
    delete release.borderSteps;
    await route.fulfill({ response, json: release });
  });
  await page.route(`${DATA_URL.fixture}/img/**`, (route) =>
    route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: 'image/jpeg',
      body: JPEG,
    }),
  );
  const stepRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/fd/borders/')) stepRequests.push(request.url());
  });

  await page.goto(`${PREVIEW_URL}/?data=${DATA_URL.fixture}&opening=Q48314`);
  await expect(page.locator('#room')).toBeHidden();
  await page.keyboard.press('Shift');
  await phase(page, 'idle');

  const explorePlaque = page.locator('.lobby-plaque[data-choice="explore"]');
  await explorePlaque.scrollIntoViewIfNeeded();
  await explorePlaque.click();
  await phase(page, 'gone');
  await expect(page.locator('.wu-explore .xr')).toBeVisible();
  expect(await page.evaluate(() => window.__borders === undefined)).toBe(true);

  // The dive lands with the opening's plate pinned; the mark takes the page back to the lobby.
  await page.getByRole('button', { name: 'Wander — return to lobby' }).click();
  await phase(page, 'idle');
  await page.locator('.lobby-plaque[data-story="tambora"]').click();
  const title = page.locator('.wu .wu-card .wu-title');
  await expect(title).toHaveText(story.beats[0]?.title ?? '');
  for (let beat = 1; beat <= BEAT; beat += 1) {
    await page.keyboard.press('ArrowRight');
    await expect(title).toHaveText(story.beats[beat]?.title ?? '');
  }
  // The steps' plate would show once the beat's step drew, a few seconds in; give it as long.
  await page.waitForTimeout(5_000);
  await expect(page.locator('.wu-story .wu-borders.is-shown')).toHaveCount(0);

  expect(stepRequests).toEqual([]);
  expect(errors).toEqual([]);
});
