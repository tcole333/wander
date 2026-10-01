// Explore's time: the needle's day and how much of history the tape shows (explore/timeRuler.ts),
// published to the world clock. The tape moves and the needle stays still: the span is always
// centred on the day and may run past history's ends, while the day itself stays within history.
// Zoom pivots on the needle, so it never moves the date. Every jump flies (timeMotion.ts), its date
// moving evenly on the overview's warp and its span rising with the distance; a jump longer than
// half a span leaves a return point that back() flies to, swapping the two. A released pull
// coasts, stopping at history's ends with a short rubber band, and a held arrow glides. tick(nowMs)
// runs whatever moves, once a frame. The day is fractional while the tape stands between days.
import { tunables } from '../config/tunables';
import { dayFromHistorical } from '../story/dates';
import type { Span } from '../story/ui/format';
import { overviewWarp, YEAR_DAYS, type Warp } from './overviewScale';
import { graduation, seriesDays } from './tapeScale';
import {
  coastStep,
  easeInOut,
  flick,
  flightAt,
  glideRate,
  nearestTick,
  nextDetent,
  nextTick,
  planFlight,
  takeOver,
  ticksOn,
  withinDays,
  type Coast,
  type Flight,
  type Pose,
} from './timeMotion';
import {
  nowWindow,
  worldClock,
  type DayWindow,
  type WorldClock,
  type WorldTime,
} from './worldClock';

/**
 * Inclusive day limits: all of 10,000 BCE through the last day of 2000 CE, in the historical
 * calendar the ruler engraves (1 January 10,000 BCE in the Julian).
 */
export const HISTORY: Span = Object.freeze({
  start: dayFromHistorical({ year: -9999, month: 1, day: 1 }),
  end: dayFromHistorical({ year: 2000, month: 12, day: 31 }),
});
/** The narrowest and widest the tape shows, days. */
export const MIN_EXPLORE_DAYS = tunables.exploreMinSpanDays;
export const MAX_EXPLORE_DAYS = tunables.exploreMaxSpanYears * YEAR_DAYS;

/**
 * `window` with each end kept within `history`. Near either end of history the ruler's width
 * reaches days Explore does not hold, so whatever asks for events by date asks within it: nothing
 * after 2000 or before 10,000 BCE is marked, kept focal or picked for Meanwhile.
 */
export function withinHistory(window: DayWindow, history: Span = HISTORY): DayWindow {
  return {
    start: clamp(window.start, history.start, history.end),
    end: clamp(window.end, history.start, history.end),
  };
}

/** Explore's now window: the clock's (worldClock.ts, nowWindow), within history. */
export function exploreWindow(time: WorldTime): DayWindow {
  return withinHistory(nowWindow(time));
}

/** The days the tape shows: the clock's span centred on its day, within history. */
export function tapeWindow({ day, spanDays }: WorldTime): DayWindow {
  return withinHistory({ start: day - spanDays / 2, end: day + spanDays / 2 });
}

export interface ExploreTimeOptions {
  /** How many years the tape first shows, centred on the opening day; the widest when absent. */
  openYears?: number;
  /** Whether motion is reduced: flights are short and never rise, and nothing coasts. */
  reducedMotion?: () => boolean;
}

export interface FlyOptions {
  /** A jump: one longer than half a span leaves a return point. */
  jump?: boolean;
  /** A set length instead of the distance's, and a wait before it starts, seconds. */
  durationS?: number;
  delayS?: number;
}

type FlightMotion = { kind: 'flight'; flight: Flight; delayS: number; startMs: number | null };
type Motion =
  | FlightMotion
  | { kind: 'coast'; coast: Coast }
  | { kind: 'spring'; from: number; startMs: number | null }
  | { kind: 'glide'; dir: 1 | -1; downMs: number };

/** A pull past history's end gives way this far at most, as a share of the span. */
const RUBBER = 0.06;
/** The rubber band's spring back, seconds. */
const SPRING_S = 0.3;

