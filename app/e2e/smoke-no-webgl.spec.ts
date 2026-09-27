// The production build in a browser with WebGL turned off: the room shows the story's own card,
// its title and blurb, instead of a globe it cannot draw. Its own file, since a browser's launch
// options can only change for a whole file.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseStory } from '../src/story/story';
import { DATA_URL } from './servers';

const story = parseStory(
  readFileSync(new URL('../../stories/tambora/story.md', import.meta.url), 'utf8'),
);

test.use({ launchOptions: { args: ['--disable-3d-apis'] } });

test("shows the story's card in the room without WebGL", async ({ page }) => {
  await page.goto(`/?data=${DATA_URL.fixture}`);
  await expect(page.locator('#room .plate .wu-title')).toHaveText(story.title);
});
