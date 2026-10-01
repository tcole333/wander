// What Explore's ruler e2e specs share (explore-ruler.spec.ts, explore-ruler-touch.spec.ts): the
// lobby's dive onto Waterloo in the production build, on the fixture's data server, and the world
// clock, the ruler's box and the page's errors as the specs read them.
import { expect as playwrightExpect, type Page } from '@playwright/test';
import type { ExploreLabelsHook, ExploreViewHook, WorldTimeHook } from '../src/explore/explore';
import { DATA_URL, PREVIEW_URL } from './servers';

export const expect = playwrightExpect.configure({ timeout: 90_000 });

export type RulerPage = Window & {
  __worldTime?: WorldTimeHook;
  __exploreView?: ExploreViewHook;
  __exploreLabels?: ExploreLabelsHook;
  pointerCancels?: number;
};

/** The world clock, and whether anything moves the tape. */
export function clock(page: Page): Promise<{ day: number; spanDays: number; moving: boolean }> {
  return page.evaluate(() => {
    const time = (window as RulerPage).__worldTime!;
    return { ...time.state(), moving: time.moving() };
  });
}

/** Waits for the tape to come to rest and returns the clock. */
export async function rested(page: Page): Promise<{ day: number; spanDays: number }> {
  await expect.poll(async () => (await clock(page)).moving).toBe(false);
  await page.waitForTimeout(100);
  const { day, spanDays } = await clock(page);
  return { day, spanDays };
}

/** The event pinned on its plate, by its Wikidata id, or null. */
export function pinned(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as RulerPage).__exploreLabels?.pinned() ?? null);
}

/** The ruler's box and its scales' heights at the crown, in the page's px. */
export async function ruler(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('.xr')!;
    const box = element.getBoundingClientRect();
    return {
      top: box.top,
      left: box.left,
      width: box.width,
      height: box.height,
      bottom: box.bottom,
      tapeY: box.top + Number(element.dataset.tapeY),
      overviewY: box.top + Number(element.dataset.overviewY),
      rulePx: Number(element.dataset.rulePx),
    };
  });
}

/** Collects the page's errors, which each test expects none of. */
export function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

/** Opens the lobby and dives into Explore on Waterloo, waiting for the landing zoom to rest. */
export async function dive(page: Page): Promise<void> {
  await page.goto(`${PREVIEW_URL}/?data=${DATA_URL.fixture}&opening=Q48314`);
  await expect(page.locator('#room')).toBeHidden();
  await page.keyboard.press('Shift');
  await expect(page.locator('body')).toHaveAttribute('data-lobby', 'idle');
  const plaque = page.locator('.lobby-plaque[data-choice="explore"]');
  await plaque.scrollIntoViewIfNeeded();
  await plaque.click();
  await expect(page.locator('body')).toHaveAttribute('data-lobby', 'gone');
  await expect.poll(() => pinned(page)).toBe('Q48314');
  await rested(page);
  // Nothing has the focus: the keys are time's.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}
