// Explore's tape (explore/timeRuler.ts): the linear scale of the stretch the ruler shows, engraved
// in the historical calendar (story/dates.ts), Julian before 15 October 1582. Graduations hang
// from its top edge in three tiers: labelled ticks at a 1/2/5 step of days, months or years,
// ticks at half that step, and the finest of a tenth, fifth or half of it that stays FINE_PX apart
// and is a whole day, month or year. Labels stand under the labelled ticks, one even rhythm with
// no end labels: at month scale January is named by its year, and at day scale each month's 1st
// carries the month. Past history's ends the tape runs on as a leader, unengraved, behind a stop
// labelled with history's first or last year. Pure, so it can be tested without a page.
import { HISTORICAL, monthName, type Calendar, type Precision } from '../story/dates';
import { calendarYearLabel, monthAbbrev, monthsIn, yearsIn, type Span } from '../story/ui/format';
import { groupDigits, YEAR_DAYS } from './overviewScale';

/** The labels and ticks fade over this many px at each reel, so they slide in and out. */
export const TAPE_FADE_PX = 46;
/** Fine ticks stay at least this far apart, px. */
export const FINE_PX = 6;
/** Labels keep this far apart, px. */
const LABEL_GAP_PX = 10;
/** Month-scale labels need this much of the tape, px: a month's three letters and room. */
const MONTH_NEED_PX = 44;
/** Day numerals need this much, and a month this much, so its name on its 1st reads. */
const DAY_NEED_PX = 30;
const DAY_MONTH_PX = 160;
/** Mean days in a month. */
const MONTH_DAYS = YEAR_DAYS / 12;

/** A calendar graduation: every `every` days of a month, months from January, or years. */
export interface Series {
  unit: 'day' | 'month' | 'year';
  every: number;
}

/** The tape's tiers at a span: what it labels, and its half and fine steps. */
export interface Graduation {
  label: Series;
  mid: Series | null;
  fine: Series | null;
  /** The finest unit the tape labels, which the sound's detents follow (audio/clockScore.ts). */
  unit: Precision;
  /** The years between the years it labels, 1 unless it labels years. */
  yearStep: number;
}

const day = (every: number): Series => ({ unit: 'day', every });
const month = (every: number): Series => ({ unit: 'month', every });
const year = (every: number): Series => ({ unit: 'year', every });

/** What the tape may label, finest first. */
const LADDER: readonly Series[] = [
  ...[1, 2, 5, 10].map(day),
  ...[1, 2, 3, 6].map(month),
  ...[1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].map(year),
];

/**
 * A labelled step's half step, and its fine steps, finest first. Years halve and divide by five
 * and ten while they stay whole; a year steps by months below that, and a month by days of the
 * month (the 15th its middle, every fifth day its fifths), as near as whole days come.
 */
function partsOf(series: Series): { mid: Series | null; fine: Series[] } {
  const { unit, every } = series;
  if (unit === 'day') {
    return {
      mid: every % 2 === 0 ? day(every / 2) : null,
      fine: [1, 2].filter((k) => k < every && (every / k) % 1 === 0 && k !== every / 2).map(day),
    };
  }
  if (unit === 'month') {
    if (every === 1) return { mid: day(15), fine: [day(5)] };
    if (every === 2) return { mid: month(1), fine: [day(15)] };
    return { mid: every % 2 === 0 ? month(every / 2) : null, fine: [month(1)] };
  }
  if (every === 1) return { mid: month(6), fine: [month(1), month(3)] };
  if (every === 2) return { mid: year(1), fine: [month(3), month(6)] };
  const whole = (k: number) => Number.isInteger(k) && k >= 1;
  return {
    mid: whole(every / 2) ? year(every / 2) : null,
    fine: [every / 10, every / 5].filter((k) => whole(k) && k !== every / 2).map(year),
  };
}

/** A series' mean length in days. */
export function seriesDays({ unit, every }: Series): number {
  return every * (unit === 'day' ? 1 : unit === 'month' ? MONTH_DAYS : YEAR_DAYS);
}

/** A year as the tape names it: BCE before 1 CE, CE after it where both show. */
export function tapeYearText(year: number, era: boolean): string {
  if (year <= 0) return `${groupDigits(1 - year)} BCE`;
  return calendarYearLabel(year, era);
}

