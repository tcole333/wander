// Explore's marks as the production entry (index.html) draws them, on this Mac's GPU: Chromium on
// Metal at 1440x900, at device pixel ratio 2 or 1 (the page draws at most 1.5), reading a local
// global data server. From app/, with the Vite dev server and
// `npm run data -- --profile global --port <p>` up:
//
//   node scripts/marksShots.ts --url http://127.0.0.1:5173 --data http://127.0.0.1:8793 --out <dir>
//     [--dpr 2|1] [--views europe,world,europe-3000km,alps-300km,...] [--hover] [--video]
//
// One page load: the lobby's dive onto Waterloo, its plate unpinned and the ruler's playhead set to
// 1 July 1810 at the dive's width, then each view in turn, set at once through window.__wanderView
// (?hooks=1, page/viewHook.ts) and shot once the globe, the event worker and the marks' fades have
// settled. Writes <out>/<view>.png and <out>/shots.json: each render's marks with their places,
// sizes, glyphs and events' names, and any console errors. --hover also shoots, in each view that
// names spots, the pointer resting on each mark of each spot, its plate up: <view>-hover-<qid>.png.
// --video writes <out>/zoom.mp4 through ffmpeg: the view closing from the world to 300 km over the
// Alps and tilting as it nears, a settled frame at a time, so every frame shows the tiles and the
// marks as they stand at that width.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { chromium, type Page } from '@playwright/test';
import type { Release } from '../src/data/release.ts';
import type {
  ExploreEventsHook,
  ExploreLabelsHook,
  WorldTimeHook,
} from '../src/explore/explore.ts';
import type { MarkSpec, PlacedMark } from '../src/marks/marks.ts';
import type { WanderViewHook } from '../src/page/viewHook.ts';
import { dayFromHistorical } from '../src/story/dates.ts';
import type { ViewState } from '../src/view/viewState.ts';

interface ShotPage extends Window {
  __wanderView?: WanderViewHook;
  __worldTime?: WorldTimeHook;
  __exploreEvents?: ExploreEventsHook;
  __exploreLabels?: ExploreLabelsHook;
}

/** Waterloo, which the dive opens on: in 1810's twenty years, and over Europe. */
const OPENING = 'Q48314';
const DAY = dayFromHistorical({ year: 1810, month: 7, day: 1 });

/** A view, and the places in it where two events share a spot, which --hover points at. */
interface View {
  view: ViewState;
  spots?: { name: string; at: [number, number] }[];
}

/** Munich, Pressburg and London, where two of 1810's twenty years' events share a place. */
const SHARED = [
  { name: 'munich', at: [11.575, 48.138] as [number, number] },
  { name: 'pressburg', at: [17.109, 48.152] as [number, number] },
  { name: 'london', at: [-0.129, 51.512] as [number, number] },
];

const VIEWS: Record<string, View> = {
  // The owner's framing: Europe in 1810, 1,700 km across.
  europe: { view: { lon: 9, lat: 48.5, viewKm: 1700, tilt: 0, heading: 0 }, spots: SHARED },
  world: { view: { lon: 10, lat: 35, viewKm: Infinity, tilt: 0, heading: 0 } },
  'europe-3000km': { view: { lon: 10, lat: 47, viewKm: 3000, tilt: 0, heading: 0 } },
  'alps-300km': { view: { lon: 11.8, lat: 46.6, viewKm: 300, tilt: 50, heading: 0 } },
  'munich-400km': {
    view: { lon: 11.6, lat: 48.1, viewKm: 400, tilt: 0, heading: 0 },
    spots: [SHARED[0]!],
  },
  'london-400km': {
    view: { lon: -0.13, lat: 51.51, viewKm: 400, tilt: 0, heading: 0 },
    spots: [SHARED[2]!],
  },
};

