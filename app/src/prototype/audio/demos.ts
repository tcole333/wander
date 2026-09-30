// What the audition plays and renders beyond single triggers: the time ruler scrubbed across
// years or across a month's days, as its detents would sound, a camera flight's whir, a stretch
// of the walk itself, its director and ruler run frame by frame into the walk's score, and a
// stretch of Explore, its free clock, ruler and dive run frame by frame into Explore's score.
import { ClockScore } from '../../audio/clockScore';
import type { SoundEngine } from '../../audio/engine';
import { Detents, whir, type DetentWeight } from '../../audio/voices';
import { paceOf, WalkScore } from '../../audio/walkAudio';
import { tunables } from '../../config/tunables';
import { civilFromDay, dayFromHistorical } from '../../story/dates';
import { beatView, createWalk } from '../../story/director';
import type { Story } from '../../story/story';
import { CraftRuler } from '../../story/ui/rulerCraft';
import { ExploreTime, HISTORY } from '../../time/exploreTime';
import { graduation } from '../../time/tapeScale';
import { WorldClock } from '../../time/worldClock';
import { FreeFlight } from '../../view/freeFlight';
import { ViewControl } from '../../view/viewControl';
import { drawnView, type ViewState } from '../../view/viewState';

/** The ruler scrubbed by this many frames a second, as a drag would move it. */
const FRAMES = 120;

/**
 * The ruler dragged from story day `from` to `to` over `seconds`, easing in and out, with marks
 * at each `unit`: by months, a detent at each month it passes and a heavier one at each year; by
 * days, one at each day and a heavier one at each month and year. The pacer drops those that come
 * too fast. Returns when it ends, on the audio clock.
 */
export function scrub(
  engine: SoundEngine,
  from: number,
  to: number,
  seconds: number,
  at: number,
  unit: 'month' | 'day' = 'month',
): number {
  const detents = new Detents(engine);
  const markOf = (day: number) => {
    if (unit === 'day') return Math.floor(day);
    const { year, month } = civilFromDay(day);
    return year * 12 + month - 1;
  };
  const steps = Math.round(seconds * FRAMES);
  let last = markOf(from);
  for (let k = 1; k <= steps; k += 1) {
    const u = k / steps;
    const mark = markOf(from + (to - from) * u * u * (3 - 2 * u));
    if (mark === last) continue;
    // A mark passed: forward it is the one entered, backward the one left.
    const passed = Math.max(mark, last);
    last = mark;
    detents.play(weightOf(passed, unit), at + u * seconds);
  }
  return at + seconds;
}

/** A mark's detent: the first of a year is a year's, the first of a month a month's. */
function weightOf(mark: number, unit: 'month' | 'day'): DetentWeight {
  if (unit === 'month') return mark % 12 === 0 ? 'year' : 'month';
  const { month, day } = civilFromDay(mark);
  if (day !== 1) return 'day';
  return month === 1 ? 'year' : 'month';
}

/**
 * A camera flight's whir over `seconds`, its pace rising, cruising and falling as the flight's
 * speed does, to a peak of `peak`. Returns when it ends.
 */
export function flight(engine: SoundEngine, seconds: number, at: number, peak = 1): number {
  const sound = whir(engine, at);
  const steps = Math.round(seconds * 30);
  for (let k = 0; k <= steps; k += 1) {
    const u = k / steps;
    sound.setPace(peak * Math.sin(Math.PI * u) ** 0.7, at + u * seconds);
  }
  sound.stop(at + seconds + 0.1);
  return at + seconds;
}

/** The walk's frames a second in walkStretch, as the page draws them. */
const WALK_FPS = 60;

/**
 * A stretch of the walk as it sounds, `seconds` long from `at`: the director flies it frame by
 * frame, with the ruler reading its unit, into the walk's score (audio/walkAudio.ts). It steps
 * from the first beat to the second and lands on its distant cannon, holds there `holdS`, then
 * steps to the third (the clunk, the whir, the ruler's detents) and lands on the eruption. The
 * sound fades out over its last second.
 */
export function walkStretch(
  engine: SoundEngine,
  story: Story,
  seconds: number,
  at: number,
  holdS = 5,
): void {
  const first = story.beats[0];
  if (!first) return;
  const control = new ViewControl(beatView(first));
  control.minKmAt = () => 1;
  const walk = createWalk(story, control, { ready: () => true });
  const ruler = new CraftRuler(walk, story);
  const score = new WalkScore(engine, walk.state(), at);
  const dt = 1 / WALK_FPS;
  let view = drawnView(control.current);
  let landedAt: number | null = null;
  walk.next();
  for (let t = 0; t < seconds - 1; t += dt) {
    const state = walk.state();
    if (state.beat === 1 && state.flight === null) landedAt ??= t;
    if (landedAt !== null && state.beat === 1 && t - landedAt >= holdS) walk.next();
    walk.update(t * 1000, dt);
    control.step(t * 1000, dt);
    const next = walk.state();
    ruler.update(next);
    const drawn = drawnView(control.current);
    score.frame({ state: next, unit: ruler.unit, pace: paceOf(view, drawn, dt), at: at + t, dt });
    view = drawn;
  }
  score.stop(at + seconds - 1);
  ruler.dispose();
  walk.dispose();
}

