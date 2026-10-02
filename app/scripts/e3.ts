// E3, milestone 1's acceptance (streaming.md 8.2), against the live site: headless Chromium on this
// Mac's GPU (Metal) at 1440x900, network conditions set through CDP. It checks:
//
//  1. cold loads with the cache disabled, --runs times at 25 Mbps / 50 ms and at 5 Mbps / 150 ms:
//     the time from navigation start to the room opening (#room takes is-open), and the bytes that
//     arrived before it;
//  2. at 5/150, from a cold cache in a profile of its own (a disk cache, as a visitor has): the
//     plaque chosen and all eight beats walked with Next, each shot at its landing (the director's
//     longest flight there, holds included) and once its tiles have settled; each landing against
//     the flight the director planned, which shows its readiness holds, and the surface tiles
//     still in flight at each flight's gate;
//  3. hostile interaction, still at 5/150: Next and Back every 200 ms for 10 s, a flight retargeted
//     halfway, a break-out drag and wheel mid-flight, Resume, and a window resize; then the card's
//     text and image are whole;
//  4. offline after entry (CDP's offline condition, a dropped connection): the walk steps through
//     the beats it has loaded, and a break-out's tiles arrive once the connection is back;
//  5. context loss (WEBGL_lose_context): the first reloads the page, and a second within five
//     minutes brings the story's card in the room (owner decision 21);
//  6. no request to the app's own host once the room has opened, on every page load above;
//  7. leaks: after each of --walks walks through all eight beats and a lobby round trip,
//     unthrottled, the renderer's and
//     the GPU process's footprint, the renderer's allocators from a Chromium memory dump, the JS
//     heap and the DOM's counts, at beat 1 of the next dive; and at each return, the lobby's own
//     nodes, footprint and account, which no walk may add to (owner decision 43). This one drives
//     the headless shell over a bare CDP connection: Playwright keeps the Network domain on, whose
//     agent holds response bodies in the renderer.
//
// The public production page has no hooks, so an init script logs what the DOM shows on the page's own
// clock: the room opening, the lobby's phase (data-lobby, 'gone' at the dive's landing), a beat's
// callouts fading in (they wait for the landing) and the time ruler's engraving, which comes to
// rest at the landing on a beat that spreads nothing. The planned flights come from the director
// itself (story/director.ts, loaded through Vite), stepped at 60 fps from the view the camera left.
// Writes <out>/*.png and <results>/<name>.json. Local only, never in CI, and macOS only (it reads
// footprint(1)); plain Node, run from app/ with nothing else using the GPU (about 20 minutes):
//
//   node scripts/e3.ts --out ../build/m1/e3 --results ../docs/design/measurements/e3/results \
//     [--url https://wander.traviscole.xyz] [--name live-<today>] [--only cold,walk,context,leak] \
//     [--runs 3] [--walks 10]
// A loopback --url may include ?data=global. The leak check adds ?memory=1 there to collect the
// app's optional account, with no Network domain or polling of that account during the walk.
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import type { Release } from '../src/data/release.ts';
import type { Story } from '../src/story/story.ts';
import type { ViewControl } from '../src/view/viewControl.ts';
import type { ViewState } from '../src/view/viewState.ts';
import { dataOverride } from '../src/page/dataOrigin.ts';

/** What the init script logs, each entry at performance.now() on the page's clock. */
interface E3Log {
  open: number | null;
  lobby: [number, string][];
  callouts: [number, string][];
  ticks: number[];
  inputs: [number, string][];
  /** What the page fetched from its own host after the room opened, by Resource Timing. */
  appHost: string[];
}

declare global {
  interface Window {
    __e3?: E3Log;
  }
}

/** The director's readiness gate (story/director.ts): how far into a flight it checks. */
const GATE_AT = 0.9;
/** A landing this much later than planned counts as held, in ms: a frame or two is not. */
const HELD_MS = 100;
/** After the longest flight, the landing shot waits this long for the landing's frame, in ms. */
const LANDING_SHOT_MS = 250;
/** How long a spread (ash, veil) plays out after its landing, in s (story/director.ts). */
const SPREAD_S = 8;
/** Quiet on the data host this long counts as settled, in ms. */
const SETTLE_QUIET_MS = 2000;
const VIEWPORT = { width: 1440, height: 900 };
/** The full tier's CPU line, in MiB: the renderer's footprint may never pass it (streaming.md 6). */
const CPU_LINE_MIB = 288;
/** After a return lands, the lobby stands this long before its sample, in ms. */
const LOBBY_SETTLE_MS = 3000;
/** Where the drags and the wheel land: on the globe, right of the card. */
const GLOBE = { x: 1000, y: 450 };

const CONDITIONS = {
  '25/50': {
    offline: false,
    latency: 50,
    downloadThroughput: 25e6 / 8,
    uploadThroughput: 25e6 / 8,
  },
  '5/150': { offline: false, latency: 150, downloadThroughput: 5e6 / 8, uploadThroughput: 5e6 / 8 },
  offline: { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
} as const;
type Condition = keyof typeof CONDITIONS;

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'https://wander.traviscole.xyz' },
    out: { type: 'string' },
    results: { type: 'string' },
    name: { type: 'string', default: `live-${new Date().toISOString().slice(0, 10)}` },
    only: { type: 'string', default: 'cold,walk,context,leak' },
    runs: { type: 'string', default: '3' },
    walks: { type: 'string', default: '10' },
    timeout: { type: 'string', default: '120' },
  },
});
if (!values.out || !values.results) throw new Error('--out <dir> and --results <dir> are required');
const out = resolve(values.out);
const resultsDir = resolve(values.results);
mkdirSync(out, { recursive: true });
mkdirSync(resultsDir, { recursive: true });
const timeoutMs = Number(values.timeout) * 1000;
const only = new Set(values.only.split(','));
const entry = new URL(values.url).href;
const APP_HOST = new URL(entry).host;

const appRoot = resolve(import.meta.dirname, '..');
const bundledRelease = JSON.parse(
  readFileSync(join(appRoot, 'src/generated/release.json'), 'utf8'),
) as Release;
const override = dataOverride(new URL(entry));
const release = override
  ? await fetch(`${override}/release.json`).then(async (response) => {
      if (!response.ok) throw new Error(`local release: HTTP ${response.status}`);
      return (await response.json()) as Release;
    })
  : bundledRelease;
const DATA_HOST = new URL(release.dataHost).host;

