// The state names' renders (#80, owner decision 44) on this Mac's GPU: Chromium on Metal, the dev
// page at 1440x900 and a device pixel ratio of 2 (the page draws at 1.5), at the five views the
// names were chosen on: Explore over Europe in 1810, Tambora's sixth beat, the world in 1914, the
// Mediterranean in 100 and East Asia in 1200. Each view is shot without names, with them, and with
// their floor drawn flat magenta (namesMask) the next frame, from which each name's contrast is
// measured: the median luminance of its strokes, a pixel in from their edges, over the median of
// the ground 4 to 8 device px about them (the legibility test's measure), and the WCAG ratio of the
// two. A walk is broken out once it lands, so its camera stops its slow push in, and its names are
// measured again with its callouts off, where one took a name's place (Villa Diodati's France).
// With --gpu, it then times the names at each view on the GPU at 2160x1350 (1440x900 at the page's
// 1.5): over
// interleaved windows with the names off and on, the GPU time ioreg gives the browser's GPU
// process (AGXDeviceUserClient's accumulatedGPUTime, no sudo), over the frames drawn, after giving
// every process's share of the GPU, so other work shows. Plain Node, from app/ with the Vite dev
// server and a global data server up:
//
//   node scripts/namesShots.ts --url http://127.0.0.1:5173 --data http://127.0.0.1:8793
//     [--out ../build/names/renders] [--only europe-1810,...] [--query '&marks=0']
//     [--gpu] [--windows 8]
//
// --query adds dev page params to every page's query, as for renders without the marks.
// Writes <out>/<view>-{off,on,on-mask}.png (and -nocallouts for a walk) and <out>/shots.json: each
// view's camera, the names drawn with their boxes and contrast, any console problems, and the GPU
// timing.
import { chromium, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { StepShown } from '../src/borders/clockBorders.ts';
import type { Params } from '../src/contract.ts';
import type { NameShown, NamesShown } from '../src/look/stateNames.ts';
import { dayFromHistorical } from '../src/story/dates.ts';
import type { ViewState } from '../src/view/viewState.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5173' },
    data: { type: 'string', default: 'http://127.0.0.1:8793' },
    out: { type: 'string', default: '../build/names/renders' },
    only: { type: 'string' },
    query: { type: 'string', default: '' },
    gpu: { type: 'boolean', default: false },
    windows: { type: 'string', default: '8' },
    window: { type: 'string', default: '2000' },
    timeout: { type: 'string', default: '180' },
  },
});
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const timeout = Number(values.timeout) * 1000;

interface View {
  name: string;
  year: number;
  explore?: { lon: number; lat: number; km: number };
  /** A Tambora beat, from 0. */
  beat?: number;
}

const VIEWS: View[] = [
  { name: 'europe-1810', year: 1810, explore: { lon: 13, lat: 49, km: 3000 } },
  { name: 'tambora-beat6', year: 1816, beat: 5 },
  { name: 'world-1914', year: 1914, explore: { lon: 45, lat: 30, km: 1e9 } },
  { name: 'mediterranean-100', year: 100, explore: { lon: 18, lat: 38, km: 5000 } },
  { name: 'eastasia-1200', year: 1200, explore: { lon: 112, lat: 35, km: 5000 } },
];
const only = values.only ? new Set(values.only.split(',')) : null;
const views = VIEWS.filter((view) => !only || only.has(view.name));

/** The page's own chrome, hidden in the renders. */
const HIDE =
  '.wu, .wu *, #hud, .lil-gui, #presets, #note, .plate, .card { visibility: hidden !important; }';
const DPR = 2;

/** The dev page's hooks the script reads (prototype/app/main.ts, explore/exploreBorders.ts). */
interface NamesWindow {
  __proto?: {
    ready(): boolean;
    error?: string;
    stats(): { view: ViewState };
    view(view: ViewState, instant?: boolean): void;
  };
  __worldTime?: { seek(day: number): void };
  __borders?: { show(on: boolean): void; shown(): StepShown | null };
  __walk?: { goTo(beat: number): void; landed(): boolean; breakOut(): void; effects(): Params };
  __names?: { shown(): NamesShown; params: Params };
}

interface Contrast {
  text: string;
  emPx: number;
  strokes: number;
  ground: number;
  ratio: number;
  wcag: number;
}

const report: Record<string, unknown>[] = [];
const browser = await chromium.launch({ args: ['--use-angle=metal'] });

