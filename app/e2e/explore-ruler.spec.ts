// Explore's time ruler (explore/timeRuler.ts) from the production build's lobby (dist/ under vite
// preview, on the fixture's data server through ?data=), diving onto Waterloo (?opening=). It runs
// at the project's viewport, 960x600 on SwiftShader and 1440x900 on the GPU, so its checks are
// relative to the view. The arrow keys move time with nothing focused, the globe takes them from
// its own stop, + and - stay the globe's, a typed date flies there and Backspace flies back, the
// overview's rider names the year a press flies to, a pull moves the tape 1:1 under a needle that
// never moves, the wheel shows more or less about the needle and a sideways swipe travels, a touch
// pulls and a pinch zooms without zooming the page, no press on the brass selects text, a pin holds
// while its date is on the tape, and Home and End reach history's ends. Nothing logs an error.
import { expect as playwrightExpect, test, type Page } from '@playwright/test';
import type { ExploreLabelsHook, ExploreViewHook, WorldTimeHook } from '../src/explore/explore';
import { dayFromIso } from '../src/story/dates';
import { HISTORY } from '../src/time/exploreTime';
import { DATA_URL, PREVIEW_URL } from './servers';

const TIMEOUT = 90_000;
const expect = playwrightExpect.configure({ timeout: TIMEOUT });
const WATERLOO = dayFromIso('1815-06-18');
const YEAR_DAYS = 365.2425;

type RulerPage = Window & {
  __worldTime?: WorldTimeHook;
  __exploreView?: ExploreViewHook;
  __exploreLabels?: ExploreLabelsHook;
  pointerCancels?: number;
};

/** The world clock, and whether anything moves the tape. */
function clock(page: Page): Promise<{ day: number; spanDays: number; moving: boolean }> {
  return page.evaluate(() => {
    const time = (window as RulerPage).__worldTime!;
    return { ...time.state(), moving: time.moving() };
  });
}

/** Waits for the tape to come to rest and returns the clock. */
async function rested(page: Page): Promise<{ day: number; spanDays: number }> {
  await expect.poll(async () => (await clock(page)).moving).toBe(false);
  await page.waitForTimeout(100);
  const { day, spanDays } = await clock(page);
  return { day, spanDays };
}

function goal(page: Page) {
  return page.evaluate(() => (window as RulerPage).__exploreView!.goal());
}

function pinned(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as RulerPage).__exploreLabels?.pinned() ?? null);
}

