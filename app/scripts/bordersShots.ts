// Still renders of the borders through time (#80) on this Mac's GPU: Chromium on Metal at
// 1440x900, the dev page in Explore with ?stepBorders, which draws the border step the world clock
// stands in from its slot (prototype/app/main.ts). For each view it jumps the camera there (tilt 0,
// heading 0), shoots it without borders, then seeks the clock to 1 July of each year, waits until
// that year's step draws at full strength and the streamer has been idle for a second, and shoots.
// Then it lays the renders out in contact sheets: each set at half size, a row per year, and their
// centres at full size. Plain Node, run from app/ with the Vite dev server and a global data server
// up:
//
//   node scripts/bordersShots.ts --url http://127.0.0.1:5173 --data http://127.0.0.1:8793
//     [--out ../build/borders/renders] [--only matched,europe,...] [--skip-existing]
//     [--sheets-only] [--view <name>=<lon>:<lat>:<km>@<year>+<year>...]...
//
// The sets: 1000, 1500, 1800 and 1914 on the comparison's matched views; Europe and India in those
// years at world view, 6,000 and 2,500 km across; Kuwait, Victoria, the Aral, Java, Sumbawa,
// Hyderabad and Mysore at 1,500 km in those years and 1815, and in the years their corrections
// turn on; and Africa and the Americas in 1500. Writes <out>/shots/<view>-<year>.png (-none
// without borders), <out>/<set>.png and <out>/<set>-detail.png, and <out>/shots.json: each
// shot's camera, the step drawn, its year plate's words and any console problems. --view adds a
// view of its own, in the given years, to the sheet `views` (a km of 0 is the widest view).
import { chromium, type Browser } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { StepShown } from '../src/borders/clockBorders.ts';
import type { Release } from '../src/data/release.ts';
import { dayFromHistorical, formatHistorical } from '../src/story/dates.ts';
import type { ViewState } from '../src/view/viewState.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5173' },
    data: { type: 'string', default: 'http://127.0.0.1:8793' },
    out: { type: 'string', default: '../build/borders/renders' },
    only: { type: 'string' },
    'skip-existing': { type: 'boolean', default: false },
    'sheets-only': { type: 'boolean', default: false },
    view: { type: 'string', multiple: true, default: [] },
    settle: { type: 'string', default: '1500' },
    timeout: { type: 'string', default: '120' },
  },
});
const out = resolve(values.out);
const shotsDir = join(out, 'shots');
mkdirSync(shotsDir, { recursive: true });
const timeout = Number(values.timeout) * 1000;

interface View {
  lon: number;
  lat: number;
  /** Km across; Infinity is the widest the zoom allows. */
  km: number;
  title: string;
}

/** The comparison's matched views, Europe and India from task 0, and the places at 1,500 km. */
const VIEWS: Record<string, View> = {
  oldworld: { lon: 40, lat: 20, km: 17500, title: 'The Old World, 17,500 km' },
  americas: { lon: -75, lat: 0, km: 17500, title: 'The Americas, 17,500 km' },
  europe: { lon: 15, lat: 46, km: 4000, title: 'Europe, 4,000 km' },
  asia: { lon: 100, lat: 25, km: 8000, title: 'East Asia, 8,000 km' },
  africa: { lon: 20, lat: 0, km: 11000, title: 'Africa, 11,000 km' },
  'europe-world': { lon: 15, lat: 45, km: Infinity, title: 'Europe, world view' },
  'europe-6000': { lon: 15, lat: 48, km: 6000, title: 'Europe, 6,000 km' },
  'europe-2500': { lon: 12, lat: 48, km: 2500, title: 'Europe, 2,500 km' },
  'india-world': { lon: 80, lat: 22, km: Infinity, title: 'India, world view' },
  'india-6000': { lon: 80, lat: 22, km: 6000, title: 'India, 6,000 km' },
  'india-2500': { lon: 80, lat: 24, km: 2500, title: 'India, 2,500 km' },
  kuwait: { lon: 47.5, lat: 29.3, km: 1500, title: 'Kuwait, 1,500 km' },
  victoria: { lon: 33, lat: -1, km: 1500, title: 'Lake Victoria, 1,500 km' },
  aral: { lon: 60, lat: 45, km: 1500, title: 'The Aral Sea, 1,500 km' },
  java: { lon: 110, lat: -7.3, km: 1500, title: 'Java, 1,500 km' },
  sumbawa: { lon: 118.3, lat: -8.3, km: 1500, title: 'Sumbawa, 1,500 km' },
  hyderabad: { lon: 78.5, lat: 17.4, km: 1500, title: 'Hyderabad, 1,500 km' },
  mysore: { lon: 76.5, lat: 12.8, km: 1500, title: 'Mysore, 1,500 km' },
  ladoga: { lon: 31, lat: 60.8, km: 1500, title: 'Lake Ladoga, 1,500 km' },
  michigan: { lon: -86.8, lat: 44.6, km: 1500, title: 'Lake Michigan, 1,500 km' },
  sevan: { lon: 45.2, lat: 40.4, km: 1500, title: 'Lake Sevan, 1,500 km' },
  mesoamerica: { lon: -95, lat: 18, km: 3500, title: 'Mesoamerica, 3,500 km' },
  andes: { lon: -70, lat: -14, km: 4500, title: 'The Andes, 4,500 km' },
  'west-africa': { lon: 0, lat: 12, km: 4500, title: 'West Africa, 4,500 km' },
  'east-africa': { lon: 35, lat: -3, km: 4500, title: 'East Africa, 4,500 km' },
};

