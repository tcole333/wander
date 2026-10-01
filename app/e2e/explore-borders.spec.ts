// Explore's borders from the production build's lobby (dist/ under vite preview, on the fixture's
// data server through ?data=, whose release names the border steps and the event files): the
// fixture's border steps begin in 1815 and 1830. The dive opens on Waterloo (?opening= pins it),
// where the 1815 step draws from its slot with no plate of its own; a scrub to 1830 draws that step
// once the clock rests there; Escape unpins Waterloo, still on the ruler's tape, and then leaves;
// and back in the lobby, Tambora's sixth beat, the first after the eruption to list borders, draws
// its step under the walk's plate, its images answered by the media stage's test image. Nothing
// logs an error.
import { expect as playwrightExpect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dayFromIso } from '../src/story/dates';
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

async function phase(page: Page, name: string): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-lobby', name);
}

/** The year of the step Explore draws from a slot at full strength, or null. */
async function stepDrawn(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const shown = window.__borders?.shown();
    return shown && !shown.preview && shown.strength > 0.999 ? shown.year : null;
  });
}

test('draws the border steps in Explore as its clock moves, and in the Tambora walk', async ({
  page,
}) => {
  test.setTimeout(600_000);
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

  await page.goto(`${PREVIEW_URL}/?data=${DATA_URL.fixture}&opening=Q48314`);
  await expect(page.locator('#room')).toBeHidden();
  await page.keyboard.press('Shift');
  await phase(page, 'idle');

  const explorePlaque = page.locator('.lobby-plaque[data-choice="explore"]');
  await explorePlaque.scrollIntoViewIfNeeded();
  await explorePlaque.click();
  await phase(page, 'gone');
  await expect.poll(() => stepDrawn(page), { timeout: TIMEOUT }).toBe(1815);
  await expect(page.locator('.wu-explore .wu-borders')).toHaveCount(0);

  await page.evaluate((day) => window.__worldTime?.seek(day), dayFromIso('1830-07-01'));
  await expect.poll(() => stepDrawn(page), { timeout: TIMEOUT }).toBe(1830);

  // Waterloo stays on the 200-year tape at 1830, so its pin holds: the first Escape unpins it, and
  // the second leaves for the lobby.
  const pinned = () => page.evaluate(() => window.__exploreLabels?.pinned() ?? null);
  await expect.poll(pinned).toBe('Q48314');
  await page.keyboard.press('Escape');
  await expect.poll(pinned).toBeNull();
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