/** The ruler's box and its scales' heights at the crown, in the page's px. */
async function ruler(page: Page) {
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
function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

/** Opens the lobby and dives into Explore on Waterloo, waiting for the landing zoom to rest. */
async function dive(page: Page): Promise<void> {
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

test('Explore’s ruler moves time by keys, typing, the overview, a pull and the wheel', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errors = watch(page);
  await dive(page);
  const date = page.getByRole('slider', { name: 'World date' });
  const years = page.getByRole('slider', { name: 'Years shown' });
  const view = page.viewportSize()!;

  // The ruler stands within 116 px, inside the view, on Waterloo, 200 years wide.
  const box = await ruler(page);
  expect(box.height).toBeLessThanOrEqual(116);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(view.height + 0.5);
  const plateBox = (await page.locator('.xr-plaque').boundingBox())!;
  expect(plateBox.y).toBeGreaterThanOrEqual(0);
  await expect(date).toHaveAttribute('aria-valuenow', String(WATERLOO));
  await expect(years).toHaveAttribute('aria-valuetext', '200 years');

  // With nothing focused, the arrows move time and leave the globe.
  const before = await goal(page);
  await page.keyboard.press('ArrowRight');
  const stepped = await rested(page);
  expect(stepped.day).toBeGreaterThan(WATERLOO);
  expect(await goal(page)).toEqual(before);
  await page.keyboard.press('Shift+ArrowRight');
  const labelled = await rested(page);
  expect(labelled.day - stepped.day).toBeGreaterThan(stepped.day - WATERLOO);

  // Up shows more years and Down fewer, about the needle.
  await page.keyboard.press('ArrowUp');
  expect(await rested(page)).toEqual({ day: labelled.day, spanDays: 500 * YEAR_DAYS });
  await expect(years).toHaveAttribute('aria-valuetext', '500 years');
  await page.keyboard.press('ArrowDown');
  expect(await rested(page)).toEqual({ day: labelled.day, spanDays: 200 * YEAR_DAYS });

  // The Globe's stop gives the globe the arrows; + and - are the globe's everywhere.
  const globe = page.getByRole('application', { name: 'Globe' });
  await globe.focus();
  await expect(page.locator('.xt-globe-name')).toHaveClass(/is-shown/);
  const globeBefore = await goal(page);
  // Held until a frame has turned the globe: a slow renderer may draw none in a short hold.
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await goal(page)).lon).not.toBe(globeBefore.lon);
  await page.keyboard.up('ArrowRight');
  expect((await rested(page)).day).toBe(labelled.day);
  const width = (await goal(page)).viewKm;
  await page.keyboard.down('+');
  await expect.poll(async () => (await goal(page)).viewKm).toBeLessThan(width);
  await page.keyboard.up('+');
  expect(await rested(page)).toEqual({ day: labelled.day, spanDays: 200 * YEAR_DAYS });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // A typed date flies there, leaving a return point; Backspace brings the tape back exactly.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  const home = await rested(page);
  await page.keyboard.type('1066');
  await expect(page.locator('.xr-entry')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(date).toHaveAttribute('aria-valuetext', /1066/);
  await expect(page.locator('.xr-return')).toHaveCount(1);
  await rested(page);
  await page.keyboard.press('Backspace');
  expect(await rested(page)).toEqual({ day: home.day, spanDays: 200 * YEAR_DAYS });

  // The rider names the year under the pointer on the overview, and a press flies to it.
  const at = await ruler(page);
  await page.mouse.move(at.left + at.width * 0.45, at.overviewY);
  const rider = page.locator('.xr-rider.is-shown');
  await expect(rider).toBeVisible();
  const named = yearOf((await rider.textContent())!);
  await page.mouse.down();
  await page.mouse.up();
  await rested(page);
  const flown = yearOf((await date.getAttribute('aria-valuetext'))!.split(';')[0]!);
  expect(Math.abs(flown - named)).toBeLessThanOrEqual(50);
  await page.mouse.move(5, 5);

  // A pull moves the date 1:1 under a needle that never moves, and held still, does not coast.
  await page.keyboard.press('Backspace');
  const pulled = await rested(page);
  const jewel = (await page.locator('.xr-jewel').boundingBox())!;
  const daysPerPx = pulled.spanDays / at.rulePx;
  await page.mouse.move(view.width / 2 + 150, at.tapeY);
  await page.mouse.down();
  for (let step = 1; step <= 20; step++)
    await page.mouse.move(view.width / 2 + 150 - 15 * step, at.tapeY);
  await page.waitForTimeout(200);
  await page.mouse.up();
  const released = await clock(page);
  await page.waitForTimeout(600);
  const after = await rested(page);
  expect(after.day).toBe(released.day);
  expect((after.day - pulled.day) / (300 * daysPerPx)).toBeCloseTo(1, 1);
  expect(Math.abs((after.day - pulled.day) / (300 * daysPerPx) - 1)).toBeLessThan(0.02);
  const still = (await page.locator('.xr-jewel').boundingBox())!;
  expect(Math.abs(still.x - jewel.x)).toBeLessThan(0.5);

  // Three wheel notches show e^1.2 as much about the needle; a sideways swipe travels.
  await page.mouse.move(view.width / 2 + 200, at.tapeY);
  for (let notch = 0; notch < 3; notch++) await page.mouse.wheel(0, 100);
  const wheeled = await rested(page);
  expect(wheeled.day).toBe(after.day);
  expect(wheeled.spanDays / after.spanDays).toBeCloseTo(Math.exp(1.2), 1);
  expect(Math.abs(wheeled.spanDays / after.spanDays / Math.exp(1.2) - 1)).toBeLessThan(0.01);
  await page.waitForTimeout(400);
  await page.mouse.wheel(200, 0);
  const swiped = await rested(page);
  expect(swiped.spanDays).toBe(wheeled.spanDays);
  expect(swiped.day).toBeGreaterThan(wheeled.day);

  // No press on the brass selects text: dragged up off a reel, or off the lip.
  const reel = (await page.locator('.xr-reel').first().boundingBox())!;
  for (const [x, y] of [
    [reel.x + reel.width / 2, reel.y + reel.height / 2],
    [view.width / 2 + 60, at.tapeY - 19],
  ] as const) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 20, y - 100, { steps: 5 });
    await page.mouse.move(x + 40, y - 200, { steps: 5 });
    await page.mouse.up();
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
  }

  expect(errors).toEqual([]);
});