export class ExploreTime {
  readonly clock: WorldClock;
  readonly bounds: Span;
  /** History with its last day whole: the end is exclusive. */
  readonly extent: Span;
  /** The overview's scale, on which flights move their date evenly. */
  readonly warp: Warp;
  /** The tape's length, px, which the ruler sets: steps land on the ticks it engraves there. */
  rulePx = 1262;
  readonly #reduced: () => boolean;
  #day: number;
  #span: number;
  /** How far past history's end a pull or a coast has the tape, days; the day stays at the end. */
  #over = 0;
  #motion: Motion | null = null;
  #return: Pose | null = null;
  /** A held arrow's way, and since when, once a frame has seen it. */
  #held: { dir: 1 | -1; sinceMs: number | null } | null = null;
  #nowMs: number | null = null;
  #published = { day: NaN, span: NaN, over: NaN };
  readonly #listeners = new Set<() => void>();

  constructor(
    clock = worldClock,
    bounds = HISTORY,
    day = 0,
    { openYears, reducedMotion = () => false }: ExploreTimeOptions = {},
  ) {
    if (
      !Number.isFinite(bounds.start) ||
      !Number.isFinite(bounds.end) ||
      bounds.end <= bounds.start
    ) {
      throw new RangeError('Exploration needs a finite, increasing span');
    }
    this.clock = clock;
    this.bounds = Object.freeze({ ...bounds });
    this.extent = Object.freeze({ start: bounds.start, end: bounds.end + 1 });
    this.warp = overviewWarp(this.extent, tunables.overviewWarpYears);
    this.#reduced = reducedMotion;
    this.#day = this.#within(Number.isFinite(day) ? day : 0);
    this.#span = this.#spanWithin(
      openYears !== undefined && Number.isFinite(openYears)
        ? openYears * YEAR_DAYS
        : MAX_EXPLORE_DAYS,
    );
    this.#publish();
  }

  /** The days the tape shows: its span centred on the day, which may run past history. */
  get span(): Span {
    return { start: this.#day - this.#span / 2, end: this.#day + this.#span / 2 };
  }

  get spanDays(): number {
    return this.#span;
  }

  /** The needle's day, within history. */
  get day(): number {
    return this.#day;
  }

  /** The tape's middle as drawn: the day, or past history's end while a pull stretches it. */
  get center(): number {
    return this.#day + this.#over;
  }

  /** Something moves the tape on its own: a flight, a coast, a spring or a held arrow's glide. */
  get moving(): boolean {
    return this.#motion !== null;
  }

  /** A flight has the tape. */
  get flying(): boolean {
    return this.#motion?.kind === 'flight';
  }

  /** Where the tape is going: a flight's end, else where it stands. */
  get target(): Pose {
    const motion = this.#motion;
    return motion?.kind === 'flight' ? motion.flight.to : { day: this.#day, span: this.#span };
  }

  /** Where the last long jump left from, which back() flies to, or null. */
  get returnPoint(): Pose | null {
    return this.#return;
  }

  get returnDay(): number | null {
    return this.#return?.day ?? null;
  }

  /** The date, the span or the tape's stretch changed. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Moves the needle `deltaDays` along at once, as a sideways swipe does. */
  pan(deltaDays: number): void {
    if (!Number.isFinite(deltaDays)) return;
    this.interrupt();
    this.#day = this.#within(this.#day + deltaDays);
    this.#over = 0;
    this.#publish();
  }

  /** Puts the needle on `day` at once, keeping the span: the overview's sweep, and scripts. */
  seek(day: number): void {
    if (!Number.isFinite(day)) return;
    this.interrupt();
    this.#day = this.#within(day);
    this.#over = 0;
    this.#publish();
  }

  /** The walks' old name for seek, whole days. */
  scrub(day: number): void {
    if (Number.isFinite(day)) this.seek(Math.floor(day));
  }

  /** Shows `factor` times as much, about the needle, at once: the wheel and a pinch. */
  zoomBy(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.interrupt();
    this.zoomTo(this.#span * factor);
  }

  /** Shows `spanDays` about the needle, at once. */
  zoomTo(spanDays: number): void {
    if (!Number.isFinite(spanDays) || spanDays <= 0) return;
    this.interrupt();
    this.#span = this.#spanWithin(spanDays);
    this.#publish();
  }

  /**
   * A hand takes the tape: a flight hands it over at the span it was going to, and a coast or
   * glide stops where it is.
   */
  interrupt(): void {
    const motion = this.#motion;
    if (!motion) return;
    this.#motion = null;
    this.#held = null;
    if (motion.kind === 'flight') {
      const pose = takeOver(motion.flight, this.#flightT(motion), this.warp);
      [this.#day, this.#span] = [pose.day, pose.span];
      this.#publish();
    }
  }

  /**
   * The tape's middle under a pulling hand: the day follows it within history, and past an end
   * the tape gives way less and less, as a rubber band does.
   */
  drag(center: number): void {
    if (!Number.isFinite(center)) return;
    this.interrupt();
    this.#day = this.#within(center);
    const past = center - this.#day;
    const most = RUBBER * this.#span;
    this.#over = (Math.sign(past) * most * Math.abs(past)) / (Math.abs(past) + most);
    this.#publish();
  }

  /** The hand lets go at `velocity`, days a second: the tape coasts, or springs back to history. */
  release(velocity = 0): void {
    if (this.#over !== 0) {
      this.#motion = { kind: 'spring', from: this.#over, startMs: null };
      return;
    }
    this.fling(velocity);
  }

  /** The tape coasts from `velocity`, days a second; never with reduced motion. */
  fling(velocity: number): void {
    if (!Number.isFinite(velocity) || velocity === 0 || this.#reduced()) return;
    const { timeFlickTauS: tau, timeFlickMaxSpans: most } = tunables;
    this.#motion = { kind: 'coast', coast: flick(velocity, this.#span, tau, most) };
  }

  /**
   * Flies the needle to `day` and the tape to `span`, by default the span it shows or is going to.
   * A jump longer than half a span leaves a return point where it left from.
   */
  fly(
    day: number,
    span = this.target.span,
    { jump = false, durationS, delayS = 0 }: FlyOptions = {},
  ): void {
    if (!Number.isFinite(day) || !Number.isFinite(span)) return;
    const from = this.#pose();
    const reduced = this.#reduced();
    const to = { day: this.#within(day), span: this.#spanWithin(span) };
    if (jump && Math.abs(to.day - from.day) > from.span / 2) this.#return = from;
    const flight = planFlight(from, to, {
      minS: tunables.timeFlightS.min,
      maxS: tunables.timeFlightS.max,
      maxSpan: MAX_EXPLORE_DAYS,
      reduced,
    });
    if (durationS !== undefined && !reduced) flight.durationS = durationS;
    [this.#day, this.#span, this.#over] = [from.day, from.span, 0];
    this.#motion = { kind: 'flight', flight, delayS: reduced ? 0 : delayS, startMs: null };
    this.#publish();
  }

  /**
   * One step from where the tape is going: to the next fine or labelled tick the tape engraves,
   * or a span on. From a labelled tick a span's step moves the whole number of labelled ticks
   * nearest a span, and from anywhere else exactly a span, so a step each way comes back to where
   * it began and repeated steps never drift.
   */
  step(dir: 1 | -1, kind: 'fine' | 'label' | 'span'): void {
    const { day, span } = this.target;
    const grade = graduation(span, this.rulePx, day);
    if (kind === 'span') {
      const label = grade.label;
      if (Math.abs(nearestTick(day, label) - day) >= 1e-6) {
        this.fly(day + dir * span, span);
        return;
      }
      const count = Math.max(1, Math.round(span / seriesDays(label)));
      this.fly(ticksOn(day, dir, label, count), span);
      return;
    }
    const series = kind === 'fine' ? (grade.fine ?? grade.mid ?? grade.label) : grade.label;
    this.fly(nextTick(day, dir, series), span);
  }

  /** One detent wider (1) or narrower (-1), about the needle. */
  detent(dir: 1 | -1): void {
    const { day, span } = this.target;
    this.fly(day, nextDetent(span, dir));
  }

  /** Flies to history's first day or its last, leaving a return point. */
  toEnd(end: 'start' | 'end'): void {
    const day = end === 'start' ? this.bounds.start : this.bounds.end;
    this.fly(day, this.target.span, { jump: true });
  }

  /** Flies back to the return point, which becomes where the tape was: a second press returns. */
  back(): boolean {
    const back = this.#return;
    if (!back) return false;
    this.#return = this.target;
    this.fly(back.day, back.span);
    return true;
  }

  /** A held arrow: a step now, and from the glide's delay a glide that way until letGo(). */
  hold(dir: 1 | -1): void {
    this.step(dir, 'fine');
    this.#held = { dir, sinceMs: null };
  }

  /** The held arrow is let go: a glide eases on to the next fine tick. */
  letGo(): void {
    const held = this.#held;
    this.#held = null;
    if (!held || this.#motion?.kind !== 'glide') return;
    this.#motion = null;
    this.step(held.dir, 'fine');
  }

  /** Runs whatever moves the tape, at `nowMs`: once a frame. */
  tick(nowMs: number): void {
    const last = this.#nowMs;
    this.#nowMs = nowMs;
    const dtS = last === null ? 0 : Math.min(0.1, Math.max(0, (nowMs - last) / 1000));
    const held = this.#held;
    if (held) {
      held.sinceMs ??= nowMs;
      if (nowMs - held.sinceMs >= tunables.timeHoldGlide.delay && this.#motion?.kind !== 'glide') {
        const motion = this.#motion;
        if (motion?.kind === 'flight') {
          const pose = takeOver(motion.flight, this.#flightT(motion), this.warp);
          [this.#day, this.#span] = [pose.day, pose.span];
        }
        this.#motion = { kind: 'glide', dir: held.dir, downMs: held.sinceMs };
      }
    }
    const motion = this.#motion;
    if (!motion) return;
    switch (motion.kind) {
      case 'flight': {
        motion.startMs ??= nowMs + motion.delayS * 1000;
        const t = this.#flightT(motion);
        const pose = flightAt(motion.flight, t, this.warp);
        [this.#day, this.#span] = [pose.day, pose.span];
        if (t >= 1) this.#motion = null;
        break;
      }
      case 'coast': {
        const step = coastStep(this.#day, motion.coast, dtS, this.extent, this.#span);
        this.#day = step.day;
        if (step.coast) motion.coast = step.coast;
        else this.#motion = null;
        if (step.end && !this.#reduced()) {
          // Met history's end: the tape runs on a little and springs back.
          const most = RUBBER * this.#span;
          const run = step.end.velocity * tunables.timeFlickTauS * 0.25;
          this.#over = Math.sign(run) * Math.min(Math.abs(run), most);
          if (this.#over !== 0) this.#motion = { kind: 'spring', from: this.#over, startMs: nowMs };
        }
        break;
      }
      case 'spring': {
        motion.startMs ??= nowMs;
        const t = Math.min(1, (nowMs - motion.startMs) / 1000 / SPRING_S);
        this.#over = motion.from * (1 - easeInOut(t));
        if (t >= 1) [this.#over, this.#motion] = [0, null];
        break;
      }
      case 'glide': {
        const glide = tunables.timeHoldGlide;
        const rate = glideRate((nowMs - motion.downMs) / 1000, {
          delayS: glide.delay / 1000,
          from: glide.from,
          to: glide.to,
          rampS: glide.ramp / 1000,
        });
        const next = this.#day + motion.dir * rate * this.#span * dtS;
        this.#day = this.#within(next);
        if (this.#day !== next) [this.#motion, this.#held] = [null, null];
        break;
      }
    }
    this.#publish();
  }

  /** Where the tape stands now, mid-flight included. */
  #pose(): Pose {
    const motion = this.#motion;
    if (motion?.kind === 'flight') return flightAt(motion.flight, this.#flightT(motion), this.warp);
    return { day: this.#day, span: this.#span };
  }

  #flightT(motion: FlightMotion): number {
    if (motion.startMs === null || this.#nowMs === null) return 0;
    const t = (this.#nowMs - motion.startMs) / 1000 / motion.flight.durationS;
    return Math.min(1, Math.max(0, t));
  }

  #within(day: number): number {
    return withinDays(day, this.extent);
  }

  #spanWithin(span: number): number {
    return clamp(span, MIN_EXPLORE_DAYS, MAX_EXPLORE_DAYS);
  }

  /** Sets the clock, and tells listeners of any change, a stretch past history's end included. */
  #publish(): void {
    this.clock.set(this.#day, this.#span);
    const last = this.#published;
    if (last.day === this.#day && last.span === this.#span && last.over === this.#over) return;
    this.#published = { day: this.#day, span: this.#span, over: this.#over };
    for (const listener of this.#listeners) listener();
  }
}

/** WheelEvent pixel, line and page deltas as pixels. */
export function wheelPixels(delta: number, mode: number, pagePx: number): number {
  return delta * (mode === 1 ? 16 : mode === 2 ? pagePx : 1);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
