// Explore's renders on this Mac's GPU: Chromium on Metal at 1440x900, reading a local global data
// server. From app/, with the Vite dev server and `npm run data -- --profile global --port 8795`
// up:
//
//   node scripts/exploreShots.ts --demo --url http://127.0.0.1:5173 --out ../build/explore/r1
//     [--data http://127.0.0.1:8795] [--e1b <E1b.png>] [--scene <name>] [--no-gpu]
//   node scripts/exploreShots.ts --events --url http://127.0.0.1:5173 --out ../build/explore/r2
//     [--data http://127.0.0.1:8795] [--variants 0,1,2,3] [--scene <name>] [--no-video]
//   node scripts/exploreShots.ts --labels --url http://127.0.0.1:5173 --out ../build/explore/labels
//     [--data http://127.0.0.1:8795]
//
// --demo: the dev page's ?markDemo (the lobby's glows as marks in the event glyphs), every
// mark variant at world view, 3,000 km over Europe, 3,000 km over the demo's specimen tray in the
// Sahara and 300 km tilted over the Alps, each with one focal mark; a contact sheet per variant
// and one of all variants side by side, beside E1b's cast token (--e1b, by default
// docs/design/concepts/2026-09-28-material-trials/e1-fleet/E1b.png, which must exist: no sheet
// goes without it); and the GPU time of 140, 256 and 512 marks at world view over the marks
// turned off, in explore.json with any console errors. The time is the scene drawn into a target
// of the canvas's size, 400 samples of three draws each with the marks on and as many off, in
// turn (markDemo.ts, gpuAB): the fastest twentieth of each, where other work sharing the GPU has
// added least, and the median. --scene renders one scene only, and --no-gpu skips the timing.
//
// --events: Explore's own events on the dev page, in each variant of --variants in turn (the
// owner's default, 0, first): three openings at world view, each focal in its twenty years; Europe
// in 1805-1815 from the world view down to 3,000 km, the Napoleonic Wars giving way to their wars
// and battles as the view closes; Lepanto in 1571 at 800 km; the Julian Alps in 1917 at 180 km,
// tilted, close enough that the Battles of the Isonzo span more than parentSplitPx and give way to
// their battles; and history's end, 31 December 2000, the ruler 400 years wide, where nothing after
// 2000 is marked. A contact sheet per variant, one of the European sequence, one of all variants
// side by side, and a video of the ruler scrubbing from 3000 BCE to 2000 at world view with a sheet
// of its frames (--no-video skips it); explore.json lists every render's marks with their events'
// names, and any console errors.
//
// --labels: Explore's labels and Meanwhile. From the production page's lobby, a dive onto each of
// three openings (?opening=), across eras and pace layers, landing with its line pinned on its
// plate and Meanwhile's first answer, and from the first with an entry, a flight to that entry,
// pinned on landing. On the dev page, Europe in 1810 at 3,000 km with the Peninsular War's hollow
// glyph hovered, its extent's ring drawn, and a battle beside it hovered; and Lepanto in 1571 at
// 800 km, clicked and so pinned, with a mark beside it hovered. A contact sheet of them all;
// explore.json lists each render's plates and Meanwhile's entries, and any console errors.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Release } from '../src/data/release.ts';
import type {
  ExploreEventsHook,
  ExploreLabelsHook,
  WorldTimeHook,
} from '../src/explore/explore.ts';
import { MARK_VARIANTS } from '../src/marks/families.ts';
import type { MarkSpec, PlacedMark } from '../src/marks/marks.ts';
import type { MarkDemoApi } from '../src/prototype/app/markDemo.ts';
import { dayFromHistorical } from '../src/story/dates.ts';
import type { LonLat } from '../src/story/story.ts';
import type { ViewState } from '../src/view/viewState.ts';

interface ShotPage extends Window {
  __proto?: {
    ready(): boolean;
    view(view: ViewState, instant?: boolean): void;
    stats(): { view: ViewState };
    error?: string;
  };
  __markDemo?: MarkDemoApi;
  __worldTime?: WorldTimeHook;
  __exploreEvents?: ExploreEventsHook;
  __exploreLabels?: ExploreLabelsHook;
}

/** The demo's scenes: a view, and the place whose mark is focal there. */
const SCENES: { name: string; view: ViewState; focal: LonLat }[] = [
  {
    name: 'world',
    view: { lon: 75, lat: 15, viewKm: Infinity, tilt: 0, heading: 0 },
    focal: [84, 28],
  },
  {
    name: 'europe-3000km',
    view: { lon: 16, lat: 44, viewKm: 3000, tilt: 15, heading: 0 },
    focal: [12.5, 41.9],
  },
  {
    name: 'specimen-3000km',
    view: { lon: 22, lat: 23.75, viewKm: 3000, tilt: 0, heading: 0 },
    focal: [22.75, 21.5],
  },
  {
    name: 'alps-300km-tilted',
    view: { lon: 8.0, lat: 46.1, viewKm: 300, tilt: 50, heading: 0 },
    focal: [8.29, 46.12],
  },
];

/** An Explore scene: a view, the ruler's playhead and width, and the focal event, if any. */
interface EventScene {
  name: string;
  caption: string;
  view: ViewState;
  /** The playhead's day in the historical calendar the ruler engraves. */
  date: { year: number; month: number; day: number };
  /** The ruler's width in years: the now window is a tenth of it. */
  years: number;
  focal: string | null;
  /** The mark the sheets look closer at, when not the focal one. */
  spot?: string;
}

const WORLD_VIEW = { viewKm: Infinity, tilt: 0, heading: 0 };
/**
 * Europe with the ruler over 1805-1815, now 1810, as the view closes over Iberia: the Peninsular
 * War, whole from afar, gives way to its battles and sieges and stays as a hollow glyph.
 */
