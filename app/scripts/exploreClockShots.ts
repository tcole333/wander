// Free-clock interaction checks and ruler renders on the Mac's GPU. From app/, with Vite and
// a data server running locally (fixture by default):
//   node scripts/exploreClockShots.ts --url http://127.0.0.1:5173 --out ../build/explore-clock
//     [--data fixture|region|global|<origin>]
// Saves each calendar scale, both history ends, days of October 1066 and of the 1582 reform in
// the historical calendar Explore reads, and measurements.json.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Page } from '@playwright/test';
import { DATA_SERVERS } from '../src/page/dataOrigin.ts';
import {
  dayFromHistorical,
  dayFromIso,
  formatHistorical,
  monthName,
  type Civil,
} from '../src/story/dates.ts';
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
    data: { type: 'string', default: 'fixture' },
  },
});
if (!values.out) throw new Error('--out <dir> is required');
const origin = new URL(values.url);
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
  throw new Error('--url must be a local Vite server');
}
const dataOrigin = new URL(DATA_SERVERS[values.data] ?? values.data);
if (!['http:', 'https:'].includes(dataOrigin.protocol))
  throw new Error('--data needs an HTTP origin');
const url = new URL('/prototype.html', origin);
url.search = new URLSearchParams({ data: values.data, ui: '0' }).toString();
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
// Allow only the app and the chosen data origin: never silently fall back to production data.
await page.route('**/*', (route) => {
  const url = new URL(route.request().url());
  return [origin.origin, dataOrigin.origin].includes(url.origin) ? route.continue() : route.abort();
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
    const measure = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const labels = [
      ...document.querySelectorAll<SVGTextElement>('.rc-labels text:not(.is-covered)'),
    ].map((text) => {
      return {
        text: text.textContent,
        ...measure(text),
      };
    });
    return {
      labels,
      obstacles: [...document.querySelectorAll('.rc-plate-body, .rc-playhead svg')].map(measure),
      tier: [...document.querySelectorAll('.rc-tier .rc-gilt .rc-tier-year')].map(measure),
      window: measure(document.querySelector('.rc-window')!),
      width: innerWidth,
      height: innerHeight,
      view: (window as unknown as ClockPage).__proto.stats().view,
    };
  });
  for (const [index, label] of measured.labels.entries()) {
    assert(label.left >= 0 && label.right <= measured.width, `${name}: clipped ${label.text}`);
    for (const obstacle of measured.obstacles) {
      assert(!overlaps(label, obstacle), `${name}: plate or jewel covers ${label.text}`);
    }
    for (const next of measured.labels.slice(index + 1)) {
      assert(!overlaps(label, next), `${name}: ${label.text} overlaps ${next.text}`);
    }
  }
  // At close zooms the marker has a rectangular footprint; a full curved overview does not.
  if (measured.window.right - measured.window.left < 32) {
    for (const label of measured.tier) {
      assert(!overlaps(label, measured.window), `${name}: overview window covers a year`);
    }
  }
  await page.screenshot({ path: join(out, `${name}.png`) });
  shots.push({ name, clock: await clock(), ...measured });
}