// The story and the director, as the page runs them.
const vite = await createServer({
  root: appRoot,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
const { parseStory } = (await vite.ssrLoadModule(
  '/src/story/story.ts',
)) as typeof import('../src/story/story.ts');
const director = (await vite.ssrLoadModule(
  '/src/story/director.ts',
)) as typeof import('../src/story/director.ts');
const { curlyQuotes } = (await vite.ssrLoadModule(
  '/src/story/ui/format.ts',
)) as typeof import('../src/story/ui/format.ts');
const { maxViewKm } = (await vite.ssrLoadModule(
  '/src/view/cameraRig.ts',
)) as typeof import('../src/view/cameraRig.ts');
await vite.close();
const story: Story = parseStory(readFileSync(join(appRoot, '../stories/tambora/story.md'), 'utf8'));
const BEATS = story.beats;
const LAST = BEATS.length - 1;

const report: Record<string, unknown> = {
  date: new Date().toISOString(),
  url: entry,
  release: release.id,
  viewport: VIEWPORT,
};
/** The shots' file names, in <out>. */
const shots: string[] = [];

/** What closes each session's browser, should the run stop early. */
const closers: (() => Promise<void>)[] = [];

// ---------------------------------------------------------------------------------------------
// 1. Cold loads

async function coldLoads(): Promise<Record<string, unknown>> {
  const runs = Number(values.runs);
  const result: Record<string, unknown> = {};
  for (const condition of ['25/50', '5/150'] as const) {
    const loads = [];
    for (let run = 1; run <= runs; run += 1) {
      const load = await coldLoad(condition);
      console.log(
        `cold ${condition} run ${run}: room open ${load.openMs.toFixed(0)} ms, ` +
          `${(load.bytesBeforeOpen / 1e6).toFixed(2)} MB before it`,
      );
      loads.push(load);
    }
    result[condition] = {
      runs: loads,
      medianOpenMs: median(loads.map((load) => load.openMs)),
      medianBytesBeforeOpen: median(loads.map((load) => load.bytesBeforeOpen)),
      medianFirstPaintMs: median(loads.map((load) => load.firstPaintMs ?? NaN)),
    };
  }
  return result;
}

/** One cold load in a fresh browser: the room's opening, and what arrived before it. */
async function coldLoad(condition: Condition) {
  const session = await openSession(condition, { cacheDisabled: true });
  const { page, net, problems } = session;
  try {
    await page.goto(entry, { waitUntil: 'commit' });
    const open = await waitOpen(session);
    report.gpu ??= await gpuName(page);
    // The opening plays for a few seconds; anything fetched from the app's host then is a miss.
    await page.waitForTimeout(5000);
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const paint = performance.getEntriesByName('first-contentful-paint')[0];
      return { htmlMs: nav.responseEnd, firstPaintMs: paint ? paint.startTime : null };
    });
    const load = net.loads[0];
    if (!load) throw new Error('no page load was seen');
    const arrived = net.list().filter((r) => r.end !== null && net.at(r, r.end) <= open);
    const byHost: Record<string, number> = {};
    for (const r of arrived) byHost[r.host] = (byHost[r.host] ?? 0) + r.bytes;
    const inFlight = net
      .list()
      .filter((r) => net.at(r, r.start) <= open && (r.end === null || net.at(r, r.end) > open));
    return {
      condition,
      openMs: open,
      ...timing,
      bytesBeforeOpen: arrived.reduce((sum, r) => sum + r.bytes, 0),
      requestsBeforeOpen: arrived.length,
      bytesBeforeOpenByHost: byHost,
      inFlightAtOpen: inFlight.map((r) => r.url),
      lobby: (await readLog(page)).lobby,
      appHostAfterOpen: appHostAfterOpen(net),
      problems,
    };
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------------------------
// 2-4, 6. The walk at 5/150, hostile interaction, offline

async function walkSession(): Promise<Record<string, unknown>> {
  // A profile of its own, so revisits and the offline steps find what a visitor's disk cache holds.
  const session = await openSession('5/150', { cacheDisabled: false, profile: true });
  const { page, net } = session;
  try {
    session.net.phase = 'entry';
    await page.goto(entry, { waitUntil: 'commit' });
    const open = await waitOpen(session);
    report.gpu ??= await gpuName(page);
    await waitLobby(page, 'idle');
    const idleMs = (await readLog(page)).lobby.find(([, phase]) => phase === 'idle')?.[0] ?? null;
    await page.waitForTimeout(1000);
    const walk = await walkBeats(session);
    const hostile = await hostileInteraction(session);
    const offline = await offlineSteps(session);
    return {
      condition: '5/150',
      openMs: open,
      lobbyIdleMs: idleMs,
      walk,
      hostile,
      offline,
      images: net
        .list()
        .filter((r) => r.host === DATA_HOST && new URL(r.url).pathname.startsWith('/img/'))
        .map((r) => ({
          url: r.url,
          phase: r.phase,
          atMs: Math.round(net.at(r, r.start)),
          cached: r.cached,
          failed: r.failed,
        })),
      appHostAfterOpen: appHostAfterOpen(net),
      problems: session.problems,
    };
  } finally {
    await session.close();
  }
}

interface BeatRun {
  beat: number;
  id: string;
  pressMs: number;
  /**
   * The flight with its tiles ready at the gate (from the lobby, the shortest and longest over
   * its longitudes), and with the gate holding its longest, in s.
   */
  plannedMinS: number;
  plannedS: number;
  longestS: number;
  shotAtMs: number;
  landing: CardState;
  /** From the press to the data host's last request before it went quiet, in ms. */
  dataQuietAfterMs: number | null;
  settled: CardState;
}

/** Item 2: the dive and Next through all eight beats, shot at each landing and once settled. */
async function walkBeats(session: Session) {
  const { page, net } = session;
  session.net.phase = 'walk';
  const runs: BeatRun[] = [];
  for (const [beat, b] of BEATS.entries()) {
    const n = beat + 1;
    const press =
      beat === 0
        ? await click(page, '.lobby-plaque[data-story="tambora"]')
        : await key(page, 'ArrowRight');
    // The flight's longest, from where the camera left: the lobby, or the last beat's dwell.
    const previous = runs.at(-1);
    const left = BEATS[beat - 1];
    const from =
      previous === undefined || left === undefined
        ? lobbyViews()
        : [director.dwellView(left, dwellS(previous, press))];
    const planned = flightRange(from, beat);
    await until(page, press + planned.longestS * 1000 + LANDING_SHOT_MS);
    const shotAt = await pageNow(page);
    await shoot(page, `walk-${n}-${b.id}-landing`);
    const landing = await card(page);
    const spreads = b.effects.some((effect) => effect.kind === 'spread');
    const quietAt = await settle(session, {
      notBefore: spreads ? press + (planned.longestS + SPREAD_S + 0.5) * 1000 : 0,
    });
    await shoot(page, `walk-${n}-${b.id}-settled`);
    runs.push({
      beat,
      id: b.id,
      pressMs: press,
      plannedMinS: planned.plannedMinS,
      plannedS: planned.plannedS,
      longestS: planned.longestS,
      shotAtMs: shotAt,
      landing,
      dataQuietAfterMs: quietAt === null ? null : quietAt - press,
      settled: await card(page),
    });
    const quiet = quietAt === null ? 'never' : `${((quietAt - press) / 1000).toFixed(1)} s`;
    console.log(
      `walk beat ${n} ${b.id}: planned ${planned.plannedS.toFixed(2)} s, data quiet ${quiet}`,
    );
  }

  // Landings, from the page's log; then what each flight's gate found still in flight.
  const log = await readLog(page);
  const load = net.loads.at(-1);
  const landed = landings(log, runs);
  return runs.map((run, i) => {
    const next = runs[i + 1]?.pressMs ?? Infinity;
    const landing = landed[i] ?? {
      atMs: null,
      by: null,
      calloutMs: null,
      rulerRestMs: null,
      lateMs: null,
    };
    const gate = run.pressMs + GATE_AT * run.plannedS * 1000;
    const tiles = net
      .list()
      .filter((r) => r.host === DATA_HOST && r.epoch === (load?.epoch ?? 0))
      .filter((r) => new URL(r.url).pathname.startsWith('/surf/'));
    const pendingAtGate = tiles.filter(
      (r) => net.at(r, r.start) <= gate && (r.end === null || net.at(r, r.end) > gate),
    );
    const during = net
      .list()
      .filter((r) => r.host === DATA_HOST && r.phase === 'walk' && !r.cached)
      .filter((r) => net.at(r, r.start) >= run.pressMs && net.at(r, r.start) < next);
    const lateMs = landing.lateMs;
    return {
      ...run,
      landedAtMs: landing.atMs,
      landedBy: landing.by,
      calloutShownMs: landing.calloutMs,
      rulerAtRestMs: landing.rulerRestMs,
      landedLateMs: lateMs,
      held: lateMs === null ? null : lateMs > HELD_MS,
      /** How much later than the director's full hold (its gate never ready), in ms. */
      lateOverFullHoldMs: lateMs === null ? null : lateMs - (run.longestS - run.plannedS) * 1000,
      surfTilesInFlightAtGate: pendingAtGate.length,
      lastOfThemDoneAfterGateMs: pendingAtGate.length
        ? Math.max(
            ...pendingAtGate.map((r) => (r.end === null ? Infinity : net.at(r, r.end) - gate)),
          )
        : null,
      dataRequests: during.length,
      dataBytes: during.reduce((sum, r) => sum + r.bytes, 0),
      failedRequests: during.filter((r) => r.failed !== null).map((r) => `${r.url}: ${r.failed}`),
      landingWhole: cardProblems(run.landing, run.beat, false),
      settledWhole: cardProblems(run.settled, run.beat, true),
    };
  });
}

/** Item 3: Next and Back every 200 ms, a retarget, a break-out mid-flight, Resume, a resize. */
async function hostileInteraction(session: Session) {
  const { page } = session;
  session.net.phase = 'hostile';
  const problemsFrom = session.problems.length;
  let beat = LAST;
  const random = lcg(1815);
  const presses: string[] = [];
  const start = await pageNow(page);
  for (let i = 0; i < 50; i += 1) {
    await until(page, start + i * 200);
    // Next or Back at random, kept off the ends so every press starts a flight.
    const forward = beat <= 1 ? true : beat >= LAST - 1 ? false : random() < 0.5;
    await page.keyboard.press(forward ? 'ArrowRight' : 'ArrowLeft');
    beat += forward ? 1 : -1;
    presses.push(forward ? 'Next' : 'Back');
  }
  const stormMs = (await pageNow(page)) - start;
  const stormBeat = beat;
  await shoot(page, 'hostile-1-storm-end');
  await page.waitForTimeout(6000);
  await settle(session);
  const afterStorm = await card(page);

  // A flight retargeted halfway: the Next lever, then a far beat's dot on the ruler.
  await page.click('.rc-lever.is-next');
  beat += 1;
  await page.waitForTimeout(1200);
  const far = beat >= 4 ? 1 : LAST - 1;
  await page.locator('.rc-dot').nth(far).click();
  beat = far;
  await page.waitForTimeout(300);
  await shoot(page, 'hostile-2-retargeted');
  await page.waitForTimeout(6000);
  await settle(session);
  const afterRetarget = await card(page);

  // A break-out mid-flight: a drag across the globe, then the wheel in and out.
  await page.keyboard.press('ArrowRight');
  beat += 1;
  await page.waitForTimeout(900);
  await page.mouse.move(GLOBE.x, GLOBE.y);
  await page.mouse.down();
  await page.mouse.move(GLOBE.x - 240, GLOBE.y - 70, { steps: 12 });
  await page.mouse.up();
  for (const dy of [-350, -350, -350, 350]) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1500);
  await shoot(page, 'hostile-3-breakout');
  const resumeShown = await page.locator('.wu-resume.is-shown').isVisible();

  await page.click('.wu-resume');
  await page.waitForTimeout(6000);
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.waitForTimeout(1500);
  await shoot(page, 'hostile-4-resized');
  await page.setViewportSize(VIEWPORT);
  await page.waitForTimeout(1500);
  await settle(session);
  await shoot(page, 'hostile-5-after');
  const after = await card(page);
  return {
    presses,
    stormMs,
    afterStorm: {
      card: afterStorm,
      expectedBeat: stormBeat,
      problems: cardProblems(afterStorm, stormBeat, true),
    },
    retargetedTo: far,
    afterRetarget: {
      card: afterRetarget,
      expectedBeat: far,
      problems: cardProblems(afterRetarget, far, true),
    },
    resumeShownAfterBreakout: resumeShown,
    after: { card: after, expectedBeat: beat, problems: cardProblems(after, beat, true) },
    problems: session.problems.slice(problemsFrom),
  };
}

/**
 * Item 4: offline, the walk steps from the first beat to the last; a break-out offline, then
 * back online until its tiles have arrived; then Resume and Back.
 */
async function offlineSteps(session: Session) {
  const { page, cdp, net } = session;
  session.net.phase = 'offline';
  const problemsFrom = session.problems.length;
  await emulate(cdp, 'offline');
  const offlineAt = await pageNow(page);
  const steps = [];
  for (let beat = 0; beat <= LAST; beat += 1) {
    const from = net.list().length;
    if (beat === 0) await page.locator('.rc-dot').nth(0).click();
    else await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(7000);
    await shoot(page, `offline-${beat + 1}-${BEATS[beat]?.id}`);
    const state = await card(page);
    const requests = net.list().slice(from);
    steps.push({
      beat,
      card: state,
      problems: cardProblems(state, beat, true),
      fromCache: requests.filter((r) => r.cached).length,
      failed: requests.filter((r) => r.failed !== null).length,
    });
  }
  // Away from the beats: west across the globe from the last beat, toward the Himalaya, and in.
  session.net.phase = 'offline-breakout';
  await page.mouse.move(GLOBE.x, GLOBE.y);
  for (let i = 0; i < 2; i += 1) {
    await page.mouse.down();
    await page.mouse.move(GLOBE.x + 380, GLOBE.y, { steps: 12 });
    await page.mouse.up();
    await page.mouse.move(GLOBE.x, GLOBE.y);
  }
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(1000);
  // The view is at rest: what fails from now on, the resting view wants.
  session.net.phase = 'offline-rest';
  await page.waitForTimeout(3000);
  await shoot(page, 'offline-9-breakout');
  const offlineProblems = session.problems.slice(problemsFrom);
  const failedOffline = net
    .list()
    .filter((r) => r.failed !== null && r.end !== null && net.at(r, r.end) >= offlineAt);

  session.net.phase = 'online';
  await emulate(cdp, '5/150');
  const onlineAt = await pageNow(page);
  // A tile that failed draws from its ancestors for degradeFor (30 s), then is wanted again.
  const recovered = await recovery(session, onlineAt, 90_000);
  await shoot(page, 'online-1-recovered');
  await page.locator('.wu-resume').click();
  await page.waitForTimeout(6000);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(6000);
  await settle(session);
  await shoot(page, 'online-2-back');
  const back = await card(page);
  return {
    steps,
    failedWhileOffline: failedOffline.length,
    failedWhileOfflineSample: failedOffline.slice(0, 5).map((r) => `${r.url}: ${r.failed}`),
    problemsWhileOffline: offlineProblems,
    recovery: recovered,
    back: { card: back, problems: cardProblems(back, LAST - 1, true) },
    problemsOnline: session.problems.slice(problemsFrom + offlineProblems.length),
  };
}

/**
 * Once back online: every surface tile the resting break-out view wanted and could not fetch
 * offline (a tile wanted only mid-drag is not wanted again) arrives, and the data host goes
 * quiet. Returns when, after `from`, and what came.
 */
async function recovery(session: Session, from: number, capMs: number) {
  const { page, net } = session;
  const tile = (r: Request) => r.host === DATA_HOST && new URL(r.url).pathname.startsWith('/surf/');
  const failedIn = (phase: string) =>
    new Set(
      net
        .list()
        .filter((r) => r.phase === phase && r.failed !== null && tile(r))
        .map((r) => r.url),
    );
  const lostMidDrag = failedIn('offline-breakout');
  const lost = failedIn('offline-rest');
  const start = Date.now();
  const outcome = (since: Request[], back: Set<string>) => ({
    tilesLostAtRest: lost.size,
    fetchedAgain: [...lost].filter((url) => back.has(url)).length,
    tilesLostMidDrag: lostMidDrag.size,
    fetchedAgainMidDrag: [...lostMidDrag].filter((url) => back.has(url)).length,
    requests: since.length,
    failed: since.filter((r) => r.failed !== null).length,
  });
  let since: Request[] = [];
  let back = new Set<string>();
  while (Date.now() - start < capMs) {
    await page.waitForTimeout(1000);
    since = net.list().filter((r) => r.phase === 'online' && r.host === DATA_HOST);
    back = new Set(since.filter((r) => r.failed === null && r.end !== null).map((r) => r.url));
    const quiet = net.pending() === 0 && Date.now() - net.lastActivity >= 3000;
    if ([...lost].every((url) => back.has(url)) && quiet) {
      return { afterMs: (await pageNow(page)) - from, ...outcome(since, back) };
    }
  }
  return { afterMs: null, ...outcome(since, back) };
}

// ---------------------------------------------------------------------------------------------
// 5. Context loss

async function contextLossSession(): Promise<Record<string, unknown>> {
  const session = await openSession('25/50', { cacheDisabled: false });
  const { page } = session;
  session.net.phase = 'context';
  try {
    await page.goto(entry, { waitUntil: 'commit' });
    await waitOpen(session);
    await waitLobby(page, 'idle');
    await click(page, '.lobby-plaque[data-story="tambora"]');
    await waitLobby(page, 'gone');
    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(4000);
    }
    await shoot(page, 'context-1-before');
    const origin = await page.evaluate(() => performance.timeOrigin);
    await loseContext(page);
    // The first loss reloads the page: a new document, whose room opens again.
    const reloaded = await page
      .waitForFunction((was) => performance.timeOrigin !== was, origin, {
        timeout: 20_000,
        polling: 250,
      })
      .then(() => true)
      .catch(() => false);
    let reopenedMs: number | null = null;
    if (reloaded) {
      reopenedMs = await waitOpen(session);
      await waitLobby(page, 'idle');
      await shoot(page, 'context-2-reloaded');
    }
    const second = await page.evaluate(() => performance.timeOrigin);
    await loseContext(page);
    const plate = await page
      .waitForSelector('#room .plate-card', { state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(1500);
    await shoot(page, 'context-3-second-loss');
    const shown = await page.evaluate(() => ({
      roomOpen: document.getElementById('room')?.classList.contains('is-open') ?? null,
      title: document.querySelector('#room .plate-card .wu-title')?.textContent ?? null,
      blurb: document.querySelector('#room .plate-card .plate-blurb')?.textContent ?? null,
      note: document.querySelector('#room .plate-card .plate-note')?.textContent ?? null,
      reload: document.querySelector('#room .plate-card .plate-button') !== null,
      canvas: document.querySelector('canvas.walk-canvas') !== null,
      stored: sessionStorage.getItem('wander:context-lost'),
    }));
    const reloadedAgain = (await page.evaluate(() => performance.timeOrigin)) !== second;
    return {
      firstLossReloaded: reloaded,
      reopenedMs,
      secondLossPlate: plate,
      secondLossReloaded: reloadedAgain,
      shown,
      appHostAfterOpen: appHostAfterOpen(session.net),
      problems: session.problems,
    };
  } finally {
    await session.close();
  }
}

async function loseContext(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.walk-canvas');
    const gl = canvas?.getContext('webgl2');
    const lose = gl?.getExtension('WEBGL_lose_context');
    if (!lose) throw new Error('no WEBGL_lose_context on the walk canvas');
    lose.loseContext();
  });
}