const EUROPE_KM = [Infinity, 12_000, 6000, 3000];
const PENINSULAR_WAR = 'Q152499';
/** The stretch the European sheet's crops show about the war, km across: the peninsula. */
const IBERIA_KM = 1500;

const EVENT_SCENES: EventScene[] = [
  {
    name: 'opening-waterloo',
    caption: 'Waterloo, 18 June 1815, its twenty years, at world view',
    view: { lon: 4.41222, lat: 35, ...WORLD_VIEW },
    date: { year: 1815, month: 6, day: 18 },
    years: 200,
    focal: 'Q48314',
  },
  {
    name: 'opening-krakatoa',
    caption: 'Krakatoa, 27 August 1883, its twenty years, at world view',
    view: { lon: 105.423, lat: -6.102, ...WORLD_VIEW },
    date: { year: 1883, month: 8, day: 27 },
    years: 200,
    focal: 'Q8094772',
  },
  {
    name: 'opening-titanic',
    caption: 'The Titanic, 15 April 1912, its twenty years, at world view',
    view: { lon: -49.94583, lat: 35, ...WORLD_VIEW },
    date: { year: 1912, month: 4, day: 15 },
    years: 200,
    focal: 'Q2577588',
  },
  ...EUROPE_KM.map((viewKm) => ({
    name: `europe-1810-${viewKm === Infinity ? 'world' : `${viewKm}km`}`,
    caption: `Europe, the ruler over 1805-1815, now 1810, ${viewKm === Infinity ? 'at world view' : `${viewKm.toLocaleString('en')} km wide`}`,
    view: { lon: -3, lat: 42, viewKm, tilt: 0, heading: 0 },
    date: { year: 1810, month: 7, day: 1 },
    years: 10,
    focal: null,
    spot: PENINSULAR_WAR,
  })),
  {
    name: 'lepanto-800km',
    caption: 'Lepanto, 7 October 1571, 800 km wide',
    view: { lon: 21.0, lat: 38.3, viewKm: 800, tilt: 30, heading: 0 },
    date: { year: 1571, month: 10, day: 7 },
    years: 20,
    focal: 'Q165425',
  },
  {
    name: 'isonzo-180km-tilted',
    caption: 'Caporetto, 24 October 1917, among the Julian Alps, 180 km wide and tilted',
    view: { lon: 13.6, lat: 46.0, viewKm: 180, tilt: 50, heading: 0 },
    date: { year: 1917, month: 10, day: 24 },
    years: 20,
    focal: 'Q242644',
  },
  {
    name: 'end-2000-world',
    caption: 'History’s end, 31 December 2000, the ruler 400 years wide, at world view',
    view: { lon: 30, lat: 30, ...WORLD_VIEW },
    date: { year: 2000, month: 12, day: 31 },
    years: 400,
    focal: null,
  },
];

/** The scrub: the ruler's playhead from 3000 BCE to 2000 at world view, over SCRUB_MS. */
const SCRUB = {
  view: { lon: 30, lat: 30, ...WORLD_VIEW },
  from: { year: -2999, month: 1, day: 1 },
  to: { year: 2000, month: 12, day: 31 },
  years: 400,
  ms: 30_000,
  /** The years whose frames the scrub's sheet shows. */
  frames: [-2999, -1499, -499, 1, 800, 1300, 1600, 1800, 1914, 1990],
};

/** The openings the labels' renders dive onto: an ancient battle, a city's fire and an eruption. */
const LABEL_OPENINGS = [
  { qid: 'Q31900', name: 'marathon' },
  { qid: 'Q164679', name: 'great-fire-of-london' },
  { qid: 'Q8094772', name: 'krakatoa' },
];
/** Lepanto, which the pinned render clicks. */
const LEPANTO = 'Q165425';

/** E1b's cast-brass ship, cropped from the 1586 x 992 render. */
const E1B_DEFAULT = new URL(
  '../../docs/design/concepts/2026-09-28-material-trials/e1-fleet/E1b.png',
  import.meta.url,
).pathname;
const E1B_CROP = { x: 980, y: 330, w: 200, h: 170 };

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5173' },
    out: { type: 'string' },
    data: { type: 'string', default: 'http://127.0.0.1:8795' },
    demo: { type: 'boolean', default: false },
    events: { type: 'boolean', default: false },
    labels: { type: 'boolean', default: false },
    variants: { type: 'string', default: '0,1,2,3' },
    'no-video': { type: 'boolean', default: false },
    timeout: { type: 'string', default: '120' },
    e1b: { type: 'string', default: E1B_DEFAULT },
    scene: { type: 'string' },
    'no-gpu': { type: 'boolean', default: false },
  },
});
if ([values.demo, values.events, values.labels].filter(Boolean).length !== 1) {
  throw new Error('pass one of --demo, --events and --labels');
}
const scenes = SCENES.filter((scene) => !values.scene || scene.name === values.scene);
const eventScenes = EVENT_SCENES.filter((scene) => !values.scene || scene.name === values.scene);
if (!values.labels && (values.demo ? scenes : eventScenes).length === 0)
  throw new Error(`no scene '${values.scene}'`);
