// Explore's time ruler (src/explore/timeRuler.ts): interaction checks and renders on the Mac's GPU.
// From app/, with Vite and a data server running locally (fixture by default):
//   node scripts/exploreClockShots.ts --url http://127.0.0.1:5173 --out ../build/explore-clock
//     [--data fixture|region|global|<origin>]
// Saves the tape at each calendar scale about 1 CE, the wheel and a pull on the tape, both of
// history's ends, days of October 1066, the Ides of March in 44 BCE and the 1582 reform in the
// historical calendar Explore reads, and the widest tape at 1024, 1440 and 1920 px about four
// dates; every render checks that the tape's labels stay in view and clear of each other, the
// plaque and the jewel, and that the overview's names stay clear of each other. Writes
// measurements.json.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Page } from '@playwright/test';
import { DATA_SERVERS } from '../src/page/dataOrigin.ts';
import { dayFromHistorical, dayFromIso, monthName, type Civil } from '../src/story/dates.ts';
import type { WorldTime } from '../src/time/worldClock.ts';
import type { Span } from '../src/story/ui/format.ts';
import type { ViewState } from '../src/view/viewState.ts';

interface ClockPage extends Window {
  __worldTime: {
    state(): WorldTime;
    span(): Span;
    seek(day: number): void;
    zoom(factor: number, share?: number): void;
    pan(days: number): void;
    moving(): boolean;
  };
  __proto: { stats(): { view: ViewState }; error?: string };
}

const YEAR_DAYS = 365.2425;
/** History's first and last days, as the ruler holds them. */
const HISTORY = {
  start: dayFromHistorical({ year: -9999, month: 1, day: 1 }),
  end: dayFromHistorical({ year: 2000, month: 12, day: 31 }),
};

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

/** Puts the needle on `day` with `days` on the tape, at once. */
async function show(day: number, days: number) {
  await page.evaluate(
    ({ day, days }) => {
      const world = (window as unknown as ClockPage).__worldTime;
      world.zoom(days / world.state().spanDays);
      world.seek(day);
    },
    { day, days },
  );
}

/** Waits for whatever moves the tape to come to rest. */
async function rest() {
  await page.waitForFunction(() => !(window as unknown as ClockPage).__worldTime.moving());
}

