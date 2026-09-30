// The borders through time in motion (#80) on this Mac's GPU: Chromium on Metal at 1440x900, the
// dev page in Explore (prototype.html), whose borders follow the world clock
// (explore/exploreBorders.ts), measuring the borders' budgets as it goes (streaming.md 3.3). Plain
// Node, run from app/ with the Vite dev server and a global data server up, and ffmpeg installed:
//
//   node scripts/bordersVideos.ts --url http://127.0.0.1:5173 --data http://127.0.0.1:8793
//     [--out ../build/borders/videos] [--only world,europe,gpu,walk]
//
// The videos scrub the clock from one step's first day to the next's at a steady number of steps a
// second, faster than borderRest, so the previews draw while it moves, and rest a few seconds in
// chosen years, where each step streams in under its plate:
// - world: 3400 BCE to 2000 at world view over the Old World, eight steps a second, resting in
//   1000, 1500, 1800 and 1914, the ruler showing all of history;
// - europe: 1900 to 1950 over Europe, 4,000 km across, five steps a second, resting in 1914, 1919,
//   1939 and 1945, the ruler showing a century.
// Each is the page's screencast (JPEG frames at their own times) encoded by ffmpeg into
// <out>/<name>.mp4. While it records, the page logs its frames, the step drawn each frame and
// whether from a slot or a preview, every long task (over 50 ms), and the borders' CPU bytes
// (borders.*, from ?memory=1's account) every 250 ms: the most at any point and the most once the
// last rest has settled.
// - gpu: the GPU time a scene draw adds with the borders at rest and mid-dissolve, two slots and
//   two previews, over the borders off (prototype/app/bordersTiming.ts), at world view and at
//   4,000 and 2,500 km over Europe, and the border array's size on the GPU.
// - walk: the Tambora walk on the dev page, drawing border steps (?explore) and milestone 1's 1815
//   field (without), sampling borders.* every 50 ms from the first beat through the sixth, the
//   most while a border beat's step loads, each account's total once the sixth has settled, and
//   the GPU time its borders add there.
// Writes <out>/videos.json with every measurement and any console problems.
import { chromium, type Browser, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { StepShown } from '../src/borders/clockBorders.ts';
import type { Release } from '../src/data/release.ts';
import { dayFromHistorical } from '../src/story/dates.ts';
import type { ViewState } from '../src/view/viewState.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5173' },
    data: { type: 'string', default: 'http://127.0.0.1:8793' },
    out: { type: 'string', default: '../build/borders/videos' },
    only: { type: 'string' },
    timeout: { type: 'string', default: '180' },
  },
});
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const timeout = Number(values.timeout) * 1000;
const only = values.only ? new Set(values.only.split(',')) : null;
const wanted = (name: string) => !only || only.has(name);

const VIEWPORT = { width: 1440, height: 900 };
const WIDEST_KM = 1e9;
const MiB = 1024 * 1024;

interface VideoPlan {
  name: string;
  title: string;
  view: ViewState;
  /** The ruler's visible span, in years; all of history when absent. */
  rulerYears?: number;
  from: number;
  to: number;
  stepsPerSecond: number;
  /** Years whose step the clock rests in, and for how long. */
  rests: number[];
  restMs: number;
}

const PLANS: VideoPlan[] = [
  {
    name: 'world',
    title: '3400 BCE to 2000 at world view',
    view: { lon: 40, lat: 25, viewKm: WIDEST_KM, tilt: 0, heading: 0 },
    from: -3399,
    to: 2000,
    stepsPerSecond: 8,
    rests: [1000, 1500, 1800, 1914],
    restMs: 2500,
  },
  {
    name: 'europe',
    title: '1900 to 1950 over Europe, 4,000 km across',
    view: { lon: 18, lat: 49, viewKm: 4000, tilt: 0, heading: 0 },
    rulerYears: 100,
    from: 1900,
    to: 1950,
    stepsPerSecond: 5,
    rests: [1914, 1919, 1939, 1945],
    restMs: 2500,
  },
];

interface Keyframe {
  t: number;
  day: number;
}

/** GPU ms of a scene draw in each of bordersTiming.ts's passes: its fastest twentieth, median. */
type GpuPasses = Record<string, { p05: number; p50: number; samples: number }>;