if (!values.out) throw new Error('--out <dir> is required');
const origin = new URL(values.url);
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
  throw new Error('--url must be a local Vite server');
}
const dataOrigin = new URL(values.data);
if (!['localhost', '127.0.0.1', '[::1]'].includes(dataOrigin.hostname)) {
  throw new Error('--data must be a local data server');
}
if (values.demo && !existsSync(values.e1b)) {
  throw new Error(`no E1b render at ${values.e1b}: every sheet sets it beside the marks (--e1b)`);
}
const timeout = Number(values.timeout) * 1000;
const out = resolve(values.out);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const errors: string[] = [];
const report: Record<string, unknown> = { data: dataOrigin.origin };
try {
  if (values.demo) {
    const page = await open(browser);
    const shots = await demoShots(page);
    report.shots = shots;
    if (!values['no-gpu']) report.gpu = await gpuTimes(page);
    await sheets(browser, shots);
    console.log(`${shots.length} renders and their sheets in ${out}`);
  } else if (values.events) {
    await eventRenders(browser, report);
  } else {
    await labelRenders(browser, report);
  }
  assert.deepEqual(errors, [], 'browser console');
} finally {
  report.errors = errors;
  writeFileSync(join(out, 'explore.json'), JSON.stringify(report, null, 2));
  await browser.close();
}

async function open(browser: Browser): Promise<Page> {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Only the app and the local data: never production data by accident.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return [origin.origin, dataOrigin.origin].includes(url.origin)
      ? route.continue()
      : route.abort();
  });
  const url = new URL('/prototype.html', origin);
  url.search = `data=${encodeURIComponent(dataOrigin.origin)}&ui=0&markDemo&markVariant=0`;
  await page.goto(url.href);
  await page.waitForFunction(() => (window as ShotPage).__markDemo !== undefined, null, {
    timeout,
  });
  const failed = await page.evaluate(() => (window as ShotPage).__proto?.error);
  if (failed) throw new Error(failed);
  return page;
}

interface Shot {
  name: string;
  variant: number;
  scene: string;
  path: string;
  focal: { id: string; x: number; y: number } | null;
  placed: readonly PlacedMark[];
}

async function demoShots(page: Page): Promise<Shot[]> {
  const shots: Shot[] = [];
  const marks = await page.evaluate(() => (window as ShotPage).__markDemo!.marks());
  for (const scene of scenes) {
    const focal = nearest(marks, scene.focal);
    await page.evaluate(
      ({ view, id }) => {
        const w = window as ShotPage;
        w.__proto!.view(view, true);
        w.__markDemo!.focus(id);
      },
      { view: scene.view, id: focal },
    );
    for (const [variant] of MARK_VARIANTS.entries()) {
      await page.evaluate((v) => (window as ShotPage).__markDemo!.set({ markVariant: v }), variant);
      await settle(page);
      const name = `v${variant}-${scene.name}`;
      const path = join(out, `${name}.png`);
      await page.screenshot({ path });
      const placed = await page.evaluate(() => (window as ShotPage).__markDemo!.placed());
      const at = placed.find((mark) => mark.id === focal);
      shots.push({
        name,
        variant,
        scene: scene.name,
        path,
        focal: at ? { id: at.id, x: at.x, y: at.y } : null,
        placed,
      });
      console.log(path);
    }
  }
  return shots;
}

/** The GPU time of the marks at world view: 140, 256 and 512, each over the marks turned off. */
async function gpuTimes(page: Page) {
  await page.evaluate(() => {
    const w = window as ShotPage;
    w.__proto!.view({ lon: 75, lat: 15, viewKm: Infinity, tilt: 0, heading: 0 }, true);
    w.__markDemo!.focus(null);
    w.__markDemo!.set({ markVariant: 0 });
  });
  const results: Record<string, unknown> = {};
  for (const count of [140, 256, 512]) {
    await page.evaluate((n) => (window as ShotPage).__markDemo!.stress(n, [75, 15], 70), count);
    await settle(page);
    const placed = await page.evaluate(() => (window as ShotPage).__markDemo!.placed().length);
    const time = await page.evaluate(() => (window as ShotPage).__markDemo!.gpuAB(400));
    if (!time) throw new Error('this browser gives no GPU timer queries');
    const over = { p05: time.on.p05 - time.off.p05, p50: time.on.p50 - time.off.p50 };
    results[String(count)] = { placed, ...time, over };
    console.log(
      `${count} marks (${placed} placed): ${over.p05.toFixed(3)} ms p05, ${over.p50.toFixed(3)} ms p50 over off`,
    );
  }
  await page.evaluate(() => {
    const w = window as ShotPage;
    w.__markDemo!.stress(0);
    w.__markDemo!.set({ marks: true });
  });
  console.log(JSON.stringify(results));
  return results;
}

async function settle(page: Page): Promise<void> {
  // A frame first, so a jump just asked for has reached the streamer before its idleness counts.
  await frames(page, 3);
  await page.waitForFunction(() => (window as ShotPage).__proto?.ready() === true, null, {
    timeout,
  });
  // Two more frames, so the marks' table holds this view.
  await frames(page, 2);
}

async function frames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((done) => requestAnimationFrame(done));
  }, count);
}

function nearest(marks: readonly MarkSpec[], [lon, lat]: LonLat): string {
  let best = marks[0]?.id ?? '';
  let bestD = Infinity;
  for (const mark of marks) {
    const d = (mark.at[0] - lon) ** 2 + (mark.at[1] - lat) ** 2;
    if (d < bestD) [best, bestD] = [mark.id, d];
  }
  return best;
}

