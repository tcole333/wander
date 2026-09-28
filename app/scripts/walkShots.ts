// Screenshots of the Tambora walk (prototype.html?story=tambora) on this Mac's GPU: Chromium on
// Metal at 1440x900. It steps through the story as a visitor would and shoots each beat once the
// flight has landed, the streamer has been idle for a second, story time has come to rest (the ash
// and veil beats play their spread out after landing) and the card's image has loaded (or
// failed); three flights halfway; the ruler scrubbed to 11 April 1815 on the ash beat, and from
// the veil beat to February 1816, between beats, where Meanwhile shows that month's entries; and a
// break-out, a Meanwhile entry chosen, with the Resume plaque. Writes <out>/*.png and
// <out>/walk.json (flight timings, fonts and any console errors). Plain Node, run from app/ with
// the Vite dev server and a data server up:
//
//   node scripts/walkShots.ts --url http://127.0.0.1:5194 --out <dir> [--query 'data=region']
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dayFromIso } from '../src/story/dates.ts';

interface WalkApi {
  state(): { beat: number; mode: string; flight: number | null; day: number };
  goTo(beat: number): void;
  resume(): void;
  scrub(day: number): void;
  landed(): boolean;
  flights(): { to: number | null; plannedS: number; tookS: number; heldS: number }[];
}
interface WalkWindow {
  __walk?: WalkApi;
  __proto?: { ready(): boolean; error?: string };
  /** Story time at the last poll, to tell when it has come to rest. */
  __lastDay?: number;
}

/** The beats' ids, in story order, for the files' names. */
const BEATS = [
  'world-1815',
  'sunda',
  'sumbawa',
  'ash',
  'veil',
  'europe-1816',
  'new-england-1816',
  'yunnan-bengal-1817',
];
/** The flights shot halfway, by the beat flown to. */
const MID_FLIGHT = new Set(['sumbawa', 'europe-1816', 'new-england-1816']);
/** The scrubs shot, by the beat scrubbed from: the name's date, and the day scrubbed to. */
const SCRUBS: Record<string, { date: string; to: (day: number) => number }> = {
  // Back a day, to 11 April 1815: ash has reached Bali, Lombok and Banyuwangi.
  ash: { date: '1815-04-11', to: (day) => day - 1 },
  // Past the beat, to a month between beats.
  veil: { date: '1816-02', to: () => dayFromIso('1816-02-15') },
};
/** Long enough for the plaques and the card's words to fade in after a landing. */
const FADE_MS = 1500;

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5194' },
    out: { type: 'string' },
    query: { type: 'string', default: '' },
    timeout: { type: 'string', default: '90' },
  },
});
if (!values.out) throw new Error('--out <dir> is required');
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
const shoot = async (name: string) => {
  const png = join(out, `${name}.png`);
  await page.screenshot({ path: png });
  shots.push(png);
  console.log(png);
};

try {
  const extra = values.query ? `&${values.query}` : '';
  await page.goto(`${values.url}/prototype.html?story=tambora&ui=0${extra}`);
  await page.waitForFunction(
    () => {
      const w = window as WalkWindow;
      if (w.__proto?.error) throw new Error(w.__proto.error);
      return w.__walk !== undefined;
    },
    null,
    { timeout: timeoutMs },
  );

  for (const [beat, id] of BEATS.entries()) {
    const n = beat + 1;
    if (beat > 0) await page.evaluate((b) => (window as WalkWindow).__walk?.goTo(b), beat);
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
  writeFileSync(join(out, 'walk.json'), JSON.stringify({ ...report, shots, problems }, null, 2));
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