// ---------------------------------------------------------------------------------------------
// 7. Leaks

/**
 * Walks every beat, returns to the lobby and dives again --walks times, in a browser driven over
 * a bare CDP connection, not Playwright:
 * Playwright keeps the Network domain on for every page, and DevTools' network agent then keeps
 * response bodies in the renderer, which grows with every tile fetched. No domain is enabled
 * here but Page; gc() is exposed, and runs in the page and its decode workers before each sample.
 * The page's Resource Timing buffer keeps its default size.
 */
async function leakSession(): Promise<Record<string, unknown>> {
  const bare = await launchBare();
  try {
    const { page } = bare;
    const blank = await sample(bare);
    const leakUrl = new URL(entry);
    if (['127.0.0.1', 'localhost', '[::1]'].includes(leakUrl.hostname))
      leakUrl.searchParams.set('memory', '1');
    await bare.send('Page.navigate', { url: leakUrl.href }, page);
    await bare.until('window.__e3?.open != null');
    await bare.until("document.body.dataset.lobby === 'idle'");
    await bare.click('.lobby-plaque[data-story="tambora"]');
    await bare.until("document.body.dataset.lobby === 'gone'");
    let firstLandingMs = await bare.evaluate<number>('performance.now()');
    await sleep(5000);
    const samples = [
      { walks: -1, ...blank },
      { walks: 0, ...(await sample(bare)) },
    ];
    const walks = Number(values.walks);
    // The lobby after each return, where the walk's own DOM and mode are gone.
    const lobby: (Awaited<ReturnType<typeof sample>> & { walks: number })[] = [];
    // Each flight, for its landing against the plan: unthrottled, how late a landing reads.
    const flights: Flight[] = [];
    for (let w = 1; w <= walks; w += 1) {
      for (let beat = 0; beat <= LAST; beat += 1) {
        if (beat === 0 && (await bare.evaluate<string>(STATUS)).startsWith('Beat 1 ')) continue;
        const press = beat === 0 ? await bare.click('.rc-dot') : await bare.key('ArrowRight');
        const previous = flights.at(-1);
        const left = BEATS[beat === 0 ? LAST : beat - 1];
        const dwell =
          beat === 1
            ? (press - firstLandingMs) / 1000
            : previous
              ? (press - previous.pressMs) / 1000 - previous.plannedS
              : 0;
        const from = left ? director.dwellView(left, Math.max(0, dwell)) : null;
        flights.push({
          beat,
          pressMs: press,
          plannedS: from ? fly(from, beat, true) : NaN,
          longestS: from ? fly(from, beat, false) : NaN,
        });
        await sleep(6500);
      }
      // Include the lifetime boundary, then sample at the same point as walk 0: beat 1 after a
      // dive, with old cards, directors, event handlers and fading cues already released.
      await bare.click('.wu-mark');
      await bare.until("document.body.dataset.lobby === 'idle'");
      // What the walk left behind: the lobby's own DOM and account, with no allocator dump, whose
      // trace this sample would leave in the renderer before the walk's.
      await sleep(LOBBY_SETTLE_MS);
      lobby.push({ walks: w, ...(await sample(bare, { dump: false })) });
      await bare.click('.lobby-plaque[data-story="tambora"]');
      await bare.until("document.body.dataset.lobby === 'gone'");
      firstLandingMs = await bare.evaluate<number>('performance.now()');
      await sleep(5000);
      const taken = { walks: w, ...(await sample(bare)) };
      samples.push(taken);
      console.log(
        `leak walk ${w}: renderer ${taken.rendererMB} MB, GPU process ${taken.gpuMB} MB, ` +
          `JS heap ${taken.jsHeapUsedMB} MB, ${JSON.stringify(taken.renderer)}`,
      );
    }
    const png = join(out, 'leak-after.png');
    const shot = await bare.send<{ data: string }>('Page.captureScreenshot', {}, page);
    writeFileSync(png, Buffer.from(shot.data, 'base64'));
    shots.push(basename(png));
    const log = await bare.evaluate<E3Log>('window.__e3');
    const observed = landings(log, flights).flatMap((landing, i) => {
      const flight = flights[i];
      if (!flight || landing.lateMs === null || Number.isNaN(landing.lateMs)) return [];
      const fullHoldMs = (flight.longestS - flight.plannedS) * 1000;
      return [{ lateMs: landing.lateMs, overFullHoldMs: landing.lateMs - fullHoldMs }];
    });
    const late = observed.map((o) => o.lateMs);
    // Walks 3 against 6, and 6 against the last when there are more.
    const at = (w: number) => samples.find((s) => s.walks === w);
    const growth = (from: number, to: number) => {
      const [a, b] = [at(from), at(to)];
      if (!a || !b || from >= to) return null;
      const keys = ['rendererMB', 'gpuMB', 'gpuGraphicsMB', 'jsHeapUsedMB', 'nodes'] as const;
      const parts = Object.keys(b.renderer);
      return {
        ...Object.fromEntries(keys.map((key) => [key, { from: a[key], to: b[key] }])),
        renderer: Object.fromEntries(
          parts.map((part) => [part, { from: a.renderer[part], to: b.renderer[part] }]),
        ),
      };
    };
    return {
      driver: 'bare CDP, no Network domain',
      url: leakUrl.href,
      cpuBudget: {
        limitMiB: CPU_LINE_MIB,
        passed: samples.filter((s) => s.walks > 0).every((s) => s.rendererMB <= CPU_LINE_MIB),
      },
      samples,
      growth: { walks3to6: growth(3, 6), walks6toLast: growth(6, walks) },
      lobbySamples: lobby,
      leftBehind: leftBehind(lobby),
      landingsUnthrottled: {
        flights: flights.length,
        observed: late.length,
        lateMsMedian: median(late),
        lateMsMax: Math.max(...late),
        held: late.filter((ms) => ms > HELD_MS).length,
        overFullHoldMsMax: Math.max(...observed.map((o) => o.overFullHoldMs)),
      },
      appHostAfterOpen: log.appHost,
      problems: bare.problems,
    };
  } finally {
    await bare.close();
  }
}