/** A contact sheet per variant, and one of all of them, each beside E1b's cast token. */
async function sheets(browser: Browser, shots: Shot[]): Promise<void> {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });
  const png = (path: string) => `data:image/png;base64,${readFileSync(path).toString('base64')}`;
  const e1b = png(values.e1b);
  const zoom = (src: string, x: number, y: number, w: number, h: number, k = 2) =>
    `<div class="crop" style="width:${w * k}px;height:${h * k}px">
      <img src="${src}" style="transform:scale(${k}) translate(${-x}px,${-y}px)"></div>`;
  const e1bCell = `<figure>${zoom(e1b, E1B_CROP.x, E1B_CROP.y, E1B_CROP.w, E1B_CROP.h)}
      <figcaption>E1b cast token, 2×</figcaption></figure>`;
  /** A crop `w` x `h` about a point, kept on screen and off the ruler, at `k` times. */
  const crop = (shot: Shot, at: { x: number; y: number }, w: number, h: number, k = 2) => {
    const x = Math.max(0, Math.min(1440 - w, at.x - w / 2));
    const y = Math.max(0, Math.min(780 - h, at.y - h / 2));
    return zoom(png(shot.path), x, y, w, h, k);
  };
  /** The focal mark; the densest spot among the others away from it; the specimen tray. */
  const spots = (shot: Shot) => {
    // On relief seen tilted, a mark stands above its sea-level place.
    const lift = shot.scene.includes('tilted') ? 25 : 0;
    const focal = shot.focal ?? { x: 720, y: 400 };
    const others = shot.placed.filter(
      (m) =>
        m.id !== shot.focal?.id &&
        !m.id.startsWith('specimen') &&
        Math.hypot(m.x - focal.x, m.y - focal.y) > 90 &&
        m.x > 60 &&
        m.x < 1380 &&
        m.y > 60 &&
        m.y < 760,
    );
    const crowd = (m: PlacedMark) =>
      others.filter((o) => Math.hypot(o.x - m.x, o.y - m.y) < 110).length;
    const busiest = others.sort((a, b) => crowd(b) - crowd(a))[0] ?? focal;
    const tray = shot.scene.startsWith('specimen')
      ? shot.placed.filter((m) => m.id.startsWith('specimen'))
      : [];
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    return {
      focal: { x: focal.x, y: focal.y - lift },
      busiest: { x: busiest.x, y: busiest.y - lift },
      tray: tray.length ? { x: mean(tray.map((m) => m.x)), y: mean(tray.map((m) => m.y)) } : null,
    };
  };
  const style = `<style>
    body { margin: 0; padding: 16px; background: #120c07; color: #d9c7a3;
      font: 15px Georgia, serif; width: max-content; }
    h1 { font-weight: normal; font-size: 20px; margin: 0 0 10px; }
    .row { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
    figure { margin: 0; display: flex; flex-direction: column; gap: 6px; }
    img.full { width: 720px; height: 450px; }
    .crop { position: relative; overflow: hidden; }
    .crop img { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
    figcaption { font-size: 13px; opacity: 0.8; }
  </style>`;
  const shoot = async (html: string, path: string) => {
    await page.setContent(`<!doctype html><html><head>${style}</head><body>${html}</body></html>`);
    await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
    await page.screenshot({ path, fullPage: true });
    console.log(path);
  };
  const figure = (inner: string, caption: string) =>
    `<figure>${inner}<figcaption>${caption}</figcaption></figure>`;
  const TRAY = { w: 300, h: 270 };
  for (const [variant, title] of MARK_VARIANTS.entries()) {
    const own = shots.filter((shot) => shot.variant === variant);
    const rows = own.map((shot) => {
      const { focal, busiest, tray } = spots(shot);
      return `<div class="row">${figure(`<img class="full" src="${png(shot.path)}">`, shot.scene)}
        ${figure(crop(shot, focal, 180, 150), 'focal, 2×')}
        ${tray ? figure(crop(shot, tray, TRAY.w, TRAY.h), 'the specimen tray, 2×') : figure(crop(shot, busiest, 180, 150), 'others, 2×')}
        ${shot === own[0] ? e1bCell : ''}</div>`;
    });
    await shoot(
      `<h1>Variant ${variant}: ${title}</h1>${rows.join('')}`,
      join(out, `sheet-v${variant}.png`),
    );
  }
  const rows = MARK_VARIANTS.map((title, variant) => {
    const own = shots.filter((shot) => shot.variant === variant);
    const cells = own.map((shot) => {
      const { focal, busiest, tray } = spots(shot);
      const inner = tray
        ? crop(shot, tray, TRAY.w, TRAY.h)
        : `<div class="row" style="gap:4px;margin:0">${crop(shot, focal, 150, 135)}${crop(shot, busiest, 150, 135)}</div>`;
      return figure(inner, shot.scene);
    });
    return `<h1>${variant} ${title}</h1><div class="row">${cells.join('')}${e1bCell}</div>`;
  });
  await shoot(rows.join(''), join(out, 'sheet-all.png'));
  const trays = MARK_VARIANTS.map((title, variant) => {
    const shot = shots.find((s) => s.variant === variant && spots(s).tray);
    const tray = shot && spots(shot).tray;
    return shot && tray
      ? figure(crop(shot, tray, TRAY.w, TRAY.h, 3), `${variant} ${title}, 3×`)
      : '';
  });
  if (trays.some(Boolean)) {
    await shoot(
      `<h1>The specimen tray at 3,000 km: rows nature, governance, infrastructure, then a hovered hollow parent, a soft mark, the focal one and a hollow one</h1><div class="row">${trays.join('')}${e1bCell}</div>`,
      join(out, 'sheet-tray.png'),
    );
  }
  await page.close();
}

/** Each event's name and class, by Q number, from the data server's event files. */
async function eventNames(): Promise<Map<number, { label: string; cls: string }>> {
  const release = (await (await fetch(new URL('/release.json', dataOrigin))).json()) as Release;
  if (!release.events) throw new Error(`${dataOrigin.origin} serves no event index`);
  const names = new Map<number, { label: string; cls: string }>();
  let classes: string[] = [];
  const keys = [
    release.events.overview,
    ...release.events.files.map((f) => f.key).filter((k) => k !== release.events!.overview),
  ];
  for (const key of keys) {
    const bytes = Buffer.from(await (await fetch(new URL(`/${key}`, dataOrigin))).arrayBuffer());
    const doc = JSON.parse(gunzipSync(bytes).toString('utf8')) as {
      classes?: string[];
      qid: number[];
      label: string[];
      cls: number[];
    };
    if (doc.classes) classes = doc.classes;
    doc.qid.forEach((qid, i) =>
      names.set(qid, { label: doc.label[i] ?? '', cls: classes[doc.cls[i] ?? -1] ?? '?' }),
    );
  }
  return names;
}