/** Whether a stretch reaches both sides of 1 CE, so its years say which era. */
export function crossesEra(range: Span, calendar: Calendar = HISTORICAL): boolean {
  const era = calendar.day({ year: 1, month: 1, day: 1 });
  return range.start < era && range.end > era;
}

/** A label's length along the tape, px, generously: its face's letters and their spacing. */
export function labelWidth(text: string, face: 'numeral' | 'caps'): number {
  if (face === 'caps') return text.length * 8.1;
  let width = 0;
  for (const ch of text) width += /[0-9]/.test(ch) ? 9 : ch === ' ' ? 4.5 : ch === ',' ? 4 : 10.5;
  return width;
}

/**
 * The tape's tiers for `spanDays` across `rulePx`: the finest labelled step whose labels have
 * room, around `near` (whose years set how long a year's label runs), with its half step and the
 * finest fine step at least FINE_PX apart.
 */
export function graduation(
  spanDays: number,
  rulePx: number,
  near: number,
  calendar: Calendar = HISTORICAL,
): Graduation {
  const pxPerDay = rulePx / spanDays;
  const range = { start: near - spanDays / 2, end: near + spanDays / 2 };
  const era = crossesEra(range, calendar);
  const widest = Math.max(
    ...[range.start, range.end].map((d) =>
      labelWidth(tapeYearText(calendar.civil(d).year, era), 'numeral'),
    ),
  );
  const yearNeed = Math.max(72, widest + 26);
  const label =
    LADDER.find((series) => {
      const px = seriesDays(series) * pxPerDay;
      if (series.unit === 'day') return px >= DAY_NEED_PX && MONTH_DAYS * pxPerDay >= DAY_MONTH_PX;
      if (series.unit === 'month') return px >= MONTH_NEED_PX;
      return px >= yearNeed;
    }) ?? LADDER.at(-1)!;
  const { mid, fine } = partsOf(label);
  const shown = fine.find((series) => seriesDays(series) * pxPerDay >= FINE_PX) ?? null;
  return {
    label,
    mid,
    fine: shown,
    unit: label.unit,
    yearStep: label.unit === 'year' ? label.every : 1,
  };
}

/** The days a series' ticks fall on within `range`, in order. */
export function seriesTicks(
  series: Series,
  range: Span,
  calendar: Calendar = HISTORICAL,
): number[] {
  const { unit, every } = series;
  const days: number[] = [];
  const inRange = (d: number) => d >= range.start && d <= range.end;
  if (unit === 'year') {
    for (const mark of yearsIn(range, every, calendar))
      if (inRange(mark.start)) days.push(mark.start);
  } else if (unit === 'month') {
    for (const mark of monthsIn(range, every, calendar))
      if (inRange(mark.start)) days.push(mark.start);
  } else {
    for (let d = Math.ceil(range.start); d <= range.end; d += 1) {
      const date = calendar.civil(d).day;
      if (every === 1 || date === 1) {
        days.push(d);
        continue;
      }
      // A month's last days would crowd the next 1st: the step stops half a step short of it.
      const length = monthLength(d, calendar);
      if (date % every === 0 && date <= length - every / 2) days.push(d);
    }
  }
  return days;
}

/** The days in the month `d` falls in (21 in October 1582 as history counts it). */
function monthLength(d: number, calendar: Calendar): number {
  const date = calendar.civil(d);
  const next =
    date.month === 12
      ? { year: date.year + 1, month: 1, day: 1 }
      : { year: date.year, month: date.month + 1, day: 1 };
  return calendar.day(next) - calendar.day({ ...date, day: 1 });
}

export type TapeTier = 'label' | 'mid' | 'fine';

/** A label under a labelled tick, or a stop's name beside it. */
export interface TapeLabel {
  /** What it names, so a re-engraving keeps the same element. */
  key: string;
  day: number;
  text: string;
  face: 'numeral' | 'caps';
  anchor: 'start' | 'middle' | 'end';
}

export interface TapeEngraving {
  graduation: Graduation;
  ticks: Record<TapeTier, number[]>;
  labels: TapeLabel[];
  /** History's ends within the range, each an engraved double rule. */
  stops: { day: number; side: 'start' | 'end' }[];
  /** The stretches past history, which the tape runs on as unengraved leader. */
  leaders: Span[];
}

/** How far a stop's name stands from its rule, px. */
export const STOP_NAME_PX = 7;

