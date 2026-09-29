// Free-clock interaction checks and ruler renders on the Mac's GPU. From app/, with Vite and
// the fixture data server running locally:
//   node scripts/exploreClockShots.ts --url http://127.0.0.1:5173 --out ../build/explore-clock
// Saves each calendar scale, both history ends, and measurements.json. No production data.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Page } from '@playwright/test';
import type { WorldTime } from '../src/time/worldClock.ts';
import type { Span } from '../src/story/ui/format.ts';
import type { ViewState } from '../src/view/viewState.ts';

interface ClockPage extends Window {
  __worldTime: {
    state(): WorldTime;
    span(): Span;
    seek(day: number): void;
    zoom(factor: number, share: number): void;
  };
  __proto: { stats(): { view: ViewState }; error?: string };
}

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5173' },
    out: { type: 'string' },
  },
});
if (!values.out) throw new Error('--out <dir> is required');
const origin = new URL(values.url);
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
  throw new Error('--url must be a local Vite server');
}
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const errors: string[] = [];
const shots: unknown[] = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
// A local fixture check must never quietly fall back to a public data host.
await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    ? route.continue()
    : route.abort();
});

async function clock() {
  return page.evaluate(() => {
    const world = (window as unknown as ClockPage).__worldTime;
    return { ...world.state(), span: world.span() };
  });
}

async function capture(name: string) {
  await settle(page);
  const measured = await page.evaluate(() => {
    const labels = [
      ...document.querySelectorAll<SVGTextElement>('.rc-labels text:not(.is-covered)'),
    ].map((text) => {
      const rect = text.getBoundingClientRect();
      return {
        text: text.textContent,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
    return {
      labels,
      width: innerWidth,
      height: innerHeight,
      view: (window as unknown as ClockPage).__proto.stats().view,
    };
  });
  for (const label of measured.labels) {
    assert(label.left >= 0 && label.right <= measured.width, `${name}: clipped ${label.text}`);
  }
  await page.screenshot({ path: join(out, `${name}.png`) });
  shots.push({ name, clock: await clock(), ...measured });
}

try {
  await page.goto(new URL('/prototype.html?data=fixture&ui=0', origin).href);
  await page.waitForFunction(
    () => (window as unknown as ClockPage).__worldTime !== undefined,
    null,
    {
      timeout: 90000,
    },
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const initial = await clock();
  assert.equal(initial.day, 0);
  await capture('00-history');

  for (const [name, days] of [
    ['01-centuries', 1600 * 365.2425],
    ['02-decades', 140 * 365.2425],
    ['03-years', 12 * 365.2425],
    ['04-months', 366],
    ['05-days-era-crossing', 7],
  ] as const) {
    await page.evaluate((days) => {
      const world = (window as unknown as ClockPage).__worldTime;
      world.zoom(days / world.state().spanDays, 0.5);
      world.seek(0);
    }, days);
    await capture(name);
  }

  // Exercise actual wheel and drag handlers on the brass band, below the floating date plate.
  const view = await page.evaluate(() => (window as unknown as ClockPage).__proto.stats().view);
  await page.mouse.move(600, 840);
  await page.mouse.wheel(0, -500);
  await page.waitForFunction(
    () => (window as unknown as ClockPage).__worldTime.state().spanDays < 7,
  );
  assert.equal((await clock()).spanDays, 4);
  assert.deepEqual(
    await page.evaluate(() => (window as unknown as ClockPage).__proto.stats().view),
    view,
  );
  await page.mouse.move(430, 840);
  await page.mouse.down();
  const pressed = await clock();
  await page.mouse.move(1000, 840, { steps: 12 });
  await page.mouse.up();
  assert((await clock()).day > pressed.day, 'drag must move the date forward');
  assert.deepEqual(
    await page.evaluate(() => (window as unknown as ClockPage).__proto.stats().view),
    view,
  );
  await capture('06-wheel-and-drag');

  const plate = page.getByRole('slider', { name: 'World date' });
  for (const [key, day, name] of [
    ['Home', initial.span.start, '07-10000-bce'],
    ['End', initial.span.end, '08-2000-ce'],
  ] as const) {
    await plate.focus();
    await page.keyboard.press(key);
    const time = await clock();
    assert.equal(time.day, day);
    assert(time.span.start >= initial.span.start && time.span.end <= initial.span.end);
    await capture(name);
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => (window as unknown as ClockPage).__worldTime.zoom(1e9, 0.5));
  await capture('09-history-1024');
  assert.deepEqual(errors, [], 'browser console');
  console.log(`Clock gestures and bounds passed; ${shots.length} renders in ${out}`);
} finally {
  writeFileSync(join(out, 'measurements.json'), JSON.stringify({ shots, errors }, null, 2));
  await browser.close();
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}
