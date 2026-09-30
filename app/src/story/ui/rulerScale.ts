// The crafted time ruler's geometry and scale (rulerCraft.ts draws them): the band's circle, the
// radial rows its parts sit on, the span's calendar engraved in two rows, and the whole story in
// whole years on the base plate beneath. Pure, so it can be tested without a page.
// A story's ruler engraves the proleptic Gregorian calendar its dates are written in; Explore's
// engraves the historical one (dates.ts), Julian before 15 October 1582.
import {
  civilFromDay,
  dayFromCivil,
  GREGORIAN,
  HISTORICAL,
  monthName,
  yearLabel,
  type Calendar,
} from '../dates';
import type { StoryBeat } from '../story';
import { calendarYearLabel, monthAbbrev, monthsIn, yearsIn, type Span } from './format';

/** The ruler's box: the view's width, this tall, on the view's foot. */
export const HEIGHT = 170;
/** The knobs: radius to the knurl's tips, and their centers from the side and the foot. */
export const KNOB_R = 50;
export const KNOB_SIDE = 86;
export const KNOB_FOOT = 64;
/** How far the band's middle rises above its ends. */
export const SAG = 22;
/**
 * Radial offsets from the band's center line, up positive: the band's half width, the rows of
 * its engraving (baselines), and the rail's edges.
 */
export const BAND = 22;
/** The band's top face, above it, catching the lamp. */
export const LIP = 4.5;
export const UPPER_ROW = 5;
export const LOWER_ROW = -17.5;
export const RAIL_TOP = -25;
export const RAIL_FOOT = -55;
/** On the rail: the studs' centers, and the baseline of each one's numeral beneath it. */
export const STUD_AT = -35;
export const NUMERAL_ROW = -50.5;
/** The base plate under the rail runs this far below it, past the view's foot. */
export const BASE = 60;
/**
 * The story tier on the base plate: its rule (on which the beats' dots sit), and the baseline of
 * its years. It spans this share of the rule, where the band sags least.
 */
export const TIER_RULE = -60;
export const TIER_ROW = -71;
export const TIER_REACH = 0.6;
/** The rule stops this far short of each knob's rim. */
export const RULE_MARGIN = 22;

/** The least widths, px, for a day's tick, a day's number, a month's name, and a year's. */
const DAY_TICK_PX = 6;
const DAY_LABEL_PX = 19;
const MONTH_LABEL_PX = 46;
const YEAR_LABEL_PX = 44;
/** A month named with its year needs this much of it on the rule. */
const MONTH_YEAR_LABEL_PX = 110;
/** Where every day's number would crowd, every fifth, tenth or fifteenth is numbered, this far apart. */
const DAY_STEPS = [5, 10, 15];
const DAY_STEP_PX = 42;

/** The band's circle: center, center-line radius, and the half-angles of the rule and of the band. */
export interface Arc {
  width: number;
  cx: number;
  cy: number;
  r: number;
  reach: number;
  end: number;
}

export function arcFor(width: number): Arc {
  const half = width / 2 - KNOB_SIDE;
  const r = (half * half + SAG * SAG) / (2 * SAG);
  const apexY = HEIGHT - KNOB_FOOT - SAG;
  return {
    width,
    cx: width / 2,
    cy: apexY + r,
    r,
    reach: Math.asin((half - KNOB_R - RULE_MARGIN) / r),
    end: Math.asin(half / r),
  };
}

/** The point at `angle` on the circle `dr` above the band's center line. */
export function at(arc: Arc, angle: number, dr = 0): [number, number] {
  const r = arc.r + dr;
  return [arc.cx + r * Math.sin(angle), arc.cy - r * Math.cos(angle)];
}

/** The ring's stretch from a0 to a1 between the radial offsets `inner` and `outer`. */
export function sector(arc: Arc, a0: number, a1: number, inner: number, outer: number): string {
  const [x0, y0] = at(arc, a0, outer);
  const [x1, y1] = at(arc, a1, outer);
  const [x2, y2] = at(arc, a1, inner);
  const [x3, y3] = at(arc, a0, inner);
  const [ro, ri] = [arc.r + outer, arc.r + inner];
  return (
    `M${f(x0)} ${f(y0)}A${f(ro)} ${f(ro)} 0 0 1 ${f(x1)} ${f(y1)}` +
    `L${f(x2)} ${f(y2)}A${f(ri)} ${f(ri)} 0 0 0 ${f(x3)} ${f(y3)}Z`
  );
}

/** An arc along the band from a0 to a1, `dr` above its center line. */
export function along(arc: Arc, a0: number, a1: number, dr: number): string {
  const [x0, y0] = at(arc, a0, dr);
  const [x1, y1] = at(arc, a1, dr);
  const r = arc.r + dr;
  return `M${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(y1)}`;
}

