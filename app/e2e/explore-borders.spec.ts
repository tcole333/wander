// Explore's borders from the production build's lobby (dist/ under vite preview, on the fixture's
// data server through ?data=, with ?explore): the fixture's border steps begin in 1815 and 1830.
// The dive opens on Waterloo, where the 1815 step draws under its year plate; a scrub to 1830
// changes the plate once the clock rests there; and back in the lobby, Tambora's sixth beat, the
// first after the eruption to list borders, draws its step under the walk's plate, its images
// answered by the media stage's test image. Nothing logs an error.
import { expect as playwrightExpect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dayFromIso } from '../src/story/dates';
import { parseStory } from '../src/story/story';
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
// The whole test, fixtures included, takes the long budget: on CI the browser context itself can
// take over 30 s to set up after a heavy software-rendered spec such as the borders probe.
test.describe.configure({ timeout: 600_000 });

async function phase(page: Page, name: string): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-lobby', name);
}

test('draws the border steps in Explore as its clock moves, and in the Tambora walk', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  expect(story.beats[BEAT]?.layers).toContain('borders');
  await page.route(`${DATA_URL.fixture}/img/**`, (route) =>
    route.fulfill({
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: 'image/jpeg',
      body: JPEG,
    }),
  );

  await page.goto(`${PREVIEW_URL}/?data=${DATA_URL.fixture}&explore`);
  await expect(page.locator('#room')).toBeHidden();
  await page.keyboard.press('Shift');
  await phase(page, 'idle');

  const explorePlaque = page.locator('.lobby-plaque[data-choice="explore"]');
  await explorePlaque.scrollIntoViewIfNeeded();
  await explorePlaque.click();
  await phase(page, 'gone');
  const plate = page.locator('.wu-explore .wu-borders.is-shown');
  await expect(plate).toHaveText('Borders · 1815');

  await page.evaluate((day) => window.__worldTime?.seek(day), dayFromIso('1830-07-01'));
  await expect(plate).toHaveText('Borders · 1830');

  await page.keyboard.press('Escape');
  await phase(page, 'idle');
  await expect(page.locator('.wu-explore')).toHaveCount(0);

  await page.locator('.lobby-plaque[data-story="tambora"]').click();
  const title = page.locator('.wu .wu-card .wu-title');
  await expect(title).toHaveText(story.beats[0]?.title ?? '');
  for (let beat = 1; beat <= BEAT; beat += 1) {
    await page.keyboard.press('ArrowRight');
    await expect(title).toHaveText(story.beats[beat]?.title ?? '');
  }
  await expect(page.locator('.wu-story .wu-borders.is-shown')).toHaveText('Borders · 1815');

  expect(errors).toEqual([]);
});