const YEARS = [1000, 1500, 1800, 1914];
const PLACES = ['kuwait', 'victoria', 'aral', 'java', 'sumbawa', 'hyderabad', 'mysore'];

/** A sheet: its rows, each a label and its shots as [view, year]. */
interface Sheet {
  title: string;
  rows: { label: string; shots: [string, number][] }[];
}

const byYear = (views: string[]): Sheet['rows'] =>
  YEARS.map((year) => ({ label: String(year), shots: views.map((view) => [view, year]) }));

const SHEETS: Record<string, Sheet> = {
  matched: {
    title: '1000, 1500, 1800 and 1914 on the matched views',
    rows: byYear(['oldworld', 'americas', 'europe', 'asia', 'africa']),
  },
  europe: {
    title: 'Europe at world view, 6,000 and 2,500 km',
    rows: byYear(['europe-world', 'europe-6000', 'europe-2500']),
  },
  india: {
    title: 'India at world view, 6,000 and 2,500 km',
    rows: byYear(['india-world', 'india-6000', 'india-2500']),
  },
  places: {
    title: 'Places at 1,500 km in 1000, 1500, 1800, 1815 and 1914',
    rows: PLACES.map((view) => ({
      label: VIEWS[view]?.title.split(',')[0] ?? view,
      shots: [1000, 1500, 1800, 1815, 1914].map((year) => [view, year] as [string, number]),
    })),
  },
  corrections: {
    title: 'The corrections in the years they turn on',
    rows: [
      {
        label: 'Kuwait',
        shots: [
          ['kuwait', 1872],
          ['kuwait', 1899],
          ['kuwait', 1950],
          ['kuwait', 1962],
        ],
      },
      {
        label: 'Java and Sumbawa',
        shots: [
          ['java', 1813],
          ['java', 1816],
          ['java', 1817],
          ['sumbawa', 1816],
          ['sumbawa', 1817],
        ],
      },
      {
        label: 'Hyderabad and Mysore',
        shots: [
          ['hyderabad', 1798],
          ['hyderabad', 1801],
          ['mysore', 1798],
          ['mysore', 1799],
          ['mysore', 1860],
        ],
      },
    ],
  },
  lakes: {
    title: 'The lake shores verify:bake flags',
    rows: [
      {
        label: 'Ladoga',
        shots: [
          ['ladoga', 1938],
          ['ladoga', 1941],
        ],
      },
      {
        label: 'Michigan',
        shots: [
          ['michigan', 1825],
          ['michigan', 1835],
        ],
      },
      { label: 'Sevan', shots: [['sevan', 1734]] },
    ],
  },
  'new-world-1500': {
    title: 'Africa and the Americas in 1500',
    rows: [
      {
        label: 'The Americas',
        shots: [
          ['americas', 1500],
          ['mesoamerica', 1500],
          ['andes', 1500],
        ],
      },
      {
        label: 'Africa',
        shots: [
          ['africa', 1500],
          ['west-africa', 1500],
          ['east-africa', 1500],
        ],
      },
    ],
  },
};