test('Explore’s pin holds while on the tape, and Home and End reach history’s ends', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errors = watch(page);
  await dive(page);
  // Ten fine steps, twenty years on a 200-year tape: Waterloo is still on it.
  for (let press = 0; press < 10; press++) await page.keyboard.press('ArrowRight');
  await rested(page);
  expect(await pinned(page)).toBe('Q48314');
  await page.keyboard.press('End');
  expect((await rested(page)).day).toBe(HISTORY.end);
  await expect.poll(() => pinned(page)).toBeNull();
  await page.keyboard.press('Home');
  expect((await rested(page)).day).toBe(HISTORY.start);
  expect(errors).toEqual([]);
});

test('Explore’s ruler takes a touch’s pull and a pinch, never zooming the page', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 960, height: 600 },
  });
  const page = await context.newPage();
  const errors = watch(page);
  await page.addInitScript(() => {
    addEventListener(
      'pointercancel',
      () => {
        const w = window as RulerPage;
        w.pointerCancels = (w.pointerCancels ?? 0) + 1;
      },
      { capture: true },
    );
  });
  await dive(page);
  const at = await ruler(page);
  const cdp = await context.newCDPSession(page);
  const touch = (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { x: number; y: number }[],
  ) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const x = at.left + at.width / 2 + 120;

  // One finger pulls the tape, twenty moves to the left.
  const before = await clock(page);
  await touch('touchStart', [{ x, y: at.tapeY }]);
  for (let move = 1; move <= 20; move++)
    await touch('touchMove', [{ x: x - 8 * move, y: at.tapeY }]);
  await page.waitForTimeout(150);
  await touch('touchEnd', []);
  const pulled = await rested(page);
  expect(pulled.day).toBeGreaterThan(before.day);
  expect(await page.evaluate(() => (window as RulerPage).pointerCancels ?? 0)).toBe(0);

  // Two fingers spread apart show less, and the page itself never zooms.
  const mid = at.left + at.width / 2;
  await touch('touchStart', [
    { x: mid - 40, y: at.tapeY },
    { x: mid + 40, y: at.tapeY },
  ]);
  for (let move = 1; move <= 10; move++) {
    await touch('touchMove', [
      { x: mid - 40 - 10 * move, y: at.tapeY },
      { x: mid + 40 + 10 * move, y: at.tapeY },
    ]);
  }
  await touch('touchEnd', []);
  const pinched = await rested(page);
  expect(pinched.spanDays).toBeLessThan(pulled.spanDays * 0.5);
  expect(await page.evaluate(() => visualViewport?.scale ?? 1)).toBe(1);
  expect(await page.evaluate(() => (window as RulerPage).pointerCancels ?? 0)).toBe(0);
  expect(errors).toEqual([]);
  await context.close();
});

/** A year as history writes it, '1066' or '500 BCE' or '2 July 1066 CE', as a calendar year. */
function yearOf(text: string): number {
  const match = /(\d[\d,]*)\s*(BCE|CE)?\s*$/.exec(text.trim());
  if (!match) throw new Error(`no year in '${text}'`);
  const n = Number(match[1]!.replace(/,/g, ''));
  return match[2] === 'BCE' ? 1 - n : n;
}
