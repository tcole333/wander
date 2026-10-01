// How Explore's time moves (explore/timeRuler.ts, time/exploreTime.ts): flights between dates, a
// flicked tape's coast, a held arrow's glide, steps that land on the tape's engraved ticks, and the
// span's detents. Pure, so it can be tested without a page or a clock.
import { HISTORICAL, type Calendar } from '../story/dates';
import type { Span } from '../story/ui/format';
import { YEAR_DAYS, type Warp } from './overviewScale';
import { seriesDays, seriesTicks, type Series } from './tapeScale';

/** Where the needle stands and how much the tape shows, days. */
export interface Pose {
  day: number;
  span: number;
}

/**
 * The span's detents, days: the counter's knobs, the up and down arrows and a double click step
 * between them; the wheel and pinch move freely.
 */
export const SPAN_DETENTS: readonly number[] = [
  10,
  YEAR_DAYS / 12,
  YEAR_DAYS / 4,
  ...[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].map((years) => years * YEAR_DAYS),
];

/**
 * The next detent past `span` in `dir` (1 wider, -1 narrower), or the last one either way:
 * within 2% of a detent counts as on it.
 */
export function nextDetent(span: number, dir: 1 | -1): number {
  if (dir > 0) return SPAN_DETENTS.find((d) => d > span * 1.02) ?? SPAN_DETENTS.at(-1)!;
  return SPAN_DETENTS.findLast((d) => d < span / 1.02) ?? SPAN_DETENTS[0]!;
}

export interface FlightTiming {
  /** The shortest and longest flight, seconds. */
  minS: number;
  maxS: number;
  /** The widest the span rises to on the way, days. */
  maxSpan: number;
  /** Reduced motion: a short flight with no rise. */
  reduced?: boolean;
}

/** A flight between poses: how long it takes, and how far its span rises, as a log factor. */
export interface Flight {
  from: Pose;
  to: Pose;
  durationS: number;
  rise: number;
  maxSpan: number;
}

/** A reduced-motion flight's length, seconds. */
export const REDUCED_FLIGHT_S = 0.15;

/**
 * A flight from `from` to `to`: 0.22 + 0.11·log2(1 + distance/span) s within its limits, and at
 * its middle a span (distance/span)^0.6 wider, so the eras passing show, as a camera's flight
 * rises to show the ground passing.
 */
export function planFlight(from: Pose, to: Pose, timing: FlightTiming): Flight {
  const hop = Math.abs(to.day - from.day) / Math.max(from.span, to.span);
  if (timing.reduced) {
    return { from, to, durationS: REDUCED_FLIGHT_S, rise: 0, maxSpan: timing.maxSpan };
  }
  const durationS = Math.min(
    timing.maxS,
    Math.max(timing.minS, timing.minS + 0.11 * Math.log2(1 + hop)),
  );
  return { from, to, durationS, rise: hop > 1 ? 0.6 * Math.log(hop) : 0, maxSpan: timing.maxSpan };
}

/** Eased in and out. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * The pose `t` (0 to 1) of the way through a flight: the date moves evenly on the overview's
 * warp, eased, and the span eases in log space with its rise; the ends are exact.
 */
export function flightAt(flight: Flight, t: number, warp: Warp): Pose {
  const { from, to } = flight;
  if (t <= 0) return from;
  if (t >= 1) return to;
  const e = easeInOut(t);
  const day =
    from.day === to.day
      ? to.day
      : warp.day(warp.u(from.day) + (warp.u(to.day) - warp.u(from.day)) * e);
  const logSpan =
    Math.log(from.span) +
    (Math.log(to.span) - Math.log(from.span)) * e +
    flight.rise * Math.sin(Math.PI * t);
  return { day, span: Math.min(Math.max(flight.maxSpan, from.span, to.span), Math.exp(logSpan)) };
}

/**
 * Where a flight stands once a hand takes the tape `t` of the way through it: at the day it had
 * reached, and the span it was going to, so the pull reads the tape as it will stay.
 */
export function takeOver(flight: Flight, t: number, warp: Warp): Pose {
  return { day: flightAt(flight, t, warp).day, span: flight.to.span };
}