/** The zoom: from the world view to 300 km over the Alps, tilting over the last stretch. */
const ZOOM = {
  from: { lon: 10, lat: 40, viewKm: 20_000, tilt: 0, heading: 0 },
  to: VIEWS['alps-300km']!.view,
  frames: 150,
  fps: 30,
};

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5173' },
    data: { type: 'string', default: 'http://127.0.0.1:8793' },
    out: { type: 'string' },
    dpr: { type: 'string', default: '2' },
    views: { type: 'string', default: Object.keys(VIEWS).join(',') },
    hover: { type: 'boolean', default: false },
    video: { type: 'boolean', default: false },
    timeout: { type: 'string', default: '120' },
  },
});
if (!values.out) throw new Error('--out <dir> is required');
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const origin = new URL(values.url);
const dataOrigin = new URL(values.data);
for (const url of [origin, dataOrigin]) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error(`${url.origin} is not on this machine`);
  }
}
const views = values.views.split(',').filter(Boolean);
for (const name of views) if (!VIEWS[name]) throw new Error(`no view '${name}'`);
const timeout = Number(values.timeout) * 1000;
const dpr = Number(values.dpr);

interface DrawnMark extends PlacedMark {
  at: [number, number];
  glyph: string;
  pace: string;
  focal: boolean;
  hollow: boolean;
  label: string;
}

interface Shot {
  view: string;
  path: string;
  viewKm: number;
  marks: DrawnMark[];
  /** The marks of the events placed at each spot, and each one's hovered render. */
  spots: { name: string; marks: string[]; hovers: string[] }[];
}

const names = await eventNames();
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const errors: string[] = [];
const shots: Shot[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: dpr,
  });
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
  await openExplore(page);
  for (const name of views) shots.push(await shoot(page, name, VIEWS[name]!));
  if (values.video) await zoomVideo(page);
  await context.close();
} finally {
  writeFileSync(join(out, 'shots.json'), JSON.stringify({ dpr, shots, errors }, null, 2));
  await browser.close();
}
if (errors.length > 0) console.log(`console errors:\n${errors.join('\n')}`);

/**
 * The production page: the lobby's dive onto Waterloo, its plate unpinned, and the ruler's playhead
 * in 1810. The pointer then rests off the globe, so no mark is hovered.
 */
async function openExplore(page: Page): Promise<void> {
  const url = new URL('/', origin);
  url.search = new URLSearchParams({
    data: dataOrigin.origin,
    opening: OPENING,
    hooks: '1',
  }).toString();
  await page.goto(url.href);
  await page.locator('#room').waitFor({ state: 'hidden', timeout });
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => document.body.dataset.lobby === 'idle', null, { timeout });
  await page.locator('.lobby-plaque[data-choice="explore"]').click();
  await page.waitForFunction(() => document.body.dataset.lobby === 'gone', null, { timeout });
  await page.waitForFunction(
    (qid) => (window as ShotPage).__exploreLabels?.pinned() === qid,
    OPENING,
    { timeout },
  );
  await page.evaluate((day) => {
    const w = window as ShotPage;
    w.__exploreLabels!.pin(null);
    w.__worldTime!.seek(day);
  }, DAY);
  await page.mouse.move(1439, 1);
}

async function shoot(page: Page, name: string, { view, spots = [] }: View): Promise<Shot> {
  await page.evaluate((v) => (window as ShotPage).__wanderView!.go(v), view);
  await settle(page);
  const path = join(out, `${name}.png`);
  await page.screenshot({ path });
  const marks = await drawn(page);
  const shot: Shot = { view: name, path, viewKm: view.viewKm, marks, spots: [] };
  console.log(`${path}: ${marks.length} marks`);
  for (const spot of spots) {
    // The marks of events placed within a few kilometers of the spot.
    const near = marks.filter((m) => Math.hypot(m.at[0] - spot.at[0], m.at[1] - spot.at[1]) < 0.05);
    const hovers: string[] = [];
    if (values.hover) {
      for (const mark of near) {
        await page.mouse.move(mark.x, mark.y);
        await page.waitForFunction(
          (id) => (window as ShotPage).__exploreLabels?.hovered() === id,
          mark.id,
          { timeout: 10_000 },
        );
        // The plate comes once the pointer has rested (hoverQueue) and fades in.
        await page.waitForTimeout(700);
        const hovered = join(out, `${name}-hover-${mark.id.replace('/', '-')}.png`);
        await page.screenshot({ path: hovered });
        hovers.push(hovered);
        console.log(`${hovered}: ${mark.label}`);
      }
      await page.mouse.move(1439, 1);
      await page.waitForTimeout(500);
    }
    shot.spots.push({ name: spot.name, marks: near.map((m) => m.id), hovers });
  }
  return shot;
}

