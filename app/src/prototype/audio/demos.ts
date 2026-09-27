// What the audition plays and renders beyond single triggers: the time ruler scrubbed across
// years, as its detents would sound, and a camera flight's whir.
import type { SoundEngine } from '../../audio/engine';
import { Detents, whir } from '../../audio/voices';
import { civilFromDay } from '../../story/dates';

/** The ruler scrubbed by this many frames a second, as a drag would move it. */
const FRAMES = 120;

/**
 * The ruler dragged from story day `from` to `to` over `seconds`, easing in and out: a detent at
 * each month it passes and a heavier one at each year. The pacer drops those that come too fast.
 * Returns when it ends, on the audio clock.
 */
export function scrub(
  engine: SoundEngine,
  from: number,
  to: number,
  seconds: number,
  at: number,
): number {
  const detents = new Detents(engine);
  const monthOf = (day: number) => {
    const { year, month } = civilFromDay(day);
    return year * 12 + month - 1;
  };
  const steps = Math.round(seconds * FRAMES);
  let last = monthOf(from);
  for (let k = 1; k <= steps; k += 1) {
    const u = k / steps;
    const month = monthOf(from + (to - from) * u * u * (3 - 2 * u));
    if (month === last) continue;
    // A mark passed: forward it is the month entered, backward the month left.
    const mark = Math.max(month, last);
    last = month;
    detents.play(mark % 12 === 0 ? 'year' : 'month', at + (k / steps) * seconds);
  }
  return at + seconds;
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