/**
 * The tape's engraving over `range` (the days the ruler's buffer holds) at `spanDays` across
 * `rulePx`, within `extent` (history, its end exclusive). Labels are dropped where they would
 * crowd one of higher rank: a stop's name first, then a year or month named at its boundary.
 */
export function engraveTape(
  range: Span,
  spanDays: number,
  rulePx: number,
  extent: Span,
  calendar: Calendar = HISTORICAL,
): TapeEngraving {
  const center = (range.start + range.end) / 2;
  const grade = graduation(spanDays, rulePx, center, calendar);
  const pxPerDay = rulePx / spanDays;
  const within = {
    start: Math.max(range.start, extent.start),
    end: Math.min(range.end, extent.end),
  };
  const era = crossesEra(range, calendar);
  const ticks: Record<TapeTier, number[]> = { label: [], mid: [], fine: [] };
  const taken = new Set<number>();
  const tiers: [TapeTier, Series | null][] = [
    ['label', grade.label],
    ['mid', grade.mid],
    ['fine', grade.fine],
  ];
  if (within.end > within.start) {
    for (const [tier, series] of tiers) {
      if (!series) continue;
      for (const d of seriesTicks(series, within, calendar)) {
        // History's end is a stop, not a tick; nothing is cut past it.
        if (taken.has(d) || d >= extent.end) continue;
        taken.add(d);
        ticks[tier].push(d);
      }
    }
  }

  const ranked: { label: TapeLabel; rank: number }[] = [];
  const stops: TapeEngraving['stops'] = [];
  for (const [d, side] of [
    [extent.start, 'start'],
    [extent.end, 'end'],
  ] as const) {
    if (d < range.start || d > range.end) continue;
    stops.push({ day: d, side });
    const y = calendar.civil(side === 'start' ? d : d - 1).year;
    ranked.push({
      label: {
        key: `s${side}`,
        day: d,
        text: tapeYearText(y, false),
        face: 'numeral',
        anchor: side === 'start' ? 'start' : 'end',
      },
      rank: 3,
    });
  }
  for (const d of ticks.label) {
    const date = calendar.civil(d);
    const { unit } = grade.label;
    let text: string;
    let face: TapeLabel['face'] = 'numeral';
    let rank = 1;
    if (unit === 'year') text = tapeYearText(date.year, era);
    else if (date.day === 1 && (unit === 'day' || date.month === 1)) {
      // A month's 1st carries the month, and January its year.
      rank = 2;
      if (date.month === 1) text = tapeYearText(date.year, era);
      else [text, face] = [monthName(date.month).toUpperCase(), 'caps'];
    } else if (unit === 'month') [text, face] = [monthAbbrev(date.month).toUpperCase(), 'caps'];
    else text = String(date.day);
    ranked.push({ label: { key: `${unit[0]}${d}`, day: d, text, face, anchor: 'middle' }, rank });
  }

  // Higher ranks first, then left to right, each clear of those kept.
  const kept: { left: number; right: number }[] = [];
  const labels: TapeLabel[] = [];
  for (const { label } of ranked.sort((a, b) => b.rank - a.rank || a.label.day - b.label.day)) {
    const x = (label.day - range.start) * pxPerDay;
    const width = labelWidth(label.text, label.face);
    const left =
      label.anchor === 'start'
        ? x + STOP_NAME_PX
        : label.anchor === 'end'
          ? x - STOP_NAME_PX - width
          : x - width / 2;
    const right = left + width;
    if (kept.some((k) => left < k.right + LABEL_GAP_PX && right > k.left - LABEL_GAP_PX)) continue;
    kept.push({ left, right });
    labels.push(label);
  }
  labels.sort((a, b) => a.day - b.day);

  const leaders: Span[] = [];
  if (range.start < extent.start) leaders.push({ start: range.start, end: extent.start });
  if (range.end > extent.end) leaders.push({ start: extent.end, end: range.end });
  return { graduation: grade, ticks, labels, stops, leaders };
}

/**
 * The tape's fade toward the reels: 0 at the rule's end, rising to 1 TAPE_FADE_PX in, for the mask
 * the labels slide under. `x` is px from the rule's start, `rulePx` its length.
 */
export function tapeFade(x: number, rulePx: number): number {
  const edge = Math.min(x, rulePx - x);
  return Math.min(1, Math.max(0, edge / TAPE_FADE_PX));
}