/**
 * What the walks left in the lobby: its node count and the app's account by owner, which must stay
 * as the second return left them (the first still carries what the first walk warmed), and the
 * renderer's footprint at each return.
 */
function leftBehind(returns: { nodes: number; memoryAccount: unknown; rendererMB: number }[]) {
  const later = returns.slice(1);
  const owners = (s: { memoryAccount: unknown }) =>
    JSON.stringify((s.memoryAccount as { owners?: unknown } | null)?.owners ?? null);
  return {
    nodes: returns.map((s) => s.nodes),
    nodesFlat: new Set(later.map((s) => s.nodes)).size <= 1,
    accountFlat: new Set(later.map(owners)).size <= 1,
    rendererMB: returns.map((s) => s.rendererMB),
  };
}

/** The ruler's status line, which names the beat. */
const STATUS = "document.querySelector('.rc-status')?.textContent ?? ''";

/** Chromium's allocators in the renderer's memory dump that the samples keep, by dump path. */
const RENDERER_PARTS = {
  arrayBuffers: 'partition_alloc/partitions/array_buffer',
  blinkBuffers: 'partition_alloc/partitions/buffer',
  blinkGc: 'blink_gc',
  blinkGcLive: 'blink_gc/main/allocated_objects',
  v8: 'v8',
  malloc: 'malloc',
  gpuClient: 'gpu',
} as const;

