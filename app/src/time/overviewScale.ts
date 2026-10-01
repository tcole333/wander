// Explore's overview (explore/timeRuler.ts): all of history on the ruler's lower strip, on a
// logarithmic scale in the years before 2000's end plus overviewWarpYears, as a slide rule is
// graduated. The recent past, where the index is dense, opens out and the deep past closes up, so
// the convention shows (globe-language.md, principle 1): 1 CE falls about a third of the way
// along, 1500 near two thirds. The warp, its ticks and names, the lens over the stretch the tape
// shows, and the rider's year under a pointer. Pure, so it can be tested without a page.
import { HISTORICAL, type Calendar } from '../story/dates';
import { yearsIn, type Span } from '../story/ui/format';

/** Mean Gregorian days in a year. */
export const YEAR_DAYS = 365.2425;

/** The overview's scale: 0 at history's first day, 1 at the end of its last. */
export interface Warp {
  u(day: number): number;
  day(u: number): number;
  /** Days per unit of u at `day`, the scale's local density. */
  daysPerU(day: number): number;
}

/**
 * The warp over `extent` (its end exclusive): u grows with the log of the days before the end
 * plus `warpYears`, so a year near the end is as long as `warpYears` years at the start would be
 * on a scale `warpYears` shorter.
 */
export function overviewWarp(extent: Span, warpYears: number): Warp {
  const end = extent.end;
  const c = warpYears * YEAR_DAYS;
  const whole = end - extent.start + c;
  const log = Math.log(whole / c);
  const within = (day: number) => Math.min(end, Math.max(extent.start, day));
  return {
    u: (day) => Math.log(whole / (end - within(day) + c)) / log,
    day: (u) => end + c - whole * Math.exp(-Math.min(1, Math.max(0, u)) * log),
    daysPerU: (day) => (end - within(day) + c) * log,
  };
}

/** A graduation on the overview: its day, its kind, and its length and weight, px. */
export interface OverviewTick {
  day: number;
  kind: 'millennium' | 'century' | 'decade' | 'era' | 'end';
  length: number;
  width: number;
}

/** Centuries and decades are cut only where they stay this far apart, px. */
const TICK_GAP_PX = 4.5;

/**
 * The overview's graduations along `lengthPx`: history's ends and each millennium, 1 CE as a
 * double rule (the era's seam), and the centuries and decades wherever they stay TICK_GAP_PX
 * apart. Years are the historical calendar's.
 */
export function overviewTicks(
  warp: Warp,
  extent: Span,
  lengthPx: number,
  calendar: Calendar = HISTORICAL,
): OverviewTick[] {
  const px = (day: number) => warp.u(day) * lengthPx;
  const ticks: OverviewTick[] = [
    { day: extent.start, kind: 'end', length: 9, width: 1.2 },
    { day: extent.end, kind: 'end', length: 9, width: 1.2 },
  ];
  const taken = new Set<number>([extent.start, extent.end]);
  const add = (day: number, kind: OverviewTick['kind'], length: number, width: number) => {
    if (taken.has(day) || day < extent.start || day > extent.end) return;
    // The last millennium's tick would stand a few px from history's end, which marks it.
    if (px(extent.end) - px(day) < 2 * TICK_GAP_PX) return;
    taken.add(day);
    ticks.push({ day, kind, length, width });
  };
  const era = calendar.day({ year: 1, month: 1, day: 1 });
  add(era, 'era', 8, 0.7);
  for (const year of yearsIn(extent, 1000, calendar)) add(year.start, 'millennium', 7, 1);
  for (const [step, kind, length, width] of [
    [100, 'century', 4, 0.8],
    [10, 'decade', 2.5, 0.6],
  ] as const) {
    for (const year of yearsIn(extent, step, calendar)) {
      if (px(year.end) - px(year.start) < TICK_GAP_PX) continue;
      add(year.start, kind, length, width);
    }
  }
  return ticks.sort((a, b) => a.day - b.day);
}

/** A name engraved on the overview: its words, its day, how it sits there, and its extent, px. */
export interface OverviewName {
  text: string;
  day: number;
  anchor: 'start' | 'middle' | 'end';
  left: number;
  right: number;
}

/**
 * The overview's names by priority: history's ends first, then the era's seam, then the years
 * that open the eras a visitor looks for. Calendar names only.
 */
const NAMES: readonly (readonly [year: number | 'end', text: string])[] = [
  [-9999, '10,000 BCE'],
  ['end', '2000'],
  [1, '1 CE'],
  [1500, '1500'],
  [1000, '1000'],
  [1800, '1800'],
  [1900, '1900'],
  [-4999, '5000 BCE'],
  [-2999, '3000 BCE'],
  [-999, '1000 BCE'],
  [500, '500'],
  [1700, '1700'],
  [1600, '1600'],
  [1200, '1200'],
  [1950, '1950'],
  [-1999, '2000 BCE'],
  [-6999, '7000 BCE'],
  [1300, '1300'],
  [1400, '1400'],
  [1100, '1100'],
  [1850, '1850'],
  [-499, '500 BCE'],
  [1750, '1750'],
  [1650, '1650'],
];

/** Names keep this far apart, px. */
const NAME_GAP_PX = 9;
/** A name's letters at the overview's 9.5 px caps and their spacing, px, generously. */
export const NAME_CHAR_PX = 6.8;

