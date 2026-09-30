// The border steps in time (streaming.md 3.0, Border years; 3.3): each step holds from its year's
// 1 January in the historical calendar, Julian before 15 October 1582, until the next begins, and
// none holds before the first. Previews come in chunks of `per` steps, and a ring cell pairs two
// consecutive steps, the even one in R and the odd in G; a chunk starts at an even step, so a
// cell's two previews never span two chunks. Pure: no three, no fetches.
import type { BorderStepsRelease } from '../data/release';
import { dayFromHistorical, formatHistorical } from '../story/dates';

export class StepsError extends Error {
  override name = 'StepsError';
}

export interface BorderSteps {
  /** Each step's first year, astronomical, ascending. */
  readonly years: readonly number[];
  /** Each step's first day: its year's 1 January as history writes it. */
  readonly firstDays: readonly number[];
  /** Steps a preview chunk holds. */
  readonly per: number;
}

/** The steps of a release's `borderSteps` section, checking that its lists agree. */
export function borderSteps(section: BorderStepsRelease): BorderSteps {
  const { years, keys, bytes, previews } = section;
  if (years.length === 0) throw new StepsError('a borderSteps section with no steps');
  if (keys.length !== years.length || bytes.length !== years.length) {
    throw new StepsError(`${years.length} steps with ${keys.length} keys, ${bytes.length} sizes`);
  }
  for (let i = 1; i < years.length; i += 1) {
    if ((years[i] ?? 0) <= (years[i - 1] ?? 0)) {
      throw new StepsError(`step years out of order at ${i}: ${years[i - 1]}, ${years[i]}`);
    }
  }
  const { per } = previews;
  if (!Number.isInteger(per) || per < 2 || per % 2 !== 0) {
    throw new StepsError(`preview chunks of ${per} steps: a cell's pair would span two`);
  }
  if (previews.keys.length !== Math.ceil(years.length / per)) {
    throw new StepsError(`${previews.keys.length} preview chunks for ${years.length} steps`);
  }
  return { years, firstDays: years.map(firstDay), per };
}

/** A step's first day: its year's 1 January in the historical calendar. */
export function firstDay(year: number): number {
  return dayFromHistorical({ year, month: 1, day: 1 });
}

/** The step that holds on `day`: the last to begin at or before it; null before the first. */
export function stepAt(steps: BorderSteps, day: number): number | null {
  const { firstDays } = steps;
  if (!(day >= (firstDays[0] ?? Infinity))) return null;
  let lo = 0;
  let hi = firstDays.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((firstDays[mid] ?? Infinity) <= day) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The steps either side of `step`, null past either end. */
export function neighbours(
  steps: BorderSteps,
  step: number,
): { before: number | null; after: number | null } {
  return {
    before: step > 0 ? step - 1 : null,
    after: step + 1 < steps.years.length ? step + 1 : null,
  };
}

/** The chunk that holds a step's preview, and the preview's place in it. */
export function chunkOf(steps: BorderSteps, step: number): { chunk: number; index: number } {
  return { chunk: Math.floor(step / steps.per), index: step % steps.per };
}

/**
 * The pair of steps a ring cell holds a step's preview in, and its channel there: 0 (R) for the
 * even step, 1 (G) for the odd.
 */
export function cellOf(step: number): { pair: number; channel: 0 | 1 } {
  return { pair: step >> 1, channel: (step & 1) as 0 | 1 };
}

/** The year plate's words for a step's first year, as history writes it: 'Borders · 44 BCE'. */
export function plateLabel(year: number): string {
  return `Borders · ${formatHistorical(firstDay(year), 'year')}`;
}