/** A tick across the band at `angle`, from one radial offset to another. */
export function radial(arc: Arc, angle: number, from: number, to: number): string {
  const [x0, y0] = at(arc, angle, from);
  const [x1, y1] = at(arc, angle, to);
  return `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`;
}

/**
 * The span moved, if need be, so `day` lies at least `margin` of its width from either end: the
 * plaque over the playhead then always has room on the rule, and never leaves it.
 */
export function anchored(span: Span, day: number, margin: number): Span {
  const width = span.end - span.start;
  const share = (day - span.start) / width;
  const kept = Math.min(1 - margin, Math.max(margin, share));
  if (kept === share) return span;
  const start = day - kept * width;
  return { start, end: start + width };
}

export type TickKind = 'full' | 'major' | 'minor';
export const TICK_KINDS: TickKind[] = ['full', 'major', 'minor'];

/**
 * A label on the band: what it names (its key), where, in which row and face; and for the upper
 * row, the angles of the part of its unit on the rule, within which it may move aside.
 */
export interface Label {
  key: string;
  angle: number;
  /** A coarse tick stays at its date even when its label moves aside. */
  tickAngle?: number;
  row: number;
  text: string;
  cls: string;
  anchor?: 'start' | 'middle' | 'end';
  from?: number;
  to?: number;
}

export interface Scale extends Record<TickKind, string> {
  labels: Label[];
}

/**
 * The finest calendar unit with room on the band, from days through millennia.
 */
export type RulerUnit = 'day' | 'month' | 'year' | 'decade' | 'century' | 'millennium';

export function engravedUnit(arc: Arc, span: Span, calendar: Calendar = GREGORIAN): RulerUnit {
  const pxPerDay = (2 * arc.reach * arc.r) / (span.end - span.start);
  if (pxPerDay >= DAY_TICK_PX) return 'day';
  if (pxPerDay * 28 * 3 >= MONTH_LABEL_PX) return 'month';
  const step = yearStep(arc, span, calendar);
  return step >= 1000 ? 'millennium' : step >= 100 ? 'century' : step >= 10 ? 'decade' : 'year';
}

/**
 * The years between the years the band labels: one where it engraves days or months, which name
 * every year they reach, else the step of its year labels.
 */
export function labelledYearStep(arc: Arc, span: Span, calendar: Calendar = GREGORIAN): number {
  const unit = engravedUnit(arc, span, calendar);
  return unit === 'day' || unit === 'month' ? 1 : yearStep(arc, span, calendar);
}

/** A 1/2/5 calendar interval large enough for its year labels at the view's actual width. */
function yearStep(arc: Arc, span: Span, calendar: Calendar): number {
  const era = span.start < 0 && span.end >= 0;
  const chars = Math.max(
    ...[span.start, span.end].map((day) => calendarYearLabel(calendar.civil(day).year, era).length),
  );
  const needed =
    (((span.end - span.start) / 365.2425) * Math.max(60, chars * 12 + 12)) /
    (2 * arc.reach * arc.r);
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(needed)));
  return ([1, 2, 5, 10].find((n) => n * magnitude >= needed) ?? 10) * magnitude;
}

/**
 * Days and months retain the walk's two rows. Years and coarser spans use whole calendar
 * years, stepping by 1/2/5 multiples of years, decades, centuries or millennia as needed. Days,
 * months and years are `calendar`'s: in the historical one, 4 October 1582 is followed by the 15th.
 * `extent` is the whole stretch the ruler can show, whose own ends are named wherever they fit.
 */
