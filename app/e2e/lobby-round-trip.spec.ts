// Both entry points use the same lobby, walk and sound owner. The dev shell still starts on a
// beat; returning from it reaches the same lobby. No real network images or browser audio policy
// bypass: the knob must choose silence before the plaque's gesture creates a context.
import { expect as playwrightExpect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseStory } from '../src/story/story';
import { DATA_URL, DEV_URL, PREVIEW_URL } from './servers';

const story = parseStory(
  readFileSync(new URL('../../stories/tambora/story.md', import.meta.url), 'utf8'),
);
const JPEG = readFileSync(
  new URL('../../pipeline/tests/data/media/quadrants.jpg', import.meta.url),
);
const TIMEOUT = 90_000;
const expect = playwrightExpect.configure({ timeout: TIMEOUT });

declare global {
  interface Window {
    lobbyCheck: { contexts: AudioContext[]; maxKnobs: number; maxMarks: number };
  }
}

async function phase(page: Page, name: string): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-lobby', name, { timeout: TIMEOUT });
}

// CI's software renderer needs fewer pixels per frame; GPU renders belong to lobbyShots.ts.
test.use({ viewport: { width: 640, height: 400 } });

for (const entry of ['production', 'dev'] as const) {
  test(`${entry}: chooses silence, walks to beat 2, returns and starts afresh`, async ({
    page,
  }, testInfo) => {
    // CI's four-core SwiftShader walks each entry in minutes; it carries the production entry,
    // and the dev page's walk runs on the GPU project (npm run e2e:gpu).
    test.skip(
      testInfo.project.name === 'swiftshader' && entry === 'dev',
      'dev entry on the GPU only',
    );
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.route(`${DATA_URL.fixture}/img/**`, (route) =>
      route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: 'image/jpeg',
        body: JPEG,
      }),
    );
    await page.addInitScript(() => {
      localStorage.setItem('wander.muted', '0');
      const check: Window['lobbyCheck'] = { contexts: [], maxKnobs: 0, maxMarks: 0 };
      window.lobbyCheck = check;
      window.AudioContext = class extends AudioContext {
        constructor(options?: AudioContextOptions) {
          super(options);
          check.contexts.push(this);
        }
      };
      new MutationObserver(() => {
        check.maxKnobs = Math.max(check.maxKnobs, document.querySelectorAll('.wu-sound').length);
        check.maxMarks = Math.max(check.maxMarks, document.querySelectorAll('.wu-mark').length);
      }).observe(document, { childList: true, subtree: true });
    });
    const url =
      entry === 'production'
        ? `${PREVIEW_URL}/?data=${DATA_URL.fixture}`
        : `${DEV_URL}/prototype.html?story=tambora&ui=0&data=${DATA_URL.fixture}`;
    await page.goto(url);
    const title = page.locator('.wu-story .wu-title');
    const mark = page.getByRole('button', { name: 'Wander — return to lobby' });
    const knob = page.locator('.wu-sound');
    if (entry === 'dev') {
      await phase(page, 'gone');
      await expect(title).toHaveText(story.beats[0]!.title, { timeout: TIMEOUT });
      await mark.click();
    } else {
      await page.waitForFunction(
        () => ['opening', 'idle'].includes(document.body.dataset.lobby ?? ''),
        undefined,
        { timeout: TIMEOUT },
      );
      await page.keyboard.press('Shift');
    }
    await phase(page, 'idle');
    const originalKnob = await knob.elementHandle();
    const contextsBefore = await page.evaluate(() => window.lobbyCheck.contexts.length);
    if (entry === 'production') expect(contextsBefore).toBe(0);
    await knob.click();
    await expect(knob).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('wander.muted'))).toBe('1');
    expect(await page.evaluate(() => window.lobbyCheck.contexts.length)).toBe(contextsBefore);

    await page.locator('.lobby-plaque[data-story="tambora"]').click();
    await phase(page, 'diving');
    await expect(knob).toBeVisible();
    await expect(knob).toHaveAttribute('aria-pressed', 'true');
    await phase(page, 'gone');
    await expect(title).toHaveText(story.beats[0]!.title);
    await expect(title).toBeVisible();
    expect(await page.evaluate(() => window.lobbyCheck.contexts.map((ctx) => ctx.state))).toEqual([
      'running',
    ]);
    expect(await knob.evaluate((current, first) => current === first, originalKnob)).toBe(true);

    // After a pointer dive, Space plays and pauses the story; it never presses the mark.
    await page.keyboard.press(' ');
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-lobby', 'gone');
    await page.keyboard.press(' ');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();

    // Escape closes an open Credits panel before it would leave the story. A keyboard visitor
    // opens it here: at this spec's 640x400, Meanwhile can lie over the card's Credits link.
    await page.locator('.wu-card-credits').focus();
    await page.keyboard.press('Enter');
    const credits = page.getByRole('dialog', { name: 'Credits' });
    await expect(credits).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(credits).toBeHidden({ timeout: TIMEOUT });
    await phase(page, 'gone');
    await expect(title).toHaveText(story.beats[0]!.title);

    await page.keyboard.press('ArrowRight');
    await expect(title).toHaveText(story.beats[1]!.title, { timeout: TIMEOUT });
    // The date reaches 5 April only when the flight has reached beat 2.
    await expect(page.locator('.rc-plate-top').first()).toHaveText('5 APRIL', { timeout: TIMEOUT });

    await mark.click();
    await phase(page, 'returning');
    await expect(knob).toBeVisible();
    await phase(page, 'idle');
    await expect(page.locator('.wu-story')).toHaveCount(0);
    await expect(page.locator('.walk-callout')).toHaveCount(0);
    await expect(page.locator('.lobby-plaque[data-story="tambora"]')).toBeFocused();
    await expect(knob).toHaveAttribute('aria-pressed', 'true');

    // The focused plaque is usable by keyboard, and the new walk starts paused on beat 1.
    await page.keyboard.press('Enter');
    await phase(page, 'gone');
    await expect(title).toHaveText(story.beats[0]!.title);
    await expect(page.locator('.rc-status')).toContainText('Beat 1 of 8');
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await page.keyboard.press('m');
    await expect(knob).toHaveAttribute('aria-pressed', 'false', { timeout: TIMEOUT });
    await page.keyboard.press('m');
    await expect(knob).toHaveAttribute('aria-pressed', 'true', { timeout: TIMEOUT });

    await page.locator('.wu-mw-entry').first().click();
    await expect(page.locator('.wu-resume')).toHaveClass(/is-shown/);
    await page.keyboard.press('Escape');
    await phase(page, 'idle');
    await expect(page.locator('.wu-story')).toHaveCount(0);
    expect(await knob.evaluate((current, first) => current === first, originalKnob)).toBe(true);
    expect(
      await page.evaluate(() => ({
        contexts: window.lobbyCheck.contexts.length,
        knobs: window.lobbyCheck.maxKnobs,
        marks: window.lobbyCheck.maxMarks,
      })),
    ).toEqual({ contexts: 1, knobs: 1, marks: 1 });
    expect(errors).toEqual([]);
  });
}