/** A mark as a render drew it: its place and size, its treatment and its event. */
interface DrawnMark extends PlacedMark {
  /** Its event's Q number, `Q…`: a hollow parent's mark id adds a suffix to it. */
  qid: string;
  at: LonLat;
  glyph: string;
  pace: string;
  focal: boolean;
  hollow: boolean;
  soft: boolean;
  label: string;
  cls: string;
}

interface EventShot {
  name: string;
  variant: number;
  scene: string;
  caption: string;
  path: string;
  focal: string | null;
  spot?: string;
  /** The view's width, km, as the camera drew it: the world view's is the zoom's widest. */
  viewKm: number;
  marks: DrawnMark[];
}

/** Opens the dev page in Explore, the marks in `variant`. */
async function openExplore(context: BrowserContext, variant: number): Promise<Page> {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return [origin.origin, dataOrigin.origin].includes(url.origin)
      ? route.continue()
      : route.abort();
  });
  const url = new URL('/prototype.html', origin);
  url.search = `data=${encodeURIComponent(dataOrigin.origin)}&ui=0&markVariant=${variant}`;
  await page.goto(url.href);
  await page.waitForFunction(
    () => {
      const w = window as ShotPage;
      return w.__proto?.error !== undefined || w.__exploreEvents !== undefined;
    },
    null,
    { timeout },
  );
  const failed = await page.evaluate(() => (window as ShotPage).__proto?.error);
  if (failed) throw new Error(failed);
  return page;
}

/** Sets the scene's view at once, the ruler's playhead and width, and its focal event. */
async function stage(
  page: Page,
  view: ViewState,
  day: number,
  years: number,
  focal: string | null,
): Promise<void> {
  await page.evaluate(
    ({ view, day, years, focal }) => {
      const w = window as ShotPage;
      w.__proto!.view(view, true);
      const time = w.__worldTime!;
      time.seek(day);
      const { start, end } = time.span();
      time.zoom((years * 365.2425) / (end - start), 0.5);
      time.seek(day);
      w.__exploreEvents!.focus(focal);
    },
    { view, day, years, focal },
  );
}

/** Waits for the tiles, the event worker and the marks' fades to rest. */
async function settleEvents(page: Page): Promise<void> {
  await frames(page, 3);
  await page.waitForFunction(
    () => {
      const w = window as ShotPage;
      return w.__proto?.ready() === true && w.__exploreEvents?.settled() === true;
    },
    null,
    { timeout },
  );
  await frames(page, 2);
}

/** The marks drawn in view, with their treatments and their events' names. */
async function drawnMarks(
  page: Page,
  names: Map<number, { label: string; cls: string }>,
): Promise<{ focal: string | null; marks: DrawnMark[] }> {
  const { focal, placed, specs } = await page.evaluate(() => {
    const events = (window as ShotPage).__exploreEvents!;
    return { focal: events.focal(), placed: events.placed(), specs: events.marks() };
  });
  const marks = placed.map((mark) => {
    const spec = specs.find((s) => s.id === mark.id);
    const qid = /^Q[0-9]+/.exec(mark.id)?.[0] ?? mark.id;
    const named = names.get(Number(qid.slice(1)));
    return {
      ...mark,
      qid,
      at: spec?.at ?? [NaN, NaN],
      glyph: spec?.glyph ?? '?',
      pace: spec?.pace ?? '?',
      focal: spec?.focal === true,
      hollow: spec?.hollow === true,
      soft: spec?.soft === true,
      label: named?.label ?? mark.id,
      cls: named?.cls ?? '?',
    };
  });
  return { focal, marks };
}

async function eventRenders(browser: Browser, report: Record<string, unknown>): Promise<void> {
  const variants = values.variants.split(',').map(Number);
  if (variants.some((v) => !Number.isInteger(v) || v < 0 || v >= MARK_VARIANTS.length)) {
    throw new Error(`--variants takes 0-${MARK_VARIANTS.length - 1}, comma-separated`);
  }
  const names = await eventNames();
  const shots: EventShot[] = [];
  for (const variant of variants) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    const page = await openExplore(context, variant);
    for (const scene of eventScenes) {
      await stage(page, scene.view, dayFromHistorical(scene.date), scene.years, scene.focal);
      await settleEvents(page);
      const name = `v${variant}-${scene.name}`;
      const path = join(out, `${name}.png`);
      await page.screenshot({ path });
      const { focal, marks } = await drawnMarks(page, names);
      const viewKm = await page.evaluate(() => (window as ShotPage).__proto!.stats().view.viewKm);
      shots.push({
        name,
        variant,
        scene: scene.name,
        caption: scene.caption,
        path,
        focal,
        spot: scene.spot,
        viewKm,
        marks,
      });
      const hollow = marks.filter((m) => m.hollow).length;
      console.log(`${path}: ${marks.length} marks, ${hollow} hollow, focal ${focal ?? 'none'}`);
    }
    await context.close();
  }
  report.shots = shots.map(({ path, ...shot }) => ({ path, ...shot }));
  await eventSheets(browser, shots);
  if (!values['no-video']) report.scrub = await scrubVideo(browser, names);
}