async function open(query: string, scale: number): Promise<{ page: Page; problems: string[] }> {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: scale,
  });
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  await page.goto(`${values.url}/prototype.html?data=${values.data}&ui=0${query}${values.query}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as NamesWindow;
      if (w.__proto?.error) throw new Error(w.__proto.error);
      return w.__proto !== undefined && w.__names !== undefined;
    },
    null,
    { timeout },
  );
  await page.addStyleTag({ content: HIDE });
  return { page, problems };
}

/** Goes to the view, with the step and its names drawn and the streamer idle. */
async function settle(page: Page, view: View): Promise<void> {
  if (view.explore) {
    const { lon, lat, km } = view.explore;
    await page.evaluate(
      ([lon, lat, km]) =>
        (window as unknown as NamesWindow).__proto!.view(
          { lon, lat, viewKm: km, tilt: 0, heading: 0 },
          true,
        ),
      [lon, lat, km] as const,
    );
    const day = dayFromHistorical({ year: view.year, month: 7, day: 1 });
    await page.evaluate((d) => {
      const w = window as unknown as NamesWindow;
      w.__worldTime!.seek(d);
      w.__borders!.show(true);
    }, day);
    await page.waitForTimeout(500);
    await page.waitForFunction(
      () => {
        const w = window as unknown as NamesWindow;
        const shown = w.__borders!.shown();
        return shown !== null && !shown.preview && shown.strength > 0.999 && w.__proto!.ready();
      },
      null,
      { timeout, polling: 250 },
    );
  } else {
    await page.evaluate((b) => (window as unknown as NamesWindow).__walk!.goTo(b), view.beat!);
    await page.waitForTimeout(1000);
    await page.waitForFunction(() => (window as unknown as NamesWindow).__walk!.landed(), null, {
      timeout,
      polling: 250,
    });
    // Broken out, the camera stops its slow push in, so the renders and the mask line up.
    await page.evaluate(() => (window as unknown as NamesWindow).__walk!.breakOut());
  }
  await page.waitForFunction(
    () => (window as unknown as NamesWindow).__names!.shown().drawn.length > 0,
    null,
    { timeout, polling: 250 },
  );
  // The names' fades, and a frame or two after.
  await page.waitForTimeout(1500);
}

async function setNames(page: Page, params: Params): Promise<void> {
  await page.evaluate(
    (p) => Object.assign((window as unknown as NamesWindow).__names!.params, p),
    params,
  );
  await page.waitForTimeout(600);
}

/** Two frames: a param set now is drawn by then. */
async function frames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/** The render with the names, the mask a frame later, and what was drawn. */
async function shootNames(
  page: Page,
  name: string,
): Promise<{ on: Buffer; mask: Buffer; shown: NamesShown }> {
  const on = await page.screenshot({ path: join(out, `${name}.png`) });
  await page.evaluate(() => ((window as unknown as NamesWindow).__names!.params.namesMask = true));
  await frames(page);
  const mask = await page.screenshot({ path: join(out, `${name}-mask.png`) });
  await page.evaluate(() => ((window as unknown as NamesWindow).__names!.params.namesMask = false));
  await frames(page);
  const shown = await page.evaluate(() => (window as unknown as NamesWindow).__names!.shown());
  return { on, mask, shown };
}

/** Each drawn name's contrast, from the render and the mask render, measured in the page. */
async function contrast(
  page: Page,
  shot: Buffer,
  mask: Buffer,
  drawn: readonly NameShown[],
): Promise<Contrast[]> {
  return page.evaluate(
    async ({ shot, mask, drawn, dpr }) => {
      const pixels = async (base64: string) => {
        const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [image, masked] = [await pixels(shot), await pixels(mask)];
      const { width: w, height: h } = image;
      const linear = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const rgb = (data: Uint8ClampedArray, i: number): [number, number, number] => [
        data[4 * i] ?? 0,
        data[4 * i + 1] ?? 0,
        data[4 * i + 2] ?? 0,
      ];
      const lum = new Float32Array(w * h);
      const letters = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const [r, g, b] = rgb(image.data, i);
        lum[i] = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
        const [mr, mg, mb] = rgb(masked.data, i);
        letters[i] = mr - mg > 70 && mb - mg > 70 ? 1 : 0;
      }
      // Manhattan distance to the letters, two passes: the band is 4 < d <= 8, as the test's
      // dilations by 4 and 8 crosses made it; the strokes, letters whose four neighbours are too.
      const d = new Float32Array(w * h).map((_, i) => (letters[i] ? 0 : 1e9));
      const near = (i: number, j: number) => (d[i] = Math.min(d[i] ?? 0, (d[j] ?? 0) + 1));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (x > 0) near(y * w + x, y * w + x - 1);
          if (y > 0) near(y * w + x, (y - 1) * w + x);
        }
      }
      for (let y = h - 1; y >= 0; y--) {
        for (let x = w - 1; x >= 0; x--) {
          if (x < w - 1) near(y * w + x, y * w + x + 1);
          if (y < h - 1) near(y * w + x, (y + 1) * w + x);
        }
      }
      const median = (list: number[]) => {
        list.sort((a, b) => a - b);
        return list[Math.floor(list.length / 2)] ?? 0;
      };
      const found: Contrast[] = [];
      for (const name of drawn) {
        const [x0, y0, x1, y1] = name.box.map((v) => Math.round(v * dpr)) as [
          number,
          number,
          number,
          number,
        ];
        const strokes: number[] = [];
        const ground: number[] = [];
        for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++) {
          for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
            const i = y * w + x;
            const core =
              letters[i] && letters[i - 1] && letters[i + 1] && letters[i - w] && letters[i + w];
            const di = d[i] ?? 0;
            if (core) strokes.push(lum[i] ?? 0);
            else if (di > 4 && di <= 8) ground.push(lum[i] ?? 0);
          }
        }
        if (strokes.length < 30 || ground.length < 30) continue;
        const [ls, lg] = [median(strokes), median(ground)];
        found.push({
          text: name.text,
          emPx: Math.round(name.emPx * 10) / 10,
          strokes: Math.round(ls * 1e4) / 1e4,
          ground: Math.round(lg * 1e4) / 1e4,
          ratio: Math.round((ls / Math.max(lg, 1e-4)) * 100) / 100,
          wcag: Math.round(((Math.max(ls, lg) + 0.05) / (Math.min(ls, lg) + 0.05)) * 100) / 100,
        });
      }
      return found;
    },
    { shot: shot.toString('base64'), mask: mask.toString('base64'), drawn, dpr: DPR },
  );
}

/** Each process's share of the GPU over `seconds`, from ioreg. */
function gpuShares(seconds: number): string[] {
  const before = gpuTimes();
  execFileSync('sleep', [String(seconds)]);
  const after = gpuTimes();
  return [...after.entries()]
    .map(([who, ns]) => [who, (ns - (before.get(who) ?? 0)) / (seconds * 1e9)] as const)
    .filter(([, share]) => share > 0.005)
    .sort((a, b) => b[1] - a[1])
    .map(([who, share]) => `${(share * 100).toFixed(1)}% ${who}`);
}

/** Every GPU client's accumulated GPU time, ns, by its creator ("pid N, name"). */
function gpuTimes(): Map<string, number> {
  const xml = execFileSync('ioreg', ['-r', '-c', 'AGXDeviceUserClient', '-a']).toString();
  const times = new Map<string, number>();
  // Each client's dict lists its AppUsage before its creator.
  for (const client of xml.split(/<dict>\s*<key>AppUsage<\/key>/).slice(1)) {
    const who = /<key>IOUserClientCreator<\/key>\s*<string>([^<]*)<\/string>/.exec(client)?.[1];
    if (!who) continue;
    let ns = 0;
    for (const match of client.matchAll(
      /<key>accumulatedGPUTime<\/key>\s*<integer>(\d+)<\/integer>/g,
    )) {
      ns += Number(match[1]);
    }
    times.set(who, (times.get(who) ?? 0) + ns);
  }
  return times;
}

/** The pid of the GPU process of the browser this script launched. */
function gpuProcess(): string {
  const ps = execFileSync('ps', ['-axo', 'pid=,ppid=,command=']).toString().split('\n');
  const rows = ps.map((line) => line.trim().split(/\s+/)).filter((r) => r.length > 2);
  const mine = new Set(
    rows.filter((r) => r.join(' ').includes('playwright_chromium')).map((r) => r[0]),
  );
  const gpu = rows.find((r) => r.join(' ').includes('--type=gpu-process') && mine.has(r[1]));
  if (!gpu?.[0]) throw new Error("no GPU process of this script's browser");
  return gpu[0];
}

/** GPU ms a frame with the names off and on, over interleaved windows. */
async function timeNames(page: Page): Promise<{ off: number; on: number; runs: unknown }> {
  const pid = gpuProcess();
  const ownTime = () =>
    [...gpuTimes().entries()]
      .filter(([who]) => who.startsWith(`pid ${pid},`))
      .reduce((sum, [, ns]) => sum + ns, 0);
  const count = () =>
    page.evaluate(
      (ms) =>
        new Promise<number>((done) => {
          let drawn = 0;
          const end = performance.now() + ms;
          const tick = () => {
            drawn += 1;
            if (performance.now() < end) requestAnimationFrame(tick);
            else done(drawn);
          };
          requestAnimationFrame(tick);
        }),
      Number(values.window),
    );
  const runs: Record<'off' | 'on', number[]> = { off: [], on: [] };
  for (let round = 0; round < Number(values.windows); round++) {
    for (const state of round % 2 === 0 ? (['off', 'on'] as const) : (['on', 'off'] as const)) {
      await setNames(page, { names: state === 'on' });
      const before = ownTime();
      const drawn = await count();
      runs[state].push((ownTime() - before) / 1e6 / drawn);
    }
  }
  const median = (list: number[]) =>
    [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? NaN;
  return { off: median(runs.off), on: median(runs.on), runs };
}

try {
  for (const view of views) {
    const walk = view.beat !== undefined;
    const { page, problems } = await open(walk ? '&story=tambora' : '', DPR);
    await page.waitForFunction(
      (walk) => {
        const w = window as unknown as NamesWindow;
        return walk ? w.__walk !== undefined : w.__borders !== undefined;
      },
      walk,
      { timeout },
    );
    await settle(page, view);
    await setNames(page, { names: false, namesMask: false });
    await page.screenshot({ path: join(out, `${view.name}-off.png`) });
    // The names fade in over nameFade once on.
    await setNames(page, { names: true, namesMask: false });
    await page.waitForTimeout(900);
    const shot = await shootNames(page, `${view.name}-on`);
    const measured = await contrast(page, shot.on, shot.mask, shot.shown.drawn);
    // A walk's callouts take their places from the names, which give way to them: measured again
    // without them, so every name the beat holds is measured.
    let nocallouts: { shown: NamesShown; contrast: Contrast[] } | null = null;
    if (walk) {
      await page.evaluate(() => ((window as unknown as NamesWindow).__walk!.effects().labels = 0));
      await page.waitForTimeout(1200);
      const bare = await shootNames(page, `${view.name}-nocallouts`);
      nocallouts = {
        shown: bare.shown,
        contrast: await contrast(page, bare.on, bare.mask, bare.shown.drawn),
      };
      await page.evaluate(() => ((window as unknown as NamesWindow).__walk!.effects().labels = 1));
    }
    const camera = await page.evaluate(
      () => (window as unknown as NamesWindow).__proto!.stats().view,
    );
    report.push({
      view: view.name,
      camera,
      shown: shot.shown,
      contrast: measured,
      nocallouts,
      problems: [...problems],
    });
    console.log(`${view.name}: ${shot.shown.drawn.length} names of ${shot.shown.candidates}`);
    for (const row of measured) {
      console.log(`  ${row.text}: ${row.ratio} (WCAG ${row.wcag}), em ${row.emPx} px`);
    }
    for (const row of nocallouts?.contrast ?? []) {
      if (measured.some((m) => m.text === row.text)) continue;
      console.log(`  ${row.text}, without the callouts: ${row.ratio} (WCAG ${row.wcag})`);
    }
    await page.close();
  }
  for (const view of values.gpu ? views : []) {
    const walk = view.beat !== undefined;
    const { page, problems } = await open(walk ? '&story=tambora' : '', 1.5);
    await page.waitForFunction(
      (walk) => {
        const w = window as unknown as NamesWindow;
        return walk ? w.__walk !== undefined : w.__borders !== undefined;
      },
      walk,
      { timeout },
    );
    await settle(page, view);
    const names = await page.evaluate(
      () => (window as unknown as NamesWindow).__names!.shown().drawn.length,
    );
    const shares = gpuShares(3);
    console.log('GPU share before timing:', shares.join('; '));
    const gpu = await timeNames(page);
    console.log(`${view.name} at 2160x1350, ${names} names: GPU ms a frame`, JSON.stringify(gpu));
    report.push({ view: view.name, size: '2160x1350', names, gpuShares: shares, gpu, problems });
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(join(out, 'shots.json'), JSON.stringify(report, null, 2));
}
