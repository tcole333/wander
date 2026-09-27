// What the audition plays and renders beyond single triggers: the time ruler scrubbed across
// years or across a month's days, as its detents would sound, and a camera flight's whir.
import type { SoundEngine } from '../../audio/engine';
import { Detents, whir, type DetentWeight } from '../../audio/voices';
import { civilFromDay } from '../../story/dates';

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