/** The widest span a flight reaches, days: at its middle, for tests and the rise's cap. */
export function peakSpan(flight: Flight, warp: Warp): number {
  let peak = 0;
  for (let k = 0; k <= 64; k += 1) peak = Math.max(peak, flightAt(flight, k / 64, warp).span);
  return peak;
}

/** A flicked tape's coast: its velocity, days a second, and how fast that decays. */
export interface Coast {
  velocity: number;
  tauS: number;
}

/**
 * The coast a release at `velocity` (days a second) starts: it travels velocity·τ in all, held to
 * `maxSpans` spans.
 */
export function flick(velocity: number, span: number, tauS: number, maxSpans: number): Coast {
  const most = (maxSpans * span) / tauS;
  return { velocity: Math.sign(velocity) * Math.min(Math.abs(velocity), most), tauS };
}

/**
 * The coast from `day` after `dtS` seconds within `extent` (its end exclusive): where it got to,
 * and what is left of it, or null once it has run down or met one of history's ends, where it
 * stops. `end` says which end it met, and how fast it was going there, days a second.
 */
export function coastStep(
  day: number,
  coast: Coast,
  dtS: number,
  extent: Span,
  span: number,
): { day: number; coast: Coast | null; end: { velocity: number } | null } {
  const decay = Math.exp(-dtS / coast.tauS);
  const next = day + coast.velocity * coast.tauS * (1 - decay);
  const velocity = coast.velocity * decay;
  const kept = withinDays(next, extent);
  if (kept !== next) return { day: kept, coast: null, end: { velocity } };
  // Run down: slower than a fiftieth of the tape a second.
  if (Math.abs(velocity) < span / 50) return { day: next, coast: null, end: null };
  return { day: next, coast: { ...coast, velocity }, end: null };
}

/** How a held arrow glides: after `delayS`, from `from` to `to` spans a second over `rampS`. */
export interface Glide {
  delayS: number;
  from: number;
  to: number;
  rampS: number;
}

/** A held arrow's pace, spans a second, `heldS` after it went down: nothing before its delay. */
export function glideRate(heldS: number, glide: Glide): number {
  if (heldS < glide.delayS) return 0;
  return glide.from + (glide.to - glide.from) * Math.min(1, (heldS - glide.delayS) / glide.rampS);
}

/** The first tick of `series` past `day` in `dir`: a step lands on an engraved tick. */
export function nextTick(
  day: number,
  dir: 1 | -1,
  series: Series,
  calendar: Calendar = HISTORICAL,
): number {
  const reach = seriesDays(series) * 1.2 + 32;
  for (let far = reach; far < reach * 64; far *= 2) {
    const ticks = seriesTicks(series, { start: day - far, end: day + far }, calendar);
    const next =
      dir > 0 ? ticks.find((d) => d > day + 1e-6) : ticks.findLast((d) => d < day - 1e-6);
    if (next !== undefined) return next;
  }
  return day + dir * seriesDays(series);
}

/**
 * The tick of `series` `count` ticks past `day` in `dir`: a step of whole ticks, which the same
 * step back undoes exactly, however unevenly the ticks fall (a month's days restart at its 1st).
 */
export function ticksOn(
  day: number,
  dir: 1 | -1,
  series: Series,
  count: number,
  calendar: Calendar = HISTORICAL,
): number {
  let at = day;
  for (let k = 0; k < count; k += 1) at = nextTick(at, dir, series, calendar);
  return at;
}

/** The tick of `series` nearest `day`. */
export function nearestTick(day: number, series: Series, calendar: Calendar = HISTORICAL): number {
  const reach = seriesDays(series) * 1.2 + 32;
  const ticks = seriesTicks(series, { start: day - reach, end: day + reach }, calendar);
  let best = day;
  let gap = Infinity;
  for (const d of ticks) {
    if (Math.abs(d - day) < gap) [best, gap] = [d, Math.abs(d - day)];
  }
  return best;
}

/** `day` kept within `extent`, whose end is exclusive: the last day's start at most. */
export function withinDays(day: number, extent: Span): number {
  return Math.min(extent.end - 1, Math.max(extent.start, day));
}
