// Screenshots of a walk (prototype.html?story=...) on this Mac's GPU: Chromium on
// Metal at 1440x900. It steps through the story as a visitor would and shoots each beat once the
// flight has landed, the streamer has been idle for a second, story time has come to rest (the ash
// and veil beats play their spread out after landing) and the card's image has loaded (or
// failed). Tambora: three flights halfway; the ruler scrubbed to 11 April 1815 on the ash beat, and from
// the veil beat to February 1816, between beats, where Meanwhile shows that month's entries; and a
// break-out, a Meanwhile entry chosen, with the Resume plaque. Magellan: every voyage leg at 20%,
// 50% and 80% of its clock, plus port and Pacific scrubs. It waits for the ship's loaded route
// before stepping and fails if an adjacent leg takes a direct flight. Writes <out>/*.png and
// <out>/walk.json (flight timings, fonts and any console errors). Plain Node, run from app/ with
// the Vite dev server and a data server up:
//
//   node scripts/walkShots.ts --url http://127.0.0.1:5194 --out <dir> [--query 'data=region']
//     [--story tambora|magellan] [--flight-points '0.2,0.5,0.8'] [--reverse] [--timeout 90]
//
// --story defaults to tambora. --flight-points sets Magellan's samples (fractions strictly
// between 0 and 1); these are live frames, with actual progress recorded in walk.json. --reverse
// also captures each Magellan leg on the way back. Use data=global for its full sea-floor relief.
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { dayFromIso } from '../src/story/dates.ts';
import type { FlightRecord } from '../src/story/director.ts';

interface WalkApi {
  state(): { beat: number; mode: string; flight: number | null; day: number };
  goTo(beat: number): void;
  resume(): void;
  scrub(day: number): void;
  landed(): boolean;
  flights(): readonly FlightRecord[];
}
interface WalkWindow {
  __walk?: WalkApi;
  __proto?: { ready(): boolean; stats(): unknown; error?: string };
  /** Story time at the last poll, to tell when it has come to rest. */
  __lastDay?: number;
}

/** The flights shot halfway, by the beat flown to. */
const MID_FLIGHT = new Set(['sumbawa', 'europe-1816', 'new-england-1816']);
/** The scrubs shot, by the beat scrubbed from: the name's date, and the day scrubbed to. */
const SCRUBS: Record<string, { date: string; to: (day: number) => number }> = {
  // Back a day, to 11 April 1815: ash has reached Bali, Lombok and Banyuwangi.
  ash: { date: '1815-04-11', to: (day) => day - 1 },
  // Past the beat, to a month between beats.
  veil: { date: '1816-02', to: () => dayFromIso('1816-02-15') },
  'san-julian': { date: '1520-07-01', to: () => dayFromIso('1520-07-01') },
  pacific: { date: '1521-02-21', to: () => dayFromIso('1521-02-21') },
};
/** Long enough for the plaques and the card's words to fade in after a landing. */
const FADE_MS = 1500;

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5194' },
    out: { type: 'string' },
    query: { type: 'string', default: '' },
    timeout: { type: 'string', default: '90' },
    story: { type: 'string', default: 'tambora' },
    'flight-points': { type: 'string', default: '0.2,0.5,0.8' },
    reverse: { type: 'boolean', default: false },
  },
});
if (!values.out) throw new Error('--out <dir> is required');
if (!['tambora', 'magellan'].includes(values.story))
  throw new Error('--story must be tambora or magellan');
const flightPoints = values['flight-points']
  .split(',')
  .map(Number)
  .sort((a, b) => a - b);
if (
  !flightPoints.length ||
  flightPoints.some((point) => !Number.isFinite(point) || point <= 0 || point >= 1)
)
  throw new Error('--flight-points must be comma-separated fractions strictly between 0 and 1');
const markdown = readFileSync(
  new URL(`../../stories/${values.story}/story.md`, import.meta.url),
  'utf8',
);
const beats = [...markdown.matchAll(/^```beat\n(.*?)\n```/gms)].map(
  (match) => (parse(match[1]!) as { id: string }).id,
);
const voyage = values.story === 'magellan';
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const timeoutMs = Number(values.timeout) * 1000;

const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const problems: string[] = [];
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    problems.push(`${message.type()}: ${message.text()}`);
  }
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

const shots: string[] = [];
const samples: unknown[] = [];
const shoot = async (name: string) => {
  const png = join(out, `${name}.png`);
  samples.push({
    path: png,
    ...(await page.evaluate(() => ({
      state: (window as WalkWindow).__walk?.state(),
      stats: (window as WalkWindow).__proto?.stats(),
    }))),
  });
  await page.screenshot({ path: png });
  shots.push(png);
  console.log(png);
};