async function capture(name: string) {
  await settle(page);
  const measured = await page.evaluate(() => {
    const measure = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    const reels = [...document.querySelectorAll('.xr-reel')].map(measure);
    // The tape's labels the reels' fades leave whole: between the reels, 46 px in.
    const [left, right] = [(reels[0]?.right ?? 0) + 46, (reels[1]?.left ?? innerWidth) - 46];
    const labels = [...document.querySelectorAll<SVGTextElement>('.xr-labels text')]
      .map((text) => ({ text: text.textContent, ...measure(text) }))
      .filter((label) => label.left >= left && label.right <= right);
    return {
      labels,
      names: [...document.querySelectorAll('.xr-ov-gilt text')].map((text) => ({
        text: text.textContent,
        ...measure(text),
      })),
      obstacles: [...document.querySelectorAll('.xr-plate-body, .xr-jewel')].map(measure),
      ruler: measure(document.querySelector('.xr')!),
      width: innerWidth,
      height: innerHeight,
      view: (window as unknown as ClockPage).__proto.stats().view,
    };
  });
  assert(measured.ruler.bottom - measured.ruler.top <= 116, `${name}: the ruler is too tall`);
  for (const [index, label] of measured.labels.entries()) {
    assert(label.left >= 0 && label.right <= measured.width, `${name}: clipped ${label.text}`);
    for (const obstacle of measured.obstacles) {
      assert(!overlaps(label, obstacle), `${name}: plaque or jewel covers ${label.text}`);
    }
    for (const next of measured.labels.slice(index + 1)) {
      assert(!overlaps(label, next), `${name}: ${label.text} overlaps ${next.text}`);
    }
  }
  for (const [index, name_] of measured.names.entries()) {
    for (const next of measured.names.slice(index + 1)) {
      assert(!overlaps(name_, next), `${name}: ${name_.text} overlaps ${next.text}`);
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
    { timeout: 90000 },
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  // The tape about 1 CE at each calendar scale: the widest, centuries, decades, years, months and
  // days across the era's seam.
  for (const [name, days] of [
    ['00-widest', 5000 * YEAR_DAYS],
    ['01-centuries', 1600 * YEAR_DAYS],
    ['02-decades', 140 * YEAR_DAYS],
    ['03-years', 12 * YEAR_DAYS],
    ['04-months', 366],
    ['05-days-era-crossing', 10],
  ] as const) {
    await show(0, days);
    assert.equal((await clock()).day, 0, name);
    await capture(name);
  }

  // The wheel over the tape shows more or less about the needle and leaves the globe; a pull to
  // the right brings earlier dates to the needle.
  await show(dayFromIso('1815-06-18'), 200 * YEAR_DAYS);
  const tapeY = await page.evaluate(() => {
    const ruler = document.querySelector<HTMLElement>('.xr')!;
    return ruler.getBoundingClientRect().top + Number(ruler.dataset.tapeY);
  });
  const view = await page.evaluate(() => (window as unknown as ClockPage).__proto.stats().view);
  const before = await clock();
  await page.mouse.move(600, tapeY);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(200);
  const wheeled = await clock();
  assert.equal(wheeled.day, before.day, 'the wheel keeps the date');
  assert(Math.abs(wheeled.spanDays / before.spanDays - Math.exp(-0.4)) < 1e-6, 'one notch closer');
  assert.deepEqual(
    await page.evaluate(() => (window as unknown as ClockPage).__proto.stats().view),
    view,
  );
  await page.mouse.move(430, tapeY);
  await page.mouse.down();
  await page.mouse.move(1000, tapeY, { steps: 12 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await rest();
  assert((await clock()).day < before.day, 'a pull to the right brings earlier dates');
  assert.deepEqual(
    await page.evaluate(() => (window as unknown as ClockPage).__proto.stats().view),
    view,
  );
  await capture('06-wheel-and-drag');

  // Home and End on the Date slider fly to history's ends.
  const plate = page.getByRole('slider', { name: 'World date' });
  for (const [key, day, name] of [
    ['Home', HISTORY.start, '07-10000-bce'],
    ['End', HISTORY.end, '08-2000-ce'],
  ] as const) {
    await plate.focus();
    await page.keyboard.press(key);
    await rest();
    assert.equal((await clock()).day, day, name);
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
    await show(day, days);
    assert.equal((await clock()).day, day, name);
    await settle(page);
    const read = await page.evaluate(() => ({
      plate: [...document.querySelectorAll('.xr-plate-text .rc-cut')].map((t) => t.textContent),
      days: [...document.querySelectorAll('.xr-labels .xr-num')].map((t) => t.textContent),
      months: [...document.querySelectorAll('.xr-labels .xr-caps')].map((t) => t.textContent),
      value: document.querySelector('[aria-label="World date"]')?.getAttribute('aria-valuetext'),
    }));
    const month = monthName(date.month);
    const year = date.year > 0 ? `${date.year} CE` : `${1 - date.year} BCE`;
    assert.deepEqual(read.plate, [`${date.day} ${month}`.toUpperCase(), year], `${name}: plaque`);
    assert(read.value?.startsWith(`${date.day} ${month} ${year};`), `${name}: ${read.value}`);
    // A month's 1st carries the month; every other day its number.
    if (date.day === 1)
      assert(read.months.includes(month.toUpperCase()), `${name}: ${read.months.join()}`);
    else assert(read.days.includes(String(date.day)), `${name}: ${read.days.join()}`);
    if (step) assert(read.days.join(' ').includes(step), `${name}: ${read.days.join(' ')}`);
    await capture(name);
  }

  // The widest tape about four dates at three widths.
  for (const width of [1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const date of ['0001-01-01', '-0999-01-01', '1815-01-01', '2000-12-31']) {
      await show(dayFromIso(date), 5000 * YEAR_DAYS);
      await capture(`widest-${width}-${date}`);
      await show(dayFromIso(date), 140 * YEAR_DAYS);
      await capture(`decades-${width}-${date}`);
    }
  }
  assert.deepEqual(errors, [], 'browser console');
  console.log(`The ruler's gestures and bounds passed; ${shots.length} renders in ${out}`);
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

/** Two frames, so the ruler has drawn what the clock holds. */
async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}