/**
 * After gc() in the page and every worker: the page's JS live set (read at once) and its heap a
 * moment later, and the DOM counts; the footprint of the renderer and of the GPU process (its
 * graphics lines hold the textures and buffers it has allocated); and, unless `dump` is off, the
 * renderer's allocators from a Chromium memory dump, in MB.
 */
async function sample(bare: Bare, { dump: withDump = true }: { dump?: boolean } = {}) {
  for (const session of [...bare.workers, bare.page]) {
    await bare.send('Runtime.evaluate', { expression: 'gc()' }, session).catch(() => {});
  }
  // The live set, read before the frames that follow allocate again.
  const live = await bare.send<{ usedSize: number }>('Runtime.getHeapUsage', {}, bare.page);
  await sleep(1500);
  const heap = await bare.send<{ usedSize: number; totalSize: number }>(
    'Runtime.getHeapUsage',
    {},
    bare.page,
  );
  const dom = await bare.send<{ nodes: number; jsEventListeners: number; documents: number }>(
    'Memory.getDOMCounters',
    {},
    bare.page,
  );
  const { processInfo } = await bare.send<{ processInfo: { type: string; id: number }[] }>(
    'SystemInfo.getProcessInfo',
  );
  const renderer = processInfo
    .filter((p) => p.type === 'renderer')
    .map((p) => ({ pid: p.id, ...footprint(p.id) }))
    .sort((a, b) => b.total - a.total)[0];
  const gpu = processInfo.filter((p) => p.type === 'GPU').map((p) => footprint(p.id));
  const dump = withDump ? await bare.memoryDump() : {};
  const parts = (renderer && dump[renderer.pid]) ?? {};
  // Sample last, so allocating/serializing the account cannot inflate this allocator dump.
  const memoryAccount = await bare.evaluate<unknown>('window.__wanderMemory?.() ?? null');
  const mb = (bytes: number) => Math.round((bytes / 2 ** 20) * 10) / 10;
  return {
    memoryAccount,
    jsLiveMB: mb(live.usedSize),
    jsHeapUsedMB: mb(heap.usedSize),
    jsHeapTotalMB: mb(heap.totalSize),
    nodes: dom.nodes,
    listeners: dom.jsEventListeners,
    documents: dom.documents,
    rendererMB: mb(renderer?.total ?? NaN),
    gpuMB: mb(gpu.reduce((sum, f) => sum + f.total, 0)),
    gpuGraphicsMB: mb(gpu.reduce((sum, f) => sum + f.graphics, 0)),
    renderer: Object.fromEntries(
      Object.entries(RENDERER_PARTS).map(([name, path]) => [name, mb(parts[path] ?? NaN)]),
    ) as Record<string, number>,
  };
}

interface Bare {
  /** The page's flat session. */
  page: string;
  /** The page's workers' sessions. */
  workers: Set<string>;
  problems: { type: string; text: string }[];
  send<T = unknown>(method: string, params?: object, sessionId?: string): Promise<T>;
  evaluate<T>(expression: string): Promise<T>;
  /** Polls `expression` in the page until it is true. */
  until(expression: string): Promise<void>;
  /** Clicks the first element `selector` matches; returns when the page saw it. */
  click(selector: string): Promise<number>;
  key(name: 'ArrowRight'): Promise<number>;
  /** Every process's allocators from a detailed memory dump, by pid, in bytes. */
  memoryDump(): Promise<Record<number, Record<string, number>>>;
  close(): Promise<void>;
}