interface ShotWindow {
  __proto?: {
    ready(): boolean;
    error?: string;
    stats(): { view: ViewState };
    view(view: ViewState, instant?: boolean): void;
  };
  __worldTime?: { seek(day: number): void };
  __borders?: { show(on: boolean): void; shown(): StepShown | null };
}

interface Shot {
  view: string;
  year: number | null;
  path: string;
  step?: number;
  stepYear?: number;
  plate?: string;
  camera?: ViewState;
  problems: string[];
}

const HIDE = '.wu, .wu *, #hud, .lil-gui, #presets, #note { visibility: hidden !important; }';
const WIDEST_KM = 1e9;

const releaseUrl = `${new URL(values.data).origin}/release.json`;
const release = (await (await fetch(releaseUrl)).json()) as Release;
if (!release.borderSteps) throw new Error(`${releaseUrl} has no borderSteps section`);
const stepYears = release.borderSteps.years;
const clockDay = (year: number) => dayFromHistorical({ year, month: 7, day: 1 });
const firstDay = (year: number) => dayFromHistorical({ year, month: 1, day: 1 });
/** The step that holds on 1 July of `year`, as borders/steps.ts's stepAt finds it. */
const stepIn = (year: number) =>
  stepYears.findLastIndex((first) => firstDay(first) <= clockDay(year));
/** The year plate's words, as borders/steps.ts's plateLabel writes them. */
const plateLabel = (year: number) => `Borders · ${formatHistorical(firstDay(year), 'year')}`;

// Views asked for on the command line: one row each in the sheet `views`.
const asked = values.view.map((spec) => {
  const match = /^([\w-]+)=(-?[\d.]+):(-?[\d.]+):([\d.]+)@(-?\d+(?:\+-?\d+)*)$/.exec(spec);
  if (!match) throw new Error(`--view ${spec}: expected <name>=<lon>:<lat>:<km>@<year>+<year>`);
  const [, name = '', lon, lat, km, years = ''] = match;
  const wide = Number(km) === 0;
  VIEWS[name] = {
    lon: Number(lon),
    lat: Number(lat),
    km: wide ? Infinity : Number(km),
    title: `${name}, ${wide ? 'world view' : `${Number(km).toLocaleString('en')} km`}`,
  };
  return {
    label: name,
    shots: years.split('+').map((year) => [name, Number(year)] as [string, number]),
  };
});
if (asked.length > 0) SHEETS.views = { title: 'Views asked for', rows: asked };
const only = values.only ? new Set(values.only.split(',')) : null;
const sheetNames = Object.keys(SHEETS).filter((name) => !only || only.has(name));
/** Each view's years, in order: the renders every chosen sheet needs. */
const wanted = new Map<string, Set<number>>();
for (const name of sheetNames) {
  for (const row of SHEETS[name]?.rows ?? []) {
    for (const [view, year] of row.shots) {
      if (!VIEWS[view]) throw new Error(`no view '${view}'`);
      wanted.set(view, (wanted.get(view) ?? new Set()).add(year));
    }
  }
}
const shotPath = (view: string, year: number | null) =>
  join(shotsDir, `${view}-${year ?? 'none'}.png`);

const reportPath = join(out, 'shots.json');
const earlier = existsSync(reportPath)
  ? (JSON.parse(readFileSync(reportPath, 'utf8')) as Shot[])
  : [];
const report = new Map(earlier.map((shot) => [shot.path, shot]));

const browser = await chromium.launch({ args: ['--use-angle=metal'] });
try {
  if (!values['sheets-only']) await render(browser);
  await sheets(browser);
} finally {
  await browser.close();
  writeFileSync(reportPath, JSON.stringify([...report.values()], null, 2));
}

