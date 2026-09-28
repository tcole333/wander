// The production build in a browser with WebGL turned off: the room shows both stories' titles
// and blurbs instead of a globe it cannot draw. Its own file, since a browser's launch
// options can only change for a whole file.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseStory } from '../src/story/story';
import { DATA_URL } from './servers';

const stories = ['tambora', 'magellan'].map((id) =>
  parseStory(readFileSync(new URL(`../../stories/${id}/story.md`, import.meta.url), 'utf8')),
);

test.use({ launchOptions: { args: ['--disable-3d-apis'] } });

test('shows both stories in the room without WebGL', async ({ page }) => {
  await page.goto(`/?data=${DATA_URL.fixture}`);
  await expect(page.locator('#room .plate .wu-title')).toHaveText(
    stories.map((story) => story.title),
  );
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toHaveCount(0);
});