/** Each pass's cost over the borders off, from the fastest twentieth of each. */
function added(times: GpuPasses | null): Record<string, number> | null {
  const off = times?.off?.p05;
  if (!times || off === undefined) return null;
  return Object.fromEntries(
    Object.entries(times)
      .filter(([name]) => name !== 'off')
      .map(([name, { p05 }]) => [name, Math.round(1000 * (p05 - off)) / 1000]),
  );
}

/** The page's hooks this script reads. */
interface PageWindow {
  __proto?: {
    ready(): boolean;
    error?: string;
    view(view: ViewState, instant?: boolean): void;
  };
  __worldTime?: { seek(day: number): void; zoom(factor: number, share: number): void };
  __borders?: { show(on: boolean): void; shown(): StepShown | null };
  __bordersTiming?: {
    array(): { bytes: number; layers: number; holds: string };
    gpu(samples: number): Promise<GpuPasses | null>;
  };
  __walk?: { goTo(beat: number): void; landed(): boolean; state(): { beat: number } };
  __wanderMemory?: () => { owners: Record<string, Record<string, number>> };
  __longTasks?: { start: number; ms: number }[];
}

const releaseUrl = `${new URL(values.data).origin}/release.json`;
const release = (await (await fetch(releaseUrl)).json()) as Release;
if (!release.borderSteps) throw new Error(`${releaseUrl} has no borderSteps section`);
const stepYears = release.borderSteps.years;
const firstDay = (year: number) => dayFromHistorical({ year, month: 1, day: 1 });
/** The step that holds on `day`, as borders/steps.ts's stepAt finds it. */
const stepOn = (day: number) => stepYears.findLastIndex((year) => firstDay(year) <= day);

/**
 * The clock's path: from `from`'s first day through each step's first day to `to`'s, a step every
 * 1/stepsPerSecond seconds, resting on the first day of the step holding each rest year.
 */
function keyframes(plan: VideoPlan): Keyframe[] {
  const start = firstDay(plan.from);
  const end = firstDay(plan.to);
  const days = [start, ...stepYears.map(firstDay).filter((day) => day > start && day < end), end];
  const restAt = new Set(plan.rests.map((year) => firstDay(stepYears[stepOn(firstDay(year))]!)));
  const perStep = 1000 / plan.stepsPerSecond;
  const frames: Keyframe[] = [{ t: 0, day: start }];
  let t = 0;
  for (let i = 1; i < days.length; i += 1) {
    t += perStep;
    frames.push({ t, day: days[i]! });
    if (restAt.has(days[i]!) || i === days.length - 1) {
      t += plan.restMs;
      frames.push({ t, day: days[i]! });
    }
  }
  return frames;
}

const problems: string[] = [];
const report: Record<string, unknown> = {
  when: new Date().toISOString(),
  release: release.id,
  data: values.data,
  steps: stepYears.length,
};

/** Every long task, from the page's first moment. */
const LONG_TASKS = () => {
  const w = window as unknown as PageWindow;
  w.__longTasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      w.__longTasks?.push({ start: entry.startTime, ms: entry.duration });
    }
  }).observe({ type: 'longtask', buffered: true });
};

async function openExplore(browser: Browser): Promise<Page> {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  watch(page, 'explore');
  await page.addInitScript(LONG_TASKS);
  const query = new URLSearchParams({ data: values.data, ui: '0', memory: '1' });
  await page.goto(`${values.url}/prototype.html?${query}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as PageWindow;
      if (w.__proto?.error) throw new Error(w.__proto.error);
      return !!(w.__borders && w.__worldTime && w.__wanderMemory && w.__bordersTiming);
    },
    null,
    { timeout },
  );
  return page;
}

function watch(page: Page, where: string): void {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      problems.push(`${where} ${m.type()}: ${m.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`${where} pageerror: ${error.message}`));
}

/** Waits until the step holding `day` draws from its slot at full strength and the page is idle. */
async function settle(page: Page, day: number): Promise<void> {
  const year = stepYears[stepOn(day)];
  await page.waitForFunction(
    (drawn) => {
      const w = window as unknown as PageWindow;
      const shown = w.__borders?.shown();
      if (!shown || shown.year !== drawn || shown.preview) return false;
      return shown.strength > 0.999 && w.__proto?.ready() === true;
    },
    year,
    { timeout, polling: 100 },
  );
}