/** The headless shell Playwright installs beside its Chromium, as the other checks run. */
function headlessShell(): string {
  const full = chromium.executablePath();
  const root = full.slice(0, full.indexOf('/chromium-'));
  const revision = /\/chromium-(\d+)\//.exec(full)?.[1];
  const shell = `${root}/chromium_headless_shell-${revision}/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
  return existsSync(shell) ? shell : full;
}

/** Launches the headless shell on this GPU at 1440x900 and attaches to its page, over CDP. */
async function launchBare(): Promise<Bare> {
  const folder = mkdtempSync(join(tmpdir(), 'wander-e3-bare-'));
  const child = spawn(
    headlessShell(),
    [
      '--use-angle=metal',
      '--js-flags=--expose-gc',
      '--remote-debugging-port=0',
      `--user-data-dir=${folder}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--mute-audio',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const url = await new Promise<string>((resolve, reject) => {
    let text = '';
    child.stderr.on('data', (chunk: Buffer) => {
      text += chunk.toString();
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(text)?.[1];
      if (found) resolve(found);
    });
    child.on('exit', () => reject(new Error(`the headless shell exited: ${text}`)));
    setTimeout(() => reject(new Error('the headless shell did not start')), 30_000);
  });
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const waiting = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (e: Error) => void }
  >();
  const listeners = new Set<(method: string, params: never, sessionId?: string) => void>();
  socket.onmessage = (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      result?: unknown;
      error?: { message: string };
      method?: string;
      params?: never;
      sessionId?: string;
    };
    if (message.id !== undefined) {
      const call = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) call?.reject(new Error(message.error.message));
      else call?.resolve(message.result);
    } else if (message.method) {
      for (const listener of listeners)
        listener(message.method, message.params as never, message.sessionId);
    }
  };
  const send = <T = unknown>(method: string, params: object = {}, sessionId?: string) =>
    new Promise<T>((resolve, reject) => {
      id += 1;
      waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const { targetInfos } = await send<{ targetInfos: { targetId: string; type: string }[] }>(
    'Target.getTargets',
  );
  const target = targetInfos.find((t) => t.type === 'page');
  if (!target) throw new Error('the headless shell has no page');
  const { sessionId: page } = await send<{ sessionId: string }>('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  const workers = new Set<string>();
  const problems: { type: string; text: string }[] = [];
  listeners.add((method, params: { sessionId?: string; targetInfo?: { type: string } }) => {
    if (method === 'Target.attachedToTarget' && params.targetInfo?.type === 'worker') {
      workers.add(params.sessionId ?? '');
    } else if (method === 'Target.detachedFromTarget') {
      workers.delete(params.sessionId ?? '');
    }
  });
  listeners.add(
    (
      method,
      params: { exceptionDetails?: { text: string }; entry?: { level: string; text: string } },
    ) => {
      if (method === 'Runtime.exceptionThrown') {
        problems.push({ type: 'pageerror', text: params.exceptionDetails?.text ?? '' });
      } else if (method === 'Log.entryAdded' && params.entry && params.entry.level !== 'info') {
        problems.push({ type: params.entry.level, text: params.entry.text });
      }
    },
  );
  await send(
    'Target.setAutoAttach',
    { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
    page,
  );
  await send('Page.enable', {}, page);
  await send('Log.enable', {}, page);
  await send(
    'Emulation.setDeviceMetricsOverride',
    { ...VIEWPORT, deviceScaleFactor: 1, mobile: false },
    page,
  );
  // The init script, with the page's Resource Timing buffer back at its default.
  await send(
    'Page.addScriptToEvaluateOnNewDocument',
    { source: `(${instrument.toString()})(); performance.setResourceTimingBufferSize(250);` },
    page,
  );

  const evaluate = async <T>(expression: string) => {
    const reply = await send<{ result: { value: T } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      page,
    );
    return reply.result.value;
  };
  const lastInput = async (name: string) => {
    const inputs = await evaluate<[number, string][]>('window.__e3.inputs');
    const last = inputs.filter(([, what]) => what === name).at(-1);
    if (!last) throw new Error(`the page saw no ${name}`);
    return last[0];
  };
  return {
    page,
    workers,
    problems,
    send,
    evaluate,
    async until(expression) {
      const start = Date.now();
      while (!(await evaluate<boolean>(`Boolean(${expression})`))) {
        if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${expression}`);
        await sleep(100);
      }
    },
    async click(selector) {
      const box = await evaluate<{ x: number; y: number } | null>(
        `(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();` +
          ` return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`,
      );
      if (!box) throw new Error(`nothing matches ${selector}`);
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await send(
          'Input.dispatchMouseEvent',
          { type, ...box, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 },
          page,
        );
      }
      return lastInput('pointerdown');
    },
    async key(name) {
      const key = { key: name, code: name, windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key }, page);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key }, page);
      return lastInput(name);
    },
    async memoryDump() {
      const events: TraceEvent[] = [];
      const collect = (method: string, params: { value?: TraceEvent[] }) => {
        if (method === 'Tracing.dataCollected') events.push(...(params.value ?? []));
      };
      listeners.add(collect);
      const complete = new Promise<void>((resolve) => {
        const done = (method: string) => {
          if (method !== 'Tracing.tracingComplete') return;
          listeners.delete(done);
          resolve();
        };
        listeners.add(done);
      });
      await send('Tracing.start', {
        traceConfig: {
          includedCategories: ['disabled-by-default-memory-infra'],
          excludedCategories: ['*'],
          memoryDumpConfig: { triggers: [] },
        },
      });
      await send('Tracing.requestMemoryDump', { deterministic: true, levelOfDetail: 'detailed' });
      await send('Tracing.end');
      await complete;
      listeners.delete(collect);
      const byPid: Record<number, Record<string, number>> = {};
      for (const event of events) {
        const allocators = event.args?.dumps?.allocators;
        if (event.ph !== 'v' || !allocators) continue;
        const parts = (byPid[event.pid] ??= {});
        for (const [name, allocator] of Object.entries(allocators)) {
          const size = allocator.attrs?.size?.value;
          if (size !== undefined) parts[name] = parseInt(size, 16);
        }
      }
      return byPid;
    },
    async close() {
      socket.close();
      child.kill();
      await new Promise((resolve) => setTimeout(resolve, 500));
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

interface TraceEvent {
  ph: string;
  pid: number;
  args?: { dumps?: { allocators?: Record<string, { attrs?: { size?: { value: string } } }> } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A process's phys_footprint, the part of it macOS files under graphics, and its largest
 * categories by dirty memory, in bytes.
 */
function footprint(pid: number): {
  total: number;
  graphics: number;
  categories: [string, number][];
} {
  const text = execFileSync('footprint', [String(pid)], { encoding: 'utf8' });
  const bytes = (value: string, unit: string) =>
    Number(value) * ({ B: 1, KB: 2 ** 10, MB: 2 ** 20, GB: 2 ** 30 }[unit] ?? NaN);
  const total = /phys_footprint:\s+([\d.]+)\s+(B|KB|MB|GB)/.exec(text);
  const categories: [string, number][] = [];
  for (const line of text.split('\n')) {
    const row = /^\s*([\d.]+)\s+(B|KB|MB|GB)\s+[\d.]+\s+\w+\s+[\d.]+\s+\w+\s+\d+\s+(.+)$/.exec(
      line,
    );
    if (row?.[1] && row[2] && row[3] && row[3].trim() !== 'TOTAL') {
      categories.push([row[3].trim(), bytes(row[1], row[2])]);
    }
  }
  const graphics = categories
    .filter(([name]) => /IOAccelerator|IOSurface|\(graphics\)/.test(name))
    .reduce((sum, [, size]) => sum + size, 0);
  return {
    total: total?.[1] && total[2] ? bytes(total[1], total[2]) : NaN,
    graphics,
    categories: categories.sort((a, b) => b[1] - a[1]).slice(0, 6),
  };
}

// ---------------------------------------------------------------------------------------------
// Flights, landings and the card

/**
 * The flight to `beat` the director plans from the views in `from`: its length with the tiles
 * ready at the gate (the shortest and the longest over the views), and with the gate holding its
 * longest (never ready).
 */
function flightRange(from: ViewState[], beat: number) {
  const planned = from.map((view) => fly(view, beat, true));
  return {
    plannedMinS: Math.min(...planned),
    plannedS: Math.max(...planned),
    longestS: Math.max(...from.map((view) => fly(view, beat, false))),
  };
}

/** Seconds the director takes to fly from `view` to `beat`, stepped at 60 fps. */
function fly(view: ViewState, beat: number, ready: boolean): number {
  const control = {
    current: { ...view },
    go(to: ViewState) {
      this.current = { ...to };
    },
  };
  const walk = director.createWalk(story, control as unknown as ViewControl, {
    ready: () => ready,
  });
  // From a break-out, a beat's flight starts from wherever the camera is, even the beat it left.
  walk.breakOut();
  control.current = { ...view };
  walk.goTo(beat);
  const dt = 1 / 60;
  let s = 0;
  while (walk.state().flight !== null && s < 30) {
    walk.update(s * 1000, dt);
    s += dt;
  }
  return s;
}

/**
 * The views the lobby may stand at when its plaque is chosen: the widest view at its latitude,
 * at every longitude, since it turns as long as it stands.
 */
function lobbyViews(): ViewState[] {
  const camera = { fov: 30, aspect: VIEWPORT.width / VIEWPORT.height };
  const viewKm = maxViewKm(camera as Parameters<typeof maxViewKm>[0]);
  const views: ViewState[] = [];
  for (let lon = -180; lon < 180; lon += 5) {
    views.push({ lon, lat: 15, viewKm, tilt: 0, heading: 0 });
  }
  return views;
}

/** How long the camera dwelt on the last beat before `press`: from its landing, or its shot. */
function dwellS(previous: BeatRun, press: number): number {
  return Math.max(0, (press - previous.pressMs) / 1000 - previous.plannedS);
}

interface Flight {
  beat: number;
  pressMs: number;
  plannedS: number;
  longestS: number;
}

/** Each flight's observed landing, and how much later than planned it came, in ms. */
function landings(log: E3Log, flights: Flight[]) {
  return flights.map((flight, i) => {
    const next = flights[i + 1]?.pressMs ?? Infinity;
    const landing = observedLanding(log, flight.beat, flight.pressMs, next);
    const lateMs =
      landing.atMs === null ? null : landing.atMs - flight.pressMs - flight.plannedS * 1000;
    return { ...landing, lateMs };
  });
}

/**
 * When the walk landed on `beat`, pressed at `press`, from the page's log: the dive's landing
 * (data-lobby 'gone'), the beat's callouts fading in, or the ruler's engraving coming to rest on
 * a beat that spreads nothing, in that order; null on a spread without callouts (the veil). Each
 * signal is kept, so they can be checked against each other.
 */
function observedLanding(
  log: E3Log,
  beat: number,
  press: number,
  next: number,
): {
  atMs: number | null;
  by: string | null;
  calloutMs: number | null;
  rulerRestMs: number | null;
} {
  const b = BEATS[beat];
  const texts = (b?.effects ?? []).flatMap((effect) =>
    effect.kind === 'callout' ? [effect.text.toUpperCase(), effect.text] : [],
  );
  const calloutMs =
    log.callouts.find(
      ([t, text]) => t > press && t < next && texts.some((name) => text.includes(name)),
    )?.[0] ?? null;
  const spreads = (b?.effects ?? []).some((effect) => effect.kind === 'spread');
  const rulerRestMs = spreads
    ? null
    : (log.ticks.filter((t) => t > press && t < next).at(-1) ?? null);
  const signals = { calloutMs, rulerRestMs };
  const gone = log.lobby.find(([t, phase]) => phase === 'gone' && t > press);
  if (beat === 0 && gone) return { atMs: gone[0], by: 'data-lobby gone', ...signals };
  if (calloutMs !== null) return { atMs: calloutMs, by: 'callout shown', ...signals };
  if (rulerRestMs !== null) return { atMs: rulerRestMs, by: 'ruler at rest', ...signals };
  return { atMs: null, by: null, ...signals };
}

interface CardState {
  status: string;
  title: string;
  date: string;
  paragraphs: number;
  image: 'sharp' | 'preview' | 'plate' | 'loading' | 'none';
  imageSrc: string | null;
  resumeShown: boolean;
  roomOpen: boolean;
}

/** What the card shows now, and the ruler's status line, which names the beat. */
async function card(page: Page): Promise<CardState> {
  return page.evaluate(() => {
    const q = (selector: string) => document.querySelector(selector);
    const frame = q('.wu .wu-card .wu-frame');
    const sharp = frame?.querySelector<HTMLImageElement>('img.is-loaded:not(.wu-preview)');
    const image = sharp
      ? 'sharp'
      : frame?.querySelector('img.wu-preview.is-loaded')
        ? 'preview'
        : frame?.querySelector('.wu-plate')
          ? 'plate'
          : frame
            ? 'loading'
            : 'none';
    return {
      status: q('.rc-status')?.textContent ?? '',
      title: q('.wu .wu-card .wu-title')?.textContent ?? '',
      date: q('.wu .wu-card .wu-date')?.textContent ?? '',
      paragraphs: document.querySelectorAll('.wu .wu-card .wu-text p').length,
      image,
      imageSrc: sharp?.currentSrc ?? null,
      resumeShown: q('.wu-resume')?.classList.contains('is-shown') ?? false,
      roomOpen: q('#room')?.classList.contains('is-open') ?? false,
    } as const;
  });
}

/** The beat the ruler's status line names, 0-based, or -1. */
function beatOf(state: CardState): number {
  const n = /^Beat (\d+) of/.exec(state.status)?.[1];
  return n === undefined ? -1 : Number(n) - 1;
}

/** What is missing or wrong on the card for `beat`; `sharp` asks for the image itself too. */
function cardProblems(state: CardState, beat: number, sharp: boolean): string[] {
  const b = BEATS[beat];
  if (!b) return [`no beat ${beat}`];
  const problems: string[] = [];
  if (beatOf(state) !== beat) problems.push(`ruler names beat ${beatOf(state) + 1}`);
  if (state.title !== curlyQuotes(b.title)) problems.push(`title '${state.title}'`);
  if (state.paragraphs !== b.paragraphs.length) {
    problems.push(`${state.paragraphs} of ${b.paragraphs.length} paragraphs`);
  }
  if (sharp ? state.image !== 'sharp' : state.image === 'none')
    problems.push(`image ${state.image}`);
  if (!state.roomOpen) problems.push('the room is closed');
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Sessions, network and the page's log

interface Request {
  url: string;
  host: string;
  /** The page load it belongs to (NetLog.loads). */
  epoch: number;
  /** CDP timestamps, in s. */
  start: number;
  end: number | null;
  bytes: number;
  failed: string | null;
  /** Served from the HTTP cache (disk or memory), not the network. */
  cached: boolean;
  /** The script's phase when it started. */
  phase: string;
}

/** Every request the page makes, from CDP, placed on the page's clock by its load's document. */
class NetLog {
  readonly #requests = new Map<string, Request>();
  readonly loads: { epoch: number; ts: number; fetchStart: number; open: number | null }[] = [];
  /** Date.now() of the last start or end on the data host. */
  lastActivity = Date.now();
  /** The script's phase, which each request and console message is filed under. */
  phase = 'load';

  constructor(cdp: CDPSession) {
    cdp.on('Network.requestWillBeSent', (e) => {
      if (e.type === 'Document' && e.requestId === e.loaderId && !e.redirectResponse) {
        this.loads.push({ epoch: this.loads.length, ts: e.timestamp, fetchStart: 0, open: null });
      }
      const host = hostOf(e.request.url);
      if (host === null) return;
      if (host === DATA_HOST) this.lastActivity = Date.now();
      this.#requests.set(e.requestId, {
        url: e.request.url,
        host,
        epoch: Math.max(0, this.loads.length - 1),
        start: e.timestamp,
        end: null,
        bytes: 0,
        failed: null,
        cached: false,
        phase: this.phase,
      });
    });
    cdp.on('Network.requestServedFromCache', (e) => {
      const r = this.#requests.get(e.requestId);
      if (r) r.cached = true;
    });
    cdp.on('Network.responseReceived', (e) => {
      const r = this.#requests.get(e.requestId);
      if (r && (e.response.fromDiskCache || e.response.fromPrefetchCache)) r.cached = true;
    });
    cdp.on('Network.loadingFinished', (e) => {
      const r = this.#requests.get(e.requestId);
      if (!r) return;
      r.end = e.timestamp;
      r.bytes = e.encodedDataLength;
      if (r.host === DATA_HOST) this.lastActivity = Date.now();
    });
    cdp.on('Network.loadingFailed', (e) => {
      const r = this.#requests.get(e.requestId);
      if (!r) return;
      r.end = e.timestamp;
      r.failed = e.canceled ? 'canceled' : e.errorText;
      if (r.host === DATA_HOST) this.lastActivity = Date.now();
    });
  }

  list(): Request[] {
    return [...this.#requests.values()];
  }

  /** A CDP timestamp of `r`'s on its page's clock, in ms. */
  at(r: Request, ts: number): number {
    const load = this.loads[r.epoch];
    return load ? (ts - load.ts) * 1000 + load.fetchStart : NaN;
  }

  /** Data-host requests under way. */
  pending(): number {
    return this.list().filter((r) => r.host === DATA_HOST && r.end === null).length;
  }
}

interface Session {
  page: Page;
  cdp: CDPSession;
  net: NetLog;
  problems: { phase: string; type: string; text: string }[];
  close(): Promise<void>;
}

/**
 * A fresh browser on this Mac's GPU, its page logging, under `condition`. With `profile`, it runs
 * in a new profile folder, whose HTTP cache is on disk as a visitor's is; otherwise in Playwright's
 * off-the-record context, whose cache lives in memory and is small enough that a walk evicts its
 * first beats.
 */
async function openSession(
  condition: Condition,
  { cacheDisabled, profile = false }: { cacheDisabled: boolean; profile?: boolean },
): Promise<Session> {
  const args = ['--use-angle=metal'];
  const options = { viewport: VIEWPORT, deviceScaleFactor: 1 };
  let browser: Browser | null = null;
  let context: BrowserContext;
  let folder: string | null = null;
  if (profile) {
    folder = mkdtempSync(join(tmpdir(), 'wander-e3-'));
    context = await chromium.launchPersistentContext(folder, { args, ...options });
  } else {
    browser = await chromium.launch({ args });
    report.chromium ??= browser.version();
    context = await browser.newContext(options);
  }
  await context.addInitScript(instrument);
  const page = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled });
  await emulate(cdp, condition);
  const close = async () => {
    await context.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (folder) rmSync(folder, { recursive: true, force: true });
  };
  closers.push(close);
  const session: Session = {
    page,
    cdp,
    net: new NetLog(cdp),
    problems: [],
    close,
  };
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    session.problems.push({ phase: session.net.phase, type: message.type(), text: message.text() });
  });
  page.on('pageerror', (error) => {
    session.problems.push({ phase: session.net.phase, type: 'pageerror', text: error.message });
  });
  return session;
}

async function emulate(cdp: CDPSession, condition: Condition): Promise<void> {
  await cdp.send('Network.emulateNetworkConditions', CONDITIONS[condition]);
}

/**
 * The init script: logs the room, the lobby, callouts, the ruler's engraving, input, and what
 * the page fetches from its own host once the room has opened.
 */
function instrument(): void {
  performance.setResourceTimingBufferSize(100_000);
  const log: E3Log = { open: null, lobby: [], callouts: [], ticks: [], inputs: [], appHost: [] };
  window.__e3 = log;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const late = log.open !== null && entry.startTime > log.open;
      if (late && new URL(entry.name).origin === location.origin) log.appHost.push(entry.name);
    }
  }).observe({ type: 'resource', buffered: true });
  const watch = new MutationObserver((records) => {
    const now = performance.now();
    for (const record of records) {
      const target = record.target as Element;
      if (record.attributeName === 'data-lobby') {
        log.lobby.push([now, document.body.dataset.lobby ?? '']);
      } else if (record.attributeName === 'd') {
        if (target.classList.contains('rc-tick') && log.ticks.at(-1) !== now) log.ticks.push(now);
      } else if (target.id === 'room') {
        if (log.open === null && target.classList.contains('is-open')) log.open = now;
      } else if (
        target.classList.contains('walk-callout-inner') &&
        target.classList.contains('shown') &&
        !(record.oldValue ?? '').includes('shown')
      ) {
        log.callouts.push([now, target.textContent ?? '']);
      }
    }
  });
  watch.observe(document, {
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['class', 'd', 'data-lobby'],
  });
  for (const type of ['keydown', 'pointerdown'] as const) {
    addEventListener(
      type,
      (event) => log.inputs.push([performance.now(), 'key' in event ? event.key : type]),
      { capture: true, passive: true },
    );
  }
}

async function readLog(page: Page): Promise<E3Log> {
  const log = await page.evaluate(() => window.__e3);
  if (!log) throw new Error('the init script did not run');
  return log;
}

/** Waits for the room to open, and places the load on the page's clock; returns when it did. */
async function waitOpen(session: Session): Promise<number> {
  const { page, net } = session;
  await page.waitForFunction(() => (window.__e3?.open ?? null) !== null, null, {
    timeout: timeoutMs,
    polling: 100,
  });
  const { open, fetchStart } = await page.evaluate(() => ({
    open: window.__e3?.open ?? NaN,
    fetchStart: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)
      .fetchStart,
  }));
  const load = net.loads.at(-1);
  if (load) Object.assign(load, { fetchStart, open });
  return open;
}

async function waitLobby(page: Page, phase: string): Promise<void> {
  await page.waitForFunction((want) => document.body.dataset.lobby === want, phase, {
    timeout: timeoutMs,
    polling: 100,
  });
}

/**
 * Waits until the data host has been quiet for `quietMs` with nothing in flight, the card's
 * image has come or failed, and it is `notBefore` on the page's clock. Returns when the data host
 * last started or finished a request, on the page's clock, or null after `capMs`.
 */
async function settle(
  session: Session,
  { quietMs = SETTLE_QUIET_MS, capMs = 90_000, notBefore = 0 } = {},
): Promise<number | null> {
  const { page, net } = session;
  await until(page, notBefore);
  const start = Date.now();
  while (Date.now() - start < capMs) {
    const quiet = net.pending() === 0 && Date.now() - net.lastActivity >= quietMs;
    const image = (await card(page)).image;
    if (quiet && image !== 'loading' && image !== 'preview') {
      return (await pageNow(page)) - (Date.now() - net.lastActivity);
    }
    await page.waitForTimeout(250);
  }
  return null;
}

/** Requests to the app's own host after the room opened, on each page load that opened. */
function appHostAfterOpen(net: NetLog): string[] {
  return net
    .list()
    .filter((r) => r.host === APP_HOST)
    .filter((r) => {
      const open = net.loads[r.epoch]?.open;
      return open !== null && open !== undefined && net.at(r, r.start) > open;
    })
    .map((r) => r.url);
}

async function click(page: Page, selector: string): Promise<number> {
  await page.click(selector);
  return lastInput(page, 'pointerdown');
}

async function key(page: Page, name: string): Promise<number> {
  await page.keyboard.press(name);
  return lastInput(page, name);
}

/** When the page saw the last `name` input, on its clock. */
async function lastInput(page: Page, name: string): Promise<number> {
  const inputs = (await readLog(page)).inputs.filter(([, what]) => what === name);
  const last = inputs.at(-1);
  if (!last) throw new Error(`the page saw no ${name}`);
  return last[0];
}

/** The GPU WebGL 2 reports, to show the run drew on this Mac's GPU. */
function gpuName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null;
  });
}

function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/** Waits until `atMs` on the page's clock. */
async function until(page: Page, atMs: number): Promise<void> {
  const now = await pageNow(page);
  if (atMs > now) await page.waitForTimeout(atMs - now);
}

async function shoot(page: Page, name: string): Promise<void> {
  const png = join(out, `${name}.png`);
  await page.screenshot({ path: png });
  shots.push(basename(png));
  console.log(png);
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol.startsWith('http') ? parsed.host : null;
  } catch {
    return null;
  }
}

function median(numbers: number[]): number {
  const sorted = numbers.filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] ?? NaN)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** A seeded generator, so each run presses the same sequence. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// ---------------------------------------------------------------------------------------------
// The run, below the classes it uses

try {
  if (only.has('cold')) report.cold = await coldLoads();
  if (only.has('walk')) report.walk = await walkSession();
  if (only.has('context')) report.contextLoss = await contextLossSession();
  if (only.has('leak')) report.leak = await leakSession();
} finally {
  for (const close of closers) await close();
  report.shots = shots;
  const file = join(resultsDir, `${values.name}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(file);
}
