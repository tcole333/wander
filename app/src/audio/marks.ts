// The time ruler's marks as its playhead passes them (PRD, Audio: gear detents as the ruler passes
// years and months): a mark stands at the start of each day, month and year, weighted by what it
// begins, and the playhead passes the ones the ruler engraves at that moment: its days, its
// months, or the years it labels, every year or every labelled step of years (the free ruler's
// decades, centuries and millennia). Months and years are those of the ruler's calendar: a story's
// proleptic Gregorian, or Explore's historical one. Pure, for tests.
import { GREGORIAN, type Calendar } from '../story/dates';
import { monthsIn, yearsIn } from '../story/ui/format';
import type { DetentWeight } from './voices';

/** A mark on the ruler: the day it starts, and what it begins. */
export interface Mark {
  day: number;
  weight: DetentWeight;
}

/** The mark at the start of `day`: a year's on the first of January, a month's on any first. */
export function markAt(day: number, calendar: Calendar = GREGORIAN): Mark {
  const date = calendar.civil(day);
  if (date.day !== 1) return { day, weight: 'day' };
  return { day, weight: date.month === 1 ? 'year' : 'month' };
}

export interface MarkOptions {
  /** The calendar the ruler engraves. */
  calendar?: Calendar;
  /** The years between the years the ruler labels, where it engraves no finer than years. */
  yearStep?: number;
  /**
   * The most marks a move walks. A move past more of its finest marks than this (a leap along the
   * ruler's tier, or to history's ends) walks the next coarser ones instead: days give way to
   * months, months to years, and years to every tenth labelled year, so a leap across all of
   * history costs no more than a drag.
   */
  most?: number;
}

/** Days in the shortest month (the reform's October of 1582 had 21) and year, for estimates. */
const MONTH_DAYS = 21;
const YEAR_DAYS = 365;

/**
 * The marks the playhead passes moving from day `from` to `to`, in the order it passes them, none
 * finer than `finest` (the ruler's engraved unit). Going forward it passes a mark as it enters
 * that day; going back, as it leaves it.
 */
export function marksPassed(
  from: number,
  to: number,
  finest: DetentWeight,
  { calendar = GREGORIAN, yearStep = 1, most = Infinity }: MarkOptions = {},
): Mark[] {
  const first = Math.floor(Math.min(from, to)) + 1;
  const last = Math.floor(Math.max(from, to));
  if (last < first) return [];
  const days = last - first + 1;
  let unit = finest;
  let step = finest === 'year' ? yearStep : 1;
  const estimate = () =>
    unit === 'day' ? days : unit === 'month' ? days / MONTH_DAYS : days / (YEAR_DAYS * step);
  // Coarser steps stop once a step's labelled years lie farther apart than the move.
  while (estimate() > most && (unit !== 'year' || step * YEAR_DAYS < days)) {
    if (unit === 'year') step *= 10;
    else unit = unit === 'day' ? 'month' : 'year';
  }

  const marks: Mark[] = [];
  if (unit === 'day') {
    for (let day = first; day <= last; day += 1) marks.push(markAt(day, calendar));
  } else if (unit === 'month') {
    for (const month of monthsIn({ start: first, end: last + 1 }, 1, calendar)) {
      if (month.start < first) continue;
      marks.push({ day: month.start, weight: month.month === 1 ? 'year' : 'month' });
    }
  } else {
    for (const year of yearsIn({ start: first, end: last }, step, calendar)) {
      if (year.start >= first) marks.push({ day: year.start, weight: 'year' });
    }
  }
  return from <= to ? marks : marks.reverse();
}
