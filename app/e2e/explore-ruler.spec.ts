// Explore's time ruler (explore/timeRuler.ts) from the production build's lobby (dist/ under vite
// preview, on the fixture's data server through ?data=), diving onto Waterloo (?opening=). It runs
// at the project's viewport, 960x600 on SwiftShader and 1440x900 on the GPU, so its checks are
// relative to the view. The arrow keys move time with nothing focused, the globe takes them from
// its own stop, + and - stay the globe's, a typed date flies there and Backspace flies back, the
// overview's rider names the year a press flies to, over the return point its year, a pull moves
// the tape 1:1 under a needle that never moves, the wheel shows more or less about the needle and
// a sideways swipe travels, no label shows cut by a glass edge's line or in a reel's fade, no
// press on the brass selects text, a pin holds while its date is on the tape, Home and End reach
// history's ends, a letter on the plaque opens its entry, and a refused date is said. Nothing logs
// an error. Touch is explore-ruler-touch.spec.ts's.
import type { Page } from '@playwright/test';
import { dayFromIso } from '../src/story/dates';
import { HISTORY } from '../src/time/exploreTime';
import { test } from './idle';
import { clock, dive, expect, pinned, rested, ruler, watch, type RulerPage } from './rulerPage';

const WATERLOO = dayFromIso('1815-06-18');
const YEAR_DAYS = 365.2425;

function goal(page: Page) {
  return page.evaluate(() => (window as RulerPage).__exploreView!.goal());
}

/**
 * The tape's shown labels that a glass edge's drawn line cuts or that reach into a reel's fade,
 * from the browser's own boxes: the glass's edges stand a twentieth of the tape each side of the
 * needle, and their line opens behind a label crossing them; the fades take the last 46 px at
 * each end.
 */
function cutLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const element = document.querySelector<HTMLElement>('.xr')!;
    const box = element.getBoundingClientRect();
    const half = Number(element.dataset.rulePx) / 2;
    const middle = box.left + box.width / 2;
    const drawn = [...document.querySelectorAll('.xr-edge-band')].map(
      (band) => getComputedStyle(band).opacity !== '0',
    );
    const cut: string[] = [];
    for (const text of document.querySelectorAll('.xr-labels text:not(.is-off)')) {
      const { left, right } = text.getBoundingClientRect();
      const [l, r] = [left - middle, right - middle];
      if (r < -half - 200 || l > half + 200) continue;
      [-half / 10, half / 10].forEach((edge, side) => {
        if (drawn[side] && l < edge + 0.8 && r > edge - 0.8)
          cut.push(`${text.textContent} at a glass edge`);
      });
      if (l < -half + 46 - 0.5 || r > half - 46 + 0.5) cut.push(`${text.textContent} in a fade`);
    }
    return cut;
  });
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

  // Over the return point, now 1066, the rider names it, and a press flies back there.
  const at = await ruler(page);
  const rider = page.locator('.xr-rider.is-shown');
  const flownYear = async () => yearOf((await date.getAttribute('aria-valuetext'))!.split(';')[0]!);
  const mark = (await page.locator('.xr-return').boundingBox())!;
  await page.mouse.move(mark.x + mark.width / 2 + 2, mark.y + mark.height / 2);
  await expect(rider).toHaveText('1066');
  await page.mouse.down();
  await page.mouse.up();
  await rested(page);
  expect(await flownYear()).toBe(1066);

  // Away from the marks, the rider names the year under the pointer, and a press lands on it.
  await page.mouse.move(at.left + at.width * 0.45, at.overviewY);
  await expect(rider).toBeVisible();
  const named = yearOf((await rider.textContent())!);
  await page.mouse.down();
  await page.mouse.up();
  await rested(page);
  expect(await flownYear()).toBe(named);
  await page.mouse.move(5, 5);

  // A pull moves the date 1:1 under a needle that never moves, and held still, does not coast.
  await page.keyboard.press('Backspace');
  const pulled = await rested(page);
  const jewel = (await page.locator('.xr-jewel').boundingBox())!;
  const daysPerPx = pulled.spanDays / at.rulePx;
  await page.mouse.move(view.width / 2 + 150, at.tapeY);
  await page.mouse.down();
  // Labels cross the glass's edges as the tape moves, each edge's line opening behind them, and
  // are dropped whole in the fades.
  const cut = await cutLabels(page);
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(view.width / 2 + 150 - 15 * step, at.tapeY);
    cut.push(...(await cutLabels(page)));
  }
  await page.waitForTimeout(200);
  await page.mouse.up();
  expect(cut).toEqual([]);
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
  // The reels are painted brass: they take presses rather than let them through to the globe.
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('xr-hit'),
      { x: reel.x + reel.width / 2, y: reel.y + reel.height / 2 },
    ),
  ).toBe(true);
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

test('Explore’s pin holds while on the tape, Home and End reach history’s ends, and the plaque reads a month', async ({
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

  // With the plaque focused a letter opens the entry too, so a month types whole; a date the
  // entry refuses is said, as the plaque shakes.
  const date = page.getByRole('slider', { name: 'World date' });
  await date.focus();
  await page.keyboard.type('June 1815');
  await expect(page.locator('.xr-entry')).toHaveValue('June 1815');
  await page.keyboard.press('Enter');
  await expect(date).toHaveAttribute('aria-valuetext', /^15 June 1815 CE;/);
  await expect(date).toBeFocused();
  await page.keyboard.type('31 February 1815');
  await page.keyboard.press('Enter');
  await expect(page.locator('.xr-status')).toHaveText(
    'There is no 31 February 1815 in the calendar.',
  );
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

/** A year as history writes it, '1066' or '500 BCE' or '2 July 1066 CE', as a calendar year. */
function yearOf(text: string): number {
  const match = /(\d[\d,]*)\s*(BCE|CE)?\s*$/.exec(text.trim());
  if (!match) throw new Error(`no year in '${text}'`);
  const n = Number(match[1]!.replace(/,/g, ''));
  return match[2] === 'BCE' ? 1 - n : n;
}