async function render(browser: Browser): Promise<void> {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  const query = new URLSearchParams({ data: values.data, ui: '0', stepBorders: '1' });
  await page.goto(`${values.url}/prototype.html?${query}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as ShotWindow;
      if (w.__proto?.error) throw new Error(w.__proto.error);
      return w.__borders !== undefined && w.__worldTime !== undefined;
    },
    null,
    { timeout },
  );
  await page.addStyleTag({ content: HIDE });
  for (const [name, years] of wanted) {
    const view = VIEWS[name] as View;
    const todo = [null, ...[...years].sort((a, b) => a - b)].filter(
      (year) => !values['skip-existing'] || !existsSync(shotPath(name, year)),
    );
    if (todo.length === 0) continue;
    await page.evaluate(
      ([lon, lat, viewKm]) =>
        (window as unknown as ShotWindow).__proto!.view(
          { lon: lon!, lat: lat!, viewKm: viewKm!, tilt: 0, heading: 0 },
          true,
        ),
      [view.lon, view.lat, Number.isFinite(view.km) ? view.km : WIDEST_KM],
    );
    for (const year of todo) {
      const step = year === null ? null : stepIn(year);
      const stepYear = step === null || step < 0 ? null : (stepYears[step] ?? null);
      await page.evaluate(
        ([day, on]) => {
          const w = window as unknown as ShotWindow;
          if (day !== null) w.__worldTime!.seek(day);
          w.__borders!.show(on);
        },
        [year === null ? null : clockDay(year), year !== null] as const,
      );
      await page.waitForTimeout(500);
      await page.waitForFunction(
        (drawn) => {
          const w = window as unknown as ShotWindow;
          const shown = w.__borders!.shown();
          const borders =
            drawn === null ? shown === null : shown?.year === drawn && shown.strength > 0.999;
          return borders && w.__proto!.ready();
        },
        stepYear,
        { timeout, polling: 250 },
      );
      await page.waitForTimeout(Number(values.settle));
      const path = shotPath(name, year);
      await page.screenshot({ path });
      const camera = await page.evaluate(
        () => (window as unknown as ShotWindow).__proto!.stats().view,
      );
      const shot: Shot = { view: name, year, path, camera, problems: problems.splice(0) };
      if (step !== null && step >= 0 && stepYear !== null) {
        Object.assign(shot, { step, stepYear, plate: plateLabel(stepYear) });
      }
      report.set(path, shot);
      console.log(path, shot.plate ?? 'no borders', shot.problems.length || '');
    }
  }
  await page.close();
}

/** Each sheet at half size, a row per year or place, and its renders' centres at full size. */
async function sheets(browser: Browser): Promise<void> {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  const png = (path: string) => `data:image/png;base64,${readFileSync(path).toString('base64')}`;
  const style = `<style>
    body { margin: 0; padding: 20px; background: #120c07; color: #d9c7a3;
      font: 15px Georgia, serif; width: max-content; }
    h1 { font-weight: normal; font-size: 24px; margin: 0 0 14px; }
    .row { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 14px; }
    .label { width: 150px; font-size: 20px; padding-top: 4px; }
    figure { margin: 0; display: flex; flex-direction: column; gap: 5px; }
    .cell { width: 720px; height: 450px; overflow: hidden; position: relative; }
    .cell img { position: absolute; }
    img.half { width: 720px; height: 450px; left: 0; top: 0; }
    img.centre { left: -360px; top: -225px; }
    figcaption { font-size: 14px; opacity: 0.85; }
  </style>`;
  for (const name of sheetNames) {
    const sheet = SHEETS[name] as Sheet;
    for (const detail of [false, true]) {
      const rows = sheet.rows.map((row) => {
        const cells = row.shots.map(([view, year]) => {
          const shot = report.get(shotPath(view, year));
          const title = VIEWS[view]?.title ?? view;
          if (!shot || !existsSync(shot.path)) {
            return `<figure><div class="cell"></div><figcaption>${title}, ${year}: not rendered</figcaption></figure>`;
          }
          const plate = shot.stepYear === year ? shot.plate : `${shot.plate} (clock ${year})`;
          return `<figure><div class="cell"><img class="${detail ? 'centre' : 'half'}" src="${png(shot.path)}"></div>
            <figcaption>${title}: ${plate}</figcaption></figure>`;
        });
        return `<div class="row"><div class="label">${row.label}</div>${cells.join('')}</div>`;
      });
      const path = join(out, `${name}${detail ? '-detail' : ''}.png`);
      const scale = detail ? 'centres at full size' : 'half size';
      await page.setContent(
        `<!doctype html><html><head>${style}</head><body><h1>${sheet.title} (${scale})</h1>${rows.join('')}</body></html>`,
      );
      await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
      await page.screenshot({ path, fullPage: true });
      console.log(path);
    }
  }
  await page.close();
}