/** The scrub from 3000 BCE to 2000 at world view, as a video and a sheet of frames. */
async function scrubVideo(
  browser: Browser,
  names: Map<number, { label: string; cls: string }>,
): Promise<unknown> {
  const size = { width: 1440, height: 900 };
  const from = dayFromHistorical(SCRUB.from);
  const to = dayFromHistorical(SCRUB.to);
  // The frames first, each settled.
  const still = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await openExplore(still, 0);
  const frameShots: { year: number; path: string; marks: number }[] = [];
  for (const year of SCRUB.frames) {
    await stage(page, SCRUB.view, dayFromHistorical({ year, month: 7, day: 1 }), SCRUB.years, null);
    await settleEvents(page);
    const path = join(out, `scrub-${year < 1 ? `${1 - year}bce` : year}.png`);
    await page.screenshot({ path });
    const { marks } = await drawnMarks(page, names);
    frameShots.push({ year, path, marks: marks.length });
    console.log(`${path}: ${marks.length} marks`);
  }
  await still.close();

  const recording = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    recordVideo: { dir: out, size },
  });
  const filmed = await openExplore(recording, 0);
  await stage(filmed, SCRUB.view, from, SCRUB.years, null);
  await settleEvents(filmed);
  // The playhead moves at a steady pace through the years, a frame at a time.
  const stats = await filmed.evaluate(
    async ({ from, to, ms }) => {
      const time = (window as ShotPage).__worldTime!;
      const start = performance.now();
      let frames = 0;
      let longest = 0;
      let last = start;
      for (;;) {
        const now = await new Promise<number>((done) => requestAnimationFrame(done));
        longest = Math.max(longest, now - last);
        last = now;
        frames++;
        const t = Math.min(1, (now - start) / ms);
        time.seek(from + (to - from) * t);
        if (t >= 1) break;
      }
      return { frames, longestFrameMs: longest, ms: performance.now() - start };
    },
    { from, to, ms: SCRUB.ms },
  );
  await filmed.waitForTimeout(1500);
  const video = filmed.video();
  await recording.close();
  const path = join(out, 'scrub.webm');
  if (video) renameSync(await video.path(), path);
  console.log(`${path}: ${stats.frames} frames in ${Math.round(stats.ms)} ms`);

  const sheet = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  // The globe, which the world view leaves small, at twice its size.
  const cells = frameShots.map(
    ({ year, path, marks }) =>
      `<figure>${cropOf(path, { x: 720, y: 370 }, 240, 190)}
      <figcaption>${year < 1 ? `${1 - year} BCE` : year}, ${marks} marks, 2×</figcaption></figure>`,
  );
  await shootSheet(
    sheet,
    `<h1>The ruler scrubbed from 3000 BCE to 2000 at world view, a ${SCRUB.years}-year ruler (a ${SCRUB.years / 10}-year now window), variant 0</h1><div class="grid3">${cells.join('')}</div>`,
    join(out, 'sheet-scrub.png'),
  );
  await sheet.close();
  return { video: path, ...stats, frames: frameShots };
}