async function video(browser: Browser, plan: VideoPlan): Promise<void> {
  const page = await openExplore(browser);
  const frames = keyframes(plan);
  const first = frames[0]!.day;
  await page.evaluate(
    ([view, years, day]) => {
      const w = window as unknown as PageWindow;
      w.__proto!.view(view, true);
      // Explore opens on 200 years; a factor past all of history shows it all.
      w.__worldTime!.zoom(years === null ? 1e6 : years / 200, 0.5);
      w.__worldTime!.seek(day);
    },
    [plan.view, plan.rulerYears ?? null, first] as const,
  );
  await settle(page, first);
  await page.waitForTimeout(1000);

  const dir = join(out, `${plan.name}-frames`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const shots: { file: string; t: number }[] = [];
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = `f${String(shots.length).padStart(6, '0')}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(data, 'base64'));
    shots.push({ file, t: metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 });
  await page.waitForTimeout(1000);

  const log = await page.evaluate(async (keys) => {
    const w = window as unknown as PageWindow;
    const drawn: { t: number; day: number; year: number | null; preview: boolean }[] = [];
    const memory: { t: number; bytes: number }[] = [];
    const bordersBytes = () => {
      const owners = w.__wanderMemory!().owners;
      let bytes = 0;
      for (const [owner, kinds] of Object.entries(owners)) {
        if (!owner.startsWith('borders.')) continue;
        for (const value of Object.values(kinds)) bytes += value;
      }
      return bytes;
    };
    const start = performance.now();
    let key = 0;
    let sampled = -Infinity;
    const end = keys[keys.length - 1]!.t;
    await new Promise<void>((done) => {
      const frame = (now: number) => {
        const t = now - start;
        while (key < keys.length - 2 && keys[key + 1]!.t <= t) key += 1;
        const a = keys[key]!;
        const b = keys[key + 1] ?? a;
        const share = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
        const day = a.day + share * (b.day - a.day);
        w.__worldTime!.seek(day);
        const shown = w.__borders!.shown();
        drawn.push({ t, day, year: shown?.year ?? null, preview: shown?.preview ?? false });
        if (t - sampled >= 250) {
          sampled = t;
          memory.push({ t, bytes: bordersBytes() });
        }
        if (t >= end) done();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const tasks = (w.__longTasks ?? []).filter((task) => task.start >= start);
    return { start, drawn, memory, tasks, settled: bordersBytes() };
  }, frames);
  await cdp.send('Page.stopScreencast');
  await page.close();

  // A constant 30 fps from the frames' own times.
  const list = shots.map((shot, i) => {
    const next = shots[i + 1];
    const seconds = next ? Math.max(0.001, next.t - shot.t) : 1 / 30;
    return `file '${shot.file}'\nduration ${seconds.toFixed(4)}`;
  });
  writeFileSync(join(dir, 'frames.txt'), `${list.join('\n')}\nfile '${shots.at(-1)?.file}'\n`);
  const mp4 = join(out, `${plan.name}.mp4`);
  const encoded = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      join(dir, 'frames.txt'),
      '-fps_mode',
      'cfr',
      '-r',
      '30',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '18',
      mp4,
    ],
    { encoding: 'utf8' },
  );
  if (encoded.status !== 0) throw new Error(`ffmpeg: ${encoded.stderr}`);
  rmSync(dir, { recursive: true, force: true });

  const gaps = log.drawn.slice(1).map((f, i) => f.t - log.drawn[i]!.t);
  const sorted = [...gaps].sort((a, b) => a - b);
  const count = (test: (f: (typeof log.drawn)[number]) => boolean) =>
    log.drawn.filter(test).length / log.drawn.length;
  report[plan.name] = {
    title: plan.title,
    video: mp4,
    screencastFrames: shots.length,
    seconds: frames.at(-1)!.t / 1000,
    frames: log.drawn.length,
    frameMs: {
      p50: sorted[Math.floor(0.5 * (sorted.length - 1))],
      p95: sorted[Math.floor(0.95 * (sorted.length - 1))],
      max: sorted.at(-1),
    },
    drawn: {
      slot: count((f) => f.year !== null && !f.preview),
      preview: count((f) => f.preview),
      none: count((f) => f.year === null),
      years: [...new Set(log.drawn.map((f) => f.year))].length,
    },
    longTasks: log.tasks,
    bordersCpuMiB: {
      most: Math.max(...log.memory.map((m) => m.bytes)) / MiB,
      settled: log.settled / MiB,
    },
  };
  console.log(plan.name, JSON.stringify(report[plan.name]));
}

async function gpu(browser: Browser): Promise<void> {
  const page = await openExplore(browser);
  const day = firstDay(1815) + 180;
  const views: Record<string, ViewState> = {
    world: { lon: 40, lat: 25, viewKm: WIDEST_KM, tilt: 0, heading: 0 },
    'europe-4000': PLANS[1]!.view,
    'europe-2500': { lon: 12, lat: 48, viewKm: 2500, tilt: 0, heading: 0 },
  };
  const times: Record<string, unknown> = {};
  for (const [name, view] of Object.entries(views)) {
    await page.evaluate(
      ([v, d]) => {
        const w = window as unknown as PageWindow;
        w.__proto!.view(v, true);
        w.__worldTime!.seek(d);
      },
      [view, day] as const,
    );
    await settle(page, day);
    await page.waitForTimeout(1500);
    const passes = await page.evaluate(() =>
      (window as unknown as PageWindow).__bordersTiming!.gpu(300),
    );
    times[name] = { addedMs: added(passes), passes };
    console.log('gpu', name, JSON.stringify(times[name]));
  }
  const array = await page.evaluate(() =>
    (window as unknown as PageWindow).__bordersTiming!.array(),
  );
  report.gpu = { array: { ...array, MiB: array.bytes / MiB }, times };
  await page.close();
}

/** The Tambora walk from its first beat through its sixth, sampling borders.* every 50 ms. */
async function walk(browser: Browser, steps: boolean): Promise<unknown> {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const where = steps ? 'walk (steps)' : 'walk (1815 field)';
  watch(page, where);
  const query = new URLSearchParams({ story: 'tambora', data: values.data, ui: '0', memory: '1' });
  if (steps) query.set('explore', '');
  await page.goto(`${values.url}/prototype.html?${query}`);
  await page.waitForFunction(
    () => {
      const w = window as unknown as PageWindow;
      if (w.__proto?.error) throw new Error(w.__proto.error);
      return !!(w.__walk && w.__wanderMemory && w.__bordersTiming);
    },
    null,
    { timeout },
  );
  const sample = () =>
    page.evaluate(() => {
      const owners = (window as unknown as PageWindow).__wanderMemory!().owners;
      let borders = 0;
      let total = 0;
      for (const [owner, kinds] of Object.entries(owners)) {
        for (const value of Object.values(kinds)) {
          total += value;
          if (owner.startsWith('borders.')) borders += value;
        }
      }
      return { borders, total };
    });
  let most = 0;
  const until = async (done: () => Promise<boolean>) => {
    const started = Date.now();
    while (!(await done())) {
      most = Math.max(most, (await sample()).borders);
      if (Date.now() - started > timeout) throw new Error(`${where}: timed out`);
      await page.waitForTimeout(50);
    }
  };
  const landedOn = (beat: number) =>
    page.evaluate((b) => {
      const w = (window as unknown as PageWindow).__walk!;
      return w.state().beat === b && w.landed();
    }, beat);
  const hold = async (ms: number) => {
    const from = Date.now();
    await until(() => Promise.resolve(Date.now() - from > ms));
  };
  // The first beat lists borders: its step loads once the clock rests.
  await until(() => landedOn(0));
  await hold(4000);
  const first = await sample();
  await page.evaluate(() => (window as unknown as PageWindow).__walk!.goTo(5));
  await until(() => landedOn(5));
  await hold(4000);
  const settled = await sample();
  const passes = await page.evaluate(() =>
    (window as unknown as PageWindow).__bordersTiming!.gpu(300),
  );
  const array = await page.evaluate(() =>
    (window as unknown as PageWindow).__bordersTiming!.array(),
  );
  await page.close();
  return {
    bordersMostMiB: most / MiB,
    firstBeatSettled: { bordersMiB: first.borders / MiB, totalMiB: first.total / MiB },
    sixthBeatSettled: { bordersMiB: settled.borders / MiB, totalMiB: settled.total / MiB },
    sixthBeatGpu: { addedMs: added(passes), passes },
    array: { ...array, MiB: array.bytes / MiB },
  };
}

const browser = await chromium.launch({ args: ['--use-angle=metal'] });
try {
  for (const plan of PLANS) if (wanted(plan.name)) await video(browser, plan);
  if (wanted('gpu')) await gpu(browser);
  if (wanted('walk')) {
    report.walk = { steps: await walk(browser, true), field1815: await walk(browser, false) };
    console.log('walk', JSON.stringify(report.walk));
  }
} finally {
  await browser.close();
  report.problems = problems;
  writeFileSync(join(out, 'videos.json'), JSON.stringify(report, null, 2));
}
