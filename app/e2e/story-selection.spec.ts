// The same visit can walk both stories, keeping one mark and sound knob. Fixture images stay on
// the data origin, and the route may be absent until its renderer lands.
import { expect as playwrightExpect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { withLock, type StoryLock } from '../src/story/lock';
import { parseStory } from '../src/story/story';
import { DATA_URL, DEV_URL, PREVIEW_URL } from './servers';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const locks = Object.fromEntries(
  ['tambora', 'magellan'].map((id) => [
    id,
    JSON.parse(read(`../../stories/${id}/story.lock.json`)) as StoryLock,
  ]),
);
const stories = Object.fromEntries(
  Object.entries(locks).map(([id, lock]) => [
    id,
    withLock(parseStory(read(`../../stories/${id}/story.md`)), lock),
  ]),
);
/** How many Meanwhile entries the lock gives a story's first beat, as its panel shows them. */
const firstBeatMeanwhile = (id: string) =>
  locks[id]!.meanwhile!.beats[stories[id]!.beats[0]!.id]!.length;
const JPEG = readFileSync(
  new URL('../../pipeline/tests/data/media/quadrants.jpg', import.meta.url),
);
const TIMEOUT = 90_000;
const expect = playwrightExpect.configure({ timeout: TIMEOUT });

// Fewer pixels for SwiftShader; the scrollable column still reaches both plaques.
test.use({ viewport: { width: 640, height: 400 } });

async function phase(page: Page, name: string): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-lobby', name);
}

for (const entry of ['production', 'dev'] as const) {
  test(`${entry}: Magellan, return, Tambora, and a fresh Magellan`, async ({ page }, testInfo) => {
    // CI's four-core SwiftShader walks each entry in minutes; it carries the production entry,
    // and the dev page's walk runs on the GPU project (npm run e2e:gpu).
    test.skip(
      testInfo.project.name === 'swiftshader' && entry === 'dev',
      'dev entry on the GPU only',
    );
    test.setTimeout(600_000);
    const errors: string[] = [];
    const wikimedia: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('request', (request) => {
      if (/(^|\.)wikimedia\.org$/.test(new URL(request.url()).hostname))
        wikimedia.push(request.url());
    });
    await page.route(`${DATA_URL.fixture}/img/**`, (route) =>
      route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: 'image/jpeg',
        body: JPEG,
      }),
    );
    const title = page.locator('.wu-story .wu-title');
    const magellan = page.locator('.lobby-plaque[data-story="magellan"]');
    const tambora = page.locator('.lobby-plaque[data-story="tambora"]');
    const mark = page.getByRole('button', { name: 'Wander — return to lobby' });
    const knob = page.locator('.wu-sound');
    await page.goto(
      entry === 'production'
        ? `${PREVIEW_URL}/?data=${DATA_URL.fixture}`
        : `${DEV_URL}/prototype.html?story=magellan&ui=0&data=${DATA_URL.fixture}`,
    );
    if (entry === 'dev') {
      await phase(page, 'gone');
      await expect(title).toHaveText(stories.magellan!.beats[0]!.title);
      await mark.click();
    } else {
      await expect(page.locator('#room')).toBeHidden();
      await page.keyboard.press('Shift');
    }
    await phase(page, 'idle');
    await expect(page.locator('.lobby-title')).toHaveText(['Tambora', 'Magellan–Elcano']);
    await expect(tambora).toBeVisible();
    await expect(magellan).toBeVisible();
    const originalMark = await mark.elementHandle();
    const originalKnob = await knob.elementHandle();

    await magellan.scrollIntoViewIfNeeded();
    await magellan.click();
    await phase(page, 'gone');
    await expect(title).toBeVisible();
    await expect(title).toHaveText(stories.magellan!.beats[0]!.title);
    await expect(page.locator('.rc-status')).toContainText('Beat 1 of 10');
    await expect(page.locator('.rc-gilt .rc-tier-year')).toHaveText([
      '1519',
      '1520',
      '1521',
      '1522',
    ]);
    await expect(page.locator('.rc-plate-top').first()).toHaveText('20 SEPTEMBER');
    const imageKeys = stories.magellan!.beats[0]!.image.locked!.files.map((file) => file.key);
    await expect
      .poll(async () => {
        const src = await page.locator('.wu-frame img.is-loaded').first().getAttribute('src');
        return imageKeys.some((key) => src === `${DATA_URL.fixture}/${key}`);
      })
      .toBe(true);
    await expect(page.locator('.wu-mw-entry')).toHaveCount(firstBeatMeanwhile('magellan'));
    await page.keyboard.press('ArrowRight');
    await expect(title).toHaveText(stories.magellan!.beats[1]!.title);
    await expect(page.locator('.rc-plate-top').first()).toHaveText('13 DECEMBER');
    await page.keyboard.press('Escape');
    await phase(page, 'idle');
    await expect(page.locator('.wu-story')).toHaveCount(0);
    await expect(magellan).toBeFocused();
    await expect(page.locator('.lobby-title')).toHaveText(['Tambora', 'Magellan–Elcano']);

    await tambora.click();
    await phase(page, 'gone');
    await expect(title).toHaveText(stories.tambora!.beats[0]!.title);
    await expect(page.locator('.rc-status')).toContainText('Beat 1 of 8');
    await expect(page.locator('.rc-gilt .rc-tier-year')).toHaveText(['1815', '1816', '1817']);
    await expect(page.locator('.wu-mw-entry')).toHaveCount(firstBeatMeanwhile('tambora'));
    await mark.click();
    await phase(page, 'idle');
    // Keyboard selection starts Magellan afresh, rather than resuming its previous beat 2.
    await magellan.focus();
    await page.keyboard.press('Enter');
    await phase(page, 'gone');
    await expect(title).toHaveText(stories.magellan!.beats[0]!.title);
    await expect(page.locator('.rc-status')).toContainText('Beat 1 of 10');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    expect(await mark.evaluate((current, first) => current === first, originalMark)).toBe(true);
    expect(await knob.evaluate((current, first) => current === first, originalKnob)).toBe(true);
    expect(wikimedia).toEqual([]);

    if (entry === 'production') {
      // A repeated context loss answers with the chosen story, not Tambora's old default.
      await page.evaluate(() => {
        sessionStorage.setItem('wander:context-lost', String(Date.now()));
        document.querySelector('canvas')!.dispatchEvent(new Event('webglcontextlost'));
      });
      await expect(page.locator('#room .plate .wu-title')).toHaveText('Magellan–Elcano');
      await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