/** A historical date's day number, astronomical years. */
function historical(year: number, month = 1, day = 1): number {
  return dayFromHistorical({ year, month, day });
}

/** Explore's dive: from the lobby's world view to the world view over Waterloo, kept to 35°. */
const LOBBY_VIEW: ViewState = { lon: 75, lat: 15, viewKm: 30000, tilt: 0, heading: 0 };
const WATERLOO_VIEW: ViewState = { lon: 4.41, lat: 35, viewKm: 30000, tilt: 0, heading: 0 };

/** A step of the stretch: how long it takes, s, and what it does at progress u, eased 0 to 1. */
type Step = [seconds: number, move: (u: number) => void];

/**
 * A stretch of Explore as it sounds, `seconds` long from `at`: the dive onto Waterloo, whirring,
 * then room tone, and the free ruler (ExploreTime, with what its tape engraves, time/tapeScale.ts,
 * run frame by frame into Explore's score, audio/clockScore.ts) dragged a century back and forth
 * at its opening span, by
 * decades; zoomed out and dragged to 3000 BCE, by centuries and millennia; a leap along the tier
 * to 1066, zoomed in to its months and dragged into 1067; zoomed to days and dragged through
 * October; and a leap to history's start. The sound fades out over its last second.
 */
export function exploreStretch(engine: SoundEngine, seconds: number, at: number): void {
  const opening = historical(1815, 6, 18);
  const time = new ExploreTime(new WorldClock(), HISTORY, opening, {
    openYears: tunables.exploreOpenYears,
  });
  const score = new ClockScore(engine, opening);
  const day = () => time.clock.state().day;
  const width = () => time.span.end - time.span.start;

  /** Drags the playhead from wherever the step finds it to `to`, or `to` from there. */
  const drag = (to: number | ((from: number) => number)) => {
    let path: [number, number] | undefined;
    return (u: number) => {
      const from = path?.[0] ?? day();
      path ??= [from, typeof to === 'number' ? to : to(from)];
      time.scrub(path[0] + (path[1] - path[0]) * u);
    };
  };
  /** Leaps the playhead to `to` as the step ends, as the tier or Home does. */
  const leap = (to: number) => (u: number) => {
    if (u === 1) time.seek(to);
  };
  /** Zooms about the playhead until the ruler spans `years`. */
  const zoom = (years: number) => {
    let done = 0;
    let ratio: number | undefined;
    return (u: number) => {
      ratio ??= (years * 365.2425) / width();
      time.zoomBy(ratio ** (u - done));
      done = u;
    };
  };
  const rest = () => {};
  const steps: Step[] = [
    [1.5, rest],
    [2.4, drag(historical(1715, 6))],
    [2, drag(opening)],
    [1.6, zoom(6000)],
    [3.2, drag(historical(-2999, 6))],
    [0.8, rest],
    [0.1, leap(historical(1066, 6, 1))],
    [2, zoom(3)],
    [2.6, drag(historical(1067, 3, 1))],
    [1.4, zoom(0.15)],
    [2, drag((from) => from + 40)],
    [0.8, rest],
    [0.1, leap(HISTORY.start)],
  ];

  const dt = 1 / 60;
  const ease = (u: number) => u * u * (3 - 2 * u);
  let flight: FreeFlight | null = new FreeFlight(LOBBY_VIEW, WATERLOO_VIEW);
  let view = LOBBY_VIEW;
  let step = 0;
  let stepAt = 0;
  for (let t = 0; t < seconds - 1; t += dt) {
    let next = view;
    if (flight) {
      next = flight.step(dt);
      if (flight.done) [flight, stepAt] = [null, t];
    } else if (step < steps.length) {
      const [length, move] = steps[step] ?? [0, rest];
      const u = Math.min(1, (t - stepAt) / Math.max(length, dt));
      move(ease(u));
      if (u === 1) [step, stepAt] = [step + 1, t];
    }
    const { unit, yearStep } = graduation(time.spanDays, time.rulePx, day());
    const clock = { day: day(), unit, yearStep };
    const pace = paceOf(view, next, dt);
    score.frame({ clock, flying: flight !== null, pace, at: at + t, dt });
    view = next;
  }
  score.stop(at + seconds - 1);
}