const shootVoyage = async (beat: number, direction: 'to' | 'back-to') => {
  const flight = await page.evaluate(() => (window as WalkWindow).__walk?.flights().at(-1));
  if (flight?.kind !== 'voyage')
    throw new Error(`Expected a loaded voyage ${direction} ${beats[beat]}`);
  for (const point of flightPoints) {
    await page.waitForFunction(
      (fraction) => {
        const progress = (window as WalkWindow).__walk?.state().flight;
        if (progress === null) throw new Error(`Flight sample ${fraction} was missed`);
        return progress !== undefined && progress >= fraction;
      },
      point,
      { timeout: timeoutMs, polling: 'raf' },
    );
    await shoot(`flight-${direction}-${beat + 1}-${beats[beat]}-${Math.round(point * 100)}`);
  }
};

try {
  const query = new URLSearchParams(values.query);
  query.set('story', values.story);
  query.set('ui', '0');
  await page.goto(`${values.url}/prototype.html?${query}`);
  await page.waitForFunction(
    () => {
      const w = window as WalkWindow;
      if (w.__proto?.error) throw new Error(w.__proto.error);
      return w.__walk !== undefined;
    },
    null,
    { timeout: timeoutMs },
  );

  if (voyage) {
    await settle(page);
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('.walk-ship')).some(
          (ship) => Number(getComputedStyle(ship).opacity) > 0.9,
        ),
      null,
      { timeout: timeoutMs },
    );
  }

  for (const [beat, id] of beats.entries()) {
    const n = beat + 1;
    if (beat > 0) await page.evaluate((b) => (window as WalkWindow).__walk?.goTo(b), beat);
    if (voyage && beat > 0) await shootVoyage(beat, 'to');
    if (MID_FLIGHT.has(id)) {
      await page.waitForFunction(
        () => ((window as WalkWindow).__walk?.state().flight ?? 0) >= 0.5,
        null,
        {
          timeout: timeoutMs,
          polling: 'raf',
        },
      );
      await shoot(`flight-to-${n}-${id}`);
    }
    await settle(page);
    await shoot(`beat-${n}-${id}`);

    const scrub = SCRUBS[id];
    if (scrub) {
      const day = await page.evaluate(() => (window as WalkWindow).__walk?.state().day ?? 0);
      await page.evaluate((to) => (window as WalkWindow).__walk?.scrub(to), scrub.to(day));
      await page.waitForTimeout(FADE_MS);
      await shoot(`scrub-${n}-${id}-${scrub.date}`);
      await page.evaluate(() => (window as WalkWindow).__walk?.resume());
      await settle(page);
    }
  }

  if (voyage && values.reverse) {
    for (let beat = beats.length - 2; beat >= 0; beat--) {
      await page.evaluate((b) => (window as WalkWindow).__walk?.goTo(b), beat);
      await shootVoyage(beat, 'back-to');
      await settle(page);
    }
  }

  // A break-out: the visitor chooses Meanwhile's first entry, and the camera flies there.
  await page.locator('.wu-mw-entry').first().click();
  await page.waitForFunction(
    () => {
      const flight = (window as WalkWindow).__walk?.flights().at(-1);
      return flight !== undefined && flight.to === null && flight.tookS >= flight.plannedS;
    },
    null,
    { timeout: timeoutMs, polling: 250 },
  );
  await page.waitForFunction(() => (window as WalkWindow).__proto?.ready() ?? false, null, {
    timeout: timeoutMs,
    polling: 250,
  });
  await page.waitForTimeout(FADE_MS);
  await shoot('breakout-meanwhile');

  const report = await page.evaluate(() => ({
    state: (window as WalkWindow).__walk?.state(),
    flights: (window as WalkWindow).__walk?.flights(),
    fonts: {
      libreBaskerville: document.fonts.check('16px "Libre Baskerville"'),
      sourceSerif4: document.fonts.check('16px "Source Serif 4"'),
    },
  }));
  writeFileSync(
    join(out, 'walk.json'),
    JSON.stringify({ ...report, shots, samples, problems }, null, 2),
  );
  for (const problem of problems) console.log(`  ${problem}`);
} finally {
  await browser.close();
}

/**
 * Waits for the landing, the streamer's idle second, story time at rest and the card's image,
 * then the fades.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as WalkWindow).__walk?.landed() ?? false, null, {
    timeout: timeoutMs,
    polling: 250,
  });
  await page.waitForFunction(
    () => {
      const w = window as WalkWindow;
      const day = w.__walk?.state().day;
      const still = day === w.__lastDay;
      w.__lastDay = day;
      return still;
    },
    null,
    { timeout: timeoutMs, polling: 250 },
  );
  await page.waitForFunction(
    () => {
      const frame = document.querySelector('.wu-figure:not([hidden]) .wu-frame');
      return (
        frame === null || frame.querySelector('img.is-loaded:not(.wu-preview), .wu-plate') !== null
      );
    },
    null,
    { timeout: timeoutMs, polling: 250 },
  );
  await page.waitForTimeout(FADE_MS);
}