export function engraveScale(
  arc: Arc,
  span: Span,
  angle: (day: number) => number,
  calendar: Calendar = GREGORIAN,
  extent?: Span,
): Scale {
  const scale: Scale = { full: '', major: '', minor: '', labels: [] };
  const pxPerDay = (2 * arc.reach * arc.r) / (span.end - span.start);
  const unit = engravedUnit(arc, span, calendar);
  const yearText = (year: number) => calendarYearLabel(year, span.start < 0 && span.end >= 0);
  const yearWidth = (year: number) =>
    year <= 0 || (span.start < 0 && span.end >= 0)
      ? Math.max(YEAR_LABEL_PX, yearText(year).length * 12)
      : YEAR_LABEL_PX;
  const inRule = (day: number) => day >= span.start && day <= span.end;
  const edges = (a: number, length: number) =>
    radial(arc, a, BAND - 1, BAND - 1 - length) + radial(arc, a, -BAND + 1, -BAND + 1 + length);
  /** Names the stretch [from, to) at the middle of the part of it on the rule, if that is wide enough. */
  const name = (
    key: string,
    from: number,
    to: number,
    row: number,
    text: string,
    cls: string,
    least: number,
  ) => {
    const a0 = angle(Math.max(from, span.start));
    const a1 = angle(Math.min(to, span.end));
    if ((a1 - a0) * arc.r < least) return;
    const label: Label = { key, angle: (a0 + a1) / 2, row, text, cls };
    if (row > 0) Object.assign(label, { from: a0, to: a1 });
    scale.labels.push(label);
  };

  // Months are visited only when their ticks have room. At millennia this never enumerates
  // the intervening years or months: yearStep jumps directly between the marks to engrave.
  const months = pxPerDay * 28 >= 4 ? monthsIn(span, 1, calendar) : [];
  for (const month of months) {
    if (!inRule(month.start)) continue;
    if (month.month === 1) scale.full += radial(arc, angle(month.start), -BAND + 1, BAND - 1);
    else if (pxPerDay * 28 >= 4) scale.major += edges(angle(month.start), 7);
  }
  if (unit === 'day') {
    // Days, numbered as often as they fit, under each month named with its year.
    const step =
      pxPerDay >= DAY_LABEL_PX ? 1 : (DAY_STEPS.find((s) => s * pxPerDay >= DAY_STEP_PX) ?? 30);
    for (let day = Math.ceil(span.start); day < span.end; day += 1) {
      const date = calendar.civil(day).day;
      const numbered =
        step === 1 || (date === 1 && step >= 5) || (date % step === 0 && date <= 30 - step / 2);
      if (date !== 1) scale.minor += edges(angle(day), numbered && step > 1 ? 6 : 4);
      if (numbered && inRule(day + 0.5)) {
        const text = String(date);
        scale.labels.push({
          key: `d${day}`,
          angle: angle(day + 0.5),
          row: LOWER_ROW,
          text,
          cls: 'rc-day',
        });
      }
    }
    for (const month of months) {
      const text = `${monthName(month.month)} ${yearText(month.year)}`.toUpperCase();
      name(
        `u${month.start}`,
        month.start,
        month.end,
        UPPER_ROW,
        text,
        'rc-upper',
        month.year <= 0 || (span.start < 0 && span.end >= 0)
          ? Math.max(MONTH_YEAR_LABEL_PX, text.length * 10)
          : MONTH_YEAR_LABEL_PX,
      );
    }
  } else if (unit === 'month') {
    // Months, each with a fine tick at its middle and named, or where that crowds, every third
    // (January, April, July, October), under each year.
    const every = pxPerDay * 30 >= MONTH_LABEL_PX ? 1 : 3;
    for (const month of months) {
      const mid = (month.start + month.end) / 2;
      if (inRule(mid)) scale.minor += edges(angle(mid), 4);
      if ((month.month - 1) % every !== 0) continue;
      const text = monthAbbrev(month.month).toUpperCase();
      const least = Math.min(MONTH_LABEL_PX, 28);
      name(`m${month.start}`, month.start, month.end, LOWER_ROW, text, 'rc-month', least);
    }
    for (const year of yearsIn(span, 1, calendar)) {
      const text = yearText(year.year);
      name(
        `Y${year.start}`,
        year.start,
        year.end,
        UPPER_ROW - 3,
        text,
        'rc-upper is-year',
        yearWidth(year.year),
      );
    }
  } else {
    const step = yearStep(arc, span, calendar);
    for (const year of yearsIn(span, step, calendar)) {
      const text = yearText(year.year);
      if (inRule(year.start) && months.length === 0) {
        scale.full += radial(arc, angle(year.start), -BAND + 1, BAND - 1);
      }
      if (step === 1) {
        name(
          `y${year.start}`,
          year.start,
          year.end,
          LOWER_ROW,
          text,
          'rc-year',
          yearWidth(year.year),
        );
      } else if (inRule(year.start) && year.start < span.end) {
        const a = angle(year.start);
        const half = (text.length * 6) / arc.r;
        const anchor = a - half < -arc.reach ? 'start' : a + half > arc.reach ? 'end' : 'middle';
        scale.labels.push({
          key: `c${year.start}`,
          angle: a,
          row: LOWER_ROW,
          text,
          cls: 'rc-year',
          anchor,
        });
      }
    }
    if (step > 1) {
      // Round calendar ticks take precedence. An unround edge is named only where it keeps its
      // own length of bare rule from every tick label, so it reads as the rule's end rather than
      // crowding the round year beside it, though the extent's own ends (history's) need only
      // fit; the exclusive end never names a new year.
      for (const [day, anchor] of [
        [span.start, 'start'],
        [span.end, 'end'],
      ] as const) {
        const text = yearText(calendar.civil(anchor === 'end' ? Math.ceil(day) - 1 : day).year);
        if (scale.labels.some((label) => label.text === text)) continue;
        const edge: Label = {
          key: `e${day}`,
          angle: angle(day),
          row: LOWER_ROW,
          text,
          cls: 'rc-year',
          anchor,
        };
        const [left, right] = yearLabelEdges(arc, edge);
        const bound =
          extent !== undefined && (anchor === 'start' ? day <= extent.start : day >= extent.end);
        const clear = bound ? 4 : right - left;
        if (
          scale.labels.some((label) => {
            const [a, b] = yearLabelEdges(arc, label);
            return left < b + clear && right + clear > a;
          })
        )
          continue;
        scale.major += edges(angle(day), 7);
        scale.labels.push(edge);
      }
      scale.labels = spaceYears(arc, scale.labels);
    }
  }
  return scale;
}