/**
 * The names that fit along `lengthPx`, taken by priority, each clear of those already taken by
 * NAME_GAP_PX: history's start reads from its end inward, and its end back from it.
 */
export function overviewNames(
  warp: Warp,
  extent: Span,
  lengthPx: number,
  calendar: Calendar = HISTORICAL,
  charPx = NAME_CHAR_PX,
): OverviewName[] {
  const names: OverviewName[] = [];
  for (const [year, text] of NAMES) {
    const day = year === 'end' ? extent.end : calendar.day({ year, month: 1, day: 1 });
    const anchor = day <= extent.start ? 'start' : day >= extent.end ? 'end' : 'middle';
    const x = warp.u(day) * lengthPx;
    const width = text.length * charPx;
    const left = anchor === 'start' ? x + 3 : anchor === 'end' ? x - 3 - width : x - width / 2;
    const right = left + width;
    if (names.some((name) => left < name.right + NAME_GAP_PX && right > name.left - NAME_GAP_PX))
      continue;
    names.push({ text, day, anchor, left, right });
  }
  return names.sort((a, b) => a.day - b.day);
}

/** The lens's extent in u: the tape's days, at least `minPx` wide about the needle's day. */
export function lensExtent(
  warp: Warp,
  day: number,
  spanDays: number,
  lengthPx: number,
  minPx = 12,
): { u0: number; u1: number; u: number } {
  const u = warp.u(day);
  let [u0, u1] = [warp.u(day - spanDays / 2), warp.u(day + spanDays / 2)];
  const least = minPx / lengthPx;
  if (u1 - u0 < least) {
    [u0, u1] = [u - least / 2, u + least / 2];
    if (u0 < 0) [u0, u1] = [0, least];
    if (u1 > 1) [u0, u1] = [1 - least, 1];
  }
  return { u0, u1, u };
}

/** The rider's year: a name a pixel there can tell from the next. */
export interface RiderYear {
  /** Astronomical year, as the calendar counts. */
  year: number;
  /** The years between names where it stands, one of RIDER_STEPS. */
  step: number;
  /** Its middle day, where a press flies. */
  day: number;
  text: string;
}

/**
 * The years the rider's names keep apart. Wider than 50 only on a narrow view, whose overview
 * holds more years to a pixel in the deep past.
 */
export const RIDER_STEPS: readonly number[] = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/**
 * The year the rider names at `u` on an overview `lengthPx` long. Its names are the years, as
 * history numbers them, that are multiples of the finest of RIDER_STEPS at least the years a pixel
 * holds where each stands, with 1 BCE and 1 CE either side of the era's seam; the rider names the
 * one nearest the pointer's year. As the pointer moves a pixel the name moves a name at most, and
 * never back against it, even where the step changes, so every name is one a pointer at whole
 * pixels can reach.
 */
export function riderYear(
  warp: Warp,
  extent: Span,
  u: number,
  lengthPx: number,
  calendar: Calendar = HISTORICAL,
): RiderYear {
  const first = calendar.civil(extent.start).year;
  const last = calendar.civil(extent.end - 1).year;
  const stepAt = (day: number) => {
    const yearsPerPx = warp.daysPerU(day) / lengthPx / YEAR_DAYS;
    return RIDER_STEPS.find((s) => s >= yearsPerPx) ?? RIDER_STEPS.at(-1)!;
  };
  // Years as history numbers them, BCE negative and no year 0, so a step's multiples are names.
  const toYear = (n: number) => (n < 0 ? n + 1 : n);
  const isName = (n: number) =>
    Math.abs(n) === 1 || n % stepAt(middleDay(toYear(n), calendar)) === 0;
  const at = Math.min(extent.end - 1, Math.max(extent.start, warp.day(u)));
  const exact = calendar.civil(at).year;
  const n = exact <= 0 ? exact - 1 : exact;
  // The nearest name each way, which is never more than the coarser step there away.
  const near = (dir: 1 | -1) => {
    let k = n;
    while (!isName(k)) k += k + dir === 0 ? 2 * dir : dir;
    return Math.min(last, Math.max(first, toYear(k)));
  };
  const [before, after] = [near(-1), near(1)];
  // A tie goes away from the era's seam: 500 BCE, not 490 BCE, from 495 BCE.
  const [down, up] = [exact - before, after - exact];
  const year = up < down || (up === down && exact > 0) ? after : before;
  const day = middleDay(year, calendar);
  return { year, step: stepAt(day), day, text: riderText(year) };
}

/** The rider over a mark on the overview: the year of the day a press there flies to. */
export function riderOn(day: number, calendar: Calendar = HISTORICAL): RiderYear {
  const year = calendar.civil(day).year;
  return { year, step: 1, day, text: riderText(year) };
}

/** A year's middle day in `calendar`. */
export function middleDay(year: number, calendar: Calendar = HISTORICAL): number {
  const start = calendar.day({ year, month: 1, day: 1 });
  const end = calendar.day({ year: year + 1, month: 1, day: 1 });
  return Math.floor((start + end) / 2);
}

/** A year as the rider names it: BCE before 1 CE, and CE through 999 so a short year reads. */
function riderText(year: number): string {
  if (year <= 0) return `${groupDigits(1 - year)} BCE`;
  return year < 1000 ? `${year} CE` : String(year);
}

/** Digits grouped by thousands from 10,000 up, as history writes 10,000 BCE. */
export function groupDigits(n: number): string {
  return n >= 10_000 ? n.toLocaleString('en-US') : String(n);
}
