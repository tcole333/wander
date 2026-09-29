// Explore's renders on this Mac's GPU: Chromium on Metal at 1440x900, reading a local global data
// server. From app/, with the Vite dev server and `npm run data -- --profile global --port 8795`
// up:
//
//   node scripts/exploreShots.ts --demo --url http://127.0.0.1:5173 --out ../build/explore/r1
//     [--data http://127.0.0.1:8795] [--e1b <E1b.png>] [--scene <name>] [--no-gpu]
//
// --demo: the dev page's ?markDemo (the lobby's glows as marks in the four test glyphs), every
// mark variant at world view, 3,000 km over Europe, 3,000 km over the demo's specimen tray in the
// Sahara and 300 km tilted over the Alps, each with one focal mark; a contact sheet per variant and one of all variants side by side, beside E1b's cast
// token (--e1b, by default docs/design/concepts/2026-09-28-material-trials/e1-fleet/E1b.png); and
// the GPU time of 140, 256 and 512 marks at world view over the marks turned off, in explore.json
// with any console errors. The time is the scene drawn into a target of the canvas's size, 400
// samples of three draws each with the marks on and as many off, in turn (markDemo.ts, gpuAB):
// the fastest twentieth of each, where other work sharing the GPU has added least, and the median.
// --scene renders one scene only, and --no-gpu skips the timing.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser, type Page } from '@playwright/test';
import { MARK_VARIANTS } from '../src/marks/families.ts';
import type { MarkSpec, PlacedMark } from '../src/marks/marks.ts';
import type { MarkDemoApi } from '../src/prototype/app/markDemo.ts';
import type { LonLat } from '../src/story/story.ts';
import type { ViewState } from '../src/view/viewState.ts';

interface ShotPage extends Window {
  __proto?: { ready(): boolean; view(view: ViewState, instant?: boolean): void; error?: string };
  __markDemo?: MarkDemoApi;
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
    timeout: { type: 'string', default: '120' },
    e1b: { type: 'string', default: E1B_DEFAULT },
    scene: { type: 'string' },
    'no-gpu': { type: 'boolean', default: false },
  },
});
const scenes = SCENES.filter((scene) => !values.scene || scene.name === values.scene);
if (scenes.length === 0) throw new Error(`no scene '${values.scene}'`);
if (!values.out) throw new Error('--out <dir> is required');
if (!values.demo) throw new Error('only --demo renders so far: pass --demo');
const origin = new URL(values.url);
if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
  throw new Error('--url must be a local Vite server');
}
const dataOrigin = new URL(values.data);
if (!['localhost', '127.0.0.1', '[::1]'].includes(dataOrigin.hostname)) {
  throw new Error('--data must be a local data server');
}
const timeout = Number(values.timeout) * 1000;
const out = resolve(values.out);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const errors: string[] = [];
const report: Record<string, unknown> = { data: dataOrigin.origin };
try {
  const page = await open(browser);
  const shots = await demoShots(page);
  report.shots = shots;
  if (!values['no-gpu']) report.gpu = await gpuTimes(page);
  await sheets(browser, shots);
  assert.deepEqual(errors, [], 'browser console');
  console.log(`${shots.length} renders and their sheets in ${out}`);
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
  const e1b = existsSync(values.e1b) ? png(values.e1b) : null;
  const zoom = (src: string, x: number, y: number, w: number, h: number, k = 2) =>
    `<div class="crop" style="width:${w * k}px;height:${h * k}px">
      <img src="${src}" style="transform:scale(${k}) translate(${-x}px,${-y}px)"></div>`;
  const e1bCell = e1b
    ? `<figure>${zoom(e1b, E1B_CROP.x, E1B_CROP.y, E1B_CROP.w, E1B_CROP.h)}
      <figcaption>E1b cast token, 2×</figcaption></figure>`
    : '';
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