/** A render as an image's source. */
function png(path: string): string {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

/** A `w` x `h` crop of a render about a point, kept on screen and off the ruler, at `k` times. */
function cropOf(path: string, at: { x: number; y: number }, w: number, h: number, k = 2): string {
  const x = Math.max(0, Math.min(1440 - w, at.x - w / 2));
  const y = Math.max(0, Math.min(780 - h, at.y - h / 2));
  return `<div class="crop" style="width:${w * k}px;height:${h * k}px">
    <img src="${png(path)}" style="transform:scale(${k}) translate(${-x}px,${-y}px)"></div>`;
}

/** The sheets' style: set before the renders run, as the module's top level awaits them. */
function sheetStyle(): string {
  return `<style>
  body { margin: 0; padding: 16px; background: #120c07; color: #d9c7a3;
    font: 15px Georgia, serif; width: max-content; }
  h1 { font-weight: normal; font-size: 20px; margin: 0 0 10px; max-width: 1500px; }
  .row { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px; }
  .grid2 { display: grid; grid-template-columns: repeat(2, 720px); gap: 12px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 480px); gap: 12px; }
  figure { margin: 0; display: flex; flex-direction: column; gap: 6px; }
  img.full { width: 720px; height: 450px; }
  .crop { position: relative; overflow: hidden; }
  .crop img { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  figcaption { font-size: 13px; opacity: 0.85; max-width: 720px; line-height: 1.35; }
</style>`;
}

async function shootSheet(page: Page, html: string, path: string): Promise<void> {
  await page.setContent(
    `<!doctype html><html><head>${sheetStyle()}</head><body>${html}</body></html>`,
  );
  await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  await page.screenshot({ path, fullPage: true });
  console.log(path);
}

/** Where to look closer: the focal mark, else the middle of the densest cluster of marks. */
function spotOf(shot: EventShot): { x: number; y: number } {
  // On relief seen tilted, a mark stands above its sea-level place.
  const lift = shot.scene.includes('tilted') ? 25 : 0;
  const focal = shot.marks.find((m) => m.focal || m.qid === shot.spot);
  if (focal) return { x: focal.x, y: focal.y - lift };
  const inView = shot.marks.filter((m) => m.x > 60 && m.x < 1380 && m.y > 60 && m.y < 760);
  const crowd = (m: DrawnMark) =>
    inView.filter((o) => Math.hypot(o.x - m.x, o.y - m.y) < 110).length;
  const busiest = [...inView].sort((a, b) => crowd(b) - crowd(a))[0];
  return busiest ? { x: busiest.x, y: busiest.y - lift } : { x: 720, y: 400 };
}

/** A render's marks in words: the hollow parents, the solid ones by class, and the focal one. */
function tally(shot: EventShot): string {
  const hollow = shot.marks.filter((m) => m.hollow).map((m) => m.label);
  const solid = shot.marks.filter((m) => !m.hollow);
  const byClass = new Map<string, number>();
  for (const m of solid) byClass.set(m.cls, (byClass.get(m.cls) ?? 0) + 1);
  const classes = [...byClass]
    .sort((a, b) => b[1] - a[1])
    .map(([cls, n]) => `${n} ${cls}`)
    .join(', ');
  const focal = shot.marks.find((m) => m.focal)?.label;
  return [
    `${shot.marks.length} marks: ${classes || 'none'}`,
    hollow.length ? `hollow: ${hollow.join('; ')}` : '',
    focal ? `focal: ${focal}` : '',
  ]
    .filter(Boolean)
    .join('. ');
}

async function eventSheets(browser: Browser, shots: EventShot[]): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const figure = (inner: string, caption: string) =>
    `<figure>${inner}<figcaption>${caption}</figcaption></figure>`;
  const variants = [...new Set(shots.map((s) => s.variant))];
  for (const variant of variants) {
    const rows = shots
      .filter((shot) => shot.variant === variant)
      .map(
        (shot) => `<div class="row">
          ${figure(`<img class="full" src="${png(shot.path)}">`, `${shot.caption}. ${tally(shot)}`)}
          ${figure(cropOf(shot.path, spotOf(shot), 220, 180), shot.focal ? 'the focal mark, 2×' : 'the densest marks, 2×')}
        </div>`,
      );
    await shootSheet(
      page,
      `<h1>Explore's events, variant ${variant}: ${MARK_VARIANTS[variant]}</h1>${rows.join('')}`,
      join(out, `sheet-v${variant}.png`),
    );
  }
  // Europe as the view closes, in the first variant rendered.
  const europe = shots.filter((s) => s.variant === variants[0] && s.scene.startsWith('europe'));
  if (europe.length > 0) {
    const cells = europe.map((shot) =>
      figure(`<img class="full" src="${png(shot.path)}">`, `${shot.caption}. ${tally(shot)}`),
    );
    // The same stretch of the globe in each, IBERIA_KM across about the war's mark.
    const crops = europe.map((shot) => {
      const w = Math.max(24, (IBERIA_KM * 1440) / shot.viewKm);
      const k = 340 / w;
      const at = spotOf(shot);
      return figure(
        cropOf(shot.path, at, w, 0.8 * w, k),
        `${shot.caption.replace(/.*, /, '')}, ${k.toFixed(1)}×`,
      );
    });
    await shootSheet(
      page,
      `<h1>Europe, the ruler over 1805-1815, now 1810, as the view closes over Iberia, variant ${variants[0]}: the Peninsular War gives way to its battles and sieges and stays as a hollow glyph</h1>
      <div class="row">${crops.join('')}</div>
      <div class="grid2">${cells.join('')}</div>`,
      join(out, 'sheet-europe.png'),
    );
  }
  // Every variant side by side, a crop of each scene.
  const scenesDrawn = [...new Set(shots.map((s) => s.scene))];
  const rows = scenesDrawn.map((scene) => {
    const own = shots.filter((s) => s.scene === scene);
    const cells = own.map((shot) =>
      figure(
        cropOf(shot.path, spotOf(shot), 240, 170, 1.5),
        `${shot.variant} ${MARK_VARIANTS[shot.variant]}`,
      ),
    );
    return `<h1>${own[0]?.caption ?? scene}</h1><div class="row">${cells.join('')}</div>`;
  });
  await shootSheet(page, rows.join(''), join(out, 'sheet-all.png'));
  await page.close();
}

/** A render of labels: its plates' words, sides and places, and Meanwhile's entries. */
interface LabelShot {
  name: string;
  caption: string;
  path: string;
  plates: { pinned: boolean; side: string | null; text: string; box: number[] }[];
  meanwhile: string[];
}

/** What a render shows of the labels and Meanwhile. */
async function labelsShown(page: Page): Promise<Omit<LabelShot, 'name' | 'caption' | 'path'>> {
  return page.evaluate(() => ({
    plates: [...document.querySelectorAll<HTMLElement>('.xl-plate.is-shown')].map((plate) => {
      const box = plate.getBoundingClientRect();
      return {
        pinned: plate.classList.contains('is-pinned'),
        side: plate.getAttribute('data-side'),
        text: [...plate.children]
          .map((line) => (line as HTMLElement).innerText.replace(/\s*\n\s*/g, ' / '))
          .join(' | '),
        box: [box.left, box.top, box.width, box.height].map(Math.round),
      };
    }),
    meanwhile: [...document.querySelectorAll('.wu-meanwhile:not([hidden]) .wu-mw-entry')].map(
      (entry) => entry.textContent ?? '',
    ),
  }));
}

/** Opens the production page's lobby on this machine, Explore's dive pinned on `qid`. */
async function openLobby(context: BrowserContext, qid: string): Promise<Page> {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return [origin.origin, dataOrigin.origin].includes(url.origin)
      ? route.continue()
      : route.abort();
  });
  await page.addInitScript(() => performance.setResourceTimingBufferSize(100_000));
  const url = new URL('/', origin);
  url.search = `data=${encodeURIComponent(dataOrigin.origin)}&opening=${qid}`;
  await page.goto(url.href);
  await page.locator('#room').waitFor({ state: 'hidden', timeout });
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => document.body.dataset.lobby === 'idle', null, { timeout });
  return page;
}

/**
 * Waits on the production page, which has no readiness hook, for the event worker and the marks'
 * fades to rest and for the data host to have sent nothing new for a second and a half.
 */
async function settleLive(page: Page): Promise<void> {
  await frames(page, 3);
  await page.waitForFunction(() => (window as ShotPage).__exploreEvents?.settled() === true, null, {
    timeout,
  });
  let fetched = -1;
  for (let still = 0; still < 3;) {
    await page.waitForTimeout(500);
    const count = await page.evaluate(
      (host) =>
        performance.getEntriesByType('resource').filter((entry) => entry.name.startsWith(host))
          .length,
      dataOrigin.origin,
    );
    still = count === fetched ? still + 1 : 0;
    fetched = count;
  }
  // The plates' and Meanwhile's fades.
  await page.waitForTimeout(900);
}

