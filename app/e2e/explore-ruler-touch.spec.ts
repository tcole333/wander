// Explore's time ruler under a touch screen (explore/timeRuler.ts), from the production build's
// lobby as explore-ruler.spec.ts dives: one finger pulls the tape, two pinch it anywhere on the
// ruler, the counter's knobs included, zooming time and never the page, a tap on a knob steps a
// detent, and a finger that slides off a knob stops it. Nothing logs an error. Apart from the
// ruler's other spec so CI runs each in a shard of its own (e2e/shards.ts): CI's software renderer
// takes several minutes over the touches.
import { test } from '@playwright/test';
import { nextDetent, SPAN_DETENTS } from '../src/time/timeMotion';
import { closeIdle } from './idle';
import { clock, dive, expect, rested, ruler, watch, type RulerPage } from './rulerPage';

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

  // A pinch landing on the counter's two knobs is the ruler's pinch too: neither knob steps, the
  // span follows the fingers' spread, and the page never zooms.
  const knobAt = async (name: string) => {
    const box = (await page.locator(`.xr-knob.is-${name}`).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const [fewer, more] = [await knobAt('fewer'), await knobAt('more')];
  await touch('touchStart', [fewer, more]);
  for (let move = 1; move <= 10; move++)
    await touch('touchMove', [fewer, { x: more.x + 15 * move, y: more.y }]);
  await touch('touchEnd', []);
  const counted = await rested(page);
  const spread = (more.x - fewer.x) / (more.x + 150 - fewer.x);
  expect(Math.abs(counted.spanDays / pinched.spanDays / spread - 1)).toBeLessThan(0.02);
  expect(await page.evaluate(() => visualViewport?.scale ?? 1)).toBe(1);
  expect(await page.evaluate(() => (window as RulerPage).pointerCancels ?? 0)).toBe(0);
  // A finger on a knob steps it, and lifted, stops it. A slow renderer may take long enough
  // between the two touches for the knob to count a hold and step again, so the check is that it
  // stepped at least once, onto a detent, and stays there once lifted.
  await touch('touchStart', [more]);
  await touch('touchEnd', []);
  const tapped = (await rested(page)).spanDays;
  expect(tapped).toBeGreaterThanOrEqual(nextDetent(counted.spanDays, 1));
  expect(SPAN_DETENTS).toContain(tapped);
  await page.waitForTimeout(600);
  expect((await rested(page)).spanDays).toBe(tapped);
  // A finger that lands on a knob and slides off stops it: held there, it repeats nothing, and
  // lifted, steps nothing. (A slow renderer may count a hold before the slide reaches it.)
  await touch('touchStart', [fewer]);
  for (let move = 1; move <= 6; move++)
    await touch('touchMove', [{ x: fewer.x + 30 * move, y: fewer.y - 6 * move }]);
  await page.waitForTimeout(700);
  const slid = (await clock(page)).spanDays;
  await page.waitForTimeout(700);
  expect((await clock(page)).spanDays).toBe(slid);
  await touch('touchEnd', []);
  expect((await rested(page)).spanDays).toBe(slid);
  expect(errors).toEqual([]);
  await closeIdle(page);
  await context.close();
});