/** Conservative text extents along the rule, including the face's letter spacing. */
function yearLabelEdges(arc: Arc, label: Label): [number, number] {
  const width = label.text.length * 12;
  const left =
    label.angle * arc.r - width * (label.anchor === 'start' ? 0 : label.anchor === 'end' ? 1 : 0.5);
  return [left, left + width];
}

/** Nudge neighboring labels apart when an edge label turns inward; their ticks stay put. */
function spaceYears(arc: Arc, labels: Label[]): Label[] {
  const positions = labels
    .sort((a, b) => a.angle - b.angle)
    .map((label) => {
      const [left, right] = yearLabelEdges(arc, label);
      return { label, left, width: right - left };
    });
  let edge = -arc.reach * arc.r;
  for (const position of positions) {
    position.left = Math.max(edge, position.left);
    edge = position.left + position.width + 4;
  }
  edge = arc.reach * arc.r;
  for (const position of [...positions].reverse()) {
    position.left = Math.min(position.left, edge - position.width);
    edge = position.left - 4;
  }
  return positions.map(({ label, left, width }) => ({
    ...label,
    tickAngle: label.angle,
    anchor: 'middle',
    angle: (left + width / 2) / arc.r,
  }));
}

/** The story's whole years: from the first of the year its first date falls in, to the end of the last's. */
export function storyYears(beats: StoryBeat[]): Span {
  const days = beats.flatMap((beat) => beat.window);
  const first = civilFromDay(Math.min(...days)).year;
  const last = civilFromDay(Math.max(...days)).year;
  return {
    start: dayFromCivil({ year: first, month: 1, day: 1 }),
    end: dayFromCivil({ year: last + 1, month: 1, day: 1 }),
  };
}

/** The story tier's angle for a day: the story's years map onto the tier's share of the rule. */
export function tierAngle(arc: Arc, story: Span, day: number): number {
  const t = Math.min(1, Math.max(0, (day - story.start) / (story.end - story.start)));
  return (2 * t - 1) * arc.reach * TIER_REACH;
}

/**
 * The story tier's engraving, which changes only with the view's size: a tick at each month (a
 * longer one at each year), and each year named under the middle of its stretch.
 */
export function engraveTier(
  arc: Arc,
  story: Span,
): { years: string; months: string; labels: Label[] } {
  const tier = { years: '', months: '', labels: [] as Label[] };
  for (const month of monthsIn(story)) {
    const a = tierAngle(arc, story, month.start);
    if (month.month === 1) tier.years += radial(arc, a, TIER_RULE, TIER_RULE - 8);
    else tier.months += radial(arc, a, TIER_RULE, TIER_RULE - 3.5);
  }
  tier.years += radial(arc, tierAngle(arc, story, story.end), TIER_RULE, TIER_RULE - 8);
  for (const year of yearsIn({ start: story.start, end: story.end - 1 })) {
    const angle = (tierAngle(arc, story, year.start) + tierAngle(arc, story, year.end)) / 2;
    tier.labels.push({
      key: `t${year.start}`,
      angle,
      row: TIER_ROW,
      text: yearLabel(year.year),
      cls: 'rc-tier-year',
    });
  }
  return tier;
}

/**
 * Exploration's overview uses bounded intervals of the historical calendar; story tiers always
 * name every year.
 */
export function engraveHistoryTier(arc: Arc, history: Span): ReturnType<typeof engraveTier> {
  const tier = { years: '', months: '', labels: [] as Label[] };
  const tierArc = { ...arc, reach: arc.reach * TIER_REACH };
  const scale = engraveScale(
    tierArc,
    history,
    (day) => tierAngle(arc, history, day),
    HISTORICAL,
    history,
  );
  for (const label of scale.labels) {
    tier.years += radial(arc, label.tickAngle ?? label.angle, TIER_RULE, TIER_RULE - 8);
    tier.labels.push({ ...label, row: TIER_ROW, cls: 'rc-tier-year' });
  }
  return tier;
}

const ROMAN: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function roman(n: number): string {
  let out = '';
  for (const [value, numeral] of ROMAN) {
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  }
  return out;
}

export function deg(angle: number): number {
  return (angle * 180) / Math.PI;
}

export function f(x: number, digits = 1): string {
  return x.toFixed(digits);
}