/** Waits for the tiles, the event worker and the marks' fades to rest. */
async function settle(page: Page): Promise<void> {
  await frames(page, 3);
  await page.waitForFunction(
    () => {
      const w = window as ShotPage;
      return w.__wanderView?.ready() === true && w.__exploreEvents?.settled() === true;
    },
    null,
    { timeout },
  );
  await page.waitForTimeout(300);
  await frames(page, 2);
}

async function frames(page: Page, count: number): Promise<void> {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise((done) => requestAnimationFrame(done));
  }, count);
}

/** The marks drawn in view, with their specs and their events' names. */
async function drawn(page: Page): Promise<DrawnMark[]> {
  const { placed, specs } = await page.evaluate(() => {
    const events = (window as ShotPage).__exploreEvents!;
    return { placed: events.placed(), specs: events.marks() };
  });
  const byId = new Map<string, MarkSpec>(specs.map((spec) => [spec.id, spec]));
  return placed.map((mark) => {
    const spec = byId.get(mark.id);
    const qid = Number(/^Q([0-9]+)/.exec(mark.id)?.[1]);
    return {
      ...mark,
      at: spec?.at ?? [NaN, NaN],
      glyph: spec?.glyph ?? '?',
      pace: spec?.pace ?? '?',
      focal: spec?.focal === true,
      hollow: spec?.hollow === true,
      label: names.get(qid) ?? mark.id,
    };
  });
}

/** Each event's name by Q number, from the data server's event files. */
async function eventNames(): Promise<Map<number, string>> {
  const release = (await (await fetch(new URL('/release.json', dataOrigin))).json()) as Release;
  if (!release.events) throw new Error(`${dataOrigin.origin} serves no event index`);
  const found = new Map<number, string>();
  for (const { key } of release.events.files) {
    const bytes = Buffer.from(await (await fetch(new URL(`/${key}`, dataOrigin))).arrayBuffer());
    const doc = JSON.parse(gunzipSync(bytes).toString('utf8')) as {
      qid: number[];
      label: string[];
    };
    doc.qid.forEach((qid, i) => found.set(qid, doc.label[i] ?? ''));
  }
  return found;
}

/**
 * The zoom as a video: each frame's view set at once and settled, then shot, from the world view to
 * 300 km over the Alps, the width falling geometrically and the tilt coming in over the last third.
 */
async function zoomVideo(page: Page): Promise<void> {
  const dir = join(out, 'zoom-frames');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { from, to, frames: count, fps } = ZOOM;
  const ease = (t: number) => t * t * (3 - 2 * t);
  for (let i = 0; i < count; i++) {
    const t = ease(i / (count - 1));
    const view: ViewState = {
      lon: from.lon + (to.lon - from.lon) * t,
      lat: from.lat + (to.lat - from.lat) * t,
      viewKm: from.viewKm * (to.viewKm / from.viewKm) ** t,
      tilt: to.tilt * ease(Math.max(0, (t - 0.66) / 0.34)),
      heading: 0,
    };
    await page.evaluate((v) => (window as ShotPage).__wanderView!.go(v), view);
    await settle(page);
    await page.screenshot({ path: join(dir, `${String(i).padStart(4, '0')}.png`) });
  }
  const video = join(out, 'zoom.mp4');
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    String(fps),
    '-i',
    join(dir, '%04d.png'),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '16',
    video,
  ]);
  console.log(`${video}: ${count} frames at ${fps} fps`);
}