try {
  await page.goto(url.href);
  await page.waitForFunction(
    () => (window as unknown as ClockPage).__worldTime !== undefined,
    null,
    {
      timeout: 90000,
    },
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Explore opens on an event; these checks start from all of history, at 1 CE.
  await page.evaluate(() => {
    const world = (window as unknown as ClockPage).__worldTime;
    world.zoom(1e12, 0.5);
    world.seek(0);
  });
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
    ['End', initial.span.end - 1, '08-2000-ce'],
  ] as const) {
    await plate.focus();
    await page.keyboard.press(key);
    const time = await clock();
    assert.equal(time.day, day);
    assert(time.span.start >= initial.span.start && time.span.end <= initial.span.end);
    if (key === 'End') {
      assert.deepEqual(await page.locator('.rc-labels .rc-day').allTextContents(), [
        '28',
        '29',
        '30',
        '31',
      ]);
    }
    await capture(name);
  }
  // Explore reads history's calendar: October 1066 in the Julian, Hastings on the 14th, the Ides
  // of March in 44 BCE, and the reform's step from 4 to 15 October 1582.
  const historical: { name: string; date: Civil; days: number; step?: string }[] = [
    { name: '10-hastings-days', date: { year: 1066, month: 10, day: 14 }, days: 12 },
    { name: '11-hastings-weeks', date: { year: 1066, month: 10, day: 14 }, days: 40 },
    { name: '12-october-1066-start', date: { year: 1066, month: 10, day: 1 }, days: 12 },
    { name: '13-october-1066-end', date: { year: 1066, month: 10, day: 31 }, days: 12 },
    { name: '14-ides-of-march', date: { year: -43, month: 3, day: 15 }, days: 12 },
    { name: '15-reform', date: { year: 1582, month: 10, day: 4 }, days: 10, step: '3 4 15 16' },
  ];
  for (const { name, date, days, step } of historical) {
    const day = dayFromHistorical(date);
    await page.evaluate(
      ({ day, days }) => {
        const world = (window as unknown as ClockPage).__worldTime;
        world.zoom(days / world.state().spanDays, 0.5);
        world.seek(day);
      },
      { day, days },
    );
    assert.equal((await clock()).day, day, name);
    const read = await page.evaluate(() => ({
      plate: [...document.querySelectorAll('.rc-plate-text .rc-cut')].map((t) => t.textContent),
      days: [...document.querySelectorAll('.rc-labels .rc-day')].map((t) => t.textContent),
      upper: [...document.querySelectorAll('.rc-labels .rc-upper')].map((t) => t.textContent),
      value: document.querySelector('[aria-label="World date"]')?.getAttribute('aria-valuetext'),
    }));
    const month = monthName(date.month);
    const year = date.year > 0 ? `${date.year} CE` : `${1 - date.year} BCE`;
    assert.deepEqual(read.plate, [`${date.day} ${month}`.toUpperCase(), year], `${name}: plaque`);
    assert.equal(read.value, `${date.day} ${month} ${year}`, `${name}: the slider's date`);
    const band = formatHistorical(day, 'month').toUpperCase();
    assert(read.upper.includes(band), `${name}: the band names ${band}, not ${read.upper.join()}`);
    if (days <= 12) assert(read.days.includes(String(date.day)), `${name}: ${read.days.join()}`);
    if (step) assert(read.days.join(' ').includes(step), `${name}: ${read.days.join(' ')}`);
    await capture(name);
  }

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => (window as unknown as ClockPage).__worldTime.zoom(1e9, 0.5));
  await capture('09-history-1024');
  for (const width of [1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const date of ['0001-01-01', '-0999-01-01', '1815-01-01', '2000-12-31']) {
      await page.evaluate((day) => {
        const world = (window as unknown as ClockPage).__worldTime;
        world.zoom(1e9, 0.5);
        world.seek(day);
      }, dayFromIso(date));
      await capture(`history-${width}-${date}`);
      await page.evaluate((day) => {
        const world = (window as unknown as ClockPage).__worldTime;
        world.zoom((140 * 365.2425) / world.state().spanDays, 0.5);
        world.seek(day);
      }, dayFromIso(date));
      await capture(`decades-${width}-${date}`);
    }
  }
  assert.deepEqual(errors, [], 'browser console');
  console.log(`Clock gestures and bounds passed; ${shots.length} renders in ${out}`);
} finally {
  writeFileSync(join(out, 'measurements.json'), JSON.stringify({ shots, errors }, null, 2));
  await browser.close();
}

function overlaps(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
    // A newly revealed label fades in; measure and photograph its settled face.
    await Promise.all(
      document
        .querySelector('.rc-labels')!
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}