/** Points at the mark with this id and waits for its plate. */
async function hoverMark(page: Page, id: string): Promise<void> {
  const mark = await page.evaluate(
    (id) => (window as ShotPage).__exploreEvents!.placed().find((m) => m.id === id),
    id,
  );
  if (!mark) throw new Error(`no mark ${id} in view`);
  await page.mouse.move(mark.x, mark.y);
  await page.waitForFunction((id) => (window as ShotPage).__exploreLabels?.hovered() === id, id, {
    timeout,
  });
  await page.waitForTimeout(500);
}

/** The drawn mark nearest the mark with this id, other than it and its event's. */
async function markBeside(page: Page, id: string): Promise<string> {
  const beside = await page.evaluate((id) => {
    const placed = (window as ShotPage).__exploreEvents!.placed();
    const own = placed.find((m) => m.id === id);
    if (!own) return null;
    const qid = id.replace('/outline', '');
    const others = placed.filter(
      (m) => m.id.replace('/outline', '') !== qid && !m.id.endsWith('/outline') && m.alpha > 0.5,
    );
    others.sort(
      (a, b) => Math.hypot(a.x - own.x, a.y - own.y) - Math.hypot(b.x - own.x, b.y - own.y),
    );
    return others[0]?.id ?? null;
  }, id);
  if (!beside) throw new Error(`no mark beside ${id}`);
  return beside;
}

async function labelRenders(browser: Browser, report: Record<string, unknown>): Promise<void> {
  const shots: LabelShot[] = [];
  const shoot = async (page: Page, name: string, caption: string) => {
    const path = join(out, `${name}.png`);
    await page.screenshot({ path });
    const shown = await labelsShown(page);
    shots.push({ name, caption, path, ...shown });
    console.log(`${path}: ${shown.plates.map((p) => p.text).join(' / ')}`);
  };
  const size = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

  // The dives, each in a context of its own, so no opening is remembered into the next.
  let flown = false;
  for (const opening of LABEL_OPENINGS) {
    const context = await browser.newContext(size);
    const page = await openLobby(context, opening.qid);
    await page.locator('.lobby-plaque[data-choice="explore"]').click();
    await page.waitForFunction(() => document.body.dataset.lobby === 'gone', null, { timeout });
    await page.waitForFunction(
      (qid) => (window as ShotPage).__exploreLabels?.pinned() === qid,
      opening.qid,
      { timeout },
    );
    await page
      .locator('.wu-meanwhile .wu-mw-entry')
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => console.log(`${opening.name}: Meanwhile gave no entry`));
    await settleLive(page);
    await shoot(page, `opening-${opening.name}`, `The dive onto ${opening.name}, landed`);
    const entry = page.locator('.wu-meanwhile .wu-mw-entry').first();
    if (!flown && (await entry.isVisible())) {
      flown = true;
      const label = await entry.locator('.wu-mw-label').textContent();
      await entry.click();
      await page.waitForFunction(
        (label) =>
          document.querySelector('.xl-plate.is-pinned.is-shown .xl-name')?.textContent === label,
        label,
        { timeout },
      );
      await settleLive(page);
      await shoot(page, 'meanwhile-flight', `Meanwhile's ${label}, flown to and pinned`);
    }
    await context.close();
  }

  // Hovered and pinned plates on the dev page, whose views the scenes set.
  const context = await browser.newContext(size);
  const page = await openExplore(context, 0);
  const europe = EVENT_SCENES.find((scene) => scene.name === 'europe-1810-3000km')!;
  await stage(page, europe.view, dayFromHistorical(europe.date), europe.years, null);
  await settleEvents(page);
  const war = `${PENINSULAR_WAR}/outline`;
  await hoverMark(page, war);
  await shoot(
    page,
    'hover-parent-europe-1810',
    'The Peninsular War hovered, over 1810 at 3,000 km',
  );
  await hoverMark(page, await markBeside(page, war));
  await shoot(page, 'hover-europe-1810', 'A mark beside it hovered');

  const lepanto = EVENT_SCENES.find((scene) => scene.name === 'lepanto-800km')!;
  await page.mouse.move(5, 450);
  await stage(page, lepanto.view, dayFromHistorical(lepanto.date), lepanto.years, null);
  await settleEvents(page);
  const at = await page.evaluate(
    (id) => (window as ShotPage).__exploreEvents!.placed().find((m) => m.id === id),
    LEPANTO,
  );
  if (!at) throw new Error('Lepanto is not marked in view');
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(
    (id) => (window as ShotPage).__exploreLabels?.pinned() === id,
    LEPANTO,
    { timeout },
  );
  await settleEvents(page);
  await hoverMark(page, await markBeside(page, LEPANTO));
  await shoot(page, 'pinned-lepanto', 'Lepanto clicked and pinned, a mark beside it hovered');
  await context.close();

  report.labels = shots.map(({ path, ...shot }) => ({ path, ...shot }));
  const sheet = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const cells = shots.map(
    (shot) =>
      `<figure><img class="full" src="${png(shot.path)}"><figcaption>${shot.caption}. ${shot.plates
        .map((p) => `${p.pinned ? 'Pinned' : 'Hovered'}, ${p.side}: ${p.text}`)
        .join(
          '; ',
        )}${shot.meanwhile.length ? `. Meanwhile: ${shot.meanwhile.join('; ')}` : ''}</figcaption></figure>`,
  );
  await shootSheet(
    sheet,
    `<h1>Explore's labels and Meanwhile</h1><div class="grid2">${cells.join('')}</div>`,
    join(out, 'sheet-labels.png'),
  );
  await sheet.close();
}
